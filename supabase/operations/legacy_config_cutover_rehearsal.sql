-- ============================================================================
-- LEGACY-CONFIG-CUTOVER-2026 — rehearsal (ROLLS BACK, CHANGES NOTHING)
-- ----------------------------------------------------------------------------
-- The end-to-end proof of the two invariants the unit tests can only mirror:
--
--   1. An explicit stock_config_id is never overridden by the canonical
--      resolver, so a cutover movement against 50NB retires 50NB and leaves
--      20NB exactly where it was.
--   2. LIVE_LEGACY_WRITER blocks on a legacy movement posted AFTER canonical-
--      resolver activation, and not on the historical ones from before it.
--
-- Everything happens inside ONE transaction that ends in ROLLBACK. No balance,
-- movement, configuration or snapshot row survives this script. Run it only
-- after migrations 20260904100000-20260904130000 are present in the target
-- environment, and run it on STAGING first.
--
--   ssh -i ~/.ssh/serapod_migration root@72.62.253.182 \
--     "docker exec -i serapod-stg-db psql -U postgres -d supabase -v ON_ERROR_STOP=1" \
--     < supabase/operations/legacy_config_cutover_rehearsal.sql
--
-- Container identity matters: KVM2 (staging) runs BOTH serapod-stg-db and a
-- container named serapod-prd-db. Staging is serapod-stg-db / database
-- supabase; production is serapod-prd-db / database supabase on KVM8.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- Nothing below may leak, whatever happens next.
CREATE OR REPLACE FUNCTION pg_temp.rehearsal_guard() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation', true) IS NULL THEN
    RAISE EXCEPTION 'Rehearsal must run inside a transaction';
  END IF;
END;
$$;
SELECT pg_temp.rehearsal_guard();

\echo ''
\echo '=== A. Pick a live Cellera variant that carries both 20NB and a legacy balance ==='

CREATE TEMP TABLE rehearsal_subject ON COMMIT DROP AS
SELECT pi_new.organization_id,
       pi_new.variant_id,
       v.variant_name,
       o.org_code,
       c_new.id  AS config_20nb,
       c_old.id  AS config_legacy,
       c_old.config_code AS legacy_code,
       pi_new.quantity_on_hand AS qty_20nb_before,
       pi_old.quantity_on_hand AS qty_legacy_before
FROM public.product_inventory pi_new
JOIN public.inventory_stock_configurations c_new
     ON c_new.id = pi_new.stock_config_id AND c_new.config_code = '20NB'
JOIN public.inventory_stock_configurations c_old
     ON c_old.variant_id = pi_new.variant_id
    AND c_old.config_code IN ('50NB', 'UNCLASSIFIED')
JOIN public.product_inventory pi_old
     ON pi_old.variant_id = pi_new.variant_id
    AND pi_old.organization_id = pi_new.organization_id
    AND pi_old.stock_config_id = c_old.id
    AND pi_old.is_active
JOIN public.product_variants v ON v.id = pi_new.variant_id
JOIN public.organizations o ON o.id = pi_new.organization_id
WHERE pi_new.is_active
  AND pi_new.quantity_on_hand > 0
  AND pi_old.quantity_on_hand > 0
ORDER BY pi_old.quantity_on_hand DESC
LIMIT 1;

SELECT org_code, variant_name, legacy_code, qty_20nb_before, qty_legacy_before
FROM rehearsal_subject;

\echo ''
\echo '=== B. Post the retirement explicitly against the LEGACY configuration ==='
-- This is exactly what execute_legacy_config_cutover() does per row.

DO $$
DECLARE
  s          record;
  v_movement uuid;
  v_20_after integer;
  v_lg_after integer;
