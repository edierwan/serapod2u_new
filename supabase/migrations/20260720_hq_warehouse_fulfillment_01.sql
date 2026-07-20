-- ============================================================================
-- HQ Warehouse Inventory Flow — Batch 1
-- Distributor Order fulfillment warehouse selection
-- ----------------------------------------------------------------------------
-- Additive / rerunnable. No historical order backfill.
--
-- Default fulfillment warehouse storage (already exists):
--   organizations.default_warehouse_org_id
--   = application setting "default_distributor_fulfillment_warehouse_id"
-- Staging currently points Serapod HQ default at Serapod Warehouse Balakong.
--
-- This migration:
--   1. Adds nullable orders.fulfillment_warehouse_id (FK organizations)
--   2. Resolves inventory org from that field (legacy-safe fallback)
--   3. Guards warehouse validity + immutability after draft
--   4. Adds atomic D2H submit + allocate RPC with optional idempotency key
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Order-level fulfillment warehouse (nullable, backward compatible)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_fulfillment_warehouse_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_fulfillment_warehouse_id_fkey
      FOREIGN KEY (fulfillment_warehouse_id)
      REFERENCES public.organizations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_warehouse_id
  ON public.orders (fulfillment_warehouse_id)
  WHERE fulfillment_warehouse_id IS NOT NULL;

COMMENT ON COLUMN public.orders.fulfillment_warehouse_id IS
  'D2H/S2D source warehouse used for availability, allocation, fulfillment and reversal. Distinct from warehouse_org_id (H2M receiving warehouse). Nullable for legacy orders.';

COMMENT ON COLUMN public.organizations.default_warehouse_org_id IS
  'Default distributor fulfillment warehouse for this HQ (application key: default_distributor_fulfillment_warehouse_id). Must be an active WH child of this HQ. Used when creating new D2H orders; never rewritten onto historical orders.';

