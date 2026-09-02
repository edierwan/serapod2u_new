-- Align messaging flow with Technical Specification (source of truth):
-- Confirm → validate stock → reserve → SO + warehouse inbox (no HQ approve gate).
-- Ready to Ship locks prepared qty only (reservation already held from confirm).
-- Ship deducts physical stock. Partial accept releases excess reservation.
-- Classic Serapp / submit_and_allocate / non-messaging orders unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- Notification log (§39)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  channel text NOT NULL,
  message_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  recipient_identifier text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_notifications_ref
  ON public.message_notifications (reference_type, reference_id, created_at DESC);

ALTER TABLE public.message_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_notifications_select ON public.message_notifications;
CREATE POLICY message_notifications_select
  ON public.message_notifications FOR SELECT TO authenticated
  USING (public.is_hq_admin());

REVOKE ALL ON TABLE public.message_notifications FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.message_notifications TO authenticated;
GRANT ALL ON TABLE public.message_notifications TO service_role;

-- ---------------------------------------------------------------------------
-- Messaging settings (§6 — server-side master config)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_channel_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hq_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  messaging_orders_enabled boolean NOT NULL DEFAULT true,
  telegram_ordering_enabled boolean NOT NULL DEFAULT true,
  telegram_notifications_enabled boolean NOT NULL DEFAULT true,
  whatsapp_ordering_enabled boolean NOT NULL DEFAULT false,
  default_fulfillment_warehouse_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  warehouse_telegram_chat_id text,
  finance_telegram_chat_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (hq_organization_id)
);

ALTER TABLE public.messaging_channel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_channel_settings_select ON public.messaging_channel_settings;
CREATE POLICY messaging_channel_settings_select
  ON public.messaging_channel_settings FOR SELECT TO authenticated
  USING (public.is_hq_admin());

DROP POLICY IF EXISTS messaging_channel_settings_write ON public.messaging_channel_settings;
CREATE POLICY messaging_channel_settings_write
  ON public.messaging_channel_settings FOR ALL TO authenticated
  USING (public.is_hq_admin())
  WITH CHECK (public.is_hq_admin());

