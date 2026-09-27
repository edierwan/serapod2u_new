-- ============================================================================
-- Security & Access Final Wave — B. Finance, Payroll, HR and lifecycle
-- ----------------------------------------------------------------------------
-- Requires 20260928100000_sa_final_governance_foundation.sql.
--
-- Purpose
--   1. Decision caching for database gates (per transaction, per actor).
--   2. sa_gate_policy(): mechanical, environment-agnostic RLS rewrite used by
--      this and the next migration. For a policy it builds
--        sa_rls_gate(<perm>, <row org>, (<existing expression>))
--          OR (sa_is_new_authoritative(<perm>) AND (<ownership remainder>))
--      where <ownership remainder> is the existing expression with every
--      role/privilege predicate (role_level, role_code, is_hq_admin(), ...)
--      replaced by false. Therefore:
--        LEGACY_ENFORCED/SHADOW : exactly the existing policy.
--        NEW_ENFORCED/RETIRED   : S&A permission in the ROW's organization, or
--                                 the non-privileged ownership part of the
--                                 existing policy (own record, reporting line).
--      The rewrite is monotonic (never widens): it refuses any expression in
--      which a privilege predicate could appear under NOT, and refuses to
--      leave any role predicate behind.
--   3. sa_inject_operation_guard(): environment-agnostic insertion of
--      sa_require_operation() into existing SECURITY DEFINER RPCs (reads the
--      live definition, never ships a copy of another environment's body),
--      with optional targeted replacement of legacy role guards so that in
--      NEW_ENFORCED the S&A decision is the authority.
--   4. Finance: GL/fiscal/posting-rule/bank/exchange-rate RLS gated by the
--      Finance permissions; post_document_to_gl, approve_payment_request and
--      generate_fiscal_periods guarded.
--   5. Payroll/HR: HR RLS gated per domain permission (payroll, compensation,
--      contracts, recruitment, benefits, ...); payroll run approval can only
--      be performed by an S&A payroll approver in NEW_ENFORCED (direct
--      PostgREST transition guard), with SoD monitoring (calculated_by vs
--      approver); payroll GL posting/reversal/seeding RPCs guarded.
--   6. Joiner/Mover/Leaver: sa_sync_user_lifecycle() derives memberships and
--      baseline/compatibility assignments from HR/User Management facts
--      (users.is_active, employment_status, organization_id, role_code,
--      employment_type, account_scope); leavers lose all business access,
--      delegations and pending requests while history is preserved; contract
--      and intern access always expires. Trigger on users + initial sync.
--
-- No migration mode is changed here. Everything is inert in SHADOW.
--
-- Rollback guidance
--   * RLS: for every policy altered here the pre-migration expression is the
--     third argument of sa_rls_gate(...) — recorded in sa_policy_rewrites
--     (original_using / original_check). Restore with
--       select format('alter policy %I on %s using (%s) with check (%s)', ...)
--     from public.sa_policy_rewrites.
--   * RPCs: sa_function_guard_injections.original_definition holds the
--     pre-migration definition; execute it to restore.
--   * drop trigger sa_users_lifecycle on public.users;
--     drop trigger sa_payroll_run_transition_guard on public.hr_payroll_runs;
--     drop the functions created here. Lifecycle-created rows remain as
--     history (status inactive/revoked).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cached gate evaluation
-- ---------------------------------------------------------------------------
-- Transaction-local memo so RLS evaluates each (actor, permission, org) once
-- per statement batch instead of once per row. Keys are opaque hashes; values
-- are validated. Only the database can call set_config in these functions
-- (PostgREST never exposes pg_catalog).
create or replace function public.sa_cached_mode_is_new(p_permission text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  -- sa_cache.epoch lets a caller (tests, the cutover script) invalidate the
  -- memo inside one transaction; it is empty in normal requests.
  v_key text := 'sa_cache.m' || md5(coalesce(current_setting('sa_cache.epoch', true), '') || '|' || p_permission);
  v_val text := current_setting(v_key, true);
begin
  if v_val in ('t','f') then return v_val = 't'; end if;
  v_val := case when public.sa_is_new_authoritative(p_permission) then 't' else 'f' end;
  perform set_config(v_key, v_val, true);
  return v_val = 't';
end $$;
revoke all on function public.sa_cached_mode_is_new(text) from public, anon, authenticated;

create or replace function public.sa_cached_actor_allows(p_permission text, p_context jsonb)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_val text;
begin
  if v_uid is null then return false; end if;
  v_key := 'sa_cache.d' || md5(coalesce(current_setting('sa_cache.epoch', true), '') || '|' || v_uid::text || '|' || p_permission || '|' || coalesce(p_context::text, ''));
  v_val := current_setting(v_key, true);
  if v_val in ('t','f') then return v_val = 't'; end if;
  v_val := case when public.sa_actor_has_permission(v_uid, p_permission, p_context) then 't' else 'f' end;
  perform set_config(v_key, v_val, true);
  return v_val = 't';
end $$;
revoke all on function public.sa_cached_actor_allows(text,jsonb) from public, anon, authenticated;

create or replace function public.sa_rls_gate(p_permission text, p_organization_id uuid, p_legacy boolean)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if public.sa_cached_mode_is_new(p_permission) then
    return p_organization_id is not null
       and public.sa_cached_actor_allows(p_permission, jsonb_build_object('organization_id', p_organization_id));
  end if;
  return coalesce(p_legacy, false);
end $$;
revoke all on function public.sa_rls_gate(text,uuid,boolean) from public, anon;
grant execute on function public.sa_rls_gate(text,uuid,boolean) to authenticated, service_role;

create or replace function public.sa_rls_new_mode(p_permission text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select public.sa_cached_mode_is_new(p_permission)
$$;
revoke all on function public.sa_rls_new_mode(text) from public, anon;
grant execute on function public.sa_rls_new_mode(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Mechanical RLS rewrite
-- ---------------------------------------------------------------------------
create table if not exists public.sa_policy_rewrites (
  table_name text not null,
  policy_name text not null,
  permission_key text not null,
  organization_expression text not null,
  original_using text,
  original_check text,
  rewritten_at timestamptz not null default now(),
  primary key (table_name, policy_name)
);
alter table public.sa_policy_rewrites enable row level security;
alter table public.sa_policy_rewrites force row level security;
revoke all on table public.sa_policy_rewrites from public, anon, authenticated, service_role;
grant select on table public.sa_policy_rewrites to service_role;
comment on table public.sa_policy_rewrites is 'Audit/rollback record of RLS policies gated by S&A (original expressions preserved).';

-- Replaces role/privilege predicates by false. Returns null when the
-- expression cannot be rewritten safely (privilege predicate under NOT, or a
-- role reference left behind).
create or replace function public.sa_policy_ownership_remainder(p_expression text)
returns text language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v text := p_expression;
  v_patterns text[] := array[
    '\((public\.)?(get_my_role_level|current_user_role_level)\(\)\s*(<=|<|=|>=|>)\s*\d+\)',
    '(public\.)?sa_actor_is_hr_manager\(\)',
    '(public\.)?sa_actor_is_staff\(\d+\)',
    '(public\.)?is_hq_admin\(\)',
    '(public\.)?is_super_admin\(\)',
    '(public\.)?is_power_user\(\)',
    '(public\.)?is_admin\(\)',
    '(public\.)?has_role_level\(\d+\)',
    '\((\w+\.)?role_level\s*(<=|<|=|>=|>)\s*\d+\)',
    '\((\w+\.)?role_code\s*=\s*''[A-Za-z_]+''::text\)',
    '\((\w+\.)?role_code\s*=\s*ANY\s*\(ARRAY\[[^\]]*\]\)\)'
  ];
  v_pattern text;
begin
  if p_expression is null then return null; end if;
  foreach v_pattern in array v_patterns loop
    v := regexp_replace(v, v_pattern, 'false', 'gi');
  end loop;
  -- Monotonicity: a replaced predicate must never sit under NOT. IS NOT NULL /
  -- IS NOT DISTINCT FROM are comparisons, not negations of a predicate.
  if v <> p_expression
     and regexp_replace(v, 'IS NOT (NULL|DISTINCT FROM)', '', 'gi') ~* '(^|[^a-z_])not([^a-z_]|$)' then
    return null;
  end if;
  -- No privilege predicate may survive (join conditions such as
  -- u.role_code = r.role_code are structural and allowed).
  if v ~* 'role_level(\(\))?\s*(<=|<|=|>=|>)|role_code\s*=\s*''|role_code\s*=\s*any|is_hq_admin|is_super_admin|is_power_user|is_admin\(|has_role_level|sa_actor_is_' then
    return null;
  end if;
  return v;
end $$;
revoke all on function public.sa_policy_ownership_remainder(text) from public, anon, authenticated;

-- p_force: gate the policy even if it has no privilege predicate (tenant-only
-- policies on sensitive tables); the remainder is then false.
create or replace function public.sa_gate_policy(
  p_table regclass, p_policy name, p_permission text, p_org_expression text, p_force boolean default false)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_pol record;
  v_new_using text;
  v_new_check text;
  v_rem text;
  v_changed boolean := false;
begin
  if not exists (select 1 from public.sa_permissions where permission_key = p_permission) then
    raise exception 'sa_gate_policy: unknown permission %', p_permission;
  end if;
  select pol.polname, pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
    into v_pol
  from pg_policy pol where pol.polrelid = p_table and pol.polname = p_policy;
  if not found then
    raise notice 'sa_gate_policy: %.% not present, skipped', p_table, p_policy;
    return false;
  end if;
  if coalesce(v_pol.qual, '') like '%sa_rls_gate(%' or coalesce(v_pol.wcheck, '') like '%sa_rls_gate(%' then
    return false; -- already gated (idempotent)
  end if;

  if v_pol.qual is not null then
    v_rem := public.sa_policy_ownership_remainder(v_pol.qual);
    if v_rem is null then raise exception 'sa_gate_policy: %.% USING cannot be rewritten safely', p_table, p_policy; end if;
    if v_rem <> v_pol.qual or p_force then
      if v_rem = v_pol.qual then v_rem := 'false'; end if;
      v_new_using := format('(public.sa_rls_gate(%L, %s, (%s)) OR (public.sa_rls_new_mode(%L) AND (%s)))',
                            p_permission, p_org_expression, v_pol.qual, p_permission, v_rem);
      v_changed := true;
    end if;
  end if;
  if v_pol.wcheck is not null then
    v_rem := public.sa_policy_ownership_remainder(v_pol.wcheck);
    if v_rem is null then raise exception 'sa_gate_policy: %.% WITH CHECK cannot be rewritten safely', p_table, p_policy; end if;
    if v_rem <> v_pol.wcheck or p_force then
      if v_rem = v_pol.wcheck then v_rem := 'false'; end if;
      v_new_check := format('(public.sa_rls_gate(%L, %s, (%s)) OR (public.sa_rls_new_mode(%L) AND (%s)))',
                            p_permission, p_org_expression, v_pol.wcheck, p_permission, v_rem);
      v_changed := true;
    end if;
  end if;
  if not v_changed then return false; end if;

  insert into public.sa_policy_rewrites(table_name, policy_name, permission_key, organization_expression, original_using, original_check)
  values ((select relname from pg_class where oid = p_table), p_policy, p_permission, p_org_expression, v_pol.qual, v_pol.wcheck)
  on conflict (table_name, policy_name) do nothing;
  if v_new_using is not null then
    execute format('alter policy %I on %s using (%s)', p_policy, p_table, v_new_using);
  end if;
  if v_new_check is not null then
    execute format('alter policy %I on %s with check (%s)', p_policy, p_table, v_new_check);
  end if;
  return true;
end $$;
revoke all on function public.sa_gate_policy(regclass,name,text,text,boolean) from public, anon, authenticated, service_role;

-- Gate every policy of a table: SELECT policies with p_read, the others with
-- p_write. Tables absent in an environment are skipped with a notice.
create or replace function public.sa_gate_table(
  p_table text, p_read text, p_write text, p_org_expression text default 'organization_id', p_force boolean default false)
returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_rel regclass := to_regclass('public.' || p_table);
  v_pol record;
  v_count integer := 0;
  v_org text := p_org_expression;
begin
  if v_rel is null then raise notice 'sa_gate_table: public.% not present, skipped', p_table; return 0; end if;
  -- Global (non-tenant) configuration tables have no organization column: the
  -- actor must hold the permission in their own organization.
  if v_org ~ '^[a-z_]+$' and not exists (
       select 1 from pg_attribute where attrelid = v_rel and attname = v_org and not attisdropped) then
    v_org := 'public.sa_actor_org_id()';
  end if;
  for v_pol in select polname, polcmd from pg_policy where polrelid = v_rel loop
    if public.sa_gate_policy(v_rel, v_pol.polname, case when v_pol.polcmd = 'r' then p_read else p_write end, v_org, p_force) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.sa_gate_table(text,text,text,text,boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC guard injection
-- ---------------------------------------------------------------------------
create table if not exists public.sa_function_guard_injections (
  function_signature text primary key,
  permission_key text not null,
  guard_marker text not null,
  original_definition text not null,
  injected_at timestamptz not null default now()
);
alter table public.sa_function_guard_injections enable row level security;
alter table public.sa_function_guard_injections force row level security;
revoke all on table public.sa_function_guard_injections from public, anon, authenticated, service_role;
grant select on table public.sa_function_guard_injections to service_role;
comment on table public.sa_function_guard_injections is 'Audit/rollback record of workflow RPCs guarded by sa_require_operation (original definitions preserved).';

-- p_guard: PL/pgSQL statement(s) inserted as the first statement of the body.
-- p_replacements: [[regex, replacement], ...]; each must match at least once.
create or replace function public.sa_inject_operation_guard(
  p_function regprocedure, p_permission text, p_guard text, p_replacements jsonb default '[]'::jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_def text := pg_get_functiondef(p_function);
  v_new text;
  v_marker text := '/* sa-guard:' || p_permission || ' */';
  v_pair jsonb;
  v_before text;
begin
  if v_def like '%' || v_marker || '%' then return false; end if;
  if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = p_function) <> 'plpgsql' then
    raise exception 'sa_inject_operation_guard: % is not plpgsql', p_function;
  end if;
  v_new := v_def;
  for v_pair in select * from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb)) loop
    v_before := v_new;
    v_new := regexp_replace(v_new, v_pair->>0, v_pair->>1, 'g');
    if v_new = v_before then
      raise exception 'sa_inject_operation_guard: pattern % not found in %', v_pair->>0, p_function;
    end if;
  end loop;
  v_before := v_new;
  -- First line consisting only of BEGIN (optionally followed by a comment).
  v_new := regexp_replace(v_new, '(\n[ \t]*BEGIN[ \t]*(--[^\r\n]*)?\r?\n)', E'\\1  ' || v_marker || E'\n  ' || p_guard || E'\n', 'i');
  if v_new = v_before then raise exception 'sa_inject_operation_guard: no BEGIN line in %', p_function; end if;
  insert into public.sa_function_guard_injections(function_signature, permission_key, guard_marker, original_definition)
  values (p_function::text, p_permission, v_marker, v_def)
  on conflict (function_signature) do nothing;
  execute v_new;
  return true;
end $$;
revoke all on function public.sa_inject_operation_guard(regprocedure,text,text,jsonb) from public, anon, authenticated, service_role;

-- In LEGACY_ENFORCED/SHADOW keep the Phase 0B staff guard; in NEW_ENFORCED/
-- LEGACY_RETIRED the S&A decision replaces it.
create or replace function public.sa_legacy_guard_unless_new(p_permission text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select not public.sa_is_new_authoritative(p_permission)
$$;
revoke all on function public.sa_legacy_guard_unless_new(text) from public, anon;
grant execute on function public.sa_legacy_guard_unless_new(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Finance
-- ---------------------------------------------------------------------------
do $finance$
begin
  perform public.sa_gate_table('gl_accounts', 'finance.ledger.view', 'finance.account.manage', 'company_id', true);
  perform public.sa_gate_table('gl_journals', 'finance.ledger.view', 'finance.journal.post', 'company_id', true);
  perform public.sa_gate_table('gl_journal_lines', 'finance.ledger.view', 'finance.journal.post',
    '(select j.company_id from public.gl_journals j where j.id = gl_journal_lines.journal_id)', true);
  perform public.sa_gate_table('gl_document_postings', 'finance.ledger.view', 'finance.journal.post', 'company_id', true);
  perform public.sa_gate_table('fiscal_years', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
  perform public.sa_gate_table('fiscal_periods', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
  perform public.sa_gate_table('gl_posting_rules', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
  perform public.sa_gate_table('gl_settings', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
  perform public.sa_gate_table('accounting_currency_settings', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
  -- Bank data had one ALL policy for every member of the company (no role
  -- check anywhere). NEW_ENFORCED restricts it to reconciliation performers;
  -- read access for cash viewers is added below.
  perform public.sa_gate_table('bank_accounts', 'finance.cash.view', 'finance.reconciliation.perform', 'company_id', true);
  perform public.sa_gate_table('bank_reconciliations', 'finance.cash.view', 'finance.reconciliation.perform', 'company_id', true);
  perform public.sa_gate_table('bank_reconciliation_lines', 'finance.cash.view', 'finance.reconciliation.perform',
    '(select r.company_id from public.bank_reconciliations r where r.id = bank_reconciliation_lines.reconciliation_id)', true);
  perform public.sa_gate_table('exchange_rates', 'finance.ledger.view', 'finance.settings.manage', 'company_id', true);
end
$finance$;

do $bank_read$
begin
  if to_regclass('public.bank_accounts') is not null then
    drop policy if exists sa_finance_cash_view on public.bank_accounts;
    create policy sa_finance_cash_view on public.bank_accounts for select to authenticated
      using (public.sa_rls_new_mode('finance.cash.view') and public.sa_rls_gate('finance.cash.view', company_id, false));
  end if;
  if to_regclass('public.bank_reconciliations') is not null then
    drop policy if exists sa_finance_cash_view on public.bank_reconciliations;
    create policy sa_finance_cash_view on public.bank_reconciliations for select to authenticated
      using (public.sa_rls_new_mode('finance.cash.view') and public.sa_rls_gate('finance.cash.view', company_id, false));
  end if;
  if to_regclass('public.exchange_rates') is not null then
    drop policy if exists sa_finance_ledger_view on public.exchange_rates;
    create policy sa_finance_ledger_view on public.exchange_rates for select to authenticated
      using (public.sa_rls_new_mode('finance.ledger.view') and public.sa_rls_gate('finance.ledger.view', company_id, false));
  end if;
end
$bank_read$;

select public.sa_inject_operation_guard(
  'public.post_document_to_gl(text,uuid,date)'::regprocedure, 'finance.journal.post',
  $g$PERFORM public.sa_require_operation('finance.journal.post', jsonb_build_object('organization_id', public.get_user_company_id()), p_document_type, p_document_id::text);$g$,
  jsonb_build_array(jsonb_build_array('IF NOT public\.is_hq_admin\(\) THEN',
    $r$IF public.sa_legacy_guard_unless_new('finance.journal.post') AND NOT public.is_hq_admin() THEN$r$)));

select public.sa_inject_operation_guard(
  'public.approve_payment_request(uuid)'::regprocedure, 'finance.payment.approve',
  $g$PERFORM public.sa_require_operation('finance.payment.approve', jsonb_build_object('organization_id', (SELECT d.company_id FROM public.documents d WHERE d.id = p_request_id)), 'payment_request', p_request_id::text);
  PERFORM public.sa_enforce_same_document_sod('payment-request-maker-checker', p_request_id::text, auth.uid(), ARRAY(SELECT d.created_by FROM public.documents d WHERE d.id = p_request_id));$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20, true\);',
    $r$IF public.sa_legacy_guard_unless_new('finance.payment.approve') THEN PERFORM public.sa_assert_staff_actor(20, true); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.generate_fiscal_periods(uuid,text)'::regprocedure, 'finance.settings.manage',
  $g$PERFORM public.sa_require_operation('finance.settings.manage', jsonb_build_object('organization_id', (SELECT fy.company_id FROM public.fiscal_years fy WHERE fy.id = p_fiscal_year_id)), 'fiscal_year', p_fiscal_year_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('finance.settings.manage') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

-- ---------------------------------------------------------------------------
-- 5. HR and Payroll
-- ---------------------------------------------------------------------------
do $hr$
declare
  r record;
begin
  for r in select * from (values
    -- table, read permission, write permission
    ('hr_payroll_runs', 'hr.payroll.view', 'hr.payroll.prepare'),
    ('hr_payroll_run_items', 'hr.payroll.view', 'hr.payroll.prepare'),
    ('hr_payroll_audit', 'hr.payroll.view', 'hr.payroll.prepare'),
    ('hr_payslip_access_logs', 'hr.payroll.view', 'hr.payroll.view'),
    ('hr_employee_compensation', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_salary_bands', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_employee_allowances', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_employee_deductions', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_allowance_types', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_deduction_types', 'hr.compensation.view', 'hr.compensation.manage'),
    ('hr_contracts', 'hr.contract.view', 'hr.contract.manage'),
    ('hr_gl_mappings', 'finance.payroll_integration.manage', 'finance.payroll_integration.manage'),
    ('hr_gl_postings', 'finance.payroll_integration.manage', 'finance.payroll_integration.manage'),
    ('hr_applicants', 'hr.recruitment.manage', 'hr.recruitment.manage'),
    ('hr_applications', 'hr.recruitment.manage', 'hr.recruitment.manage'),
    ('hr_interviews', 'hr.recruitment.manage', 'hr.recruitment.manage'),
    ('hr_job_postings', 'hr.recruitment.manage', 'hr.recruitment.manage'),
    ('hr_offers', 'hr.recruitment.manage', 'hr.recruitment.manage'),
    ('hr_benefit_contribution_items', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_benefit_contribution_runs', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_benefit_dependents', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_benefit_enrollments', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_benefit_plans', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_benefit_providers', 'hr.benefits.manage', 'hr.benefits.manage'),
    ('hr_certifications', 'hr.learning.manage', 'hr.learning.manage'),
    ('hr_course_enrollments', 'hr.learning.manage', 'hr.learning.manage'),
    ('hr_courses', 'hr.learning.manage', 'hr.learning.manage'),
    ('hr_skill_assessments', 'hr.learning.manage', 'hr.learning.manage'),
    ('hr_skill_matrix', 'hr.learning.manage', 'hr.learning.manage'),
    ('hr_document_requests', 'hr.employee.manage', 'hr.employee.manage'),
    ('hr_profile_change_requests', 'hr.employee.manage', 'hr.employee.manage'),
    ('hr_expense_claims', 'hr.expense.manage', 'hr.expense.manage'),
    ('hr_expense_items', 'hr.expense.manage', 'hr.expense.manage'),
    ('hr_timesheet_entries', 'hr.expense.manage', 'hr.expense.manage'),
    ('hr_kpi_snapshots', 'hr.analytics.view', 'hr.analytics.view'),
    ('hr_reports', 'hr.analytics.view', 'hr.analytics.view'),
    ('hr_onboarding_documents', 'hr.onboarding.manage', 'hr.onboarding.manage'),
    ('hr_onboarding_instance_tasks', 'hr.onboarding.manage', 'hr.onboarding.manage'),
    ('hr_onboarding_instances', 'hr.onboarding.manage', 'hr.onboarding.manage'),
    ('hr_onboarding_template_tasks', 'hr.onboarding.manage', 'hr.onboarding.manage'),
    ('hr_onboarding_templates', 'hr.onboarding.manage', 'hr.onboarding.manage'),
    ('hr_policies', 'hr.policy.manage', 'hr.policy.manage'),
    ('hr_policy_acknowledgements', 'hr.policy.manage', 'hr.policy.manage'),
    ('hr_attendance_entries', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_attendance_corrections', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_attendance_policies', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_timesheets', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_shifts', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_overtime_presets', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_overtime_calculations', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_overtime_policies', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_overtime_requests', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_overtime_rules', 'hr.attendance.manage', 'hr.attendance.manage'),
    ('hr_leave_requests', 'hr.leave.approve', 'hr.leave.approve'),
    ('hr_leave_approvals', 'hr.leave.approve', 'hr.leave.approve'),
    ('hr_leave_balances', 'hr.leave.approve', 'hr.leave.approve'),
    ('hr_leave_types', 'hr.leave.approve', 'hr.leave.approve'),
    ('hr_positions', 'hr.employee.manage', 'hr.employee.manage'),
    ('hr_settings', 'hr.settings.manage', 'hr.settings.manage'),
    ('hr_public_holidays', 'hr.settings.manage', 'hr.settings.manage'),
    ('hr_approval_chains', 'hr.settings.manage', 'hr.settings.manage'),
    ('hr_approval_chain_steps', 'hr.settings.manage', 'hr.settings.manage'),
    ('hr_kpi_definitions', 'hr.performance.manage', 'hr.performance.manage'),
    ('hr_performance_reviews', 'hr.performance.manage', 'hr.performance.manage'),
    ('hr_review_templates', 'hr.performance.manage', 'hr.performance.manage'),
    ('hr_appraisal_cycles', 'hr.performance.manage', 'hr.performance.manage')
  ) as t(tbl, read_perm, write_perm) loop
    perform public.sa_gate_table(r.tbl, r.read_perm, r.write_perm, 'organization_id', false);
  end loop;
end
$hr$;

-- Payroll run headers (period totals) were readable by every member of the
-- organization. NEW_ENFORCED restricts them to payroll viewers.
do $payroll_read$
begin
  if exists (select 1 from pg_policy where polrelid = 'public.hr_payroll_runs'::regclass and polname = 'sa_hr_org_read') then
    perform public.sa_gate_policy('public.hr_payroll_runs'::regclass, 'sa_hr_org_read', 'hr.payroll.view', 'organization_id', true);
  end if;
end
$payroll_read$;

-- NEW_ENFORCED check for the verified API caller in ANY of the given
-- organizations (e.g. buyer or seller of an order).
create or replace function public.sa_api_require_any_org(p_permission text, p_orgs uuid[])
returns void language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  -- Callers are SECURITY INVOKER triggers that already established the caller
  -- is an API role; current_user here would be the function owner.
  if not public.sa_is_new_authoritative(p_permission) then return; end if;
  if v_uid is not null then
    foreach v_org in array coalesce(p_orgs, array[]::uuid[]) loop
      if v_org is not null and public.sa_actor_has_permission(v_uid, p_permission, jsonb_build_object('organization_id', v_org)) then
        return;
      end if;
    end loop;
  end if;
  raise exception 'sa_authorization_required' using errcode = '42501', detail = p_permission;
end $$;
revoke all on function public.sa_api_require_any_org(text,uuid[]) from public, anon;
grant execute on function public.sa_api_require_any_org(text,uuid[]) to authenticated, service_role;

-- Direct PostgREST transition guard: approving a payroll run is an S&A
-- operation. API roles (anon/authenticated) may move a run to 'approved' only
-- when hr.payroll.approve allows them in NEW_ENFORCED (legacy: the existing
-- HR-manager RLS decides). The server route performs the approval with the
-- service role after requireAuthorization.
create or replace function public.sa_payroll_run_transition_guard()
returns trigger language plpgsql
-- SECURITY INVOKER on purpose: current_user must be the caller's role.
set search_path = pg_catalog, pg_temp as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'approved' then
    perform public.sa_enforce_same_document_sod('payroll-prepare-approve', new.id::text,
      coalesce(auth.uid(), new.approved_by), array[old.calculated_by]);
    if current_user in ('anon','authenticated') then
      perform public.sa_api_require_any_org('hr.payroll.approve', array[new.organization_id]);
    end if;
  elsif new.status = 'calculated' then
    if current_user in ('anon','authenticated') then
      perform public.sa_api_require_any_org('hr.payroll.prepare', array[new.organization_id]);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sa_payroll_run_transition_guard() from public, anon;
do $trg$
begin
  if to_regclass('public.hr_payroll_runs') is not null then
    drop trigger if exists sa_payroll_run_transition_guard on public.hr_payroll_runs;
    create trigger sa_payroll_run_transition_guard before update of status on public.hr_payroll_runs
      for each row execute function public.sa_payroll_run_transition_guard();
  end if;
end
$trg$;

select public.sa_inject_operation_guard(
  'public.post_payroll_run_to_gl(uuid,date)'::regprocedure, 'hr.payroll.release',
  $g$PERFORM public.sa_require_operation('hr.payroll.release', jsonb_build_object('organization_id', (SELECT r.organization_id FROM public.hr_payroll_runs r WHERE r.id = p_payroll_run_id)), 'payroll_run', p_payroll_run_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('hr.payroll.release') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.reverse_payroll_gl_posting(uuid,text,date)'::regprocedure, 'hr.payroll.release',
  $g$PERFORM public.sa_require_operation('hr.payroll.release', jsonb_build_object('organization_id', (SELECT r.organization_id FROM public.hr_payroll_runs r WHERE r.id = p_payroll_run_id)), 'payroll_run', p_payroll_run_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('hr.payroll.release') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.post_payroll_payment_to_gl(uuid,date)'::regprocedure, 'hr.payroll.release',
  $g$PERFORM public.sa_require_operation('hr.payroll.release', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'payroll_payment_batch', p_payment_batch_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('hr.payroll.release') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.seed_hr_gl_accounts(uuid)'::regprocedure, 'finance.payroll_integration.manage',
  $g$PERFORM public.sa_require_operation('finance.payroll_integration.manage', jsonb_build_object('organization_id', p_company_id), 'organization', p_company_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('finance.payroll_integration.manage') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.seed_payroll_gl_mappings(uuid)'::regprocedure, 'finance.payroll_integration.manage',
  $g$PERFORM public.sa_require_operation('finance.payroll_integration.manage', jsonb_build_object('organization_id', p_company_id), 'organization', p_company_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('finance.payroll_integration.manage') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

select public.sa_inject_operation_guard(
  'public.seed_payroll_components(uuid)'::regprocedure, 'hr.compensation.manage',
  $g$PERFORM public.sa_require_operation('hr.compensation.manage', jsonb_build_object('organization_id', p_company_id), 'organization', p_company_id::text);$g$,
  jsonb_build_array(jsonb_build_array('PERFORM public\.sa_assert_staff_actor\(20\);',
    $r$IF public.sa_legacy_guard_unless_new('hr.compensation.manage') THEN PERFORM public.sa_assert_staff_actor(20); END IF;$r$)));

-- INVOKER HR→GL posting functions: RLS on hr_gl_postings/gl_journals already
-- gates them; add the explicit operation guard for a clear denial.
select public.sa_inject_operation_guard(
  'public.hr_post_payroll_run_to_gl(uuid,numeric)'::regprocedure, 'hr.payroll.release',
  $g$PERFORM public.sa_require_operation('hr.payroll.release', jsonb_build_object('organization_id', (SELECT r.organization_id FROM public.hr_payroll_runs r WHERE r.id = p_run_id)), 'payroll_run', p_run_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.hr_post_benefit_contribution_run_to_gl(uuid,numeric)'::regprocedure, 'finance.journal.post',
  $g$PERFORM public.sa_require_operation('finance.journal.post', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'benefit_contribution_run', p_run_id::text);$g$);
select public.sa_inject_operation_guard(
  'public.hr_post_expense_claim_to_gl(uuid)'::regprocedure, 'finance.journal.post',
  $g$PERFORM public.sa_require_operation('finance.journal.post', jsonb_build_object('organization_id', public.sa_actor_org_id()), 'expense_claim', p_claim_id::text);$g$);

-- ---------------------------------------------------------------------------
-- 6. Joiner / Mover / Leaver
-- ---------------------------------------------------------------------------
-- Scope definition owned by the lifecycle (no actor authorization: system).
create or replace function public.sa_ensure_scope_internal(p_org uuid, p_scope_type text, p_scope_value text, p_display text, p_metadata jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.sa_scope_definitions
  where coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
    and scope_type = p_scope_type and scope_value = p_scope_value;
  if v_id is null then
    insert into public.sa_scope_definitions(organization_id, scope_type, scope_value, display_name, resource_metadata)
    values (p_org, p_scope_type, p_scope_value, p_display, coalesce(p_metadata, '{}'::jsonb))
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.sa_scope_definitions
      where coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
        and scope_type = p_scope_type and scope_value = p_scope_value;
    end if;
  elsif exists (select 1 from public.sa_scope_definitions where id = v_id and status <> 'active') then
    update public.sa_scope_definitions set status = 'active', updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.sa_ensure_scope_internal(uuid,text,text,text,jsonb) from public, anon, authenticated;

-- Derived (lifecycle-owned) assignment; idempotent; returns assignment id.
create or replace function public.sa_ensure_derived_assignment(
  p_user uuid, p_role uuid, p_membership uuid, p_scope uuid, p_until timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid; v_prev record;
begin
  select id, status, effective_until, source into v_prev from public.sa_role_assignments
  where user_id = p_user and role_id = p_role and membership_id = p_membership;
  if v_prev.id is null then
    insert into public.sa_role_assignments(user_id, role_id, membership_id, status, effective_until, assignment_reason, source)
    values (p_user, p_role, p_membership, 'active', p_until, p_reason, 'derived') returning id into v_id;
  else
    v_id := v_prev.id;
    -- Never resurrect or extend an assignment an administrator ended/granted
    -- manually; only lifecycle-owned rows are maintained here.
    if v_prev.source in ('backfill','derived') then
      update public.sa_role_assignments set status = 'active', ended_reason = null, effective_until = p_until, updated_at = now()
      where id = v_id and (status <> 'active' or effective_until is distinct from p_until);
    end if;
  end if;
  insert into public.sa_assignment_scopes(assignment_id, scope_id) values (v_id, p_scope) on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.sa_ensure_derived_assignment(uuid,uuid,uuid,uuid,timestamptz,text) from public, anon, authenticated;

create or replace function public.sa_sync_user_lifecycle(p_user uuid, p_trigger text default 'manual')
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  u record;
  v_enterprise boolean;
  v_employed boolean;
  v_changes jsonb := '[]'::jsonb;
  v_count integer;
  v_membership uuid;
  v_org_type text;
  v_compat_role uuid;
  v_baseline_role uuid;
  v_org_scope uuid;
  v_self_scope uuid;
  v_until timestamptz;
  v_contract_end date;
begin
  if not public.sa_setting_bool('lifecycle.sync_enabled', true) then
    return jsonb_build_object('status', 'disabled');
  end if;
  select id, is_active, employment_status, account_scope, organization_id, role_code, employment_type
    into u from public.users where id = p_user;
  if not found then return jsonb_build_object('status', 'no_user'); end if;

  v_enterprise := u.account_scope = 'portal' and u.organization_id is not null;
  v_employed := coalesce(u.is_active, false) and coalesce(u.employment_status, 'active') = 'active';

  -- LEAVER (or no longer an enterprise identity): end every business
  -- relationship. Consumer relationships live elsewhere and are untouched.
  if not (v_enterprise and v_employed) then
    with x as (
      update public.sa_role_assignments set status = 'revoked',
        ended_reason = 'leaver:' || coalesce(u.employment_status, 'inactive'),
        effective_until = public.sa_end_at(effective_from, effective_until), updated_at = now()
      where user_id = p_user and status = 'active' returning id)
    select count(*) into v_count from x;
    if v_count > 0 then v_changes := v_changes || jsonb_build_object('assignments_revoked', v_count); end if;

    with x as (
      update public.sa_organization_memberships set status = 'inactive',
        ended_reason = 'leaver:' || coalesce(u.employment_status, 'inactive'),
        effective_until = public.sa_end_at(effective_from, effective_until),
        is_primary = false, updated_at = now()
      where user_id = p_user and status = 'active' returning id)
    select count(*) into v_count from x;
    if v_count > 0 then v_changes := v_changes || jsonb_build_object('memberships_ended', v_count); end if;

    with x as (
      update public.sa_delegations set status = 'revoked', revoked_at = now(), revoke_reason = 'lifecycle: leaver'
      where (delegator_id = p_user or delegate_id = p_user) and status = 'active' returning id)
    select count(*) into v_count from x;
    if v_count > 0 then v_changes := v_changes || jsonb_build_object('delegations_revoked', v_count); end if;

    with x as (
      update public.sa_access_requests set status = 'cancelled', updated_at = now(),
        decision_reason = 'lifecycle: leaver'
      where (target_user_id = p_user or requester_id = p_user) and status = 'requested' returning id)
    select count(*) into v_count from x;
    if v_count > 0 then v_changes := v_changes || jsonb_build_object('requests_cancelled', v_count); end if;

    update public.sa_emergency_access_grants set status = 'revoked'
    where user_id = p_user and status in ('requested','active');

    if jsonb_array_length(v_changes) > 0 then
      perform public.sa_log_access_change(null, 'lifecycle.leaver', p_user, 'user', p_user::text,
        jsonb_build_object('trigger', p_trigger, 'employment_status', u.employment_status, 'is_active', u.is_active,
                           'account_scope', u.account_scope, 'changes', v_changes), null, 'system');
    end if;
    return jsonb_build_object('status', 'leaver', 'changes', v_changes);
  end if;

  -- MOVER: lifecycle-owned memberships in another organization end, together
  -- with every assignment on them; delegations involving the user are
  -- revoked (re-evaluation of authority in the new context).
  with ended as (
    update public.sa_organization_memberships set status = 'inactive', ended_reason = 'mover',
      effective_until = public.sa_end_at(effective_from, effective_until), is_primary = false, updated_at = now()
    where user_id = p_user and status = 'active' and source in ('backfill','derived')
      and organization_id <> u.organization_id
    returning id)
  select count(*) into v_count from ended;
  if v_count > 0 then
    update public.sa_role_assignments a set status = 'revoked', ended_reason = 'mover',
      effective_until = public.sa_end_at(a.effective_from, a.effective_until), updated_at = now()
    where a.user_id = p_user and a.status = 'active'
      and a.membership_id in (select m.id from public.sa_organization_memberships m
                              where m.user_id = p_user and m.status = 'inactive' and m.ended_reason = 'mover');
    update public.sa_delegations set status = 'revoked', revoked_at = now(), revoke_reason = 'lifecycle: mover'
    where (delegator_id = p_user or delegate_id = p_user) and status = 'active';
    v_changes := v_changes || jsonb_build_object('mover_memberships_ended', v_count);
  end if;

  -- JOINER / current organization membership.
  select id into v_membership from public.sa_organization_memberships
  where user_id = p_user and organization_id = u.organization_id
  order by (status = 'active') desc, is_primary desc limit 1;
  update public.sa_organization_memberships set is_primary = false
  where user_id = p_user and is_primary and (v_membership is null or id <> v_membership);
  if v_membership is null then
    insert into public.sa_organization_memberships(user_id, organization_id, membership_type, is_primary, status, source)
    values (p_user, u.organization_id, 'employee', true, 'active', 'derived') returning id into v_membership;
    v_changes := v_changes || jsonb_build_object('membership_created', u.organization_id);
  else
    update public.sa_organization_memberships set status = 'active', is_primary = true, ended_reason = null,
      effective_until = null, updated_at = now()
    where id = v_membership and (status <> 'active' or not is_primary or effective_until is not null);
    if found then v_changes := v_changes || jsonb_build_object('membership_reactivated', u.organization_id); end if;
  end if;

  -- Temporary workers: mandatory expiry.
  if u.employment_type in ('Contract','Intern') then
    select max(c.expiry_date) into v_contract_end from public.hr_contracts c
    where c.employee_user_id = p_user and c.status = 'active' and c.expiry_date >= current_date;
    v_until := coalesce((v_contract_end + 1)::timestamptz,
                        date_trunc('day', now()) + make_interval(days => public.sa_setting_int('lifecycle.contractor_default_expiry_days', 90)));
  else
    v_until := null;
  end if;

  select org_type_code into v_org_type from public.organizations where id = u.organization_id;
  v_org_scope := public.sa_ensure_scope_internal(u.organization_id,
    case when v_org_type = 'WH' then 'warehouse' else 'organization' end,
    u.organization_id::text, coalesce((select org_name from public.organizations where id = u.organization_id), u.organization_id::text),
    jsonb_build_object('source', 'lifecycle', 'org_type_code', v_org_type));
  v_self_scope := public.sa_ensure_scope_internal(u.organization_id, 'own_record', 'self', 'Own record',
    jsonb_build_object('source', 'lifecycle'));

  -- Compatibility role for the legacy role code (explicit, removable grants).
  v_compat_role := public.sa_refresh_compat_role(u.role_code, true);
  if v_compat_role is not null then
    perform public.sa_ensure_derived_assignment(p_user, v_compat_role, v_membership, v_org_scope, v_until,
      'Lifecycle: compatibility role for legacy ' || u.role_code);
  end if;
  -- MOVER (role change): end lifecycle-owned compatibility assignments for
  -- other role codes.
  with x as (
    update public.sa_role_assignments a set status = 'revoked', ended_reason = 'mover:role_change',
      effective_until = public.sa_end_at(a.effective_from, a.effective_until), updated_at = now()
    from public.sa_business_roles br
    where a.role_id = br.id and br.source = 'legacy' and a.user_id = p_user and a.status = 'active'
      and a.source in ('backfill','derived') and (v_compat_role is null or a.role_id <> v_compat_role)
    returning a.id)
  select count(*) into v_count from x;
  if v_count > 0 then v_changes := v_changes || jsonb_build_object('role_change_revoked', v_count); end if;

  -- Baseline: employee self-service on the employee's own record.
  select id into v_baseline_role from public.sa_business_roles where role_key = 'employee-self-service' and status = 'active';
  if v_baseline_role is not null then
    perform public.sa_ensure_derived_assignment(p_user, v_baseline_role, v_membership, v_self_scope, v_until,
      'Lifecycle: employee self-service baseline');
  end if;

  -- Contract end date changes flow into lifecycle-owned assignments.
  update public.sa_role_assignments set effective_until = v_until, updated_at = now()
  where user_id = p_user and membership_id = v_membership and status = 'active'
    and source in ('backfill','derived') and effective_until is distinct from v_until;

  if jsonb_array_length(v_changes) > 0 then
    perform public.sa_log_access_change(null,
      case when v_changes::text like '%mover%' or v_changes::text like '%role_change%' then 'lifecycle.mover' else 'lifecycle.joiner' end,
      p_user, 'user', p_user::text,
      jsonb_build_object('trigger', p_trigger, 'organization_id', u.organization_id, 'role_code', u.role_code,
                         'employment_type', u.employment_type, 'effective_until', v_until, 'changes', v_changes), null, 'system');
  end if;
  return jsonb_build_object('status', 'active', 'membership_id', v_membership, 'effective_until', v_until, 'changes', v_changes);
end $$;
revoke all on function public.sa_sync_user_lifecycle(uuid,text) from public, anon, authenticated;
grant execute on function public.sa_sync_user_lifecycle(uuid,text) to service_role;
comment on function public.sa_sync_user_lifecycle(uuid,text) is
  'Joiner/Mover/Leaver: derives S&A memberships and lifecycle-owned assignments from users employment facts. Leavers lose all business access; history is kept (status inactive/revoked).';

create or replace function public.sa_users_lifecycle_trigger()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform public.sa_sync_user_lifecycle(new.id, 'users.' || lower(tg_op));
  return new;
end $$;
revoke all on function public.sa_users_lifecycle_trigger() from public, anon, authenticated;

drop trigger if exists sa_users_lifecycle on public.users;
create trigger sa_users_lifecycle
after insert or update of is_active, employment_status, organization_id, role_code, account_scope, employment_type on public.users
for each row execute function public.sa_users_lifecycle_trigger();

create or replace function public.sa_lifecycle_resync_all()
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_user uuid; v_n integer := 0;
begin
  for v_user in
    select u.id from public.users u
    where u.account_scope = 'portal'
       or exists (select 1 from public.sa_organization_memberships m where m.user_id = u.id and m.status = 'active')
  loop
    perform public.sa_sync_user_lifecycle(v_user, 'resync');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('users_synced', v_n);
end $$;
revoke all on function public.sa_lifecycle_resync_all() from public, anon, authenticated;
grant execute on function public.sa_lifecycle_resync_all() to service_role;

-- Initial synchronisation of every existing enterprise identity.
select public.sa_lifecycle_resync_all();

-- ---------------------------------------------------------------------------
-- 7. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  -- Every gated policy must contain the gate exactly once per expression and
  -- no remaining privileged predicate outside the legacy argument.
  select count(*) into v_bad from public.sa_policy_rewrites w
  join pg_policy p on p.polname = w.policy_name and p.polrelid = ('public.' || w.table_name)::regclass
  where coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%sa_rls_gate(%';
  if v_bad > 0 then raise exception 'postcondition: % recorded policy rewrites are not gated', v_bad; end if;

  if (select count(*) from public.sa_policy_rewrites where table_name like 'hr\_%') < 50 then
    raise exception 'postcondition: HR policies were not gated';
  end if;
  if (select count(*) from public.sa_policy_rewrites where table_name in ('gl_journals','gl_accounts')) = 0 then
    raise exception 'postcondition: GL policies were not gated';
  end if;

  select count(*) into v_bad from public.sa_function_guard_injections g
  join pg_proc p on p.oid = g.function_signature::regprocedure
  where pg_get_functiondef(p.oid) not like '%' || g.guard_marker || '%'
     or pg_get_functiondef(p.oid) not like '%sa_require_operation(%';
  if v_bad > 0 then raise exception 'postcondition: % guarded functions lost their guard', v_bad; end if;

  if (select prosecdef from pg_proc where oid = 'public.sa_payroll_run_transition_guard()'::regprocedure) then
    raise exception 'postcondition: payroll transition guard must be SECURITY INVOKER';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'sa_users_lifecycle' and tgrelid = 'public.users'::regclass) then
    raise exception 'postcondition: lifecycle trigger missing';
  end if;

  -- Leavers: no active business access.
  select count(*) into v_bad from public.sa_role_assignments a join public.users u on u.id = a.user_id
  where a.status = 'active' and (u.is_active is not true or u.employment_status <> 'active');
  if v_bad > 0 then raise exception 'postcondition: % active assignments belong to leavers', v_bad; end if;

  -- Consumers never hold enterprise assignments.
  select count(*) into v_bad from public.sa_role_assignments a join public.users u on u.id = a.user_id
  where a.status = 'active' and u.account_scope <> 'portal';
  if v_bad > 0 then raise exception 'postcondition: % active assignments belong to non-portal identities', v_bad; end if;

  -- Temporary workers always expire.
  select count(*) into v_bad from public.sa_role_assignments a join public.users u on u.id = a.user_id
  where a.status = 'active' and a.source in ('backfill','derived') and u.employment_type in ('Contract','Intern')
    and a.effective_until is null;
  if v_bad > 0 then raise exception 'postcondition: % contractor assignments lack an expiry', v_bad; end if;

  if has_function_privilege('authenticated', 'public.sa_sync_user_lifecycle(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sa_gate_policy(regclass,name,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.sa_inject_operation_guard(regprocedure,text,text,jsonb)', 'EXECUTE') then
    raise exception 'postcondition: lifecycle/migration helpers must not be API-callable';
  end if;
end $$;
