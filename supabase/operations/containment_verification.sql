\echo ''
\echo '--- V1: new objects installed ---'
SELECT to_regclass('public.canonical_stock_config_activation')::text        AS activation_table,
       to_regclass('public.v_canonical_stock_config')::text                 AS canonical_view,
       to_regprocedure('public.resolve_operational_stock_config(uuid)')::text AS resolver,
       to_regprocedure('public.canonical_stock_config_activated_at()')::text AS activated_at_fn;

\echo '--- V2: activation stamp ---'
SELECT activated_at, migration FROM public.canonical_stock_config_activation;

\echo '--- V3: every active variant resolves EXACTLY ONE canonical config ---'
SELECT n_candidates, count(*) AS active_variants FROM (
  SELECT v.id, (SELECT count(*) FROM public.v_canonical_stock_config vc WHERE vc.variant_id = v.id) AS n_candidates
    FROM public.product_variants v WHERE v.is_active) x
GROUP BY 1 ORDER BY 1;

\echo '--- V4: resolver answers per family (Cellera -> 20NB, non-vape -> STD) ---'
SELECT CASE WHEN p.is_vape THEN 'vape (Cellera family)' ELSE 'non-vape' END AS family,
       c.config_code AS resolved_config_code,
       count(*) AS variants
FROM public.product_variants v
JOIN public.products p ON p.id = v.product_id
JOIN public.inventory_stock_configurations c
     ON c.id = public.resolve_operational_stock_config(v.id)
WHERE v.is_active
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '--- V5: resolver never answers a legacy code ---'
SELECT count(*) AS active_variants_resolving_to_legacy
FROM public.product_variants v
JOIN public.inventory_stock_configurations c ON c.id = public.resolve_operational_stock_config(v.id)
WHERE v.is_active AND c.config_code IN ('50NB','50OB','UNCLASSIFIED');

\echo '--- V6: explicit stock_config_id stays explicit (guard shapes) ---'
SELECT p.proname,
       (pg_get_functiondef(p.oid) ~ 'COALESCE\(p_stock_config_id, public\.resolve_operational_stock_config'
        OR pg_get_functiondef(p.oid) ~ 'COALESCE\(NEW\.stock_config_id, public\.resolve_operational_stock_config'
        OR pg_get_functiondef(p.oid) ~ 'IF NEW\.stock_config_id IS NULL THEN') AS explicit_wins
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
  AND p.proname IN ('record_stock_movement','trg_stock_movements_fill_cost_and_balance','stock_movements_apply_to_inventory')
ORDER BY 1;

\echo '--- V7: every repointed path now uses the operational resolver ---'
SELECT p.proname,
       (pg_get_functiondef(p.oid) ~ 'resolve_operational_stock_config') AS uses_operational,
       (pg_get_functiondef(p.oid) ~ 'resolve_default_stock_config')     AS still_uses_legacy_sink
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
  AND p.proname IN ('record_stock_movement','trg_stock_movements_fill_cost_and_balance',
                    'post_return_case_inventory','adjust_inventory_quantity',
                    'apply_inventory_ship_adjustment','wms_deduct_and_summarize',
                    'stock_movements_apply_to_inventory',
                    'release_allocation_for_order','revert_inventory_on_movement_delete')
ORDER BY 1;

\echo '--- V8: post_return_case_inventory Cellera destination resolves to 20NB ---'
SELECT c.config_code AS return_destination_config, count(DISTINCT v.id) AS cellera_variants
FROM public.product_variants v
JOIN public.products p ON p.id = v.product_id
JOIN public.inventory_stock_configurations c ON c.id = public.resolve_operational_stock_config(v.id)
WHERE v.is_active AND p.is_vape
GROUP BY 1 ORDER BY 1;

\echo '--- V9: inventory totals (must equal the pre-migration capture) ---'
SELECT c.config_code,
       count(*) FILTER (WHERE COALESCE(pi.quantity_on_hand,0) <> 0) AS nonzero_rows,
       COALESCE(sum(pi.quantity_on_hand),0)   AS quantity_on_hand,
       COALESCE(sum(pi.quantity_allocated),0) AS quantity_allocated
FROM public.inventory_stock_configurations c
LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
GROUP BY c.config_code ORDER BY c.config_code;

\echo '--- V10: no movement was created by the migration ---'
SELECT count(*) AS movements_total, max(created_at) AS latest_movement FROM public.stock_movements;