REVOKE ALL ON TABLE public.messaging_channel_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.messaging_channel_settings TO authenticated;
GRANT ALL ON TABLE public.messaging_channel_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Release excess reservation when prepared qty < originally reserved (§36)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_release_allocation_delta(
  p_order_id uuid,
  p_order_item_id uuid,
  p_release_qty integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_org uuid;
  v_cfg uuid;
  v_cost numeric;
BEGIN
  IF p_release_qty IS NULL OR p_release_qty <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order item not found'; END IF;

  v_org := public.order_inventory_organization(p_order_id);
  v_cfg := COALESCE(
    v_item.stock_config_id,
    (
      SELECT sm.stock_config_id
      FROM public.stock_movements sm
      WHERE sm.reference_type = 'order'
        AND sm.reference_id = p_order_id
        AND sm.variant_id = v_item.variant_id
        AND sm.movement_type = 'allocation'
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 1
    ),
    public.resolve_so_stock_config(v_item.variant_id, v_org, v_order.buyer_org_id, v_item.qty)
  );

  SELECT COALESCE(average_cost, 0) INTO v_cost
  FROM public.product_inventory
  WHERE variant_id = v_item.variant_id
    AND organization_id = v_org
    AND stock_config_id = v_cfg
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory not found to release reservation delta';
  END IF;

  UPDATE public.product_inventory
  SET quantity_allocated = GREATEST(0, quantity_allocated - p_release_qty),
      updated_at = now()
  WHERE variant_id = v_item.variant_id
    AND organization_id = v_org
    AND stock_config_id = v_cfg;

  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, reference_no,
    variant_id, stock_config_id,
    from_organization_id, to_organization_id,
    quantity_change, quantity_before, quantity_after,
    unit_cost, company_id, created_by, notes
  ) VALUES (
    'deallocation', 'order', p_order_id, v_order.order_no,
    v_item.variant_id, v_cfg,
    v_order.buyer_org_id, v_org,
    -p_release_qty, p_release_qty, GREATEST(0, p_release_qty - p_release_qty),
    v_cost, v_order.company_id, COALESCE(auth.uid(), v_order.created_by),
    format('Partial fulfilment: released %s units reservation', p_release_qty)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_release_allocation_delta(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_release_allocation_delta(uuid, uuid, integer)
  TO authenticated, service_role;

-- Apply prepared qty + release excess reservation (spec §36)
CREATE OR REPLACE FUNCTION public.messaging_apply_prepared_quantities(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_release integer;
BEGIN
  PERFORM public.messaging_ensure_preparation_items(p_order_id);

  FOR v_row IN
    SELECT * FROM public.messaging_preparation_items
    WHERE order_id = p_order_id
  LOOP
    IF v_row.prepared_quantity <= 0 THEN
      v_release := v_row.ordered_quantity;
      IF v_release > 0 THEN
        PERFORM public.messaging_release_allocation_delta(
          p_order_id, v_row.order_item_id, v_release
        );
      END IF;
      DELETE FROM public.order_items WHERE id = v_row.order_item_id;
      DELETE FROM public.messaging_preparation_items WHERE id = v_row.id;
    ELSIF v_row.prepared_quantity < v_row.ordered_quantity THEN
      v_release := v_row.ordered_quantity - v_row.prepared_quantity;
      PERFORM public.messaging_release_allocation_delta(
        p_order_id, v_row.order_item_id, v_release
      );

      UPDATE public.order_items
      SET qty = v_row.prepared_quantity,
          updated_at = now()
      WHERE id = v_row.order_item_id;

      UPDATE public.messaging_preparation_items
      SET ordered_quantity = v_row.prepared_quantity,
          prepared_quantity = v_row.prepared_quantity,
          updated_at = now()
      WHERE id = v_row.id;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'No lines remain after applying prepared quantities';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Confirm = reserve + SO + warehouse inbox (§10–§12, §15)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_d2h_order(
  p_company_id uuid,
  p_buyer_org_id uuid,
  p_seller_org_id uuid,
  p_fulfillment_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_source_channel text DEFAULT 'telegram'
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(p_created_by, auth.uid());
  v_order public.orders%ROWTYPE;
  v_existing_id uuid;
  v_item jsonb;
  v_variant uuid;
  v_product uuid;
  v_qty integer;
  v_price numeric;
  v_buyer public.organizations%ROWTYPE;
  v_seller public.organizations%ROWTYPE;
  v_hq uuid;
  v_channel text := lower(trim(COALESCE(p_source_channel, 'telegram')));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required';
  END IF;
  IF p_company_id IS NULL OR p_buyer_org_id IS NULL OR p_seller_org_id IS NULL THEN
    RAISE EXCEPTION 'Company, buyer and seller are required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  IF v_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'submit_d2h_order is only for messaging channels (telegram/whatsapp)';
  END IF;

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT order_id INTO v_existing_id
    FROM public.d2h_order_submit_idempotency
    WHERE idempotency_key = trim(p_idempotency_key);
    IF v_existing_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.orders WHERE id = v_existing_id;
      RETURN v_order;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'd2h-submit', p_seller_org_id::text, p_fulfillment_warehouse_id::text),
    0
  ));

  SELECT * INTO v_buyer FROM public.organizations WHERE id = p_buyer_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Buyer organization not found'; END IF;
  SELECT * INTO v_seller FROM public.organizations WHERE id = p_seller_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Seller organization not found'; END IF;
  IF v_buyer.org_type_code <> 'DIST' OR v_buyer.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Buyer must be an active distributor';
  END IF;
  IF v_seller.org_type_code NOT IN ('HQ', 'WH') OR v_seller.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Seller must be an active HQ or warehouse';
  END IF;

  v_hq := public.resolve_seller_hq_organization(p_seller_org_id);
  IF v_buyer.parent_org_id IS DISTINCT FROM v_hq THEN
    RAISE EXCEPTION 'Distributor is not under the seller HQ';
  END IF;

  PERFORM public.assert_hq_fulfillment_warehouse(p_seller_org_id, p_fulfillment_warehouse_id);

  IF auth.role() = 'authenticated' THEN
    IF NOT (public.is_hq_admin() OR public.can_access_org(p_seller_org_id) OR public.can_access_org(v_hq)) THEN
      RAISE EXCEPTION 'Not authorized to create this D2H order';
    END IF;
  END IF;

  INSERT INTO public.orders (
    order_type, company_id, buyer_org_id, seller_org_id,
    fulfillment_warehouse_id, status, has_rfid, has_points, has_lucky_draw,
    has_redeem, notes, created_by, source_channel
  ) VALUES (
    'D2H', p_company_id, p_buyer_org_id, p_seller_org_id,
    p_fulfillment_warehouse_id, 'draft', false, true, true,
    true, p_notes, v_actor, v_channel
  )
  RETURNING * INTO v_order;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := NULLIF(v_item->>'variant_id', '')::uuid;
    v_product := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := (v_item->>'qty')::integer;
    v_price := (v_item->>'unit_price')::numeric;
    IF v_variant IS NULL OR v_product IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Each item requires product_id, variant_id and a positive qty';
    END IF;
    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'Each item requires a positive unit_price';
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, qty, unit_price, company_id
    ) VALUES (
      v_order.id, v_product, v_variant, v_qty, v_price, p_company_id
    );
  END LOOP;

  UPDATE public.orders
  SET status = 'submitted',
      updated_by = v_actor,
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  -- §10: final stock validation + reserve (no physical deduct)
  PERFORM public.allocate_inventory_for_order(v_order.id);

  IF NOT EXISTS (
    SELECT 1 FROM public.documents WHERE order_id = v_order.id AND doc_type = 'SO'
  ) THEN
    INSERT INTO public.documents (
      company_id, order_id, doc_type, doc_no, status,
      issued_by_org_id, issued_to_org_id, created_by
    ) VALUES (
      v_order.company_id, v_order.id, 'SO', v_order.order_no, 'pending',
      v_order.seller_org_id, v_order.buyer_org_id, v_actor
    );
  END IF;

  -- Confirmed (mapped to approved in Serapod2U status model)
  UPDATE public.orders
  SET status = 'approved',
      approved_by = v_actor,
      approved_at = now(),
      updated_by = v_actor,
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.messaging_warehouse_inbox (
    order_id, company_id, buyer_org_id, seller_hq_id,
    fulfillment_warehouse_id, source_channel, status, order_no
  ) VALUES (
    v_order.id, v_order.company_id, v_order.buyer_org_id, v_hq,
    COALESCE(v_order.fulfillment_warehouse_id, v_order.seller_org_id),
    v_channel, 'pending_preparation',
    COALESCE(v_order.display_doc_no, v_order.order_no)
  )
  ON CONFLICT (order_id) DO UPDATE
    SET status = 'pending_preparation',
        updated_at = now(),
        order_no = EXCLUDED.order_no;

  IF to_regprocedure('public.messaging_timeline_append(uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public.messaging_timeline_append(
      v_order.id, 'ORDER_CONFIRMED', v_actor, v_channel,
      'draft', 'approved',
      jsonb_build_object('order_no', COALESCE(v_order.display_doc_no, v_order.order_no))
    );
    PERFORM public.messaging_timeline_append(
      v_order.id, 'INVENTORY_RESERVED', v_actor, v_channel,
      NULL, NULL, '{}'::jsonb
    );
    PERFORM public.messaging_timeline_append(
      v_order.id, 'WAREHOUSE_NOTIFIED', v_actor, v_channel,
      NULL, 'pending_preparation', '{}'::jsonb
    );
  END IF;

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    INSERT INTO public.d2h_order_submit_idempotency (idempotency_key, order_id, created_by)
    VALUES (trim(p_idempotency_key), v_order.id, v_actor)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  RETURN v_order;
