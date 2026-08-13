-- ============================================================================
-- C. POST-VERIFICATION — READ ONLY. Run after B1 (and B2, if it committed).
-- ----------------------------------------------------------------------------
-- Writes nothing; read-only is enforced by the server for the transaction.
-- Seven result sets, each with an explicit PASS/FAIL verdict where one applies.
-- ============================================================================

BEGIN;
SET LOCAL default_transaction_read_only = on;

-- ----------------------------------------------------------------------------
-- 1. Every Device configuration, with its final state.
--    Expect: one row per variant, config_code STD, lifecycle active.
--    "Oliver" (the SAFE_RENAME case) and the previously inactive STD rows must
--    both appear here as STD / active.
-- ----------------------------------------------------------------------------
WITH device_variants AS (
  SELECT pv.id AS variant_id, pv.variant_name, pv.is_active AS variant_is_active,
         p.product_name, g.group_code, g.stock_config_profile
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard'
)
SELECT '1. Device configuration final state' AS check_name,
       dv.product_name, dv.variant_name, dv.variant_is_active,
       dv.group_code, dv.stock_config_profile,
       c.id AS stock_config_id, c.config_code, c.config_label,
       c.status AS lifecycle, c.volume_ml, c.packaging,
       c.allow_so, c.allow_ord, c.default_for_ord, c.is_variant_default,
       c.requires_repacking_before_sale, c.sort_order, c.stock_sku,
       CASE WHEN c.config_code = 'STD' AND c.config_label = 'Standard'
                 AND c.status = 'active' AND c.volume_ml IS NULL AND c.packaging IS NULL
                 AND c.allow_so AND c.allow_ord AND c.default_for_ord
                 AND c.is_variant_default AND NOT c.requires_repacking_before_sale
                 AND c.sort_order = 0
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM device_variants dv
JOIN public.inventory_stock_configurations c ON c.variant_id = dv.variant_id
ORDER BY dv.product_name, dv.variant_name, c.config_code;

-- ----------------------------------------------------------------------------
-- 2. Exactly ONE configuration per Device variant, and it is an active STD.
-- ----------------------------------------------------------------------------
WITH device_variants AS (
  SELECT pv.id AS variant_id, pv.variant_name, p.product_name
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE AND COALESCE(g.stock_config_profile,'standard') = 'standard'
)
SELECT '2. One active STD per Device variant' AS check_name,
       dv.product_name, dv.variant_name,
       count(c.id) AS config_count,
       count(*) FILTER (WHERE c.config_code = 'STD' AND c.status = 'active') AS active_std_count,
       string_agg(c.config_code || '/' || c.status, ', ' ORDER BY c.config_code) AS configs,
       CASE WHEN count(c.id) = 1
                 AND count(*) FILTER (WHERE c.config_code = 'STD' AND c.status = 'active') = 1
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM device_variants dv
LEFT JOIN public.inventory_stock_configurations c ON c.variant_id = dv.variant_id
GROUP BY dv.product_name, dv.variant_name
ORDER BY dv.product_name, dv.variant_name;

-- ----------------------------------------------------------------------------
-- 3. No Device variant retains 20NB / 50NB / 50OB or any dimensioned config.
--    Expect ZERO rows. Any row here is a remaining BLOCKED_REFERENCED case.
-- ----------------------------------------------------------------------------
SELECT '3. Residual Device concentration configs (expect none)' AS check_name,
       p.product_name, pv.variant_name, c.id AS stock_config_id,
       c.config_code, c.status, c.volume_ml, c.packaging,
       (SELECT count(*) FROM public.stock_count_session_items x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.stock_count_session_scope x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.stock_movements x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.product_inventory x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.order_items x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.warehouse_receipt_items x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.stock_adjustment_items x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.stock_count_classification_allocation_resolutions x WHERE x.target_stock_config_id = c.id)
         + (SELECT count(*) FROM public.inventory_cutoff_decisions x WHERE x.stock_config_id = c.id)
         + (SELECT count(*) FROM public.inventory_cutoff_allocation_requests x WHERE x.stock_config_id = c.id) AS blocking_refs
FROM public.inventory_stock_configurations c
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
JOIN public.product_groups g    ON g.id = p.group_id
WHERE p.is_vape IS TRUE
  AND COALESCE(g.stock_config_profile,'standard') = 'standard'
  AND (c.config_code IN ('20NB','50NB','50OB') OR c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL)
ORDER BY p.product_name, pv.variant_name, c.config_code;

-- ----------------------------------------------------------------------------
-- 4. Quantities and allocations unchanged.
--    Compare these totals against the same columns in the A_PRECHECK output —
--    they must be identical, per configuration and in the grand total.
-- ----------------------------------------------------------------------------
SELECT '4. Device inventory totals (must equal A_PRECHECK)' AS check_name,
       p.product_name, pv.variant_name, c.config_code,
       o.org_name AS warehouse,
       pi.quantity_on_hand, pi.quantity_allocated, pi.quantity_available
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
JOIN public.product_groups g    ON g.id = p.group_id
LEFT JOIN public.organizations o ON o.id = pi.organization_id
WHERE p.is_vape IS TRUE AND COALESCE(g.stock_config_profile,'standard') = 'standard'
ORDER BY p.product_name, pv.variant_name, o.org_name;

