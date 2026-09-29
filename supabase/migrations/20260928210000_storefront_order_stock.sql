-- ============================================================================
-- Website orders (Outdoor + /store) move warehouse stock
-- ----------------------------------------------------------------------------
-- Business decision:
--   * Stock leaves the warehouse when staff mark a website order shipped.
--   * It ships from the seller HQ's default fulfilment warehouse
--     (organizations.default_warehouse_org_id). 20260929200000 lets the HQ
--     pick a separate online shop warehouse.
--   * A refund/cancel after shipping puts stock back only when staff confirm
--     the goods came back. Before shipping nothing was taken, so nothing returns.
--   * The website stops selling a variant the warehouse cannot cover.
--
-- Postings go through record_stock_movement (manual_out / manual_in on the
-- canonical operational configuration), tagged reference_type
-- 'storefront_order' with reference_id = storefront_orders.id and
-- reference_no = order_ref, so Movement Reports show the website order.
--
-- Additive and rerunnable. No historical order is back-posted: only orders
-- shipped after this migration move stock.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Order-level stock markers
-- ---------------------------------------------------------------------------
ALTER TABLE public.storefront_orders
  ADD COLUMN IF NOT EXISTS stock_warehouse_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS stock_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_returned_at timestamptz;

COMMENT ON COLUMN public.storefront_orders.stock_warehouse_id IS
  'Warehouse the order''s stock left from (set when it shipped).';
COMMENT ON COLUMN public.storefront_orders.stock_out_at IS
  'When the order''s items were taken out of warehouse stock. NULL = nothing taken (not shipped yet, or shipped before website orders moved stock).';
COMMENT ON COLUMN public.storefront_orders.stock_returned_at IS
  'When staff put the order''s items back into warehouse stock after a refund/cancel.';