EXCEPTION
  WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT o.* INTO v_order
      FROM public.d2h_order_submit_idempotency i
      JOIN public.orders o ON o.id = i.order_id
      WHERE i.idempotency_key = trim(p_idempotency_key);
      IF FOUND THEN RETURN v_order; END IF;
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.submit_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, text) IS
  'Messaging confirm: validate stock, reserve inventory, create SO, auto-approve, open warehouse inbox. No physical deduct until ship.';

-- orders_approve: messaging orders are confirmed at submit; keep idempotent legacy path
CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.orders;
  v_user_org uuid;
  v_user_type text;
  v_creator_level int;
  v_user_level int;
  v_authority boolean;
  v_can boolean := false;
  v_messaging boolean := false;
  v_hq uuid;
BEGIN
  SELECT * INTO v FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  v_messaging := (v.order_type = 'D2H' AND v.source_channel IN ('telegram', 'whatsapp'));

  IF v_messaging AND v.status = 'approved' THEN
    -- Already confirmed via messaging submit; ensure inbox exists only.
    v_hq := public.resolve_seller_hq_organization(v.seller_org_id);
    INSERT INTO public.messaging_warehouse_inbox (
      order_id, company_id, buyer_org_id, seller_hq_id,
      fulfillment_warehouse_id, source_channel, status, order_no
    ) VALUES (
      v.id, v.company_id, v.buyer_org_id, v_hq,
      COALESCE(v.fulfillment_warehouse_id, v.seller_org_id),
      v.source_channel, 'pending_preparation',
      COALESCE(v.display_doc_no, v.order_no)
    )
    ON CONFLICT (order_id) DO NOTHING;
    RETURN v;
  END IF;

  IF v.status <> 'submitted' THEN RAISE EXCEPTION 'Order must be in submitted'; END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = auth.uid();
  v_user_type := public.get_org_type(v_user_org);
  SELECT r.role_level INTO v_creator_level
    FROM public.users u JOIN public.roles r ON r.role_code = u.role_code WHERE u.id = v.created_by;
  SELECT r.role_level INTO v_user_level
    FROM public.users u JOIN public.roles r ON r.role_code = u.role_code WHERE u.id = auth.uid();
  v_creator_level := COALESCE(v_creator_level, 999);
  v_user_level := COALESCE(v_user_level, 999);
  v_authority := CASE
    WHEN v_creator_level = 10 THEN v_user_level IN (10, 20)
    ELSE v_user_level < v_creator_level
  END;

  IF v.order_type = 'H2M' THEN
    v_can := v_user_type = 'HQ' AND v_authority;
  ELSIF v.order_type = 'D2H' THEN
    v_can := v_user_type = 'HQ' AND (v_authority OR public.is_hq_admin());
  ELSIF v.order_type = 'S2D' THEN
    v_can := v_user_org = v.seller_org_id AND v_authority;
  END IF;
  IF NOT v_can THEN RAISE EXCEPTION 'User lacks permission to approve this order type'; END IF;

  IF v.parent_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders WHERE id = v.parent_order_id AND status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Parent order must be approved first';
    END IF;
    PERFORM public.validate_child_quantities(p_order_id, v.parent_order_id);
  END IF;

  IF v_messaging THEN
    -- Legacy messaging orders still in submitted (pre-spec migration)
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type = 'order' AND sm.reference_id = v.id AND sm.movement_type = 'allocation'
    ) THEN
      PERFORM public.allocate_inventory_for_order(p_order_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'SO') THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v.company_id, v.id, 'SO', v.order_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid()
      );
    END IF;

    v_hq := public.resolve_seller_hq_organization(v.seller_org_id);
    INSERT INTO public.messaging_warehouse_inbox (
      order_id, company_id, buyer_org_id, seller_hq_id,
      fulfillment_warehouse_id, source_channel, status, order_no
    ) VALUES (
      v.id, v.company_id, v.buyer_org_id, v_hq,
      COALESCE(v.fulfillment_warehouse_id, v.seller_org_id),
      v.source_channel, 'pending_preparation',
      COALESCE(v.display_doc_no, v.order_no)
    )
    ON CONFLICT (order_id) DO UPDATE
      SET status = EXCLUDED.status, updated_at = now(), order_no = EXCLUDED.order_no;

  ELSIF v.order_type IN ('D2H', 'S2D') THEN
    PERFORM public.fulfill_order_inventory(p_order_id);

    IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'SO') THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v.company_id, v.id, 'SO', v.order_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid()
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'DO') THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v.company_id, v.id, 'DO', 'DO-' || v.order_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid()
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'INVOICE') THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v.company_id, v.id, 'INVOICE', 'INV-' || v.order_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid()
      );
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'PO') THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v.company_id, v.id, 'PO', 'PO-' || v.order_no, 'pending',
        v.buyer_org_id, v.seller_org_id, auth.uid()
      );
    END IF;
  END IF;

  UPDATE public.orders
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v;

  RETURN v;
