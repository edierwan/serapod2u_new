-- Messaging Phase 1 (careful, additive):
-- 1) orders.source_channel — distinguish Telegram/WhatsApp from classic Serapp/web D2H
-- 2) submit_d2h_order — create submitted D2H WITHOUT inventory allocation
-- 3) orders_approve — for messaging channels: approve + SO + warehouse inbox only
--    (no fulfill / no invoice / no DO yet). Classic D2H/S2D path unchanged.
-- 4) messaging_warehouse_inbox — warehouse "incoming" after HQ approve

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Source channel on orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source_channel text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_source_channel_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_source_channel_check
      CHECK (
        source_channel IS NULL
        OR source_channel IN ('telegram', 'whatsapp', 'web', 'admin', 'api')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.orders.source_channel IS
  'Order intake channel. NULL = classic/web/Serapp allocate-on-submit path. telegram/whatsapp = messaging fulfilment (submit without allocate).';

CREATE INDEX IF NOT EXISTS idx_orders_source_channel_status
  ON public.orders (source_channel, status)
  WHERE source_channel IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Warehouse inbox for messaging orders (populated on HQ approve)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_warehouse_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  buyer_org_id uuid NOT NULL,
  seller_hq_id uuid NOT NULL,
  fulfillment_warehouse_id uuid NOT NULL,
  source_channel text NOT NULL,
  status text NOT NULL DEFAULT 'pending_preparation'
    CHECK (status IN (
      'pending_preparation',
      'preparing',
      'ready_to_ship',
      'shipped',
      'cancelled'
    )),
  order_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_warehouse_inbox_wh_status
  ON public.messaging_warehouse_inbox (fulfillment_warehouse_id, status, created_at DESC);

COMMENT ON TABLE public.messaging_warehouse_inbox IS
  'Warehouse incoming queue for messaging D2H orders after HQ approve. Allocate/ship happen in later steps.';

ALTER TABLE public.messaging_warehouse_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_warehouse_inbox_select ON public.messaging_warehouse_inbox;
CREATE POLICY messaging_warehouse_inbox_select
  ON public.messaging_warehouse_inbox
  FOR SELECT
  TO authenticated
  USING (
    public.is_hq_admin()
    OR public.can_access_org(fulfillment_warehouse_id)
    OR public.can_access_org(seller_hq_id)
    OR public.can_access_org(buyer_org_id)
  );

-- Service role / security definer writers; no direct insert/update from clients.
REVOKE ALL ON TABLE public.messaging_warehouse_inbox FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_warehouse_inbox TO authenticated;
GRANT ALL ON TABLE public.messaging_warehouse_inbox TO service_role;

-- ---------------------------------------------------------------------------
-- 3. submit_d2h_order — same as submit_and_allocate_d2h_order but NO allocate
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

  -- Serialize concurrent submits for the same fulfillment warehouse (same as allocate path).
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'd2h-submit', p_seller_org_id::text, p_fulfillment_warehouse_id::text),
    0
  ));

  SELECT * INTO v_buyer FROM public.organizations WHERE id = p_buyer_org_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buyer organization not found';
  END IF;
  SELECT * INTO v_seller FROM public.organizations WHERE id = p_seller_org_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller organization not found';
  END IF;
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

  -- Submit only — do NOT allocate. Reservation happens later (ready-to-ship).
  UPDATE public.orders
  SET status = 'submitted',
      updated_by = v_actor,
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

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
      IF FOUND THEN
        RETURN v_order;
      END IF;
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.submit_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, text) IS
  'Messaging D2H submit: creates draft+items, sets submitted, snapshots unit prices on lines, does NOT allocate inventory. Classic Serapp continues to use submit_and_allocate_d2h_order.';

REVOKE ALL ON FUNCTION public.submit_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. orders_approve — messaging branch additive; classic path unchanged
-- ---------------------------------------------------------------------------
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

  v_messaging := (
    v.order_type = 'D2H'
    AND v.source_channel IN ('telegram', 'whatsapp')
  );

  IF v_messaging THEN
    -- Messaging fulfilment: HQ approve opens warehouse work. No inventory deduct,
    -- no invoice yet, no DO yet (warehouse creates DO at ship / ready-to-ship later).
    IF NOT EXISTS (
      SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'SO'
    ) THEN
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
      order_id,
      company_id,
      buyer_org_id,
      seller_hq_id,
      fulfillment_warehouse_id,
      source_channel,
      status,
      order_no
    ) VALUES (
      v.id,
      v.company_id,
      v.buyer_org_id,
      v_hq,
      COALESCE(v.fulfillment_warehouse_id, v.seller_org_id),
      v.source_channel,
      'pending_preparation',
      COALESCE(v.display_doc_no, v.order_no)
    )
    ON CONFLICT (order_id) DO UPDATE
      SET status = EXCLUDED.status,
          updated_at = now(),
          order_no = EXCLUDED.order_no;

  ELSIF v.order_type IN ('D2H', 'S2D') THEN
    -- Classic path (unchanged): fulfill inventory + ensure SO/DO/Invoice
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

COMMENT ON FUNCTION public.orders_approve(uuid) IS
  'Approve submitted order. Classic D2H/S2D: fulfill inventory + ensure SO/DO/Invoice. Messaging D2H (source_channel telegram/whatsapp): approve + SO + warehouse inbox only (no allocate/fulfill/invoice/DO).';

COMMIT;