BEGIN
  SELECT * INTO s FROM rehearsal_subject;
  IF s IS NULL THEN
    RAISE NOTICE 'No variant carries both a 20NB and a legacy balance here; nothing to rehearse.';
    RETURN;
  END IF;

  v_movement := public.record_stock_movement(
    p_movement_type   => 'adjustment',
    p_variant_id      => s.variant_id,
    p_organization_id => s.organization_id,
    p_quantity_change => -s.qty_legacy_before,
    p_reason          => 'REHEARSAL — rolled back',
    p_reference_type  => 'legacy_config_cutover',
    p_reference_no    => 'REHEARSAL-ONLY',
    p_stock_config_id => s.config_legacy      -- explicit; must not be overridden
  );

  SELECT quantity_on_hand INTO v_20_after FROM public.product_inventory
   WHERE variant_id = s.variant_id AND organization_id = s.organization_id
     AND stock_config_id = s.config_20nb;
  SELECT quantity_on_hand INTO v_lg_after FROM public.product_inventory
   WHERE variant_id = s.variant_id AND organization_id = s.organization_id
     AND stock_config_id = s.config_legacy;

  RAISE NOTICE '% at %: % % → %, 20NB % → %',
    s.variant_name, s.org_code, s.legacy_code, s.qty_legacy_before, v_lg_after,
    s.qty_20nb_before, v_20_after;

  -- INVARIANT 1a: the legacy balance is zero.
  IF v_lg_after <> 0 THEN
    RAISE EXCEPTION 'FAIL: % did not reach zero (got %)', s.legacy_code, v_lg_after;
  END IF;

  -- INVARIANT 1b: 20NB is untouched. Not incremented, not credited, not summed.
  IF v_20_after IS DISTINCT FROM s.qty_20nb_before THEN
    RAISE EXCEPTION 'FAIL: 20NB moved from % to % — the resolver overrode the explicit configuration',
      s.qty_20nb_before, v_20_after;
  END IF;

  -- INVARIANT 1c: the movement was recorded against the legacy configuration.
  PERFORM 1 FROM public.stock_movements
   WHERE id = v_movement
     AND stock_config_id = s.config_legacy
     AND quantity_change = -s.qty_legacy_before;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: the movement did not carry the explicit legacy configuration';
  END IF;

  RAISE NOTICE 'PASS: explicit legacy posting preserved; 20NB unchanged at %', v_20_after;
END;
$$;

\echo ''
\echo '=== C. LIVE_LEGACY_WRITER: historical writes must not block ==='

DO $$
DECLARE
  v_activated timestamptz;
  v_result    jsonb;
  v_blocked   boolean;
BEGIN
  v_activated := public.canonical_stock_config_activated_at();
  RAISE NOTICE 'canonical resolver activated at %', v_activated;

  v_result := public.legacy_config_cutover_preflight();
  v_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b
     WHERE b->>'code' = 'LIVE_LEGACY_WRITER');

  -- The retirement movement posted in section B is reference_type
  -- legacy_config_cutover and is excluded by design, so it must not trip the
  -- blocker even though it was posted seconds ago.
  IF v_blocked THEN
    RAISE EXCEPTION 'FAIL: cutover retirement movements tripped LIVE_LEGACY_WRITER';
  END IF;
  RAISE NOTICE 'PASS: historical legacy writes and cutover movements do not block';
  RAISE NOTICE 'historical (non-blocking) writers: %',
    jsonb_pretty(v_result->'historical_legacy_writers');
END;
$$;

\echo ''
\echo '=== D. LIVE_LEGACY_WRITER: a write after activation must block ==='

DO $$
DECLARE
  s        record;
  v_result jsonb;
  v_blocked boolean;
BEGIN
  SELECT * INTO s FROM rehearsal_subject;
  IF s IS NULL THEN RETURN; END IF;

  -- Simulate a missed write path: an ordinary manual_in into the legacy
  -- configuration, posted now, i.e. after activation.
  PERFORM public.record_stock_movement(
    p_movement_type   => 'manual_in',
    p_variant_id      => s.variant_id,
    p_organization_id => s.organization_id,
    p_quantity_change => 1,
    p_reason          => 'REHEARSAL — simulated missed write path, rolled back',
    p_reference_type  => 'manual',
    p_stock_config_id => s.config_legacy
  );

  v_result := public.legacy_config_cutover_preflight();
  v_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b
     WHERE b->>'code' = 'LIVE_LEGACY_WRITER');

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: a legacy write after activation did not trip LIVE_LEGACY_WRITER';
  END IF;
  RAISE NOTICE 'PASS: a legacy write after activation blocks the cutover';
END;
$$;

\echo ''
\echo '=== E. Rolling everything back ==='

ROLLBACK;

\echo ''
\echo '=== F. Post-rollback proof: nothing changed ==='

SET default_transaction_read_only = on;

SELECT c.config_code,
       COALESCE(sum(pi.quantity_on_hand), 0) AS quantity_on_hand
FROM public.inventory_stock_configurations c
LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
WHERE c.config_code IN ('20NB', 'STD', '50NB', '50OB', 'UNCLASSIFIED')
GROUP BY c.config_code
ORDER BY c.config_code;

SELECT count(*) AS rehearsal_movements_left_behind
FROM public.stock_movements
WHERE reference_no IN ('REHEARSAL-ONLY')
   OR reason LIKE 'REHEARSAL —%';