END;
$$;

-- Ready to Ship: reservation already held; lock prepared qty + configs (§19)
CREATE OR REPLACE FUNCTION public.messaging_ready_to_ship(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_short_count integer := 0;
  v_needs_accept boolean := false;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order id is required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.order_type <> 'D2H' OR v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Only messaging D2H orders can use this workflow';
  END IF;
  IF v_order.status <> 'approved' THEN
    RAISE EXCEPTION 'Order must remain confirmed/approved until ship';
  END IF;

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse inbox row not found for this order'; END IF;
  IF NOT public.messaging_can_manage_inbox(v_inbox) THEN
    RAISE EXCEPTION 'Not authorized for ready-to-ship on this order';
  END IF;
  IF v_inbox.status NOT IN (
    'pending_preparation', 'preparing', 'awaiting_partial_confirmation', 'ready_to_ship'
  ) THEN
    RAISE EXCEPTION 'Order cannot move to ready-to-ship (status=%)', v_inbox.status;
  END IF;

  IF v_inbox.status = 'pending_preparation' THEN
    UPDATE public.messaging_warehouse_inbox
    SET status = 'preparing',
        prepared_started_at = COALESCE(prepared_started_at, now()),
        prepared_started_by = COALESCE(prepared_started_by, auth.uid()),
        updated_at = now()
    WHERE order_id = p_order_id
    RETURNING * INTO v_inbox;
  END IF;

  PERFORM public.messaging_ensure_preparation_items(p_order_id);

  SELECT COUNT(*) INTO v_short_count
  FROM public.messaging_preparation_items
  WHERE order_id = p_order_id AND prepared_quantity < ordered_quantity;

  v_needs_accept := (v_short_count > 0 AND v_inbox.partial_accepted_at IS NULL);

  IF v_needs_accept THEN
    UPDATE public.messaging_warehouse_inbox
    SET status = 'awaiting_partial_confirmation',
        partial_notified_at = COALESCE(partial_notified_at, now()),
        updated_at = now()
    WHERE order_id = p_order_id
    RETURNING * INTO v_inbox;

    RETURN jsonb_build_object(
      'inbox', to_jsonb(v_inbox),
      'status', 'awaiting_partial_confirmation',
      'short_lines', v_short_count,
      'allocated', true
    );
  END IF;

  IF v_inbox.status <> 'ready_to_ship' THEN
    IF v_inbox.partial_accepted_at IS NOT NULL OR v_short_count = 0 THEN
      PERFORM public.messaging_apply_prepared_quantities(p_order_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type = 'order' AND sm.reference_id = p_order_id AND sm.movement_type = 'allocation'
    ) THEN
      PERFORM public.allocate_inventory_for_order(p_order_id);
    END IF;

    UPDATE public.order_items
    SET stock_config_confirmed_at = now(),
        stock_config_confirmed_by = auth.uid(),
        updated_at = now()
    WHERE order_id = p_order_id
      AND stock_config_id IS NOT NULL
      AND stock_config_confirmed_at IS NULL;

    IF EXISTS (
      SELECT 1 FROM public.order_items
      WHERE order_id = p_order_id
        AND (stock_config_id IS NULL OR stock_config_confirmed_at IS NULL)
    ) THEN
      RAISE EXCEPTION 'Stock configuration could not be locked for all lines';
    END IF;
  END IF;

  UPDATE public.messaging_warehouse_inbox
  SET status = 'ready_to_ship',
      ready_at = COALESCE(ready_at, now()),
      ready_by = COALESCE(ready_by, auth.uid()),
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  IF to_regprocedure('public.messaging_timeline_append(uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public.messaging_timeline_append(
      p_order_id, 'READY_TO_SHIP', auth.uid(), v_inbox.source_channel,
      v_inbox.status, 'ready_to_ship', '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'inbox', to_jsonb(v_inbox),
    'status', 'ready_to_ship',
    'short_lines', 0,
    'allocated', true
  );
END;
$$;

COMMENT ON FUNCTION public.messaging_ready_to_ship(uuid) IS
  'Messaging: partial gate if needed; lock prepared qty/configs. Reservation held from confirm.';

-- Partial accept: shrink lines + release excess reservation before ready-to-ship
CREATE OR REPLACE FUNCTION public.messaging_accept_partial(
  p_order_id uuid,
  p_user_id uuid,
  p_channel text DEFAULT 'telegram',
  p_channel_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_short_count integer := 0;
BEGIN
  v_order := public.messaging_assert_distributor_order(p_order_id, p_user_id);

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaging fulfilment record not found'; END IF;
  IF v_inbox.status <> 'awaiting_partial_confirmation' THEN
    RAISE EXCEPTION 'Order is not awaiting partial confirmation (status=%)', v_inbox.status;
  END IF;

  SELECT COUNT(*) INTO v_short_count
  FROM public.messaging_preparation_items
  WHERE order_id = p_order_id AND prepared_quantity < ordered_quantity;

  PERFORM public.messaging_apply_prepared_quantities(p_order_id);

  UPDATE public.messaging_warehouse_inbox
  SET partial_accepted_at = now(),
      partial_accepted_by = p_user_id,
      status = 'preparing',
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  IF to_regprocedure('public.messaging_timeline_append(uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public.messaging_timeline_append(
      p_order_id, 'PARTIAL_FULFILMENT_ACCEPTED', p_user_id, lower(trim(COALESCE(p_channel, 'telegram'))),
      'awaiting_partial_confirmation', 'preparing',
      jsonb_build_object('short_lines', v_short_count)
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'short_lines', v_short_count,
    'status', v_inbox.status,
    'channel', lower(trim(COALESCE(p_channel, 'telegram')))
  );
END;
$$;

COMMENT ON FUNCTION public.messaging_accept_partial(uuid, uuid, text, text) IS
  'Messaging: distributor accepts available prepared qty; releases excess reservation.';

COMMIT;
