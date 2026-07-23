-- ============================================================================
-- Inventory Stock Configurations — Phase 15 (forward-only)
-- Raise per-statement timeout for Stock Count posting RPCs
-- ----------------------------------------------------------------------------
-- Confirmed root cause of SC-MRR2XNC3-8H67 (and every large-session failure):
--
--   The Supabase `authenticated`/`authenticator` roles run with
--   `statement_timeout = 8s` (and `lock_timeout = 8s`). A Stock Count post is a
--   single PostgREST statement: SELECT verify_and_post_stock_*(...). For a small
--   session (4–8 movements) it finishes well under 8s, but an Initial
--   Configuration Classification covering many flavours issues one
--   record_stock_movement() call per counted line (e.g. 124 lines → 124 ledger
--   writes, each with advisory + row locks and BEFORE/AFTER triggers). That
--   exceeds 8s and Postgres cancels the statement (SQLSTATE 57014). Because the
--   whole function is one transaction, EVERYTHING rolls back:
--     * inventory is unchanged,
--     * the session stays 'draft',
--     * the verification request stays 'active' (code NOT consumed),
--   and the API surfaced it as the generic "unexpected error".
--
--   This is why small classifications posted successfully on 2026-07-18 but the
--   124-line sessions on 2026-07-19 always failed. The EXECUTE grant (migration
--   14) and PostgREST schema cache were NOT the cause — the function already had
--   PUBLIC execute and was discoverable.
--
-- Fix: give the two posting RPCs a generous per-function statement_timeout and a
-- larger lock_timeout. A function-scoped `SET` re-arms the timer for the running
-- statement (verified empirically against the authenticated role), so the
-- atomic post can finish. Idempotency is unchanged: the session is still updated
-- WHERE status = 'draft' and the code is still single-use, so a retry after any
-- transient failure posts exactly once.
--
-- Bounded (not disabled) so a genuinely stuck post cannot hold locks forever.
-- ============================================================================

BEGIN;

ALTER FUNCTION public.verify_and_post_stock_classification(uuid, text)
  SET statement_timeout TO '300s';
ALTER FUNCTION public.verify_and_post_stock_classification(uuid, text)
  SET lock_timeout TO '30s';

ALTER FUNCTION public.verify_and_post_stock_count(uuid, text)
  SET statement_timeout TO '300s';
ALTER FUNCTION public.verify_and_post_stock_count(uuid, text)
  SET lock_timeout TO '30s';

COMMENT ON FUNCTION public.verify_and_post_stock_classification(uuid, text) IS
  'Atomically reclassifies a Legacy/Unclassified balance into 20NB/50NB/50OB. Runs with statement_timeout=300s / lock_timeout=30s (migration 15) so large multi-flavour posts are not cancelled by the 8s authenticated-role limit. Single-use code + draft-only session update keep it idempotent.';

COMMENT ON FUNCTION public.verify_and_post_stock_count(uuid, text) IS
  'Atomically posts verified Stock Count variances to exact warehouse/variant/stock-configuration balances. Runs with statement_timeout=300s / lock_timeout=30s (migration 15). Rejects initial_configuration_classification sessions (use verify_and_post_stock_classification).';

NOTIFY pgrst, 'reload schema';

COMMIT;
