-- ============================================================================
-- Stock Configurations — read-only regression verification
-- ----------------------------------------------------------------------------
-- Run after each stock-config phase (20260717_stock_config_01..04) on the
-- target database. Every query is read-only. Each block states its expected
-- result; any row returned by a "MUST BE EMPTY" block is a regression.
--
--   psql "$DB_URL" -f scripts/verify_stock_config_migration.sql
-- ============================================================================

\echo '=== [1] Every variant has exactly one default configuration (MUST BE EMPTY) ==='
SELECT pv.id AS variant_id, pv.variant_code, count(c.id) FILTER (WHERE c.is_variant_default) AS default_configs
FROM public.product_variants pv
LEFT JOIN public.inventory_stock_configurations c ON c.variant_id = pv.id
GROUP BY pv.id, pv.variant_code
HAVING count(c.id) FILTER (WHERE c.is_variant_default) <> 1;

\echo '=== [2] Only valid dimension combinations exist (MUST BE EMPTY) ==='
SELECT id, variant_id, config_code, volume_ml, packaging
FROM public.inventory_stock_configurations
WHERE NOT (
  (volume_ml IS NULL AND packaging IS NULL)
  OR (volume_ml = 20 AND packaging = 'new_box')
  OR (volume_ml = 50 AND packaging IN ('new_box', 'old_box'))
);

\echo '=== [3] 50ml Old Box rows are never directly sellable (MUST BE EMPTY) ==='
SELECT id, variant_id, config_code
FROM public.inventory_stock_configurations
WHERE packaging = 'old_box'
  AND (allow_so OR NOT requires_repacking_before_sale);

\echo '=== [4] Balance rows without a configuration (MUST BE EMPTY after Phase 0 backfill) ==='
SELECT id, variant_id, organization_id
FROM public.product_inventory
WHERE stock_config_id IS NULL;

\echo '=== [5] Balance rows whose configuration belongs to another variant (MUST BE EMPTY) ==='
SELECT pi.id, pi.variant_id, pi.stock_config_id
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
WHERE c.variant_id <> pi.variant_id;

\echo '=== [6] Movements (post-migration) whose configuration belongs to another variant (MUST BE EMPTY) ==='
SELECT sm.id, sm.variant_id, sm.stock_config_id
FROM public.stock_movements sm
JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
WHERE c.variant_id <> sm.variant_id;

\echo '=== [7] Uniqueness: one balance row per (variant, org, config) (MUST BE EMPTY) ==='
SELECT variant_id, organization_id, stock_config_id, count(*)
FROM public.product_inventory
GROUP BY variant_id, organization_id, stock_config_id
HAVING count(*) > 1;

\echo '=== [8] Variant totals equal the sum of configuration balances (informational snapshot) ==='
-- Save this output before Phase 1 and compare after: totals per (org, variant)
-- must be identical because Phase 0/1 only re-key balances, never change them.
SELECT organization_id, variant_id,
       sum(quantity_on_hand) AS on_hand,
       sum(quantity_allocated) AS allocated
FROM public.product_inventory
GROUP BY organization_id, variant_id
ORDER BY organization_id, variant_id;

\echo '=== [9] Ledger continuity per (warehouse, variant, config) for NEW movements (MUST BE EMPTY) ==='
-- Post-migration movements carry stock_config_id. Within one warehouse-side
-- chain, each movement''s quantity_before must equal the previous
-- quantity_after. Allocation/deallocation rows are per-order balances and are
-- excluded (same rule as trg_stock_movements_fill_cost_and_balance).
-- KNOWN PRE-EXISTING EXCEPTION: wms_ship_manual inserts manual_out rows that
-- deliberately do NOT update product_inventory (it accounts by movement sums).
-- A neighbouring record_stock_movement row then re-anchors to the true
-- product_inventory value, so chains that include wms_ship_manual output may
-- appear here. That is not a stock-configuration regression.
WITH chain AS (
  SELECT sm.id, sm.created_at, sm.movement_type,
         public._movement_warehouse_id(sm.movement_type, sm.from_organization_id, sm.to_organization_id) AS wh_id,
         sm.variant_id, sm.stock_config_id,
         sm.quantity_before, sm.quantity_change, sm.quantity_after,
         lag(sm.quantity_after) OVER (
           PARTITION BY public._movement_warehouse_id(sm.movement_type, sm.from_organization_id, sm.to_organization_id),
                        sm.variant_id, sm.stock_config_id
           ORDER BY sm.created_at, sm.id
         ) AS prev_after
  FROM public.stock_movements sm
  WHERE sm.stock_config_id IS NOT NULL
    AND sm.movement_type NOT IN ('allocation', 'deallocation')
)
SELECT id, created_at, movement_type, wh_id, variant_id, stock_config_id,
       prev_after, quantity_before, quantity_change, quantity_after
