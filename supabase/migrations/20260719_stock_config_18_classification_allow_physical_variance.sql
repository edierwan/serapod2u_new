-- ============================================================================
-- Inventory Stock Configurations — Phase 18 (forward-only)
-- Initial Classification: allow genuine physical-count variance vs Legacy
-- ----------------------------------------------------------------------------
-- Correction to migration 16 business rule #4:
--   A target physical total that exceeds (or is below) the remaining
--   Legacy/Unclassified balance is a valid Stock Count variance, not an error.
--
-- Example (Keladi Cheese):
--   Legacy/Unclassified = 100
--   Physical targets    = 500 + 400 + 200 = 1,100
--   Genuine net variance = +1,000  → allowed after review + verification
--
-- Still blocked:
--   - live UNC on_hand <= 0  (already fully classified / stale draft)
--   - live UNC quantity_allocated > 0  (would invalidate allocations; never
--     auto-clear / move allocations)
--
-- Posting behaviour (unchanged mathematically):
--   - Clear Legacy to 0
--   - Set each target config to its physical count
--   - Net adjustment = target total − legacy (= genuine variance)
--   - OTP is consumed only after guards pass (assert runs before code consume)
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.stock_count_assert_classification_postable(
  p_session_id uuid,
  p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row record;
  v_flavour text;
  v_unit_label text;
BEGIN
  FOR v_row IN
    SELECT
      i.variant_id,
      coalesce(nullif(btrim(p.product_name), ''), 'Unknown product') AS product_name,
      coalesce(nullif(btrim(pv.variant_name), ''), 'Unknown flavour') AS variant_name,
      coalesce(pi.quantity_on_hand, 0) AS live_on_hand,
      coalesce(pi.quantity_allocated, 0) AS live_allocated
    FROM public.stock_count_session_items i
    JOIN public.inventory_stock_configurations c
      ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
    JOIN public.product_variants pv ON pv.id = i.variant_id
    JOIN public.products p ON p.id = pv.product_id
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id
     AND pi.stock_config_id = i.stock_config_id
     AND pi.organization_id = p_warehouse_id
     AND pi.is_active = true
    WHERE i.session_id = p_session_id
      AND c.config_code = 'UNCLASSIFIED'
      AND i.physical_quantity IS NOT NULL
    ORDER BY p.product_name, pv.variant_name
  LOOP
    v_flavour := format('%s [%s]', v_row.product_name, v_row.variant_name);

    -- Live UNC already gone (classified after template/draft was captured).
    IF v_row.live_on_hand <= 0 THEN
      RAISE EXCEPTION 'stock_count_already_fully_classified: %',
        format(
          'This product has already been fully classified (%s). Download a new Initial Classification template or use Full Count to update its quantity.',
          v_flavour
        );
    END IF;

    -- Active allocation on Legacy/Unclassified — never auto-clear/move it.
    -- Full classification clears UNC to 0, so any allocated>0 would violate
    -- product_inventory.valid_quantities whether the physical target is above
    -- or below the Legacy balance.
    IF v_row.live_allocated > 0 THEN
      v_unit_label := CASE WHEN v_row.live_allocated = 1 THEN 'unit' ELSE 'units' END;
      RAISE EXCEPTION 'stock_count_allocated_blocks_post: %',
        format(
          'This Legacy inventory for %s still has %s allocated %s and cannot be fully classified. Release or resolve the allocation before posting.',
          v_flavour,
          v_row.live_allocated,
          v_unit_label
        );
    END IF;

    -- Target physical total vs Legacy is a genuine Stock Count variance
    -- (positive or negative). It is intentionally not blocked here.
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.stock_count_assert_classification_postable(uuid, uuid) IS
  'Initial Configuration Classification safety: revalidates live UNC on_hand and blocks allocated>0 (no auto-clear). Target totals above or below Legacy are valid physical-count variances. Raises stock_count_already_fully_classified / stock_count_allocated_blocks_post with product/flavour detail.';

COMMENT ON FUNCTION public.verify_and_post_stock_classification(uuid, text) IS
  'Atomically reclassifies Legacy/Unclassified into 20NB/50NB/50OB and records genuine physical-count variance (target total − legacy). Migration 15 timeouts; migration 16/18 revalidate live UNC under lock and block allocated>0 (no auto-clear). Single-use code + draft-only session update keep it idempotent; OTP is not consumed when a guard raises.';

NOTIFY pgrst, 'reload schema';

COMMIT;
