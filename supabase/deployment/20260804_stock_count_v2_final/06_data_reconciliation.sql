-- =============================================================================
-- 06_data_reconciliation.sql  [DATA CHANGE]
-- =============================================================================
-- PURPOSE      : Two idempotent reconciliations required by the 9a62556a contract.
-- PREREQUISITES: 02-05 completed.
-- MUTATES      : *** THIS FILE UPDATES EXISTING ROWS. *** It is the ONLY file in the pack that changes business data. Both statements are naturally idempotent (re-running matches zero further rows). Neither touches inventory quantities, stock movements, orders, QR records or posted Opening Balances.
-- EXPECTED     : Both counts reported below reach 0 and stay 0 on re-run.
-- VERIFY       : 08_post_deployment_verification.sql section D.
-- CHANGE 1     : inventory_stock_configurations.status 'active'/'phase_out'
--                -> 'inactive' for configurations whose owning product_variant is
--                already archived (is_active = false). Narrow allow-list, so a
--                future status value can never be silently reclassified.
-- CHANGE 2     : stock_count_sessions.status 'draft' -> 'archived' for opening
--                balance sessions whose ONLY cutoff is already 'cancelled'. These
--                are stuck drafts that occupy the one-active-draft slot.
-- NOT DONE     : no movement is replayed, no balance recomputed, no business
--                transaction backfilled twice.
-- REVIEW FIRST : run the two SELECT previews below on production and eyeball the
--                counts BEFORE running the UPDATEs.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

-- ---------------------------------------------------------------------------
-- READ-ONLY PREVIEW -- run this first, on its own, and review the counts.
-- ---------------------------------------------------------------------------
SELECT 'configs_to_deactivate' AS change, count(*) AS rows_affected
FROM public.inventory_stock_configurations isc
JOIN public.product_variants pv ON pv.id = isc.variant_id
WHERE pv.is_active = false AND isc.status IN ('active', 'phase_out')
UNION ALL
SELECT 'stuck_draft_sessions_to_archive', count(*)
FROM public.stock_count_sessions s
WHERE s.status = 'draft'
  AND s.count_type = 'opening_balance_cutoff'
  AND EXISTS (SELECT 1 FROM public.inventory_opening_cutoffs c
              WHERE c.stock_count_session_id = s.id AND c.status = 'cancelled');

-- ---------------------------------------------------------------------------
-- AMBIGUITY CHECK -- any non-zero row here means STOP and get manual approval.
-- ---------------------------------------------------------------------------
SELECT 'REVIEW_REQUIRED: config has stock movement history' AS ambiguity, count(*) AS rows
FROM public.inventory_stock_configurations isc
JOIN public.product_variants pv ON pv.id = isc.variant_id
WHERE pv.is_active = false AND isc.status IN ('active','phase_out')
  AND EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.stock_config_id = isc.id)
UNION ALL
SELECT 'REVIEW_REQUIRED: config still holds non-zero inventory', count(*)
FROM public.inventory_stock_configurations isc
JOIN public.product_variants pv ON pv.id = isc.variant_id
JOIN public.product_inventory pi ON pi.stock_config_id = isc.id
WHERE pv.is_active = false AND isc.status IN ('active','phase_out')
  AND (pi.quantity_on_hand <> 0 OR pi.quantity_allocated <> 0)
UNION ALL
SELECT 'REVIEW_REQUIRED: session also has a NON-cancelled cut-off', count(*)
FROM (SELECT s.id FROM public.stock_count_sessions s
      JOIN public.inventory_opening_cutoffs c ON c.stock_count_session_id = s.id
      WHERE s.status = 'draft' AND s.count_type = 'opening_balance_cutoff'
      GROUP BY s.id
      HAVING count(*) FILTER (WHERE c.status = 'cancelled') > 0
         AND count(*) FILTER (WHERE c.status <> 'cancelled') > 0) z;

-- ---------------------------------------------------------------------------
-- APPROVAL GATE
-- ---------------------------------------------------------------------------
-- This file does NOTHING unless you explicitly opt in:
--
--     psql "$URL" -v ON_ERROR_STOP=1 -v reconcile_approved=yes -f 06_data_reconciliation.sql
--
-- Why an opt-in and not an automatic apply:
--   * It stops a BLIND RE-RUN from mutating rows. Both UPDATEs are idempotent
--     against the state they were written for, but they are NOT time-scoped --
--     if someone later and legitimately re-activates a configuration on an
--     archived variant, or a new draft ends up behind a cancelled cut-off, a
--     careless re-run would silently revert that legitimate change. Requiring a
--     conscious flag each time means the operator must read the preview first.
--   * It makes any REVIEW_REQUIRED row above a genuine stop condition.
--
-- At the time this pack was built BOTH staging and production reported ZERO
-- qualifying rows for both changes and ZERO ambiguities, so this file is
-- expected to be a no-op. Re-check with the preview above before trusting that.
-- ---------------------------------------------------------------------------
\if :{?reconcile_approved}
\else
  \set reconcile_approved no
\endif

\if :reconcile_approved
\echo '>>> reconcile_approved is set -- APPLYING the two reconciliation updates.'
BEGIN;

-- ---- source (verbatim): supabase/migrations/20260730_archive_variant_stock_config_reconciliation.sql

UPDATE public.inventory_stock_configurations AS isc
SET status = 'inactive'
FROM public.product_variants AS pv
WHERE isc.variant_id = pv.id
  AND pv.is_active = false
  AND isc.status IN ('active', 'phase_out');

-- ---- source (verbatim): supabase/migrations/20260731220000_inventory_cutoff_cancel_archives_draft_session.sql

update public.stock_count_sessions s
set
  status = 'archived',
  updated_at = now()
where s.status = 'draft'
  and s.count_type = 'opening_balance_cutoff'
  and exists (
    select 1
    from public.inventory_opening_cutoffs c
    where c.stock_count_session_id = s.id
      and c.status = 'cancelled'
  )
  and not exists (
    select 1
    from public.inventory_opening_cutoffs c
    where c.stock_count_session_id = s.id
      and c.status in ('counting', 'posted')
  );

-- Post-condition: re-run the preview at the top; both counts must now be 0.
COMMIT;
\else
\echo ''
\echo '>>> NOT APPLIED. 06 is opt-in.'
\echo '>>> Review the preview and ambiguity counts above.'
\echo '>>> If (and only if) they are expected, re-run with:'
\echo '>>>   -v reconcile_approved=yes'
\echo ''
\endif