-- ---------------------------------------------------------------------------
-- 2. Helpers: HQ resolution + warehouse validation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_seller_hq_organization(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % not found', p_org_id;
  END IF;
  IF v_org.org_type_code = 'HQ' THEN
    RETURN v_org.id;
  END IF;
  IF v_org.org_type_code = 'WH' THEN
    IF v_org.parent_org_id IS NULL THEN
      RAISE EXCEPTION 'Warehouse % is not linked to an HQ', p_org_id;
    END IF;
    RETURN v_org.parent_org_id;
  END IF;
  RAISE EXCEPTION 'Organization % is not an HQ or warehouse seller', p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_active_hq_fulfillment_warehouse(
  p_hq_org_id uuid,
  p_warehouse_org_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations wh
    JOIN public.organizations hq ON hq.id = wh.parent_org_id
    WHERE wh.id = p_warehouse_org_id
      AND wh.org_type_code = 'WH'
      AND wh.is_active = true
      AND hq.id = p_hq_org_id
      AND hq.org_type_code = 'HQ'
      AND hq.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_hq_fulfillment_warehouse(
  p_seller_org_id uuid,
  p_warehouse_org_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hq uuid;
  v_name text;
BEGIN
  IF p_warehouse_org_id IS NULL THEN
    RAISE EXCEPTION 'Fulfillment warehouse is required';
  END IF;
  v_hq := public.resolve_seller_hq_organization(p_seller_org_id);
  IF NOT public.is_active_hq_fulfillment_warehouse(v_hq, p_warehouse_org_id) THEN
    SELECT org_name INTO v_name FROM public.organizations WHERE id = p_warehouse_org_id;
    RAISE EXCEPTION
      'Fulfillment warehouse % is not an active warehouse under the seller HQ',
      COALESCE(v_name, p_warehouse_org_id::text);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Resolve inventory organization from fulfillment warehouse (legacy-safe)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_inventory_organization(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller uuid;
  v_type text;
  v_fulfillment uuid;
  v_wh uuid;
  v_alloc_org uuid;
BEGIN
  SELECT o.seller_org_id, org.org_type_code, o.fulfillment_warehouse_id
    INTO v_seller, v_type, v_fulfillment
  FROM public.orders o
  JOIN public.organizations org ON org.id = o.seller_org_id
  WHERE o.id = p_order_id;

  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Preferred: explicit order fulfillment warehouse.
  IF v_fulfillment IS NOT NULL THEN
    RETURN v_fulfillment;
  END IF;

  -- Legacy submitted/allocated/fulfilled orders: keep the original source.
  SELECT sm.from_organization_id
    INTO v_alloc_org
  FROM public.stock_movements sm
  WHERE sm.reference_type = 'order'
    AND sm.reference_id = p_order_id
    AND sm.movement_type IN ('allocation', 'order_fulfillment')
    AND sm.from_organization_id IS NOT NULL
  ORDER BY
    CASE WHEN sm.movement_type = 'allocation' THEN 0 ELSE 1 END,
    sm.created_at,
    sm.id
  LIMIT 1;

  IF v_alloc_org IS NOT NULL THEN
    RETURN v_alloc_org;
  END IF;

  -- Legacy drafts / pre-migration rows only: previous first-active-WH fallback.
  IF v_type = 'HQ' THEN
    SELECT id INTO v_wh
    FROM public.organizations
    WHERE parent_org_id = v_seller
      AND org_type_code = 'WH'
      AND is_active = true
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_wh, v_seller);
END;
$$;

COMMENT ON FUNCTION public.order_inventory_organization(uuid) IS
  'Resolves the inventory organization for D2H/S2D allocation/fulfillment/reversal. Prefers orders.fulfillment_warehouse_id, then legacy allocation/fulfillment movement source, then historical first-active-WH fallback for pre-migration rows.';

-- ---------------------------------------------------------------------------
-- 4. Clearer insufficient-stock message + require warehouse for new D2H alloc
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
  v_org uuid;
  v_cfg uuid;
  v_on int;
  v_alloc int;
  v_cost numeric;
  v_wh_name text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
    RETURN;
  END IF;

  IF v_order.order_type = 'D2H'
     AND v_order.fulfillment_warehouse_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'order'
         AND sm.reference_id = p_order_id
         AND sm.movement_type = 'allocation'
     ) THEN
    RAISE EXCEPTION 'Fulfillment warehouse is required before inventory can be allocated';
  END IF;

  IF v_order.fulfillment_warehouse_id IS NOT NULL THEN
    PERFORM public.assert_hq_fulfillment_warehouse(
      v_order.seller_org_id,
      v_order.fulfillment_warehouse_id
    );
  END IF;

  v_org := public.order_inventory_organization(p_order_id);
  SELECT org_name INTO v_wh_name FROM public.organizations WHERE id = v_org;

  FOR v_item IN
    SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_id = p_order_id
        AND sm.variant_id = v_item.variant_id
        AND sm.movement_type = 'allocation'
    ) THEN
      CONTINUE;
    END IF;

    v_cfg := public.resolve_so_stock_config(
      v_item.variant_id, v_org, v_order.buyer_org_id, v_item.qty
    );

    SELECT quantity_on_hand, quantity_allocated, COALESCE(average_cost, 0)
      INTO v_on, v_alloc, v_cost
    FROM public.product_inventory
    WHERE variant_id = v_item.variant_id
      AND organization_id = v_org
      AND stock_config_id = v_cfg
      AND is_active = true
    FOR UPDATE;

    IF v_on - v_alloc < v_item.qty THEN
      RAISE EXCEPTION
        'Insufficient available stock at %. Select another fulfillment warehouse or adjust the order quantity.',
        COALESCE(v_wh_name, 'the selected warehouse');
    END IF;

    UPDATE public.order_items
    SET stock_config_id = v_cfg,
        stock_config_confirmed_at = NULL,
        stock_config_confirmed_by = NULL,
        updated_at = now()
    WHERE id = v_item.id;

    UPDATE public.product_inventory
    SET quantity_allocated = quantity_allocated + v_item.qty,
        updated_at = now()
    WHERE variant_id = v_item.variant_id
      AND organization_id = v_org
      AND stock_config_id = v_cfg;

    INSERT INTO public.stock_movements (
      movement_type, reference_type, reference_id, reference_no, variant_id,
      stock_config_id, from_organization_id, to_organization_id, quantity_change,
      quantity_before, quantity_after, unit_cost, company_id, created_by, created_at, notes
    ) VALUES (
      'allocation', 'order', p_order_id, v_order.order_no, v_item.variant_id,
      v_cfg, v_org, v_order.buyer_org_id, v_item.qty,
      0, v_item.qty, v_cost, v_order.company_id,
      COALESCE(auth.uid(), v_order.created_by), now(),
      'SO allocation; configuration requires internal confirmation'
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_inventory_for_order(uuid) IS
  'Allocates inventory for D2H/S2D orders from orders.fulfillment_warehouse_id (or legacy-resolved source). Movement shows warehouse location with per-order allocation (Before: 0, After: qty). Idempotent per variant allocation row.';

-- ---------------------------------------------------------------------------
-- 5. Immutability / validity guard for fulfillment_warehouse_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_fulfillment_warehouse_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.fulfillment_warehouse_id IS DISTINCT FROM NEW.fulfillment_warehouse_id
     AND OLD.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Fulfillment warehouse cannot be changed after the order leaves Draft';
  END IF;

  IF NEW.fulfillment_warehouse_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.fulfillment_warehouse_id IS DISTINCT FROM NEW.fulfillment_warehouse_id
     ) THEN
    PERFORM public.assert_hq_fulfillment_warehouse(
      NEW.seller_org_id,
      NEW.fulfillment_warehouse_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_fulfillment_warehouse_guard ON public.orders;
CREATE TRIGGER trg_orders_fulfillment_warehouse_guard
  BEFORE INSERT OR UPDATE OF fulfillment_warehouse_id, status, seller_org_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_fulfillment_warehouse_guard();

-- ---------------------------------------------------------------------------
-- 6. Optional idempotency keys for atomic D2H submit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.d2h_order_submit_idempotency (
  idempotency_key text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.d2h_order_submit_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS d2h_submit_idempotency_read ON public.d2h_order_submit_idempotency;
CREATE POLICY d2h_submit_idempotency_read ON public.d2h_order_submit_idempotency
  FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (public.can_access_org(o.seller_org_id) OR public.can_access_org(o.buyer_org_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Atomic D2H create/submit/allocate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_and_allocate_d2h_order(
  p_company_id uuid,
  p_buyer_org_id uuid,
  p_seller_org_id uuid,
  p_fulfillment_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT order_id INTO v_existing_id
    FROM public.d2h_order_submit_idempotency
    WHERE idempotency_key = trim(p_idempotency_key);
    IF v_existing_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.orders WHERE id = v_existing_id;
      RETURN v_order;
    END IF;
  END IF;

  -- Serialize concurrent submits that target the same fulfillment warehouse stock.
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
    has_redeem, notes, created_by
  ) VALUES (
    'D2H', p_company_id, p_buyer_org_id, p_seller_org_id,
    p_fulfillment_warehouse_id, 'draft', false, true, true,
    true, p_notes, v_actor
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

  PERFORM public.allocate_inventory_for_order(v_order.id);

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    INSERT INTO public.d2h_order_submit_idempotency (idempotency_key, order_id, created_by)
    VALUES (trim(p_idempotency_key), v_order.id, v_actor)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  RETURN v_order;
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent idempotent retry won the insert race.
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

COMMENT ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text) IS
  'Atomically creates a D2H draft, inserts items, submits, and allocates inventory from the selected fulfillment warehouse. Rolls back entirely on failure. Optional idempotency_key prevents duplicate orders on retry.';

REVOKE ALL ON FUNCTION public.resolve_seller_hq_organization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_seller_hq_organization(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_active_hq_fulfillment_warehouse(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_hq_fulfillment_warehouse(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_hq_fulfillment_warehouse(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_hq_fulfillment_warehouse(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.order_inventory_organization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_inventory_organization(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.allocate_inventory_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_inventory_for_order(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text)
  TO authenticated, service_role;

COMMIT;
