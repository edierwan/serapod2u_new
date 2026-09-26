-- ============================================================================
-- Phase 0B / Commit B — sensitive tables, views and HR tenant boundaries
-- ----------------------------------------------------------------------------
-- Before (verified 2026-09-27, read-only catalog queries, prod + staging)
--   * 70 public tables in production (64 in staging) had RLS DISABLED while
--     anon and authenticated held full SELECT/INSERT/UPDATE/DELETE through the
--     default grants: every HR table for recruitment, contracts, payroll runs
--     and payroll run items (salaries), benefits, expenses, timesheets,
--     payslip access logs; otp_challenges; points_transactions (6k+ rows);
--     notifications_outbox (the outbound SMS/WhatsApp queue); QR movement and
--     shipment session tables; loyalty/journey configuration; shop requests.
--     Anyone holding the public anon key could read or rewrite them.
--   * 45 superuser-owned views without security_invoker (so they bypass RLS)
--     were readable by anon, including consumer PII + bank data
--     (v_admin_redemptions), HR (hr_employee_dashboard), GL and support views.
--   * 51 HR/department policies compared u.organization_id = u.organization_id
--     (always true), so any admin-level user of any organization passed the
--     tenant check on HR writes and on compensation/allowance/deduction reads.
--   * hr_gl_mappings / hr_gl_postings allowed any authenticated user USING/
--     WITH CHECK (true).
--
-- After
--   * Every listed table has RLS enabled (deny by default) and one of:
--       SERVER   - no API role access (service_role bypasses RLS)
--       policies - explicit authenticated (and, where the public journey
--                  requires it, narrow anon) policies based on the verified
--                  auth.uid() actor.
--   * anon loses SELECT on every public view; authenticated loses SELECT on
--     views that no authenticated code path reads.
--   * HR tautologies bind the actor's organization to the target row.
--
-- Legitimate rules preserved (current production behaviour):
--   HR reads: any active member of the row's organization (HR module gate).
--   HR writes: HR managers = active role_level <= 20 or role HR_MANAGER
--     (canManageHr; in production only SA/HQ/PU/POWER_USER hold the
--     manage_org_chart/edit_org_settings permissions).
--   Employee-owned HR records (salary lines, contracts, claims, enrolments,
--   requests, ...) are readable by the employee and HR managers only.
--   Business tables: active staff (role_level <= 40) of the same company;
--   GUEST consumer/shop accounts only see their own rows, and shop redemption
--   may only record point debits.
--
-- Rollback guidance (do not apply automatically)
--   ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY; DROP POLICY sa_* ...;
--   GRANT ALL ON public.<t> TO anon, authenticated;  (previous default grants)
--   GRANT SELECT ON public.<view> TO anon, authenticated;
--   For the 51 HR policies, ALTER POLICY back to the expressions recorded in
--   docs/security/phase0b-rpc-inventory.md is NOT recommended: they were
--   tautological. Restore from supabase/schemas/current_schema.sql if needed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Actor helpers for policies
--    SECURITY DEFINER so they can read users/roles without recursing into
--    users RLS; they only ever describe the verified caller (auth.uid()).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sa_actor_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.organization_id
    FROM public.users u
   WHERE u.id = auth.uid()
     AND u.is_active IS TRUE
$$;

CREATE OR REPLACE FUNCTION public.sa_actor_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.get_company_id(public.sa_actor_org_id())
$$;

CREATE OR REPLACE FUNCTION public.sa_actor_is_staff(p_max_role_level integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
      JOIN public.roles r ON r.role_code = u.role_code
     WHERE u.id = auth.uid()
       AND u.is_active IS TRUE
       AND r.role_level <= p_max_role_level
  )
$$;

-- Mirrors canManageHr (app/src/lib/server/hrAccess.ts) for the production
-- permission matrix: admin roles (role_level <= 20) or HR_MANAGER.
CREATE OR REPLACE FUNCTION public.sa_actor_is_hr_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
      LEFT JOIN public.roles r ON r.role_code = u.role_code
     WHERE u.id = auth.uid()
       AND u.is_active IS TRUE
       AND (r.role_level <= 20 OR upper(coalesce(u.role_code, '')) = 'HR_MANAGER')
  )
$$;

