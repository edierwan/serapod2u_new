BEGIN;

-- ============================================================================
-- Fix: D2H/S2D cancellation must reverse the ORIGINAL allocation, even when the
-- (legacy) order item carries stock_config_id = NULL.
-- ----------------------------------------------------------------------------
-- Incident (5th Initial cut-off): cancelling the genuine submitted D2H order
-- SO26000085 / ORD-DH-0626-02 (variant "Zero Edition Novella [ Potato ]", qty 1)
-- failed. The order item's order_items.stock_config_id is NULL, but a genuine
-- allocation movement and a product_inventory reservation exist against the
-- "Unclassified (pending stock take)" configuration
-- (f76f45ce-ecda-47e3-92de-a5b4228e7cbf).
--
-- Root cause: public.release_allocation_for_order (as last redefined in
-- 20260717_stock_config_05_so_fulfilment.sql) resolves the release target from
-- order_items.stock_config_id ONLY. When that column is NULL while an allocation
-- movement exists it raises
--   'Allocated order item % has no stock configuration'
-- The cancellation runs inside the same transaction as the orders status update
-- (via the order status-change trigger), so the RAISE aborts and rolls the whole
-- transaction back: the order stays 'submitted', the allocation is never
-- released, and PostgREST returns the error to the client.
--
-- Fix: resolve the configuration to reverse from the immutable allocation ledger
-- (stock_movements with movement_type='allocation') for the exact order+variant,
-- not from the possibly-null order_items.stock_config_id. The release then
-- happens against that authoritative configuration at the order's warehouse.
--
-- Safety envelope (unchanged from the prior fail-closed version, plus the fix):
--   * Require an UNAMBIGUOUS configuration. Refuse (fail closed) when the ledger
--     shows more than one distinct configuration for the order+variant, and when
--     the resolved reservation cannot cover the quantity.
--   * Release EXACTLY qty from quantity_allocated. quantity_on_hand is NEVER
--     changed on the plain-allocation path.
--   * Emit EXACTLY ONE 'deallocation' movement per order item, linked to the
--     order (reference_type='order', reference_id=order id).
--   * Idempotent / double-click safe: skip when a deallocation for the exact
--     order+variant+configuration already exists.
--   * The historical order item is NOT modified to make cancellation pass.
--   * Physical-count imports, Opening Balance counts and QR data are untouched.
--   * The fulfilled-order cancellation path (reverse buyer credit + restore
--     warehouse on-hand) is preserved verbatim, now keyed on the ledger-resolved
--     configuration.
--
-- Forward-only CREATE OR REPLACE. The function keeps its signature, SECURITY
-- DEFINER attribute and existing ACLs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_allocation_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_item    record;
  v_org     uuid;
  v_alloc   int;
  v_cost    numeric;
  v_wh_on   int;
  v_buyer_on int;
  v_cfgs    uuid[];
  v_cfg     uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id; END IF;
  IF v_order.order_type NOT IN ('D2H','S2D') THEN RETURN; END IF;
  v_org:=public.order_inventory_organization(p_order_id);

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id LOOP
    -- Resolve the configuration to reverse from the immutable allocation ledger
    -- for THIS order + variant. order_items.stock_config_id may legitimately be
    -- NULL for legacy pre-confirmation allocations, so it must not be the source
    -- of truth. Require an unambiguous match.
    SELECT array_agg(DISTINCT sm.stock_config_id)
      INTO v_cfgs
    FROM public.stock_movements sm
    WHERE sm.reference_type='order'
      AND sm.reference_id=p_order_id
      AND sm.variant_id=v_item.variant_id
      AND sm.movement_type='allocation'
      AND sm.stock_config_id IS NOT NULL;

    IF v_cfgs IS NULL OR array_length(v_cfgs,1) IS NULL THEN
      -- No allocation was ever recorded for this order item. If a configuration
      -- was confirmed on the item, release against it; otherwise nothing to do.
      IF v_item.stock_config_id IS NULL THEN CONTINUE; END IF;
      v_cfg := v_item.stock_config_id;
    ELSIF array_length(v_cfgs,1) > 1 THEN
      RAISE EXCEPTION
        'Ambiguous allocation for order % variant %: % distinct stock configurations; refusing to release',
        v_order.order_no, v_item.variant_id, array_length(v_cfgs,1);
    ELSE
      v_cfg := v_cfgs[1];
    END IF;

    -- Idempotent / double-click safe: this exact configuration is already released.
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE reference_type='order' AND reference_id=p_order_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_cfg
        AND movement_type='deallocation') THEN CONTINUE; END IF;

    -- Fulfilled-order cancellation: approval already shipped the exact config out
    -- of the warehouse into the buyer (quantity_allocated was cleared then).
    -- Reverse the buyer credit and restore the warehouse on-hand.
    IF EXISTS (SELECT 1 FROM public.stock_movements
      WHERE reference_type='order' AND reference_id=p_order_id
        AND variant_id=v_item.variant_id AND stock_config_id=v_cfg
        AND movement_type='order_fulfillment') THEN
      IF EXISTS (SELECT 1 FROM public.stock_movements
        WHERE reference_type='order_cancel_reversal' AND reference_id=p_order_id
          AND variant_id=v_item.variant_id AND stock_config_id=v_cfg) THEN CONTINUE; END IF;
      SELECT quantity_on_hand,COALESCE(average_cost,0) INTO v_wh_on,v_cost FROM public.product_inventory
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_cfg FOR UPDATE;
      SELECT quantity_on_hand INTO v_buyer_on FROM public.product_inventory
        WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id AND stock_config_id=v_cfg FOR UPDATE;
      IF v_buyer_on IS NULL OR v_buyer_on<v_item.qty THEN
        RAISE EXCEPTION 'Buyer no longer has exact configuration stock required to cancel item %',v_item.id; END IF;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand-v_item.qty,updated_at=now()
        WHERE organization_id=v_order.buyer_org_id AND variant_id=v_item.variant_id AND stock_config_id=v_cfg;
      UPDATE public.product_inventory SET quantity_on_hand=quantity_on_hand+v_item.qty,updated_at=now()
        WHERE organization_id=v_org AND variant_id=v_item.variant_id AND stock_config_id=v_cfg;
      INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
        from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
      VALUES('transfer_out','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
        v_order.buyer_org_id,v_org,-v_item.qty,v_buyer_on,v_buyer_on-v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Buyer credit reversed on cancellation'),
       ('order_cancelled','order_cancel_reversal',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
        v_order.buyer_org_id,v_org,v_item.qty,v_wh_on,v_wh_on+v_item.qty,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),'Exact configuration restored on cancellation');
      CONTINUE;
    END IF;

    -- Plain-allocation path: release EXACTLY qty from quantity_allocated at the
    -- warehouse for the resolved configuration. quantity_on_hand is untouched.
    SELECT quantity_allocated,COALESCE(average_cost,0) INTO v_alloc,v_cost FROM public.product_inventory
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_cfg FOR UPDATE;
    IF NOT FOUND OR v_alloc < v_item.qty THEN
      RAISE EXCEPTION 'Cannot safely release item % configuration allocation',v_item.id; END IF;
    UPDATE public.product_inventory SET quantity_allocated=quantity_allocated-v_item.qty,updated_at=now()
      WHERE variant_id=v_item.variant_id AND organization_id=v_org AND stock_config_id=v_cfg;
    INSERT INTO public.stock_movements(movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,unit_cost,company_id,created_by,notes)
    VALUES('deallocation','order',p_order_id,v_order.order_no,v_item.variant_id,v_cfg,
      v_order.buyer_org_id,v_org,-v_item.qty,v_item.qty,0,v_cost,v_order.company_id,COALESCE(auth.uid(),v_order.created_by),
      CASE WHEN v_order.status='cancelled' THEN 'Order cancelled' ELSE 'Allocation released' END);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.release_allocation_for_order(uuid) IS
  'Releases D2H/S2D order allocation. Resolves the configuration to reverse from the immutable allocation ledger (movement_type=allocation) for the exact order+variant, so legacy items with NULL order_items.stock_config_id still cancel correctly. Unambiguous match required (fails closed on multiple configs or an under-covered reservation); releases exactly qty from quantity_allocated without touching quantity_on_hand; emits exactly one deallocation movement per item; idempotent; preserves the fulfilled-order cancellation reversal path; never mutates the order item, physical counts or QR data.';

NOTIFY pgrst, 'reload schema';

COMMIT;