FROM chain
WHERE prev_after IS NOT NULL
  AND quantity_before <> prev_after;

\echo '=== [10] Arithmetic invariant on NEW movements (MUST BE EMPTY) ==='
SELECT id, movement_type, quantity_before, quantity_change, quantity_after
FROM public.stock_movements
WHERE stock_config_id IS NOT NULL
  AND movement_type NOT IN ('allocation', 'deallocation')
  AND quantity_after <> quantity_before + quantity_change;

\echo '=== [11] Historical movements untouched (expected: rows exist with NULL config; count is stable across phases) ==='
SELECT count(*) AS legacy_movements_null_config
FROM public.stock_movements
WHERE stock_config_id IS NULL;

\echo '=== [12] Configuration balance sanity: no negative on-hand / over-allocation (MUST BE EMPTY) ==='
SELECT id, variant_id, organization_id, stock_config_id, quantity_on_hand, quantity_allocated
FROM public.product_inventory
WHERE quantity_on_hand < 0 OR quantity_allocated > quantity_on_hand;

\echo '=== [13] Repack pairing (Phase 2+): every RPK reference has balanced in/out per variant (MUST BE EMPTY) ==='
SELECT reference_no, variant_id,
       sum(quantity_change) FILTER (WHERE movement_type = 'repack_out') AS total_out,
       sum(quantity_change) FILTER (WHERE movement_type = 'repack_in')  AS total_in
FROM public.stock_movements
WHERE movement_type IN ('repack_out', 'repack_in')
GROUP BY reference_no, variant_id
HAVING coalesce(sum(quantity_change) FILTER (WHERE movement_type = 'repack_out'), 0)
     + coalesce(sum(quantity_change) FILTER (WHERE movement_type = 'repack_in'), 0) <> 0;

\echo '=== [14] Repack volume rule (Phase 2+): repack never changes volume (MUST BE EMPTY) ==='
SELECT sm_out.reference_no, sm_out.variant_id, c_out.volume_ml AS from_volume, c_in.volume_ml AS to_volume
FROM public.stock_movements sm_out
JOIN public.stock_movements sm_in
  ON sm_in.reference_no = sm_out.reference_no
 AND sm_in.variant_id = sm_out.variant_id
 AND sm_in.movement_type = 'repack_in'
JOIN public.inventory_stock_configurations c_out ON c_out.id = sm_out.stock_config_id
JOIN public.inventory_stock_configurations c_in  ON c_in.id  = sm_in.stock_config_id
WHERE sm_out.movement_type = 'repack_out'
  AND c_out.volume_ml IS DISTINCT FROM c_in.volume_ml;

\echo '=== [15] Stock Count configuration uniqueness (Phase 3+; MUST BE EMPTY) ==='
SELECT session_id, stock_config_id, count(*)
FROM public.stock_count_session_items
WHERE stock_config_id IS NOT NULL
GROUP BY session_id, stock_config_id
HAVING count(*) > 1;

\echo '=== [16] Stock Count configuration/variant consistency (Phase 3+; MUST BE EMPTY) ==='
SELECT i.id, i.session_id, i.variant_id, i.stock_config_id
FROM public.stock_count_session_items i
LEFT JOIN public.inventory_stock_configurations c
  ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
WHERE i.stock_config_id IS NOT NULL AND c.id IS NULL;

\echo '=== [17] Adjustment audit configuration/variant consistency (Phase 3+; MUST BE EMPTY) ==='
SELECT i.id, i.adjustment_id, i.variant_id, i.stock_config_id
FROM public.stock_adjustment_items i
LEFT JOIN public.inventory_stock_configurations c
  ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
WHERE i.stock_config_id IS NOT NULL AND c.id IS NULL;