REVOKE ALL ON FUNCTION public.sa_actor_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sa_actor_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sa_actor_is_staff(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sa_actor_is_hr_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sa_actor_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_actor_company_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_actor_is_staff(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_actor_is_hr_manager() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. Server-only tables (no API role access; service_role only)
-- ---------------------------------------------------------------------------

-- otp_challenges: OTP hashes/salts; only server routes (admin client) and legacy INVOKER fn_create_otp/fn_verify_otp (no callers)
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.otp_challenges FROM anon, authenticated;
GRANT ALL ON TABLE public.otp_challenges TO service_role;

-- wms_movement_dedup: Internal WMS idempotency ledger
ALTER TABLE public.wms_movement_dedup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wms_movement_dedup FROM anon, authenticated;
GRANT ALL ON TABLE public.wms_movement_dedup TO service_role;

-- redemption_orders: Admin-client only
ALTER TABLE public.redemption_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redemption_orders FROM anon, authenticated;
GRANT ALL ON TABLE public.redemption_orders TO service_role;

-- redemption_order_limits: Admin-client only
ALTER TABLE public.redemption_order_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redemption_order_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.redemption_order_limits TO service_role;

-- shop_requests: Shop onboarding requests with requester PII; admin-client only
ALTER TABLE public.shop_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_requests FROM anon, authenticated;
GRANT ALL ON TABLE public.shop_requests TO service_role;

-- message_templates: WhatsApp recovery templates; admin-client only
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_templates FROM anon, authenticated;
GRANT ALL ON TABLE public.message_templates TO service_role;

-- roadtour_claim_notification_logs: Notification log; admin-client only
ALTER TABLE public.roadtour_claim_notification_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roadtour_claim_notification_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.roadtour_claim_notification_logs TO service_role;

-- shop_request_notification_logs: Notification log; admin-client only
ALTER TABLE public.shop_request_notification_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_request_notification_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.shop_request_notification_logs TO service_role;

-- redeem_gift_transactions: Consumer gift claims with PII; admin-client only
ALTER TABLE public.redeem_gift_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redeem_gift_transactions FROM anon, authenticated;
GRANT ALL ON TABLE public.redeem_gift_transactions TO service_role;

-- Environment-specific tables (present in production only).
DO $phase0b_server_only$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_backup_device_stock_config_20260813', '_backup_group_profile_fix_20260727',
    '_backup_phantom_items_20260813', '_backup_phantom_scope_20260813',
    '_backup_stock_config_fix_20260727',
    'return_no_counters' -- written by generate_return_no() default; return cases are created via the admin client
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Phase 0B: public.% not present, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END
$phase0b_server_only$;

-- ---------------------------------------------------------------------------
-- 3. HR tables: organization-wide read, HR-manager write
-- ---------------------------------------------------------------------------

-- hr_benefit_plans
ALTER TABLE public.hr_benefit_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_plans FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_plans TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_plans TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_benefit_plans;
CREATE POLICY sa_hr_org_read ON public.hr_benefit_plans FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_plans;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_plans FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_plans;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_plans FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_plans;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_plans FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_benefit_providers
ALTER TABLE public.hr_benefit_providers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_providers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_providers TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_providers TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_benefit_providers;
CREATE POLICY sa_hr_org_read ON public.hr_benefit_providers FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_providers;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_providers FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_providers;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_providers FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_providers;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_providers FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_courses
ALTER TABLE public.hr_courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_courses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_courses TO authenticated;
GRANT ALL ON TABLE public.hr_courses TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_courses;
CREATE POLICY sa_hr_org_read ON public.hr_courses FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_courses;
CREATE POLICY sa_hr_manager_insert ON public.hr_courses FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_courses;
CREATE POLICY sa_hr_manager_update ON public.hr_courses FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_courses;
CREATE POLICY sa_hr_manager_delete ON public.hr_courses FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_job_postings
ALTER TABLE public.hr_job_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_job_postings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_job_postings TO authenticated;
GRANT ALL ON TABLE public.hr_job_postings TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_job_postings;
CREATE POLICY sa_hr_org_read ON public.hr_job_postings FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_job_postings;
CREATE POLICY sa_hr_manager_insert ON public.hr_job_postings FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_job_postings;
CREATE POLICY sa_hr_manager_update ON public.hr_job_postings FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_job_postings;
CREATE POLICY sa_hr_manager_delete ON public.hr_job_postings FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_kpi_definitions
ALTER TABLE public.hr_kpi_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_kpi_definitions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_kpi_definitions TO authenticated;
GRANT ALL ON TABLE public.hr_kpi_definitions TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_kpi_definitions;
CREATE POLICY sa_hr_org_read ON public.hr_kpi_definitions FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_kpi_definitions;
CREATE POLICY sa_hr_manager_insert ON public.hr_kpi_definitions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_kpi_definitions;
CREATE POLICY sa_hr_manager_update ON public.hr_kpi_definitions FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_kpi_definitions;
CREATE POLICY sa_hr_manager_delete ON public.hr_kpi_definitions FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_kpi_snapshots
ALTER TABLE public.hr_kpi_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_kpi_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_kpi_snapshots TO authenticated;
GRANT ALL ON TABLE public.hr_kpi_snapshots TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_kpi_snapshots;
CREATE POLICY sa_hr_org_read ON public.hr_kpi_snapshots FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_kpi_snapshots;
CREATE POLICY sa_hr_manager_insert ON public.hr_kpi_snapshots FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_kpi_snapshots;
CREATE POLICY sa_hr_manager_update ON public.hr_kpi_snapshots FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_kpi_snapshots;
CREATE POLICY sa_hr_manager_delete ON public.hr_kpi_snapshots FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_onboarding_templates
ALTER TABLE public.hr_onboarding_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_onboarding_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_onboarding_templates TO authenticated;
GRANT ALL ON TABLE public.hr_onboarding_templates TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_onboarding_templates;
CREATE POLICY sa_hr_org_read ON public.hr_onboarding_templates FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_onboarding_templates;
CREATE POLICY sa_hr_manager_insert ON public.hr_onboarding_templates FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_onboarding_templates;
CREATE POLICY sa_hr_manager_update ON public.hr_onboarding_templates FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_onboarding_templates;
CREATE POLICY sa_hr_manager_delete ON public.hr_onboarding_templates FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_onboarding_template_tasks
ALTER TABLE public.hr_onboarding_template_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_onboarding_template_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_onboarding_template_tasks TO authenticated;
GRANT ALL ON TABLE public.hr_onboarding_template_tasks TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_onboarding_template_tasks;
CREATE POLICY sa_hr_org_read ON public.hr_onboarding_template_tasks FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_onboarding_template_tasks;
CREATE POLICY sa_hr_manager_insert ON public.hr_onboarding_template_tasks FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_onboarding_template_tasks;
CREATE POLICY sa_hr_manager_update ON public.hr_onboarding_template_tasks FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_onboarding_template_tasks;
CREATE POLICY sa_hr_manager_delete ON public.hr_onboarding_template_tasks FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_policies
ALTER TABLE public.hr_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_policies FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_policies TO authenticated;
GRANT ALL ON TABLE public.hr_policies TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_policies;
CREATE POLICY sa_hr_org_read ON public.hr_policies FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_policies;
CREATE POLICY sa_hr_manager_insert ON public.hr_policies FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_policies;
CREATE POLICY sa_hr_manager_update ON public.hr_policies FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_policies;
CREATE POLICY sa_hr_manager_delete ON public.hr_policies FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_skill_matrix
ALTER TABLE public.hr_skill_matrix ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_skill_matrix FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_skill_matrix TO authenticated;
GRANT ALL ON TABLE public.hr_skill_matrix TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_skill_matrix;
CREATE POLICY sa_hr_org_read ON public.hr_skill_matrix FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_skill_matrix;
CREATE POLICY sa_hr_manager_insert ON public.hr_skill_matrix FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_skill_matrix;
CREATE POLICY sa_hr_manager_update ON public.hr_skill_matrix FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_skill_matrix;
CREATE POLICY sa_hr_manager_delete ON public.hr_skill_matrix FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_reports
ALTER TABLE public.hr_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_reports TO authenticated;
GRANT ALL ON TABLE public.hr_reports TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_reports;
CREATE POLICY sa_hr_org_read ON public.hr_reports FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_reports;
CREATE POLICY sa_hr_manager_insert ON public.hr_reports FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_reports;
CREATE POLICY sa_hr_manager_update ON public.hr_reports FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_reports;
CREATE POLICY sa_hr_manager_delete ON public.hr_reports FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_payroll_runs
ALTER TABLE public.hr_payroll_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_payroll_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_payroll_runs TO authenticated;
GRANT ALL ON TABLE public.hr_payroll_runs TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_payroll_runs;
CREATE POLICY sa_hr_org_read ON public.hr_payroll_runs FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_payroll_runs;
CREATE POLICY sa_hr_manager_insert ON public.hr_payroll_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_payroll_runs;
CREATE POLICY sa_hr_manager_update ON public.hr_payroll_runs FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_payroll_runs;
CREATE POLICY sa_hr_manager_delete ON public.hr_payroll_runs FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_benefit_contribution_runs
ALTER TABLE public.hr_benefit_contribution_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_contribution_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_contribution_runs TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_contribution_runs TO service_role;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_benefit_contribution_runs;
CREATE POLICY sa_hr_org_read ON public.hr_benefit_contribution_runs FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_contribution_runs;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_contribution_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_contribution_runs;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_contribution_runs FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_contribution_runs;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_contribution_runs FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- ---------------------------------------------------------------------------
-- 4. HR tables: HR managers only (recruitment PII, offers, dependants)
-- ---------------------------------------------------------------------------

-- hr_applicants
ALTER TABLE public.hr_applicants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_applicants FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_applicants TO authenticated;
GRANT ALL ON TABLE public.hr_applicants TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_applicants;
CREATE POLICY sa_hr_read ON public.hr_applicants FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_applicants;
CREATE POLICY sa_hr_manager_insert ON public.hr_applicants FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_applicants;
CREATE POLICY sa_hr_manager_update ON public.hr_applicants FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_applicants;
CREATE POLICY sa_hr_manager_delete ON public.hr_applicants FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_applications
ALTER TABLE public.hr_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_applications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_applications TO authenticated;
GRANT ALL ON TABLE public.hr_applications TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_applications;
CREATE POLICY sa_hr_read ON public.hr_applications FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_applications;
CREATE POLICY sa_hr_manager_insert ON public.hr_applications FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_applications;
CREATE POLICY sa_hr_manager_update ON public.hr_applications FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_applications;
CREATE POLICY sa_hr_manager_delete ON public.hr_applications FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_offers
ALTER TABLE public.hr_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_offers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_offers TO authenticated;
GRANT ALL ON TABLE public.hr_offers TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_offers;
CREATE POLICY sa_hr_read ON public.hr_offers FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_offers;
CREATE POLICY sa_hr_manager_insert ON public.hr_offers FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_offers;
CREATE POLICY sa_hr_manager_update ON public.hr_offers FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_offers;
CREATE POLICY sa_hr_manager_delete ON public.hr_offers FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_interviews
ALTER TABLE public.hr_interviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_interviews FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_interviews TO authenticated;
GRANT ALL ON TABLE public.hr_interviews TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_interviews;
CREATE POLICY sa_hr_read ON public.hr_interviews FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR interviewer_user_id = auth.uid()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_interviews;
CREATE POLICY sa_hr_manager_insert ON public.hr_interviews FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_interviews;
CREATE POLICY sa_hr_manager_update ON public.hr_interviews FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_interviews;
CREATE POLICY sa_hr_manager_delete ON public.hr_interviews FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_benefit_dependents
ALTER TABLE public.hr_benefit_dependents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_dependents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_dependents TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_dependents TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_benefit_dependents;
CREATE POLICY sa_hr_read ON public.hr_benefit_dependents FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR EXISTS (SELECT 1 FROM public.hr_benefit_enrollments e WHERE e.id = hr_benefit_dependents.enrollment_id AND e.employee_user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_dependents;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_dependents FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_dependents;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_dependents FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_dependents;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_dependents FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_benefit_contribution_items
ALTER TABLE public.hr_benefit_contribution_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_contribution_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_contribution_items TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_contribution_items TO service_role;
DROP POLICY IF EXISTS sa_hr_read ON public.hr_benefit_contribution_items;
CREATE POLICY sa_hr_read ON public.hr_benefit_contribution_items FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR employee_user_id = auth.uid()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_contribution_items;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_contribution_items FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_contribution_items;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_contribution_items FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_contribution_items;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_contribution_items FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- ---------------------------------------------------------------------------
-- 5. Employee-owned HR records: the employee and HR managers only
-- ---------------------------------------------------------------------------

-- hr_payroll_run_items
ALTER TABLE public.hr_payroll_run_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_payroll_run_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_payroll_run_items TO authenticated;
GRANT ALL ON TABLE public.hr_payroll_run_items TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_payroll_run_items;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_payroll_run_items FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_payroll_run_items;
CREATE POLICY sa_hr_manager_insert ON public.hr_payroll_run_items FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_payroll_run_items;
CREATE POLICY sa_hr_manager_update ON public.hr_payroll_run_items FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_payroll_run_items;
CREATE POLICY sa_hr_manager_delete ON public.hr_payroll_run_items FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_benefit_enrollments
ALTER TABLE public.hr_benefit_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_benefit_enrollments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_benefit_enrollments TO authenticated;
GRANT ALL ON TABLE public.hr_benefit_enrollments TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_benefit_enrollments;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_benefit_enrollments FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_benefit_enrollments;
CREATE POLICY sa_hr_manager_insert ON public.hr_benefit_enrollments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_benefit_enrollments;
CREATE POLICY sa_hr_manager_update ON public.hr_benefit_enrollments FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_benefit_enrollments;
CREATE POLICY sa_hr_manager_delete ON public.hr_benefit_enrollments FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_contracts
ALTER TABLE public.hr_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_contracts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_contracts TO authenticated;
GRANT ALL ON TABLE public.hr_contracts TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_contracts;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_contracts FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_contracts;
CREATE POLICY sa_hr_manager_insert ON public.hr_contracts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_contracts;
CREATE POLICY sa_hr_manager_update ON public.hr_contracts FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_contracts;
CREATE POLICY sa_hr_manager_delete ON public.hr_contracts FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_certifications
ALTER TABLE public.hr_certifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_certifications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_certifications TO authenticated;
GRANT ALL ON TABLE public.hr_certifications TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_certifications;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_certifications FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_certifications;
CREATE POLICY sa_hr_manager_insert ON public.hr_certifications FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_certifications;
CREATE POLICY sa_hr_manager_update ON public.hr_certifications FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_certifications;
CREATE POLICY sa_hr_manager_delete ON public.hr_certifications FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_skill_assessments
ALTER TABLE public.hr_skill_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_skill_assessments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_skill_assessments TO authenticated;
GRANT ALL ON TABLE public.hr_skill_assessments TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_skill_assessments;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_skill_assessments FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_skill_assessments;
CREATE POLICY sa_hr_manager_insert ON public.hr_skill_assessments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_skill_assessments;
CREATE POLICY sa_hr_manager_update ON public.hr_skill_assessments FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_skill_assessments;
CREATE POLICY sa_hr_manager_delete ON public.hr_skill_assessments FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_onboarding_instances
ALTER TABLE public.hr_onboarding_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_onboarding_instances FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_onboarding_instances TO authenticated;
GRANT ALL ON TABLE public.hr_onboarding_instances TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_onboarding_instances;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_onboarding_instances FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_onboarding_instances;
CREATE POLICY sa_hr_manager_insert ON public.hr_onboarding_instances FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_onboarding_instances;
CREATE POLICY sa_hr_manager_update ON public.hr_onboarding_instances FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_onboarding_instances;
CREATE POLICY sa_hr_manager_delete ON public.hr_onboarding_instances FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_payslip_access_logs (employee self-service: insert)
ALTER TABLE public.hr_payslip_access_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_payslip_access_logs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_payslip_access_logs TO authenticated;
GRANT ALL ON TABLE public.hr_payslip_access_logs TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_payslip_access_logs;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_payslip_access_logs FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_payslip_access_logs;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_payslip_access_logs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_payslip_access_logs;
CREATE POLICY sa_hr_manager_update ON public.hr_payslip_access_logs FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_payslip_access_logs;
CREATE POLICY sa_hr_manager_delete ON public.hr_payslip_access_logs FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_course_enrollments (employee self-service: insert)
ALTER TABLE public.hr_course_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_course_enrollments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_course_enrollments TO authenticated;
GRANT ALL ON TABLE public.hr_course_enrollments TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_course_enrollments;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_course_enrollments FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_course_enrollments;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_course_enrollments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_course_enrollments;
CREATE POLICY sa_hr_manager_update ON public.hr_course_enrollments FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_course_enrollments;
CREATE POLICY sa_hr_manager_delete ON public.hr_course_enrollments FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_document_requests (employee self-service: insert)
ALTER TABLE public.hr_document_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_document_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_document_requests TO authenticated;
GRANT ALL ON TABLE public.hr_document_requests TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_document_requests;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_document_requests FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_document_requests;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_document_requests FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_document_requests;
CREATE POLICY sa_hr_manager_update ON public.hr_document_requests FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_document_requests;
CREATE POLICY sa_hr_manager_delete ON public.hr_document_requests FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_expense_claims (employee self-service: insert)
ALTER TABLE public.hr_expense_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_expense_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_expense_claims TO authenticated;
GRANT ALL ON TABLE public.hr_expense_claims TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_expense_claims;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_expense_claims FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_expense_claims;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_expense_claims FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_expense_claims;
CREATE POLICY sa_hr_manager_update ON public.hr_expense_claims FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_expense_claims;
CREATE POLICY sa_hr_manager_delete ON public.hr_expense_claims FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_onboarding_documents (employee self-service: insert)
ALTER TABLE public.hr_onboarding_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_onboarding_documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_onboarding_documents TO authenticated;
GRANT ALL ON TABLE public.hr_onboarding_documents TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_onboarding_documents;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_onboarding_documents FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_onboarding_documents;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_onboarding_documents FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_onboarding_documents;
CREATE POLICY sa_hr_manager_update ON public.hr_onboarding_documents FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_onboarding_documents;
CREATE POLICY sa_hr_manager_delete ON public.hr_onboarding_documents FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_policy_acknowledgements (employee self-service: insert)
ALTER TABLE public.hr_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_policy_acknowledgements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_policy_acknowledgements TO authenticated;
GRANT ALL ON TABLE public.hr_policy_acknowledgements TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_policy_acknowledgements;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_policy_acknowledgements FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_policy_acknowledgements;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_policy_acknowledgements FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_policy_acknowledgements;
CREATE POLICY sa_hr_manager_update ON public.hr_policy_acknowledgements FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_policy_acknowledgements;
CREATE POLICY sa_hr_manager_delete ON public.hr_policy_acknowledgements FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_profile_change_requests (employee self-service: insert)
ALTER TABLE public.hr_profile_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_profile_change_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_profile_change_requests TO authenticated;
GRANT ALL ON TABLE public.hr_profile_change_requests TO service_role;
DROP POLICY IF EXISTS sa_hr_self_or_manager_read ON public.hr_profile_change_requests;
CREATE POLICY sa_hr_self_or_manager_read ON public.hr_profile_change_requests FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_self_or_manager_insert ON public.hr_profile_change_requests;
CREATE POLICY sa_hr_self_or_manager_insert ON public.hr_profile_change_requests FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (employee_user_id = auth.uid() OR public.sa_actor_is_hr_manager()));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_profile_change_requests;
CREATE POLICY sa_hr_manager_update ON public.hr_profile_change_requests FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_profile_change_requests;
CREATE POLICY sa_hr_manager_delete ON public.hr_profile_change_requests FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- ---------------------------------------------------------------------------
-- 6. HR child rows scoped through their parent record
-- ---------------------------------------------------------------------------

-- hr_expense_items
ALTER TABLE public.hr_expense_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_expense_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_expense_items TO authenticated;
GRANT ALL ON TABLE public.hr_expense_items TO service_role;
DROP POLICY IF EXISTS sa_hr_owner_or_manager_read ON public.hr_expense_items;
CREATE POLICY sa_hr_owner_or_manager_read ON public.hr_expense_items FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR EXISTS (SELECT 1 FROM public.hr_expense_claims c WHERE c.id = hr_expense_items.claim_id AND c.employee_user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_owner_or_manager_insert ON public.hr_expense_items;
CREATE POLICY sa_hr_owner_or_manager_insert ON public.hr_expense_items FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR EXISTS (SELECT 1 FROM public.hr_expense_claims c WHERE c.id = hr_expense_items.claim_id AND c.employee_user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_expense_items;
CREATE POLICY sa_hr_manager_update ON public.hr_expense_items FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_expense_items;
CREATE POLICY sa_hr_manager_delete ON public.hr_expense_items FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_timesheet_entries
ALTER TABLE public.hr_timesheet_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_timesheet_entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_timesheet_entries TO authenticated;
GRANT ALL ON TABLE public.hr_timesheet_entries TO service_role;
DROP POLICY IF EXISTS sa_hr_owner_or_manager_read ON public.hr_timesheet_entries;
CREATE POLICY sa_hr_owner_or_manager_read ON public.hr_timesheet_entries FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR EXISTS (SELECT 1 FROM public.hr_timesheets ts WHERE ts.id = hr_timesheet_entries.timesheet_id AND ts.user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_owner_or_manager_insert ON public.hr_timesheet_entries;
CREATE POLICY sa_hr_owner_or_manager_insert ON public.hr_timesheet_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR EXISTS (SELECT 1 FROM public.hr_timesheets ts WHERE ts.id = hr_timesheet_entries.timesheet_id AND ts.user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_timesheet_entries;
CREATE POLICY sa_hr_manager_update ON public.hr_timesheet_entries FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_timesheet_entries;
CREATE POLICY sa_hr_manager_delete ON public.hr_timesheet_entries FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_onboarding_instance_tasks
ALTER TABLE public.hr_onboarding_instance_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_onboarding_instance_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_onboarding_instance_tasks TO authenticated;
GRANT ALL ON TABLE public.hr_onboarding_instance_tasks TO service_role;
DROP POLICY IF EXISTS sa_hr_owner_or_manager_read ON public.hr_onboarding_instance_tasks;
CREATE POLICY sa_hr_owner_or_manager_read ON public.hr_onboarding_instance_tasks FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND (public.sa_actor_is_hr_manager() OR owner_user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.hr_onboarding_instances i WHERE i.id = hr_onboarding_instance_tasks.instance_id AND i.employee_user_id = auth.uid())));
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_onboarding_instance_tasks;
CREATE POLICY sa_hr_manager_insert ON public.hr_onboarding_instance_tasks FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_onboarding_instance_tasks;
CREATE POLICY sa_hr_manager_update ON public.hr_onboarding_instance_tasks FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_delete ON public.hr_onboarding_instance_tasks;
CREATE POLICY sa_hr_manager_delete ON public.hr_onboarding_instance_tasks FOR DELETE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- hr_overtime_presets: global presets (no organization column)
ALTER TABLE public.hr_overtime_presets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hr_overtime_presets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_overtime_presets TO authenticated;
GRANT ALL ON TABLE public.hr_overtime_presets TO service_role;
DROP POLICY IF EXISTS sa_staff_read ON public.hr_overtime_presets;
CREATE POLICY sa_staff_read ON public.hr_overtime_presets FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40));
DROP POLICY IF EXISTS sa_hr_manager_write ON public.hr_overtime_presets;
CREATE POLICY sa_hr_manager_write ON public.hr_overtime_presets FOR ALL TO authenticated
  USING (public.sa_actor_is_hr_manager())
  WITH CHECK (public.sa_actor_is_hr_manager());

-- hr_gl_mappings / hr_gl_postings: previously USING/WITH CHECK (true) for any authenticated user
DROP POLICY IF EXISTS hr_gl_mappings_insert ON public.hr_gl_mappings;
DROP POLICY IF EXISTS hr_gl_mappings_select ON public.hr_gl_mappings;
DROP POLICY IF EXISTS hr_gl_mappings_update ON public.hr_gl_mappings;
REVOKE ALL ON TABLE public.hr_gl_mappings FROM anon;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_gl_mappings;
CREATE POLICY sa_hr_org_read ON public.hr_gl_mappings FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_gl_mappings;
CREATE POLICY sa_hr_manager_insert ON public.hr_gl_mappings FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_gl_mappings;
CREATE POLICY sa_hr_manager_update ON public.hr_gl_mappings FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS hr_gl_postings_insert ON public.hr_gl_postings;
DROP POLICY IF EXISTS hr_gl_postings_select ON public.hr_gl_postings;
DROP POLICY IF EXISTS hr_gl_postings_update ON public.hr_gl_postings;
REVOKE ALL ON TABLE public.hr_gl_postings FROM anon;
DROP POLICY IF EXISTS sa_hr_org_read ON public.hr_gl_postings;
CREATE POLICY sa_hr_org_read ON public.hr_gl_postings FOR SELECT TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_insert ON public.hr_gl_postings;
CREATE POLICY sa_hr_manager_insert ON public.hr_gl_postings FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());
DROP POLICY IF EXISTS sa_hr_manager_update ON public.hr_gl_postings;
CREATE POLICY sa_hr_manager_update ON public.hr_gl_postings FOR UPDATE TO authenticated
  USING (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager())
  WITH CHECK (organization_id = public.sa_actor_org_id() AND public.sa_actor_is_hr_manager());

-- ---------------------------------------------------------------------------
-- 7. HR tautology fix: bind the actor organization to the target row
-- ---------------------------------------------------------------------------
-- Each policy keeps its name, roles and command; only the always-true
-- comparison u.organization_id = u.organization_id is replaced.
ALTER POLICY departments_insert_admin_only ON public.departments
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((r.role_code = u.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND ((u.organization_id = departments.organization_id) OR (r.role_level = 1))))));
ALTER POLICY departments_update_admin_only ON public.departments
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((r.role_code = u.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND ((u.organization_id = departments.organization_id) OR (r.role_level = 1))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((r.role_code = u.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND ((u.organization_id = departments.organization_id) OR (r.role_level = 1))))));
ALTER POLICY hr_allowance_types_delete ON public.hr_allowance_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_allowance_types.organization_id)))));
ALTER POLICY hr_allowance_types_insert ON public.hr_allowance_types
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_allowance_types.organization_id)))));
ALTER POLICY hr_allowance_types_update ON public.hr_allowance_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_allowance_types.organization_id)))));
ALTER POLICY hr_approval_chain_steps_delete ON public.hr_approval_chain_steps
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_approval_chain_steps.organization_id)))));
ALTER POLICY hr_approval_chain_steps_insert ON public.hr_approval_chain_steps
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_approval_chain_steps.organization_id)))));
ALTER POLICY hr_approval_chain_steps_update ON public.hr_approval_chain_steps
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_approval_chain_steps.organization_id)))));
ALTER POLICY hr_approval_chains_delete ON public.hr_approval_chains
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_approval_chains.organization_id)))));
ALTER POLICY hr_approval_chains_insert ON public.hr_approval_chains
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_approval_chains.organization_id)))));
ALTER POLICY hr_approval_chains_update ON public.hr_approval_chains
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_approval_chains.organization_id)))));
ALTER POLICY hr_attendance_corrections_delete ON public.hr_attendance_corrections
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_attendance_corrections.organization_id)))));
ALTER POLICY hr_attendance_corrections_insert ON public.hr_attendance_corrections
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_attendance_corrections.organization_id)))));
ALTER POLICY hr_attendance_corrections_update ON public.hr_attendance_corrections
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_attendance_corrections.organization_id) AND ((u.id = hr_attendance_corrections.requested_by) OR (r.role_level <= 20))))));
ALTER POLICY hr_deduction_types_delete ON public.hr_deduction_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_deduction_types.organization_id)))));
ALTER POLICY hr_deduction_types_insert ON public.hr_deduction_types
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_deduction_types.organization_id)))));
ALTER POLICY hr_deduction_types_update ON public.hr_deduction_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_deduction_types.organization_id)))));
ALTER POLICY hr_delegation_rules_delete ON public.hr_delegation_rules
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_delegation_rules.organization_id)))));
ALTER POLICY hr_delegation_rules_insert ON public.hr_delegation_rules
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_delegation_rules.organization_id)))));
ALTER POLICY hr_delegation_rules_update ON public.hr_delegation_rules
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_delegation_rules.organization_id)))));
ALTER POLICY hr_employee_allowances_delete ON public.hr_employee_allowances
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_employee_allowances.organization_id)))));
ALTER POLICY hr_employee_allowances_insert ON public.hr_employee_allowances
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_allowances.organization_id)))));
ALTER POLICY hr_employee_allowances_select ON public.hr_employee_allowances
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_employee_allowances.organization_id) AND ((u.id = hr_employee_allowances.employee_id) OR (r.role_level <= 20))))));
ALTER POLICY hr_employee_allowances_update ON public.hr_employee_allowances
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_allowances.organization_id)))));
ALTER POLICY hr_employee_compensation_delete ON public.hr_employee_compensation
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_employee_compensation.organization_id)))));
ALTER POLICY hr_employee_compensation_insert ON public.hr_employee_compensation
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_compensation.organization_id)))));
ALTER POLICY hr_employee_compensation_select ON public.hr_employee_compensation
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_employee_compensation.organization_id) AND ((u.id = hr_employee_compensation.employee_id) OR (r.role_level <= 20))))));
ALTER POLICY hr_employee_compensation_update ON public.hr_employee_compensation
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_compensation.organization_id)))));
ALTER POLICY hr_employee_deductions_delete ON public.hr_employee_deductions
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_employee_deductions.organization_id)))));
ALTER POLICY hr_employee_deductions_insert ON public.hr_employee_deductions
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_deductions.organization_id)))));
ALTER POLICY hr_employee_deductions_select ON public.hr_employee_deductions
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_employee_deductions.organization_id) AND ((u.id = hr_employee_deductions.employee_id) OR (r.role_level <= 20))))));
ALTER POLICY hr_employee_deductions_update ON public.hr_employee_deductions
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_employee_deductions.organization_id)))));
ALTER POLICY hr_leave_approvals_delete ON public.hr_leave_approvals
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_leave_approvals.organization_id)))));
ALTER POLICY hr_leave_approvals_insert ON public.hr_leave_approvals
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_leave_approvals.organization_id)))));
ALTER POLICY hr_leave_approvals_update ON public.hr_leave_approvals
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_leave_approvals.organization_id) AND ((u.id = hr_leave_approvals.approver_id) OR (r.role_level <= 20))))));
ALTER POLICY hr_leave_balances_delete ON public.hr_leave_balances
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_leave_balances.organization_id)))));
ALTER POLICY hr_leave_balances_insert ON public.hr_leave_balances
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_leave_balances.organization_id)))));
ALTER POLICY hr_leave_balances_update ON public.hr_leave_balances
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_leave_balances.organization_id)))));
ALTER POLICY hr_leave_requests_delete ON public.hr_leave_requests
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_leave_requests.organization_id)))));
ALTER POLICY hr_leave_requests_insert ON public.hr_leave_requests
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_leave_requests.organization_id)))));
ALTER POLICY hr_leave_requests_update ON public.hr_leave_requests
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (u.organization_id = hr_leave_requests.organization_id) AND ((u.id = hr_leave_requests.employee_id) OR (r.role_level <= 20))))));
ALTER POLICY hr_leave_types_delete ON public.hr_leave_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_leave_types.organization_id)))));
ALTER POLICY hr_leave_types_insert ON public.hr_leave_types
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_leave_types.organization_id)))));
ALTER POLICY hr_leave_types_update ON public.hr_leave_types
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_leave_types.organization_id)))));
ALTER POLICY hr_payroll_audit_insert ON public.hr_payroll_audit
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_payroll_audit.organization_id)))));
ALTER POLICY hr_public_holidays_delete ON public.hr_public_holidays
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_public_holidays.organization_id)))));
ALTER POLICY hr_public_holidays_insert ON public.hr_public_holidays
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_public_holidays.organization_id)))));
ALTER POLICY hr_public_holidays_update ON public.hr_public_holidays
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_public_holidays.organization_id)))));
ALTER POLICY hr_salary_bands_delete ON public.hr_salary_bands
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 10) AND (u.organization_id = hr_salary_bands.organization_id)))));
ALTER POLICY hr_salary_bands_insert ON public.hr_salary_bands
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_salary_bands.organization_id)))));
ALTER POLICY hr_salary_bands_update ON public.hr_salary_bands
  USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (u.organization_id = hr_salary_bands.organization_id)))));

