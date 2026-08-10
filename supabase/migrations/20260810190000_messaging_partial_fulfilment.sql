-- Messaging partial fulfilment (Phase 1, additive):
-- Warehouse can set prepared qty < ordered.
-- Ready to Ship with short lines → awaiting distributor accept (no allocate yet).
-- Distributor accept → shrink order lines to prepared qty → then Ready allocates.

BEGIN;

-- Allow new inbox status
ALTER TABLE public.messaging_warehouse_inbox
  DROP CONSTRAINT IF EXISTS messaging_warehouse_inbox_status_check;

ALTER TABLE public.messaging_warehouse_inbox
  ADD CONSTRAINT messaging_warehouse_inbox_status_check
  CHECK (status IN (
    'pending_preparation',
    'preparing',
    'awaiting_partial_confirmation',
    'ready_to_ship',
    'shipped',
    'cancelled'
  ));

ALTER TABLE public.messaging_warehouse_inbox
  ADD COLUMN IF NOT EXISTS partial_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS partial_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS partial_accepted_by uuid REFERENCES public.users(id);

-- Preparation lines (ordered vs prepared)
CREATE TABLE IF NOT EXISTS public.messaging_preparation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  ordered_quantity integer NOT NULL CHECK (ordered_quantity > 0),
  prepared_quantity integer NOT NULL CHECK (prepared_quantity >= 0),
  short_quantity integer GENERATED ALWAYS AS (GREATEST(ordered_quantity - prepared_quantity, 0)) STORED,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_prep_items_order
  ON public.messaging_preparation_items (order_id);

ALTER TABLE public.messaging_preparation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_prep_items_select ON public.messaging_preparation_items;
CREATE POLICY messaging_prep_items_select
  ON public.messaging_preparation_items FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (
          public.can_access_org(o.buyer_org_id)
          OR public.can_access_org(o.seller_org_id)
          OR public.can_access_org(COALESCE(o.fulfillment_warehouse_id, o.seller_org_id))
        )
    )
  );

REVOKE ALL ON TABLE public.messaging_preparation_items FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_preparation_items TO authenticated;
GRANT ALL ON TABLE public.messaging_preparation_items TO service_role;

