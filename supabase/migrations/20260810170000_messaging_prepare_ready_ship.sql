-- Messaging fulfilment continuation (additive, messaging channels only):
-- Start Preparing → Ready to Ship (allocate + lock configs) → Ship (fulfill + DO)
-- Classic Serapp / allocate-on-submit D2H path is unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- Inbox metadata for preparation / dispatch
-- ---------------------------------------------------------------------------
ALTER TABLE public.messaging_warehouse_inbox
  ADD COLUMN IF NOT EXISTS prepared_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepared_started_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS delivery_reference text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS vehicle_number text,
  ADD COLUMN IF NOT EXISTS ship_remarks text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messaging_warehouse_inbox_delivery_method_check'
      AND conrelid = 'public.messaging_warehouse_inbox'::regclass
  ) THEN
    ALTER TABLE public.messaging_warehouse_inbox
      ADD CONSTRAINT messaging_warehouse_inbox_delivery_method_check
      CHECK (
        delivery_method IS NULL
        OR delivery_method IN ('lalamove', 'company_transport', 'distributor_self_pickup', 'other')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Shared access helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_can_manage_inbox(p_inbox public.messaging_warehouse_inbox)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_org uuid;
  v_user_type text;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'service_role' OR public.is_hq_admin() THEN
    RETURN true;
  END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = auth.uid();
  v_user_type := public.get_org_type(v_user_org);

  IF v_user_type = 'HQ' AND (
    public.can_access_org(p_inbox.seller_hq_id) OR v_user_org = p_inbox.seller_hq_id
  ) THEN
    RETURN true;
  END IF;

  IF v_user_type = 'WH' AND (
    public.can_access_org(p_inbox.fulfillment_warehouse_id)
    OR v_user_org = p_inbox.fulfillment_warehouse_id
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_can_manage_inbox(public.messaging_warehouse_inbox) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_can_manage_inbox(public.messaging_warehouse_inbox)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Start preparing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_start_preparing(p_order_id uuid)
RETURNS public.messaging_warehouse_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order id is required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.order_type <> 'D2H' OR v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Only messaging D2H orders can use this workflow';
  END IF;
  IF v_order.status <> 'approved' THEN
    RAISE EXCEPTION 'Order must be approved before warehouse preparation';
  END IF;

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse inbox row not found for this order'; END IF;
  IF NOT public.messaging_can_manage_inbox(v_inbox) THEN
    RAISE EXCEPTION 'Not authorized to prepare this order';
  END IF;
  IF v_inbox.status NOT IN ('pending_preparation', 'preparing') THEN
    RAISE EXCEPTION 'Order is not awaiting preparation (status=%)', v_inbox.status;
  END IF;

  UPDATE public.messaging_warehouse_inbox
  SET status = 'preparing',
      prepared_started_at = COALESCE(prepared_started_at, now()),
      prepared_started_by = COALESCE(prepared_started_by, auth.uid()),
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  RETURN v_inbox;
END;
$$;

COMMENT ON FUNCTION public.messaging_start_preparing(uuid) IS
  'Messaging only: mark warehouse inbox as preparing. Does not allocate inventory.';

REVOKE ALL ON FUNCTION public.messaging_start_preparing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_start_preparing(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ready to ship = allocate reservation + lock resolved stock configs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_ready_to_ship(p_order_id uuid)
RETURNS public.messaging_warehouse_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
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
  IF v_inbox.status NOT IN ('pending_preparation', 'preparing', 'ready_to_ship') THEN
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

  -- Idempotent: if already ready and allocation exists, just refresh timestamps.
  IF v_inbox.status <> 'ready_to_ship' THEN
    PERFORM public.allocate_inventory_for_order(p_order_id);

    -- allocate_inventory_for_order clears confirmation; lock the resolved configs now
    -- because Ready to Ship is the warehouse commitment point for messaging orders.
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

  RETURN v_inbox;
END;
$$;

COMMENT ON FUNCTION public.messaging_ready_to_ship(uuid) IS
  'Messaging only: allocate inventory (reservation) and lock stock configs. Physical stock not deducted yet.';

REVOKE ALL ON FUNCTION public.messaging_ready_to_ship(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_ready_to_ship(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ship / dispatch = fulfill (deduct) + ensure DO + mark shipped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_ship_order(
  p_order_id uuid,
  p_delivery_method text DEFAULT 'other',
  p_delivery_reference text DEFAULT NULL,
  p_driver_name text DEFAULT NULL,
  p_vehicle_number text DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_method text := lower(trim(COALESCE(p_delivery_method, 'other')));
  v_do public.documents%ROWTYPE;
  v_do_created boolean := false;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order id is required'; END IF;
  IF v_method NOT IN ('lalamove', 'company_transport', 'distributor_self_pickup', 'other') THEN
    RAISE EXCEPTION 'Invalid delivery method';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.order_type <> 'D2H' OR v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Only messaging D2H orders can use this workflow';
  END IF;
  IF v_order.status NOT IN ('approved', 'warehouse_packed') THEN
    RAISE EXCEPTION 'Order must be approved before ship (status=%)', v_order.status;
  END IF;

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse inbox row not found for this order'; END IF;
  IF NOT public.messaging_can_manage_inbox(v_inbox) THEN
    RAISE EXCEPTION 'Not authorized to ship this order';
  END IF;
  IF v_inbox.status NOT IN ('ready_to_ship', 'shipped') THEN
    RAISE EXCEPTION 'Order must be ready to ship before dispatch (status=%)', v_inbox.status;
  END IF;

  IF v_inbox.status = 'ready_to_ship' THEN
    -- Deduct physical stock + credit buyer (existing ledger function).
    PERFORM public.fulfill_order_inventory(p_order_id);

    -- Ensure Delivery Order document exists (no invoice yet).
    SELECT * INTO v_do
    FROM public.documents
    WHERE order_id = p_order_id AND doc_type = 'DO'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by
      ) VALUES (
        v_order.company_id, v_order.id, 'DO', 'DO-' || v_order.order_no, 'pending',
        v_order.seller_org_id, v_order.buyer_org_id, auth.uid()
      )
      RETURNING * INTO v_do;
      v_do_created := true;
    END IF;

    UPDATE public.orders
    SET status = 'warehouse_packed',
        updated_by = auth.uid(),
        updated_at = now(),
        notes = trim(both FROM concat_ws(
          E'\n',
          NULLIF(v_order.notes, ''),
          format(
            'Shipped via messaging workflow (%s)%s%s',
            v_method,
            CASE WHEN NULLIF(trim(p_delivery_reference), '') IS NULL THEN '' ELSE format(' ref=%s', trim(p_delivery_reference)) END,
            CASE WHEN NULLIF(trim(p_remarks), '') IS NULL THEN '' ELSE format(' | %s', trim(p_remarks)) END
          )
        ))
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    UPDATE public.messaging_warehouse_inbox
    SET status = 'shipped',
        shipped_at = now(),
        shipped_by = auth.uid(),
        delivery_method = v_method,
        delivery_reference = NULLIF(trim(p_delivery_reference), ''),
        driver_name = NULLIF(trim(p_driver_name), ''),
        vehicle_number = NULLIF(trim(p_vehicle_number), ''),
        ship_remarks = NULLIF(trim(p_remarks), ''),
        updated_at = now()
    WHERE order_id = p_order_id
    RETURNING * INTO v_inbox;
  ELSE
    -- Idempotent replay
    SELECT * INTO v_do
    FROM public.documents
    WHERE order_id = p_order_id AND doc_type = 'DO'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'inbox', to_jsonb(v_inbox),
    'order_id', v_order.id,
    'order_status', v_order.status,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'do', CASE WHEN v_do.id IS NULL THEN NULL ELSE to_jsonb(v_do) END,
    'do_created', v_do_created
  );
END;
$$;

COMMENT ON FUNCTION public.messaging_ship_order(uuid, text, text, text, text, text) IS
  'Messaging only: deduct inventory, ensure DO, mark warehouse_packed/shipped. Does not create invoice.';

REVOKE ALL ON FUNCTION public.messaging_ship_order(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_ship_order(uuid, text, text, text, text, text)
  TO authenticated, service_role;

COMMIT;