-- ---------------------------------------------------------------------------
-- 8. Business tables used by staff dashboards and shop/consumer flows
-- ---------------------------------------------------------------------------

-- msia_banks: public reference list (anonymous loyalty journey reads it)
ALTER TABLE public.msia_banks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.msia_banks FROM anon, authenticated;
GRANT SELECT ON TABLE public.msia_banks TO authenticated;
GRANT SELECT ON TABLE public.msia_banks TO anon;
GRANT ALL ON TABLE public.msia_banks TO service_role;
DROP POLICY IF EXISTS sa_public_read ON public.msia_banks;
CREATE POLICY sa_public_read ON public.msia_banks FOR SELECT TO anon, authenticated
  USING (true);

-- payment_terms: reference data read by organization forms
ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_terms FROM anon, authenticated;
GRANT SELECT ON TABLE public.payment_terms TO authenticated;
GRANT ALL ON TABLE public.payment_terms TO service_role;
DROP POLICY IF EXISTS sa_authenticated_read ON public.payment_terms;
CREATE POLICY sa_authenticated_read ON public.payment_terms FOR SELECT TO authenticated
  USING (true);

-- points_rules: read by staff and shop catalog; written by company admins
ALTER TABLE public.points_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.points_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.points_rules TO authenticated;
GRANT ALL ON TABLE public.points_rules TO service_role;
DROP POLICY IF EXISTS sa_company_read ON public.points_rules;
CREATE POLICY sa_company_read ON public.points_rules FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_admin_write ON public.points_rules;
CREATE POLICY sa_admin_write ON public.points_rules FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id());

