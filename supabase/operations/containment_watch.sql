-- ============================================================================
-- Post-activation containment watch (READ ONLY)
-- ----------------------------------------------------------------------------
-- Re-run this after the next real RET26-* is received in production. It is the
-- proof that containment holds under real traffic, which installing the
-- migration alone does not establish.
--
--   ssh -i ~/.ssh/serapod_migration root@187.127.215.40 \
--     "docker exec -i serapod-prd-db psql -U supabase_admin -h 127.0.0.1 -d supabase" \
--     < supabase/operations/containment_watch.sql
--
-- PASS looks like:
--   R1  the new return's movements carry a 20NB stock_config_id
--   R2  20NB rises by exactly the returned quantity
--   R3  UNCLASSIFIED is unchanged at its frozen total
--   R4  no 50NB movement exists
--   R5  zero legacy writes after activation
--
-- Any row in R5 is a FAILURE: a write path was missed. It reports reference,
-- movement type, variant, warehouse and quantity so the path can be found.
--
-- Creates nothing. Never post a synthetic return to exercise this.
-- ============================================================================

SET default_transaction_read_only = on;
\pset pager off

\echo ''
\echo '--- R1: return movements posted since activation, with their configuration ---'
SELECT sm.reference_no,
       COALESCE(c.config_code, '(none)') AS config_code,
       count(*)                          AS movement_rows,
       sum(sm.quantity_change)           AS net_quantity,
       min(sm.created_at)                AS posted_at,
       COALESCE(o.org_code, '-')         AS warehouse
FROM public.stock_movements sm
LEFT JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
LEFT JOIN public.organizations o ON o.id = sm.to_organization_id
CROSS JOIN public.canonical_stock_config_activation a
WHERE sm.reference_type = 'return'
  AND sm.created_at > a.activated_at
GROUP BY sm.reference_no, c.config_code, o.org_code
ORDER BY min(sm.created_at);

\echo '--- R2: 20NB movement since activation (inventory must rise here) ---'
SELECT sm.reference_no, sm.movement_type, count(*) AS rows_,
       sum(sm.quantity_change) AS net, max(sm.created_at) AS latest
FROM public.stock_movements sm
JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
CROSS JOIN public.canonical_stock_config_activation a
WHERE c.config_code = '20NB' AND sm.created_at > a.activated_at
GROUP BY 1, 2 ORDER BY 5;

\echo '--- R3: balances now, against the frozen containment-day figures ---'
-- Baselines are the CONTAINMENT-day figures. After the legacy cutover the two
-- retired codes are expected to show a large negative delta (that is the whole
-- point); 20NB and STD must still show exactly zero.
SELECT c.config_code,
       COALESCE(sum(pi.quantity_on_hand), 0) AS quantity_on_hand,
       CASE c.config_code
         WHEN '20NB'         THEN 332794
         WHEN '50NB'         THEN 97141
         WHEN '50OB'         THEN 0
         WHEN 'STD'          THEN 33033
         WHEN 'UNCLASSIFIED' THEN 304875
       END AS at_containment,
       COALESCE(sum(pi.quantity_on_hand), 0) - CASE c.config_code
         WHEN '20NB'         THEN 332794
         WHEN '50NB'         THEN 97141
         WHEN '50OB'         THEN 0
         WHEN 'STD'          THEN 33033
         WHEN 'UNCLASSIFIED' THEN 304875
       END AS delta
FROM public.inventory_stock_configurations c
LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
GROUP BY c.config_code ORDER BY c.config_code;

\echo '--- R4: 50NB movement since activation, split by whether it is the cutover ---'
-- Before the cutover this had to be zero outright. Now the retirement
-- movements themselves are legitimately here, so the number that must stay at
-- zero is the non-cutover column.
SELECT count(*) FILTER (WHERE sm.reference_type = 'legacy_config_cutover') AS cutover_retirements,
       count(*) FILTER (WHERE sm.reference_type <> 'legacy_config_cutover') AS must_be_zero
FROM public.stock_movements sm
JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
CROSS JOIN public.canonical_stock_config_activation a
WHERE c.config_code = '50NB' AND sm.created_at > a.activated_at;

\echo '--- R5: FAILURE CHECK — any non-cutover legacy write after activation ---'
SELECT sm.created_at, c.config_code, sm.movement_type, sm.reference_type,
       sm.reference_no, sm.quantity_change,
       v.variant_name,
       COALESCE(o_to.org_code, o_from.org_code) AS warehouse,
       sm.created_by
FROM public.stock_movements sm
JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
JOIN public.product_variants v ON v.id = sm.variant_id
LEFT JOIN public.organizations o_to   ON o_to.id   = sm.to_organization_id
LEFT JOIN public.organizations o_from ON o_from.id = sm.from_organization_id
CROSS JOIN public.canonical_stock_config_activation a
WHERE c.config_code IN ('50NB', '50OB', 'UNCLASSIFIED')
  AND sm.created_at > a.activated_at
  AND sm.reference_type <> 'legacy_config_cutover'
ORDER BY sm.created_at DESC;
