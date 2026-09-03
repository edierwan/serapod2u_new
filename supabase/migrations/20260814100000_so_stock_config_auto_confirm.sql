-- ---------------------------------------------------------------------------
-- Sales Order stock configuration: confirmed at allocation, not by hand
--
-- Until now a submitted D2H/S2D order left every line's configuration
-- unconfirmed (stock_config_confirmed_at = NULL) and an HQ/warehouse user had
-- to click each line in View Order Details before the order could be approved.
-- That second click carried no new information: allocation already resolved ONE
-- exact configuration through resolve_so_stock_config(), already checked the
-- distributor's eligibility for it, already checked available stock, and
-- already moved the quantity into quantity_allocated against that exact
-- configuration. Approval then failed with a raw order-item UUID, which read as
-- a bug to operators.
--
-- The allocation now records the confirmation it has effectively already made.
-- Nothing about WHICH configuration is chosen changes — resolve_so_stock_config
-- keeps the same priority (20ml new box, then 50ml new box, then dimensionless;
-- never old box, never repack-required) — only the moment it is marked
-- confirmed, and by whom.
--
-- The downstream guards stay exactly as they were and are still meaningful:
--   * fulfill_order_inventory() still refuses a line with no configuration or
--     no confirmation, so a line that never went through allocation cannot be
--     fulfilled;
--   * wms_from_unique_codes() still requires stock_config_confirmed_at IS NOT
--     NULL before it will resolve QR inventory;
--   * set_order_item_stock_config() still exists, so an internal user can move
--     a submitted line to a different configuration atomically.
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
  v_actor uuid;
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
  -- Submission can run under the buyer's session or a service role; the order
  -- creator is the accountable fallback so the confirmation is never anonymous.
  v_actor := COALESCE(auth.uid(), v_order.created_by);

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

    -- The allocation IS the confirmation: this exact configuration now holds
    -- the quantity, so approval has nothing left to ask.
    UPDATE public.order_items
    SET stock_config_id = v_cfg,
        stock_config_confirmed_at = now(),
        stock_config_confirmed_by = v_actor,
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
      v_actor, now(),
      'SO allocation; configuration confirmed on allocation'
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_inventory_for_order(uuid) IS
  'Allocates inventory for D2H/S2D orders from orders.fulfillment_warehouse_id (or legacy-resolved source) and confirms the resolved stock configuration on the order line, so a submitted order is approvable without a separate manual confirmation. Movement shows warehouse location with per-order allocation (Before: 0, After: qty). Idempotent per variant allocation row.';

-- ---------------------------------------------------------------------------
-- Backfill: orders already submitted under the manual-confirmation rule are
-- stranded — allocated against a configuration, but unapprovable. They are
-- confirmed against the configuration allocation already picked for them.
-- Lines with no configuration are left alone: those never allocated, and
-- fulfilment must keep refusing them.
-- ---------------------------------------------------------------------------
UPDATE public.order_items oi
SET stock_config_confirmed_at = now(),
    stock_config_confirmed_by = COALESCE(oi.stock_config_confirmed_by, o.created_by),
    updated_at = now()
FROM public.orders o
WHERE o.id = oi.order_id
  AND o.order_type IN ('D2H', 'S2D')
  AND o.status = 'submitted'
  AND oi.stock_config_id IS NOT NULL
  AND oi.stock_config_confirmed_at IS NULL;