-- redemption_policies: read by company members, written by company admins
ALTER TABLE public.redemption_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redemption_policies FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.redemption_policies TO authenticated;
GRANT ALL ON TABLE public.redemption_policies TO service_role;
DROP POLICY IF EXISTS sa_company_read ON public.redemption_policies;
CREATE POLICY sa_company_read ON public.redemption_policies FOR SELECT TO authenticated
  USING (public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_admin_write ON public.redemption_policies;
CREATE POLICY sa_admin_write ON public.redemption_policies FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id());

-- org_notification_settings: read by company members, written by company admins
ALTER TABLE public.org_notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_notification_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_notification_settings TO authenticated;
GRANT ALL ON TABLE public.org_notification_settings TO service_role;
DROP POLICY IF EXISTS sa_company_read ON public.org_notification_settings;
CREATE POLICY sa_company_read ON public.org_notification_settings FOR SELECT TO authenticated
  USING (public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_admin_write ON public.org_notification_settings;
CREATE POLICY sa_admin_write ON public.org_notification_settings FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(20) AND public.get_company_id(org_id) = public.sa_actor_company_id());

-- marketing_segments: company marketing staff
ALTER TABLE public.marketing_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_segments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketing_segments TO authenticated;
GRANT ALL ON TABLE public.marketing_segments TO service_role;
DROP POLICY IF EXISTS sa_company_staff_all ON public.marketing_segments;
CREATE POLICY sa_company_staff_all ON public.marketing_segments FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id());

