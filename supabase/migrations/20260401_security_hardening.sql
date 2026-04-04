-- =============================================================================
-- SECURITY HARDENING MIGRATION
-- Applied: 2026-04-01 (updated 2026-04-04)
--
-- This migration:
--  1. Creates the destructive_ops_audit_log table (with RLS)
--  2. Revokes EXECUTE from PUBLIC/anon/authenticated on ALL dangerous functions
--  3. Explicitly grants EXECUTE to service_role/postgres/supabase_admin only
--  4. Sets default privileges so future functions don't auto-grant to PUBLIC
--
-- IMPORTANT: PostgreSQL grants EXECUTE to the PUBLIC pseudo-role by default.
-- Revoking from anon/authenticated alone is NOT sufficient because they
-- inherit from PUBLIC. We must REVOKE ALL FROM PUBLIC first.
-- =============================================================================

-- ─── 1. Audit log table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.destructive_ops_audit_log (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  operation   text NOT NULL,
  user_id     uuid,
  user_email  text,
  allowed     boolean NOT NULL,
  reason      text,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.destructive_ops_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_destructive_audit_created
  ON public.destructive_ops_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_destructive_audit_operation
  ON public.destructive_ops_audit_log (operation);

-- ─── 2. Revoke EXECUTE on all dangerous functions ───────────────────────────
-- Pattern: REVOKE ALL FROM PUBLIC + anon + authenticated, GRANT to service_role.
-- Wrapped in DO blocks with EXCEPTION so missing functions don't abort.

-- ── Category A: Raw SQL execution (highest risk) ────────────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.exec(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.exec(text) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.exec_raw_sql(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.exec_raw_sql(text) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ── Category B: Bulk-delete / hard-delete (critical) ────────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.delete_all_transactions_with_inventory() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.delete_all_transactions_with_inventory() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.delete_all_transactions_with_inventory_v3() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.delete_all_transactions_with_inventory_v3() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.hard_delete_organization(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.hard_delete_organization(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.hard_delete_order(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.hard_delete_order(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ── Category C: Maintenance / cleanup ───────────────────────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.archive_old_audit_logs(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.archive_old_audit_logs(integer) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.cleanup_old_audit_logs() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.cleanup_old_audit_logs() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications(integer) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.refresh_all_materialized_views() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.refresh_all_materialized_views() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.revert_inventory_on_movement_delete() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.revert_inventory_on_movement_delete() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.delete_scratch_campaign(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.delete_scratch_campaign(uuid, uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ── Category D: Seed / initialisation ───────────────────────────────────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.seed_hr_gl_accounts(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.seed_hr_gl_accounts(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.seed_payroll_components(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.seed_payroll_components(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.seed_payroll_components(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.seed_payroll_components(uuid, uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.seed_payroll_gl_mappings(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.seed_payroll_gl_mappings(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ── Category E: Body-level dangerous (DELETE FROM / EXECUTE in body) ────────

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.generate_fiscal_periods(uuid, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.generate_fiscal_periods(uuid, text) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.post_payroll_run_to_gl(uuid, date) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.post_payroll_run_to_gl(uuid, date) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.regenerate_order_doc_numbers(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.regenerate_order_doc_numbers(uuid) TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON FUNCTION public.trg_on_purchase_receive_create_balance_request() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.trg_on_purchase_receive_create_balance_request() TO service_role, postgres, supabase_admin;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- ─── 3. Default privileges: new functions don't auto-grant to PUBLIC ────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