SELECT '4b. Grand totals (must equal A_PRECHECK)' AS check_name,
       sum(pi.quantity_on_hand)   AS total_on_hand,
       sum(pi.quantity_allocated) AS total_allocated,
       sum(pi.quantity_available) AS total_available,
       count(*)                   AS inventory_rows
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
JOIN public.product_groups g    ON g.id = p.group_id
WHERE p.is_vape IS TRUE AND COALESCE(g.stock_config_profile,'standard') = 'standard';

-- ----------------------------------------------------------------------------
-- 5. D2H sellable availability.
--    Replicates the application rule (app/src/lib/orders/quick-order-catalog.ts):
--    a configuration is sellable when status = 'active' AND allow_so AND NOT
--    requires_repacking_before_sale. Expect sellable_available > 0 wherever
--    physical available stock exists.
-- ----------------------------------------------------------------------------
SELECT '5. D2H sellable availability' AS check_name,
       p.product_name, pv.variant_name, c.config_code, c.status, c.allow_so,
       SUM(pi.quantity_available)                                        AS physical_available,
       SUM(CASE WHEN c.status = 'active' AND c.allow_so
                     AND NOT c.requires_repacking_before_sale
                THEN pi.quantity_available ELSE 0 END)                   AS sellable_available,
       CASE
         WHEN SUM(pi.quantity_available) = 0 THEN 'N/A (no physical stock)'
         WHEN SUM(CASE WHEN c.status = 'active' AND c.allow_so
                            AND NOT c.requires_repacking_before_sale
                       THEN pi.quantity_available ELSE 0 END) > 0 THEN 'PASS'
         ELSE 'FAIL'
       END AS verdict
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
JOIN public.product_groups g    ON g.id = p.group_id
WHERE p.is_vape IS TRUE AND COALESCE(g.stock_config_profile,'standard') = 'standard'
GROUP BY p.product_name, pv.variant_name, c.config_code, c.status, c.allow_so
ORDER BY p.product_name, pv.variant_name;

-- ----------------------------------------------------------------------------
-- 6. Cartridge (concentration) behaviour unchanged.
--    Expect the 20NB / 50NB / 50OB template intact: 20NB active + allow_so,
--    50NB active, 50OB phase_out + requires_repacking_before_sale.
-- ----------------------------------------------------------------------------
SELECT '6. Cartridge configurations unchanged' AS check_name,
       g.group_code, c.config_code, c.status, c.allow_so, c.allow_ord,
       c.default_for_ord, c.requires_repacking_before_sale,
       count(*) AS config_rows
FROM public.inventory_stock_configurations c
JOIN public.product_variants pv ON pv.id = c.variant_id
JOIN public.products p          ON p.id = pv.product_id
JOIN public.product_groups g    ON g.id = p.group_id
WHERE COALESCE(g.stock_config_profile,'standard') = 'concentration'
GROUP BY g.group_code, c.config_code, c.status, c.allow_so, c.allow_ord,
         c.default_for_ord, c.requires_repacking_before_sale
ORDER BY g.group_code, c.config_code, c.status;

-- ----------------------------------------------------------------------------
-- 7. Recurrence guard is installed.
-- ----------------------------------------------------------------------------
SELECT '7. Recurrence guard installed' AS check_name,
       p.proname,
       (p.prosrc LIKE '%Concentration stock configurations (20NB/50NB/50OB) cannot be enabled%') AS guard_present,
       -- The guard must sit strictly BEFORE the STD -> UNCLASSIFIED conversion.
       (strpos(p.prosrc, 'COALESCE(v_group_profile, ''standard'') <> ''concentration''') > 0
        AND strpos(p.prosrc, 'COALESCE(v_group_profile, ''standard'') <> ''concentration''')
            < strpos(p.prosrc, 'config_code   = ''UNCLASSIFIED''')) AS guard_before_mutation,
       CASE WHEN p.prosrc LIKE '%Concentration stock configurations (20NB/50NB/50OB) cannot be enabled%'
             AND strpos(p.prosrc, 'COALESCE(v_group_profile, ''standard'') <> ''concentration''') > 0
             AND strpos(p.prosrc, 'COALESCE(v_group_profile, ''standard'') <> ''concentration''')
                 < strpos(p.prosrc, 'config_code   = ''UNCLASSIFIED''')
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM pg_proc p
WHERE p.proname = '_enable_variant_stock_configurations_core';

-- 7b. The 20260727 row-level trigger must still be attached alongside it.
SELECT '7b. Row-level eligibility trigger still attached' AS check_name,
       t.tgname, pg_get_triggerdef(t.oid) AS definition,
       CASE WHEN t.tgenabled = 'O' THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM pg_trigger t
WHERE t.tgname = 'trg_stock_config_group_eligibility';

COMMIT;