-- notifications_outbox: staff of the owning company (server workers use service_role)
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications_outbox TO authenticated;
GRANT ALL ON TABLE public.notifications_outbox TO service_role;
DROP POLICY IF EXISTS sa_company_staff_read ON public.notifications_outbox;
CREATE POLICY sa_company_staff_read ON public.notifications_outbox FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_insert ON public.notifications_outbox;
CREATE POLICY sa_company_staff_insert ON public.notifications_outbox FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_update ON public.notifications_outbox;
CREATE POLICY sa_company_staff_update ON public.notifications_outbox FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id());

-- consumer_activations: company staff (consumer PII)
ALTER TABLE public.consumer_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consumer_activations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.consumer_activations TO authenticated;
GRANT ALL ON TABLE public.consumer_activations TO service_role;
DROP POLICY IF EXISTS sa_company_staff_read ON public.consumer_activations;
CREATE POLICY sa_company_staff_read ON public.consumer_activations FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_insert ON public.consumer_activations;
CREATE POLICY sa_company_staff_insert ON public.consumer_activations FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_update ON public.consumer_activations;
CREATE POLICY sa_company_staff_update ON public.consumer_activations FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_delete ON public.consumer_activations;
CREATE POLICY sa_company_admin_delete ON public.consumer_activations FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(20) AND company_id = public.sa_actor_company_id());

