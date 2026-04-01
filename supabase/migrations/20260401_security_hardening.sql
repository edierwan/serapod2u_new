-- Audit log table for all destructive operation attempts (allowed or blocked).
-- This table is written by the application guard and should NEVER be
-- writable via the public API (anon / authenticated roles).

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

-- Only the service_role should be able to INSERT.
-- Revoke everything from anon & authenticated, then grant select only
-- so dashboards can read it.
ALTER TABLE public.destructive_ops_audit_log ENABLE ROW LEVEL SECURITY;

-- No RLS policy for anon / authenticated = no access through PostgREST
-- The service_role key bypasses RLS, so the app guard can still INSERT.

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_destructive_audit_created
  ON public.destructive_ops_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_destructive_audit_operation
  ON public.destructive_ops_audit_log (operation);

-- =========================================================================
-- CRITICAL: Revoke EXECUTE on dangerous functions from public-facing roles.
-- These functions should only be callable via the service_role key.
-- =========================================================================

-- Raw SQL execution functions (highest risk — allow arbitrary DDL/DML)
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.exec(text) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.exec_raw_sql(text) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Bulk-delete functions
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.delete_all_transactions_with_inventory_v3() FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.hard_delete_organization(uuid) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.hard_delete_order(uuid) FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
