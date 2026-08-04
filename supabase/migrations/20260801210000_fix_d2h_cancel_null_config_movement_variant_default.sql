BEGIN;

-- ============================================================================
-- Fix (follow-up to 20260801200000): release the allocation even when the
-- ORIGINAL allocation MOVEMENT carries stock_config_id = NULL.
-- ----------------------------------------------------------------------------
-- Runtime verification of SO26000085 / ORD-DH-0626-02 after 20260801200000 was
-- applied showed the order was set to 'cancelled' but the reservation was NOT
-- released (product_inventory.quantity_allocated still = 1 on the "Unclassified
-- (pending stock take)" configuration f76f45ce…, no deallocation movement).
--
-- Why 20260801200000 did not release it: that migration resolves the release
-- target from the allocation ledger, filtering `stock_config_id IS NOT NULL`.
-- But this legacy allocation movement was written with stock_config_id = NULL
--   movement_type='allocation', stock_config_id=NULL, from_org=<warehouse>,
--   qty +1, notes 'Allocated 1 units for order ORD-DH-0626-02 to GM Vape'
-- Only the product_inventory ROW carries the configuration (f76f45ce, which is
-- the variant's is_variant_default "Unclassified" sink). With no non-null config
-- on the movement and order_items.stock_config_id = NULL, 20260801200000 fell
-- through to CONTINUE and released nothing.
--
-- Fix: when the allocation ledger has no explicit configuration for the item,
-- fall back to the variant's default sink via public.resolve_default_stock_config
-- (is_variant_default) — which is exactly where the legacy allocation was placed
-- and where the reservation provably still sits. This mirrors the pre-Phase-4
-- behaviour of release_allocation_for_order (the "forward-only correction" in
-- 20260717_stock_config_05_so_fulfilment.sql dropped that fallback).
--
-- Safety envelope (unchanged):
--   * Unambiguous configuration required (fail closed on >1 ledger config).
--   * resolve_default_stock_config returns at most one row (is_variant_default is
--     unique per variant), so the fallback is deterministic.
--   * Release EXACTLY qty from quantity_allocated; quantity_on_hand untouched on
--     the plain-allocation path; the per-row guard (FOUND and v_alloc >= qty)
--     fails closed if the reservation does not match.
--   * Exactly one order-linked 'deallocation' movement per item.
--   * Idempotent / double-click safe (skips when the deallocation already exists),
--     so re-invoking it for the already-cancelled order is safe.
--   * The historical order item, physical counts, Opening Balance counts and QR
--     data are never modified.
--   * The fulfilled-order cancellation reversal path is preserved.
--
-- Forward-only CREATE OR REPLACE; keeps the signature, SECURITY DEFINER and ACLs.
--
-- NOTE: this migration only corrects the function. It does NOT release the
-- residual 1 already leaked onto SO26000085 (that order is already cancelled).
-- The one-time remediation is documented in the accompanying report and is NOT
-- applied here.
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
  v_has_alloc boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id; END IF;
  IF v_order.order_type NOT IN ('D2H','S2D') THEN RETURN; END IF;
  v_org:=public.order_inventory_organization(p_order_id);

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id LOOP
    -- Distinct EXPLICIT configurations recorded on the allocation ledger for
    -- THIS order + variant (config-aware modern allocations).
    SELECT array_agg(DISTINCT sm.stock_config_id)
      INTO v_cfgs
    FROM public.stock_movements sm
    WHERE sm.reference_type='order'
      AND sm.reference_id=p_order_id
      AND sm.variant_id=v_item.variant_id
      AND sm.movement_type='allocation'
      AND sm.stock_config_id IS NOT NULL;

    -- Was this item allocated at all (including legacy null-config movements)?
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type='order'
        AND sm.reference_id=p_order_id
        AND sm.variant_id=v_item.variant_id
        AND sm.movement_type='allocation'
    ) INTO v_has_alloc;

    IF v_cfgs IS NOT NULL AND array_length(v_cfgs,1) > 1 THEN
      RAISE EXCEPTION
        'Ambiguous allocation for order % variant %: % distinct stock configurations; refusing to release',
        v_order.order_no, v_item.variant_id, array_length(v_cfgs,1);
    ELSIF v_cfgs IS NOT NULL AND array_length(v_cfgs,1) = 1 THEN
      v_cfg := v_cfgs[1];
    ELSIF v_has_alloc THEN
      -- Legacy allocation whose movement did not record a configuration. The
      -- reservation was placed on the variant's default sink (is_variant_default),
      -- so reverse against that exact configuration.
      v_cfg := COALESCE(v_item.stock_config_id, public.resolve_default_stock_config(v_item.variant_id));
      IF v_cfg IS NULL THEN
        RAISE EXCEPTION
          'Cannot resolve stock configuration to release for order % variant % (legacy null-config allocation and no variant default)',
          v_order.order_no, v_item.variant_id;
      END IF;
    ELSE
      -- Never allocated. Nothing to release unless a confirmed config exists.
      IF v_item.stock_config_id IS NULL THEN CONTINUE; END IF;
      v_cfg := v_item.stock_config_id;
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
  'Releases D2H/S2D order allocation. Resolves the configuration from the allocation ledger; when the ledger carries no explicit configuration (legacy null-config movement) it falls back to the variant default sink (resolve_default_stock_config / is_variant_default), which is where such allocations were placed. Unambiguous match required (fails closed on multiple configs or an under-covered reservation); releases exactly qty from quantity_allocated without touching quantity_on_hand; emits exactly one deallocation movement per item; idempotent; preserves the fulfilled-order reversal path; never mutates the order item, physical counts or QR data.';

NOTIFY pgrst, 'reload schema';

COMMIT;