-- lucky_draw_campaigns: company staff (consumer PII)
ALTER TABLE public.lucky_draw_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lucky_draw_campaigns FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lucky_draw_campaigns TO authenticated;
GRANT ALL ON TABLE public.lucky_draw_campaigns TO service_role;
DROP POLICY IF EXISTS sa_company_staff_read ON public.lucky_draw_campaigns;
CREATE POLICY sa_company_staff_read ON public.lucky_draw_campaigns FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_insert ON public.lucky_draw_campaigns;
CREATE POLICY sa_company_staff_insert ON public.lucky_draw_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_update ON public.lucky_draw_campaigns;
CREATE POLICY sa_company_staff_update ON public.lucky_draw_campaigns FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_delete ON public.lucky_draw_campaigns;
CREATE POLICY sa_company_admin_delete ON public.lucky_draw_campaigns FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(20) AND company_id = public.sa_actor_company_id());

-- lucky_draw_entries: company staff (consumer PII)
ALTER TABLE public.lucky_draw_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lucky_draw_entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lucky_draw_entries TO authenticated;
GRANT ALL ON TABLE public.lucky_draw_entries TO service_role;
DROP POLICY IF EXISTS sa_company_staff_read ON public.lucky_draw_entries;
CREATE POLICY sa_company_staff_read ON public.lucky_draw_entries FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_insert ON public.lucky_draw_entries;
CREATE POLICY sa_company_staff_insert ON public.lucky_draw_entries FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_staff_update ON public.lucky_draw_entries;
CREATE POLICY sa_company_staff_update ON public.lucky_draw_entries FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_delete ON public.lucky_draw_entries;
CREATE POLICY sa_company_admin_delete ON public.lucky_draw_entries FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(20) AND company_id = public.sa_actor_company_id());