-- ---------------------------------------------------------------------------
-- 2. Reference family: superset of 20260904120000, plus storefront_order
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check CHECK (
    reference_type = ANY (ARRAY[
      'manual'::text,
      'order'::text,
      'transfer'::text,
      'adjustment'::text,
      'purchase_order'::text,
      'return'::text,
      'campaign'::text,
      'repack'::text,
      'order_config_change'::text,
      'order_cancel_reversal'::text,
      'stock_classification'::text,
      'opening_balance_cutoff'::text,
      'legacy_config_cutover'::text,
      'storefront_order'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 3. Which warehouse website orders ship from
-- ---------------------------------------------------------------------------
-- An order carrying an organization ships from that HQ's default warehouse.
-- Legacy orders without one belong to the single platform storefront: the one
-- active HQ that has a default warehouse. Anything else fails closed.
CREATE OR REPLACE FUNCTION public.storefront_fulfilment_warehouse(p_organization_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hq uuid;
  v_wh uuid;
  v_count integer;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_hq := public.resolve_seller_hq_organization(p_organization_id);
    SELECT default_warehouse_org_id INTO v_wh FROM public.organizations WHERE id = v_hq;
  ELSE
    SELECT count(*), (array_agg(default_warehouse_org_id))[1]
      INTO v_count, v_wh
      FROM public.organizations
     WHERE org_type_code = 'HQ'
       AND is_active = true
       AND default_warehouse_org_id IS NOT NULL;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'storefront_no_fulfilment_warehouse: more than one HQ has a default warehouse; the order must carry its organization.';
    END IF;
    SELECT parent_org_id INTO v_hq FROM public.organizations WHERE id = v_wh;
  END IF;

  IF v_wh IS NULL OR NOT public.is_active_hq_fulfillment_warehouse(v_hq, v_wh) THEN
    RAISE EXCEPTION 'storefront_no_fulfilment_warehouse: no active default warehouse is set for the online shop.';
  END IF;
  RETURN v_wh;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. What the website may still sell
-- ---------------------------------------------------------------------------
-- available = warehouse available (on hand - allocated) on the canonical
-- configuration, minus paid website orders that have not shipped yet.
CREATE OR REPLACE FUNCTION public.storefront_variant_stock(p_variant_ids uuid[], p_organization_id uuid DEFAULT NULL)
RETURNS TABLE (variant_id uuid, on_hand integer, reserved integer, available integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wh uuid := public.storefront_fulfilment_warehouse(p_organization_id);
BEGIN
  RETURN QUERY
  WITH wanted AS (
    SELECT DISTINCT unnest(p_variant_ids) AS variant_id
  ),
  stock AS (
    SELECT w.variant_id,
           COALESCE(pi.quantity_on_hand, 0)::integer AS on_hand,
           COALESCE(pi.quantity_on_hand - COALESCE(pi.quantity_allocated, 0), 0)::integer AS free
      FROM wanted w
      LEFT JOIN public.v_canonical_stock_config c
        ON c.variant_id = w.variant_id AND c.candidate_count = 1
      LEFT JOIN public.product_inventory pi
        ON pi.variant_id = w.variant_id
       AND pi.organization_id = v_wh
       AND pi.stock_config_id = c.stock_config_id
       AND pi.is_active = true
  ),
  held AS (
    SELECT i.variant_id, sum(i.quantity)::integer AS qty
      FROM public.storefront_order_items i
      JOIN public.storefront_orders o ON o.id = i.order_id
     WHERE i.variant_id = ANY (p_variant_ids)
       AND o.status::text IN ('paid', 'processing')
       AND o.stock_out_at IS NULL
     GROUP BY i.variant_id
  )
  SELECT s.variant_id,
         s.on_hand,
         COALESCE(h.qty, 0),
         GREATEST(0, s.free - COALESCE(h.qty, 0))
    FROM stock s
    LEFT JOIN held h ON h.variant_id = s.variant_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Take a shipped order's items out of stock (once, all or nothing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storefront_order_stock_out(p_order_id uuid, p_actor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.storefront_orders%ROWTYPE;
  v_wh uuid;
  v_line record;
  v_on_hand integer;
  v_units integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.storefront_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront_order_not_found';
  END IF;
  IF v_order.stock_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'warehouse_id', v_order.stock_warehouse_id);
  END IF;

  v_wh := public.storefront_fulfilment_warehouse(v_order.organization_id);

  FOR v_line IN
    SELECT i.variant_id,
           sum(i.quantity)::integer AS qty,
           min(i.product_name) AS product_name,
           min(i.variant_name) AS variant_name
      FROM public.storefront_order_items i
     WHERE i.order_id = p_order_id AND i.variant_id IS NOT NULL
     GROUP BY i.variant_id
  LOOP
    SELECT pi.quantity_on_hand INTO v_on_hand
      FROM public.product_inventory pi
     WHERE pi.variant_id = v_line.variant_id
       AND pi.organization_id = v_wh
       AND pi.stock_config_id = public.resolve_operational_stock_config(v_line.variant_id)
       AND pi.is_active = true;
    IF COALESCE(v_on_hand, 0) < v_line.qty THEN
      RAISE EXCEPTION 'storefront_stock_short: % (%) has % in the warehouse, this order needs %.',
        v_line.product_name, v_line.variant_name, COALESCE(v_on_hand, 0), v_line.qty;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type   => 'manual_out',
      p_variant_id      => v_line.variant_id,
      p_organization_id => v_wh,
      p_quantity_change => -v_line.qty,
      p_reason          => 'Website sale',
      p_notes           => format('%s order %s shipped', initcap(COALESCE(v_order.sales_channel, 'store')), v_order.order_ref),
      p_reference_type  => 'storefront_order',
      p_reference_id    => v_order.id,
      p_reference_no    => v_order.order_ref,
      p_created_by      => p_actor
    );
    v_units := v_units + v_line.qty;
  END LOOP;

  UPDATE public.storefront_orders
     SET stock_warehouse_id = v_wh,
         stock_out_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('status', 'taken', 'warehouse_id', v_wh, 'units', v_units);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Put a refunded/cancelled order's items back (once)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storefront_order_stock_return(p_order_id uuid, p_actor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.storefront_orders%ROWTYPE;
  v_line record;
  v_units integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.storefront_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront_order_not_found';
  END IF;
  IF v_order.stock_out_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_taken');
  END IF;
  IF v_order.stock_returned_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'warehouse_id', v_order.stock_warehouse_id);
  END IF;

  FOR v_line IN
    SELECT i.variant_id, sum(i.quantity)::integer AS qty
      FROM public.storefront_order_items i
     WHERE i.order_id = p_order_id AND i.variant_id IS NOT NULL
     GROUP BY i.variant_id
  LOOP
    PERFORM public.record_stock_movement(
      p_movement_type   => 'manual_in',
      p_variant_id      => v_line.variant_id,
      p_organization_id => v_order.stock_warehouse_id,
      p_quantity_change => v_line.qty,
      p_reason          => 'Website order returned',
      p_notes           => format('%s order %s came back', initcap(COALESCE(v_order.sales_channel, 'store')), v_order.order_ref),
      p_reference_type  => 'storefront_order',
      p_reference_id    => v_order.id,
      p_reference_no    => v_order.order_ref,
      p_created_by      => p_actor
    );
    v_units := v_units + v_line.qty;
  END LOOP;

  UPDATE public.storefront_orders SET stock_returned_at = now() WHERE id = p_order_id;

  RETURN jsonb_build_object('status', 'returned', 'warehouse_id', v_order.stock_warehouse_id, 'units', v_units);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Undo a stock-out whose shipment never got saved (booking/update failed)
-- ---------------------------------------------------------------------------
-- Unlike a return, this clears stock_out_at so the real shipment takes the
-- stock again later.
CREATE OR REPLACE FUNCTION public.storefront_order_stock_undo(p_order_id uuid, p_actor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.storefront_orders%ROWTYPE;
  v_line record;
  v_units integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.storefront_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storefront_order_not_found';
  END IF;
  IF v_order.stock_out_at IS NULL OR v_order.stock_returned_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_taken');
  END IF;

  FOR v_line IN
    SELECT i.variant_id, sum(i.quantity)::integer AS qty
      FROM public.storefront_order_items i
     WHERE i.order_id = p_order_id AND i.variant_id IS NOT NULL
     GROUP BY i.variant_id
  LOOP
    PERFORM public.record_stock_movement(
      p_movement_type   => 'manual_in',
      p_variant_id      => v_line.variant_id,
      p_organization_id => v_order.stock_warehouse_id,
      p_quantity_change => v_line.qty,
      p_reason          => 'Website shipment not completed',
      p_notes           => format('Order %s was not marked shipped; stock restored', v_order.order_ref),
      p_reference_type  => 'storefront_order',
      p_reference_id    => v_order.id,
      p_reference_no    => v_order.order_ref,
      p_created_by      => p_actor
    );
    v_units := v_units + v_line.qty;
  END LOOP;

  UPDATE public.storefront_orders
     SET stock_out_at = NULL,
         stock_warehouse_id = NULL
   WHERE id = p_order_id;

  RETURN jsonb_build_object('status', 'returned', 'units', v_units);
END;
$$;

REVOKE ALL ON FUNCTION public.storefront_order_stock_undo(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_order_stock_undo(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.storefront_fulfilment_warehouse(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storefront_variant_stock(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storefront_order_stock_out(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storefront_order_stock_return(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_fulfilment_warehouse(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.storefront_variant_stock(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.storefront_order_stock_out(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.storefront_order_stock_return(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
