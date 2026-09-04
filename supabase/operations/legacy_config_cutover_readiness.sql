-- ============================================================================
-- LEGACY-CONFIG-CUTOVER-2026 — readiness report (READ ONLY)
-- ----------------------------------------------------------------------------
-- The human-readable companion to legacy_config_cutover_snapshot.sql. Answers,
-- for one environment: what would be retired, what is blocking, and is the
-- canonical resolver sound.
--
-- Safe to run at any time, including before migration 20260904100000 has been
-- applied — the sections that need the new objects degrade to a notice rather
-- than an error.
-- ============================================================================

SET default_transaction_read_only = on;
\pset pager off

\echo ''
\echo '=== 0. Environment ==='
SELECT current_database() AS database,
       (SELECT count(*) FROM public.inventory_stock_configurations) AS configurations,
       (SELECT count(*) FROM public.product_variants) AS variants,
       (SELECT count(*) FROM public.organizations) AS organizations;

\echo ''
\echo '=== 1. Retirement scope — what the cutover would zero ==='
SELECT c.config_code,
       count(*) FILTER (WHERE COALESCE(pi.quantity_on_hand, 0) <> 0) AS inventory_rows,
       count(DISTINCT pi.organization_id) FILTER (WHERE COALESCE(pi.quantity_on_hand, 0) <> 0) AS organizations,
       COALESCE(sum(pi.quantity_on_hand), 0)   AS quantity_on_hand,
       COALESCE(sum(pi.quantity_allocated), 0) AS quantity_allocated
FROM public.inventory_stock_configurations c
LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
WHERE c.config_code IN ('50NB', '50OB', 'UNCLASSIFIED')
GROUP BY c.config_code
ORDER BY c.config_code;

\echo ''
\echo '=== 2. Untouched canonical balances — must be identical after cutover ==='
SELECT c.config_code,
       COALESCE(sum(pi.quantity_on_hand), 0)   AS quantity_on_hand,
       COALESCE(sum(pi.quantity_allocated), 0) AS quantity_allocated
FROM public.inventory_stock_configurations c
LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
WHERE c.config_code IN ('20NB', 'STD')
GROUP BY c.config_code
ORDER BY c.config_code;

\echo ''
\echo '=== 3. Retirement scope by organization ==='
SELECT o.org_code, o.org_name, o.org_type_code AS org_type, c.config_code,
       count(*) AS rows_, sum(pi.quantity_on_hand) AS quantity_on_hand
FROM public.product_inventory pi
JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
JOIN public.organizations o ON o.id = pi.organization_id
WHERE c.config_code IN ('50NB', '50OB', 'UNCLASSIFIED')
  AND COALESCE(pi.quantity_on_hand, 0) <> 0
GROUP BY o.org_code, o.org_name, o.org_type_code, c.config_code
ORDER BY o.org_code, c.config_code;

\echo ''
\echo '=== 4. Canonical resolver soundness (active variants must all be 1) ==='
SELECT n_candidates, count(*) AS active_variants
FROM (
  SELECT v.id,
         (SELECT count(*) FROM public.inventory_stock_configurations c
           WHERE c.variant_id = v.id
             AND c.status = 'active'
             AND c.default_for_ord
             AND c.config_code <> 'UNCLASSIFIED'
             AND NOT COALESCE(c.requires_repacking_before_sale, false)) AS n_candidates
    FROM public.product_variants v
   WHERE v.is_active
) x
GROUP BY n_candidates
ORDER BY n_candidates;

\echo ''
\echo '=== 5. Live writers into a legacy configuration (last 60 days) ==='
SELECT c.config_code, sm.movement_type, sm.reference_type,
       count(*) AS movements, sum(sm.quantity_change) AS net_quantity,
       min(sm.created_at)::date AS first_seen,
       max(sm.created_at)::date AS last_seen
FROM public.stock_movements sm
JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
WHERE c.config_code IN ('50NB', '50OB', 'UNCLASSIFIED')
  AND sm.created_at > now() - interval '60 days'
GROUP BY c.config_code, sm.movement_type, sm.reference_type
ORDER BY max(sm.created_at) DESC;

\echo ''
\echo '=== 6. Open documents that could re-create a legacy balance ==='
SELECT 'open stock transfers' AS document, count(*) AS open_count
  FROM public.stock_transfers
 WHERE status IN ('draft', 'pending', 'pending_approval', 'in_transit')
UNION ALL
SELECT 'unposted stock adjustments', count(*)
  FROM public.stock_adjustments
 WHERE status NOT IN ('posted', 'cancelled', 'rejected')
UNION ALL
SELECT 'open stock count sessions', count(*)
  FROM public.stock_count_sessions
 WHERE status NOT IN ('posted', 'archived', 'cancelled')
UNION ALL
SELECT 'open order items without a configuration', count(*)
  FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
 WHERE oi.stock_config_id IS NULL
   AND o.status NOT IN ('cancelled', 'closed');

\echo ''
\echo '=== 7. Preflight verdict (requires migration 20260904110000) ==='
DO $$
BEGIN
  IF to_regprocedure('public.legacy_config_cutover_preflight(integer)') IS NULL THEN
    RAISE NOTICE 'legacy_config_cutover_preflight() is not installed in this environment yet.';
  ELSE
    RAISE NOTICE '%', jsonb_pretty(public.legacy_config_cutover_preflight());
  END IF;
END;
$$;