-- lucky_draw_order_links: through the campaign's company
ALTER TABLE public.lucky_draw_order_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lucky_draw_order_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lucky_draw_order_links TO authenticated;
GRANT ALL ON TABLE public.lucky_draw_order_links TO service_role;
DROP POLICY IF EXISTS sa_company_staff_all ON public.lucky_draw_order_links;
CREATE POLICY sa_company_staff_all ON public.lucky_draw_order_links FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND EXISTS (SELECT 1 FROM public.lucky_draw_campaigns c WHERE c.id = lucky_draw_order_links.campaign_id AND c.company_id = public.sa_actor_company_id()))
  WITH CHECK (public.sa_actor_is_staff(40) AND EXISTS (SELECT 1 FROM public.lucky_draw_campaigns c WHERE c.id = lucky_draw_order_links.campaign_id AND c.company_id = public.sa_actor_company_id()));

-- journey_configurations / journey_order_links
--   Staff of the owning company manage journeys (including warehouse users
--   whose shipments fire auto_activate_journeys_on_ship, an INVOKER trigger).
--   anon keeps a narrow read of ACTIVE journeys only, because middleware.ts
--   resolves the security-code requirement with the anon key; commit C
--   replaces that with a narrow RPC and removes these anon policies.
ALTER TABLE public.journey_configurations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.journey_configurations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.journey_configurations TO authenticated;
GRANT SELECT ON TABLE public.journey_configurations TO anon;
GRANT ALL ON TABLE public.journey_configurations TO service_role;
DROP POLICY IF EXISTS sa_company_staff_all ON public.journey_configurations;
CREATE POLICY sa_company_staff_all ON public.journey_configurations FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND public.get_company_id(org_id) = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_public_active_read ON public.journey_configurations;
CREATE POLICY sa_public_active_read ON public.journey_configurations FOR SELECT TO anon
  USING (is_active IS TRUE);
ALTER TABLE public.journey_order_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.journey_order_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.journey_order_links TO authenticated;
GRANT SELECT ON TABLE public.journey_order_links TO anon;
GRANT ALL ON TABLE public.journey_order_links TO service_role;
DROP POLICY IF EXISTS sa_company_staff_all ON public.journey_order_links;
CREATE POLICY sa_company_staff_all ON public.journey_order_links FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND EXISTS (SELECT 1 FROM public.journey_configurations j WHERE j.id = journey_order_links.journey_config_id AND public.get_company_id(j.org_id) = public.sa_actor_company_id()))
  WITH CHECK (public.sa_actor_is_staff(40) AND EXISTS (SELECT 1 FROM public.journey_configurations j WHERE j.id = journey_order_links.journey_config_id AND public.get_company_id(j.org_id) = public.sa_actor_company_id()));
DROP POLICY IF EXISTS sa_public_active_read ON public.journey_order_links;
CREATE POLICY sa_public_active_read ON public.journey_order_links FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.journey_configurations j WHERE j.id = journey_order_links.journey_config_id AND j.is_active IS TRUE));

-- redeem_items: company staff manage the catalog; shop accounts read it and may
-- only decrement stock_quantity when redeeming (enforced by trigger below).
ALTER TABLE public.redeem_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redeem_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.redeem_items TO authenticated;
GRANT ALL ON TABLE public.redeem_items TO service_role;
DROP POLICY IF EXISTS sa_company_read ON public.redeem_items;
CREATE POLICY sa_company_read ON public.redeem_items FOR SELECT TO authenticated
  USING (company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_insert ON public.redeem_items;
CREATE POLICY sa_company_admin_insert ON public.redeem_items FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_update ON public.redeem_items;
CREATE POLICY sa_company_update ON public.redeem_items FOR UPDATE TO authenticated
  USING (company_id = public.sa_actor_company_id())
  WITH CHECK (company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_delete ON public.redeem_items;
CREATE POLICY sa_company_admin_delete ON public.redeem_items FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());

CREATE OR REPLACE FUNCTION public.sa_redeem_items_restrict_non_staff_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.sa_actor_is_staff(40) THEN
    -- Shop/consumer accounts may only take one unit of stock when redeeming.
    IF (to_jsonb(NEW) - 'stock_quantity' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'stock_quantity' - 'updated_at')
       OR NEW.stock_quantity IS NULL OR OLD.stock_quantity IS NULL
       OR NEW.stock_quantity < OLD.stock_quantity - 1 OR NEW.stock_quantity > OLD.stock_quantity THEN
      RAISE EXCEPTION 'Only staff can modify reward catalog items' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_redeem_items_restrict_non_staff_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sa_redeem_items_restrict_non_staff_update ON public.redeem_items;
CREATE TRIGGER sa_redeem_items_restrict_non_staff_update
BEFORE UPDATE ON public.redeem_items
FOR EACH ROW EXECUTE FUNCTION public.sa_redeem_items_restrict_non_staff_update();

-- redeem_gifts: journey gift stock managed by staff (no company column; scoped via the order when set)
ALTER TABLE public.redeem_gifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redeem_gifts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.redeem_gifts TO authenticated;
GRANT ALL ON TABLE public.redeem_gifts TO service_role;
DROP POLICY IF EXISTS sa_company_staff_all ON public.redeem_gifts;
CREATE POLICY sa_company_staff_all ON public.redeem_gifts FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND (order_id IS NULL OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = redeem_gifts.order_id AND o.company_id = public.sa_actor_company_id())))
  WITH CHECK (public.sa_actor_is_staff(40) AND (order_id IS NULL OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = redeem_gifts.order_id AND o.company_id = public.sa_actor_company_id())));