-- Ensure prep rows exist (default prepared = ordered)
CREATE OR REPLACE FUNCTION public.messaging_ensure_preparation_items(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.messaging_preparation_items (
    order_id, order_item_id, ordered_quantity, prepared_quantity
  )
  SELECT oi.order_id, oi.id, oi.qty, oi.qty
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  ON CONFLICT (order_item_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_ensure_preparation_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_ensure_preparation_items(uuid)
  TO authenticated, service_role;

-- Set prepared quantities: [{order_item_id, prepared_quantity, remark?}, ...]
CREATE OR REPLACE FUNCTION public.messaging_set_prepared_quantities(
  p_order_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_item jsonb;
  v_item_id uuid;
  v_prepared integer;
  v_remark text;
  v_short_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Only messaging orders support prepared quantities';
  END IF;

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse inbox row not found'; END IF;
  IF NOT public.messaging_can_manage_inbox(v_inbox) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_inbox.status NOT IN ('pending_preparation', 'preparing', 'awaiting_partial_confirmation') THEN
    RAISE EXCEPTION 'Prepared quantities can only be edited before ready-to-ship (status=%)', v_inbox.status;
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

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'order_item_id', '')::uuid;
    v_prepared := (v_item->>'prepared_quantity')::integer;
    v_remark := NULLIF(trim(COALESCE(v_item->>'remark', '')), '');
    IF v_item_id IS NULL OR v_prepared IS NULL OR v_prepared < 0 THEN
      RAISE EXCEPTION 'Each item needs order_item_id and prepared_quantity >= 0';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.messaging_preparation_items
      WHERE order_id = p_order_id AND order_item_id = v_item_id
    ) THEN
      RAISE EXCEPTION 'Order item % is not on this order', v_item_id;
    END IF;

    IF v_prepared > (
      SELECT ordered_quantity FROM public.messaging_preparation_items
      WHERE order_item_id = v_item_id
    ) THEN
      RAISE EXCEPTION 'Prepared quantity cannot exceed ordered quantity';
    END IF;

    UPDATE public.messaging_preparation_items pi
    SET prepared_quantity = v_prepared,
        remark = COALESCE(v_remark, pi.remark),
        updated_at = now()
    WHERE pi.order_id = p_order_id
      AND pi.order_item_id = v_item_id;
  END LOOP;

  -- Editing prepared qty clears prior partial acceptance
  UPDATE public.messaging_warehouse_inbox
  SET status = 'preparing',
      partial_accepted_at = NULL,
      partial_accepted_by = NULL,
      partial_notified_at = NULL,
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  SELECT COUNT(*) INTO v_short_count
  FROM public.messaging_preparation_items
  WHERE order_id = p_order_id AND prepared_quantity < ordered_quantity;

  RETURN jsonb_build_object(
    'inbox', to_jsonb(v_inbox),
    'short_lines', v_short_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_set_prepared_quantities(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_set_prepared_quantities(uuid, jsonb)
  TO authenticated, service_role;

-- Apply prepared quantities onto order_items (after distributor accept, or when full)
CREATE OR REPLACE FUNCTION public.messaging_apply_prepared_quantities(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  PERFORM public.messaging_ensure_preparation_items(p_order_id);

  FOR v_row IN
    SELECT * FROM public.messaging_preparation_items
    WHERE order_id = p_order_id
  LOOP
    IF v_row.prepared_quantity <= 0 THEN
      DELETE FROM public.order_items WHERE id = v_row.order_item_id;
      DELETE FROM public.messaging_preparation_items WHERE id = v_row.id;
    ELSIF v_row.prepared_quantity < v_row.ordered_quantity THEN
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

REVOKE ALL ON FUNCTION public.messaging_apply_prepared_quantities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_apply_prepared_quantities(uuid)
  TO authenticated, service_role;

-- Replace ready-to-ship with partial gate (return type changes → drop first)
DROP FUNCTION IF EXISTS public.messaging_ready_to_ship(uuid);

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
    RAISE EXCEPTION 'Order must remain approved until ship';
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
      'allocated', false
    );
  END IF;

  IF v_inbox.status <> 'ready_to_ship' THEN
    -- Shrink lines to prepared qty before reservation
    PERFORM public.messaging_apply_prepared_quantities(p_order_id);
    PERFORM public.allocate_inventory_for_order(p_order_id);

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
      RAISE EXCEPTION 'Stock configuration could not be locked for all lines after allocation';
    END IF;
  END IF;

  UPDATE public.messaging_warehouse_inbox
  SET status = 'ready_to_ship',
      ready_at = COALESCE(ready_at, now()),
      ready_by = COALESCE(ready_by, auth.uid()),
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  RETURN jsonb_build_object(
    'inbox', to_jsonb(v_inbox),
    'status', 'ready_to_ship',
    'short_lines', 0,
    'allocated', true
  );
END;
$$;

COMMENT ON FUNCTION public.messaging_ready_to_ship(uuid) IS
  'Messaging: if prepared < ordered without distributor accept, park as awaiting_partial_confirmation; else apply prepared qty, allocate, lock configs.';

REVOKE ALL ON FUNCTION public.messaging_ready_to_ship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_ready_to_ship(uuid) TO authenticated, service_role;

-- Distributor accepts available prepared quantities (Phase 1: no backorder)
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

  UPDATE public.messaging_warehouse_inbox
  SET partial_accepted_at = now(),
      partial_accepted_by = p_user_id,
      status = 'preparing',
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

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
  'Messaging: distributor accepts available prepared qty; warehouse can then Ready to Ship (allocate).';

REVOKE ALL ON FUNCTION public.messaging_accept_partial(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_accept_partial(uuid, uuid, text, text)
  TO authenticated, service_role;

-- Helper to list short lines for notifications
CREATE OR REPLACE FUNCTION public.messaging_list_short_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_item_id', pi.order_item_id,
    'ordered', pi.ordered_quantity,
    'prepared', pi.prepared_quantity,
    'short', pi.short_quantity,
    'variant_name', pv.variant_name
  ) ORDER BY pi.created_at), '[]'::jsonb)
  FROM public.messaging_preparation_items pi
  JOIN public.order_items oi ON oi.id = pi.order_item_id
  LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
  WHERE pi.order_id = p_order_id
    AND pi.prepared_quantity < pi.ordered_quantity;
$$;

REVOKE ALL ON FUNCTION public.messaging_list_short_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_list_short_lines(uuid)
  TO authenticated, service_role;

COMMIT;