-- points_transactions
--   Owners (consumer user / wallet owner / shop wallet org) read their rows.
--   Company staff read and adjust company rows.
--   Non-staff accounts may only INSERT a redemption debit for their own
--   company (ShopCatalogPage); they can never credit points.
ALTER TABLE public.points_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.points_transactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.points_transactions TO authenticated;
GRANT ALL ON TABLE public.points_transactions TO service_role;
DROP POLICY IF EXISTS sa_owner_or_company_staff_read ON public.points_transactions;
CREATE POLICY sa_owner_or_company_staff_read ON public.points_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR wallet_owner_user_id = auth.uid() OR (wallet_owner_org_id IS NOT NULL AND wallet_owner_org_id = public.sa_actor_org_id()) OR (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id()));
DROP POLICY IF EXISTS sa_company_staff_insert ON public.points_transactions;
CREATE POLICY sa_company_staff_insert ON public.points_transactions FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_member_redemption_debit_insert ON public.points_transactions;
CREATE POLICY sa_member_redemption_debit_insert ON public.points_transactions FOR INSERT TO authenticated
  WITH CHECK (company_id = public.sa_actor_company_id() AND transaction_type = 'redeem' AND points_amount < 0);
DROP POLICY IF EXISTS sa_company_staff_update ON public.points_transactions;
CREATE POLICY sa_company_staff_update ON public.points_transactions FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id())
  WITH CHECK (public.sa_actor_is_staff(40) AND company_id = public.sa_actor_company_id());
DROP POLICY IF EXISTS sa_company_admin_delete ON public.points_transactions;
CREATE POLICY sa_company_admin_delete ON public.points_transactions FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(20) AND company_id = public.sa_actor_company_id());

-- qr_validation_reports (warehouse shipment sessions) and qr_movements
--   Staff with access to the warehouse / distributor / movement organizations
--   (can_access_org covers HQ admins and the organization hierarchy).
ALTER TABLE public.qr_validation_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_validation_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qr_validation_reports TO authenticated;
GRANT ALL ON TABLE public.qr_validation_reports TO service_role;
DROP POLICY IF EXISTS sa_scoped_staff_all ON public.qr_validation_reports;
CREATE POLICY sa_scoped_staff_all ON public.qr_validation_reports FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(40) AND (public.can_access_org(warehouse_org_id) OR public.can_access_org(distributor_org_id)))
  WITH CHECK (public.sa_actor_is_staff(40) AND (public.can_access_org(warehouse_org_id) OR public.can_access_org(distributor_org_id)));
ALTER TABLE public.qr_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_movements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qr_movements TO authenticated;
GRANT ALL ON TABLE public.qr_movements TO service_role;
DROP POLICY IF EXISTS sa_scoped_staff_read ON public.qr_movements;
CREATE POLICY sa_scoped_staff_read ON public.qr_movements FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40) AND (public.can_access_org(from_org_id) OR public.can_access_org(to_org_id)));
DROP POLICY IF EXISTS sa_scoped_staff_insert ON public.qr_movements;
CREATE POLICY sa_scoped_staff_insert ON public.qr_movements FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40) AND (public.can_access_org(from_org_id) OR public.can_access_org(to_org_id)));
DROP POLICY IF EXISTS sa_scoped_staff_update ON public.qr_movements;
CREATE POLICY sa_scoped_staff_update ON public.qr_movements FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(40) AND (public.can_access_org(from_org_id) OR public.can_access_org(to_org_id)))
  WITH CHECK (public.sa_actor_is_staff(40) AND (public.can_access_org(from_org_id) OR public.can_access_org(to_org_id)));
DROP POLICY IF EXISTS sa_admin_delete ON public.qr_movements;
CREATE POLICY sa_admin_delete ON public.qr_movements FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(10));

-- qr_reverse_job_items: manufacturer of the job (mirrors qr_reverse_jobs policies) or HQ admin
ALTER TABLE public.qr_reverse_job_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_reverse_job_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qr_reverse_job_items TO authenticated;
GRANT ALL ON TABLE public.qr_reverse_job_items TO service_role;
DROP POLICY IF EXISTS sa_job_owner_all ON public.qr_reverse_job_items;
CREATE POLICY sa_job_owner_all ON public.qr_reverse_job_items FOR ALL TO authenticated
  USING ((public.is_hq_admin() OR EXISTS (SELECT 1 FROM public.qr_reverse_jobs j WHERE j.id = qr_reverse_job_items.job_id AND j.manufacturer_org_id = public.sa_actor_org_id())))
  WITH CHECK ((public.is_hq_admin() OR EXISTS (SELECT 1 FROM public.qr_reverse_jobs j WHERE j.id = qr_reverse_job_items.job_id AND j.manufacturer_org_id = public.sa_actor_org_id())));

-- ---------------------------------------------------------------------------
-- 9. Views: superuser-owned views bypass RLS, so restrict who can read them
-- ---------------------------------------------------------------------------
-- anon never reads a view (no anonymous code path uses one).
DO $phase0b_views_anon$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', v.rel);
  END LOOP;
END
$phase0b_views_anon$;
-- authenticated keeps views read by authenticated code paths and the
-- security_invoker views (already RLS-bound); every other superuser-owned
-- view becomes server-only.
DO $phase0b_views_auth$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('v', 'm')
       AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false)
       AND c.relname <> ALL (ARRAY['shop_points_ledger', 'v_canonical_stock_config', 'v_consumer_points_balance', 'v_gl_journal_lines', 'v_gl_journals', 'v_low_stock_alerts', 'v_pending_gl_postings', 'v_referral_monitor', 'v_shop_points_balance', 'v_stock_movements_display', 'vw_inventory_on_hand', 'vw_manual_stock_balance'])
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', v.rel);
    RAISE NOTICE 'Phase 0B: % is now server-only', v.rel;
  END LOOP;
END
$phase0b_views_auth$;
-- shop_points_ledger: kept for authenticated (ShopCatalogPage (shop accounts))
-- v_shop_points_balance: kept for authenticated (ShopCatalogPage / AdminCatalogPage)
-- v_consumer_points_balance: kept for authenticated (message-setup preview, WA marketing launch routes)
-- v_gl_journal_lines: kept for authenticated (accounting report routes)
-- v_gl_journals: kept for authenticated (accounting journal routes)
-- v_pending_gl_postings: kept for authenticated (accounting pending-postings route)
-- v_low_stock_alerts: kept for authenticated (supply-chain module assistant)
-- v_referral_monitor: kept for authenticated (ReferralMonitor / ReferralDetail)
-- v_stock_movements_display: kept for authenticated (movements + ship-metrics routes)
-- vw_inventory_on_hand: kept for authenticated (InventoryView)
-- vw_manual_stock_balance: kept for authenticated (WarehouseShipV2 / InventoryView)
-- v_canonical_stock_config: kept for authenticated (read by INVOKER resolve_operational_stock_config (stock configuration metadata))

-- ---------------------------------------------------------------------------
-- 10. Post-conditions
-- ---------------------------------------------------------------------------
DO $phase0b_b_assert$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
          OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'INSERT'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: API-accessible tables without RLS remain: %', v_bad;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual ~ 'u\.organization_id = u\.organization_id' OR with_check ~ 'u\.organization_id = u\.organization_id');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: tautological tenant policies remain: %', v_bad;
  END IF;

  SELECT string_agg(c.relname, ', ')
    INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND has_table_privilege('anon', c.oid, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: anon can still read views: %', v_bad;
  END IF;
END
$phase0b_b_assert$;
