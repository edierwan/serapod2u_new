-- ============================================================================
-- Security & Access Final Wave — D. Legacy retirement support and cutover
-- ----------------------------------------------------------------------------
-- Requires migrations A, B and C.
--
-- Purpose
--   1. sa_enforcement_readiness: registry of operations whose EVERY reachable
--      path is wired (server route through requireAuthorization/authorize and
--      the database backstop: RPC guard, RLS gate or transition guard). Must
--      match ENFORCEMENT_READY_PERMISSIONS in
--      app/src/lib/security-access/readiness.ts (tested).
--   2. sa_set_migration_mode(): the only non-owner path to change a mode.
--      NEW_ENFORCED/LEGACY_RETIRED require a readiness registration;
--      LEGACY_RETIRED requires NEW_ENFORCED first; every change is audited.
--   3. Parity evidence:
--        sa_compat_parity_report()  analytic: for every active business
--          identity and catalog permission, the legacy role definition
--          (compatibility rule) vs the S&A decision in the identity's own
--          organization. Detects lifecycle/backfill gaps before cutover.
--        sa_shadow_parity_summary()  observed: comparison counts from
--          sa_authorization_decisions per permission.
--   4. Legacy authorization stores become read-only once
--      sa_settings 'legacy_authorization.read_only' is true (set by the
--      staging cutover; production decides at promotion): roles.permissions /
--      role_level, departments.permission_overrides, HR access groups and the
--      HR permission catalogue. The database owner (migrations) is exempt.
--
-- No migration mode is changed here; the read-only switch starts false.
--
-- Rollback guidance
--   drop the triggers sa_legacy_store_read_only on roles, departments,
--   hr_access_groups, hr_access_group_members, hr_access_group_permissions,
--   hr_permissions; drop the functions and sa_enforcement_readiness.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enforcement readiness registry
-- ---------------------------------------------------------------------------
create table if not exists public.sa_enforcement_readiness (
  permission_key text primary key references public.sa_permissions(permission_key) on update cascade,
  route_wiring boolean not null,
  database_backstop text not null check (database_backstop in ('rpc_guard','rls_gate','transition_guard','decision_backstop','governance_function','read_only')),
  intentional_tightening text,
  notes text not null,
  registered_at timestamptz not null default now()
);
alter table public.sa_enforcement_readiness enable row level security;
alter table public.sa_enforcement_readiness force row level security;
revoke all on table public.sa_enforcement_readiness from public, anon, authenticated, service_role;
grant select on table public.sa_enforcement_readiness to service_role;
comment on table public.sa_enforcement_readiness is
  'Operations whose every reachable path enforces the S&A decision (route + database backstop). Only these may be NEW_ENFORCED/LEGACY_RETIRED. intentional_tightening documents expected LEGACY_ALLOW_NEW_DENY differences.';

insert into public.sa_enforcement_readiness(permission_key, route_wiring, database_backstop, intentional_tightening, notes) values
 ('inventory.stock_count.verify', true, 'decision_backstop', null, 'Wave 1 pilot: verification request/verify routes + recent-ALLOW trigger.'),
 -- Security & Access administration (governance functions re-verify the actor)
 ('security.access.view', true, 'read_only', null, 'Overview/simulator/audit read routes.'),
 ('security.role.assign', true, 'governance_function', null, 'sa_assign_role / sa_revoke_assignment re-check the actor.'),
 ('security.permission.manage', true, 'governance_function', null, 'sa_set_migration_mode re-checks the actor.'),
 ('security.role.manage', true, 'governance_function', null, 'sa_save_business_role via roles route.'),
 ('security.scope.manage', true, 'governance_function', null, 'sa_define_scope re-checks the actor.'),
 ('security.policy.manage', true, 'governance_function', null, 'SoD mitigation / authority policy functions.'),
 ('security.audit.view', true, 'read_only', null, 'Decision and access-change log routes.'),
 ('security.access_request.approve', true, 'governance_function', null, 'sa_decide_access_request re-checks the actor and forbids self-approval.'),
 ('security.access_review.manage', true, 'governance_function', null, 'Access review functions re-check the actor and forbid self-certification.'),
 ('security.delegation.manage', true, 'governance_function', null, 'sa_create_delegation/sa_revoke_delegation.'),
 ('security.service_identity.manage', true, 'read_only', null, 'Service identity registry is read-only in the UI.'),
 -- Finance
 ('finance.module.view', true, 'rls_gate', null, 'Finance pages and status route.'),
 ('finance.ledger.view', true, 'rls_gate', 'Company members above role level 40 lose direct GL table reads (never exposed in the UI).', 'Journals, journal lines, pending postings, document GL status.'),
 ('finance.report.view_sensitive', true, 'rls_gate', null, 'Trial balance, P&L, balance sheet, GL detail, cashflow.'),
 ('finance.receivable.view', true, 'rls_gate', null, 'AR routes read documents under their RLS; route gate is authoritative.'),
 ('finance.payable.view', true, 'rls_gate', null, 'AP routes.'),
 ('finance.cash.view', true, 'rls_gate', null, 'Bank accounts and reconciliation reads.'),
 ('finance.reconciliation.perform', true, 'rls_gate', 'Every company member could previously write bank accounts/reconciliations; restricted to role level <= 20 compatibility holders.', 'Bank accounts and reconciliation writes.'),
 ('finance.journal.post', true, 'rpc_guard', null, 'post_document_to_gl + GL write policies.'),
 ('finance.account.manage', true, 'rls_gate', null, 'Chart of accounts.'),
 ('finance.settings.manage', true, 'rls_gate', 'Power users previously passed the route check for exchange rates; now aligned with the HQ-admin table policies.', 'Settings, posting rules, currencies, fiscal years/periods.'),
 ('finance.data.reset', true, 'rls_gate', null, 'Accounting reset route (environment-gated destructive guard also applies).'),
 ('finance.payment.approve', true, 'rpc_guard', null, 'approve_payment_request + PAYMENT_REQUEST transition guard.'),
 ('finance.payroll_integration.manage', true, 'rls_gate', null, 'HR GL mappings/control accounts + seed RPCs.'),
 -- HR / Payroll
 ('hr.module.view', true, 'rls_gate', null, 'HR pages.'),
 ('hr.employee.view', true, 'rls_gate', null, 'Employee directory route.'),
 ('hr.employee.manage', true, 'rls_gate', null, 'Employees, positions, profile/document requests.'),
 ('hr.attendance.manage', true, 'rls_gate', null, 'Attendance, shifts, timesheets, overtime.'),
 ('hr.leave.approve', true, 'rls_gate', null, 'Leave tables (browser repository) gated in RLS.'),
 ('hr.payroll.view', true, 'rls_gate', 'Payroll run headers were readable by every organization member; restricted to payroll viewers.', 'Payroll runs/items/audit.'),
 ('hr.payroll.prepare', true, 'transition_guard', null, 'Payroll run create/calculate.'),
 ('hr.payroll.approve', true, 'transition_guard', null, 'Payroll approval route + status transition guard.'),
 ('hr.payroll.release', true, 'rpc_guard', null, 'Payroll GL post/reverse RPCs.'),
 ('hr.compensation.view', true, 'rls_gate', null, 'Compensation, allowances, deductions (own record preserved).'),
 ('hr.compensation.manage', true, 'rls_gate', null, 'Compensation administration.'),
 ('hr.contract.view', true, 'rls_gate', null, 'Contracts (own record preserved).'),
 ('hr.contract.manage', true, 'rls_gate', null, 'Contracts administration.'),
 ('hr.benefits.manage', true, 'rls_gate', null, 'Benefits.'),
 ('hr.learning.manage', true, 'rls_gate', null, 'Learning.'),
 ('hr.onboarding.manage', true, 'rls_gate', null, 'Onboarding.'),
 ('hr.recruitment.manage', true, 'rls_gate', null, 'Recruitment.'),
 ('hr.policy.manage', true, 'rls_gate', null, 'HR policies.'),
 ('hr.performance.manage', true, 'rls_gate', null, 'Performance and KPI administration.'),
 ('hr.expense.manage', true, 'rls_gate', null, 'Time & expense.'),
 ('hr.analytics.view', true, 'rls_gate', null, 'HR analytics.'),
 ('hr.settings.manage', true, 'rls_gate', null, 'HR settings, holidays, approval chains.'),
 ('hr.ai.use', true, 'read_only', null, 'HR AI assistant routes (server-side only).'),
 ('hr.self_service.use', true, 'rls_gate', null, 'Employee self-service (own record).'),
 -- Supply Chain
 ('supply_chain.order.create', true, 'transition_guard', null, 'Order insert/submit guard + D2H submit RPC.'),
 ('supply_chain.order.approve', true, 'rpc_guard', null, 'orders_approve (+ maker/checker) and approval transition guard.'),
 ('supply_chain.order.cancel', true, 'transition_guard', null, 'Order cancellation transition guard.'),
 ('supply_chain.document.acknowledge', true, 'rpc_guard', null, 'PO/invoice/payment acknowledge RPCs + document transition guard.'),
 ('supply_chain.document.manage', true, 'read_only', null, 'Document generation/upload routes (server-side).'),
 ('inventory.transfer.request', true, 'rpc_guard', null, 'Transfer draft/submit RPCs; table writes are workflow-only.'),
 ('inventory.transfer.approve', true, 'rpc_guard', null, 'Transfer approve/reject RPCs.'),
 ('inventory.transfer.cancel', true, 'rpc_guard', null, 'Transfer cancel RPC.'),
 ('inventory.transfer.dispatch', true, 'rpc_guard', null, 'Transfer dispatch RPC.'),
 ('inventory.transfer.receive', true, 'rpc_guard', null, 'Transfer receive RPC.'),
 ('inventory.adjustment.post', true, 'rpc_guard', null, 'Manual stock addition/reversal RPCs + inventory quantity guard.'),
 ('inventory.opening_balance.manage', true, 'rpc_guard', null, 'Opening balance cut-off RPCs + routes.'),
 ('inventory.stock_config.manage', true, 'rpc_guard', null, 'Stock configuration RPCs + routes.'),
 ('inventory.return.manage', true, 'rpc_guard', null, 'Return routes (server) + return inventory RPC; tables workflow-only.'),
 ('inventory.return.request', true, 'read_only', null, 'Shop return requests (server routes; return tables are workflow-only for API roles).'),
 ('warehouse.receipt.post', true, 'rpc_guard', null, 'post_warehouse_receipt + receiving routes.'),
 ('warehouse.shipment.manage', true, 'rpc_guard', null, 'Shipment RPCs + shipment routes + order shipped transition.'),
 ('qr.batch.manage', true, 'rpc_guard', null, 'QR batch routes + mark printed RPC.'),
 ('product.catalog.manage', true, 'rpc_guard', null, 'Variant archive RPC + product routes.'),
 ('manufacturing.adjustment.manage', true, 'rpc_guard', null, 'Manufacturer adjustments.'),
 -- Customer & Growth / E-Commerce / RoadTour
 ('customer.loyalty.adjust', true, 'rpc_guard', null, 'Ellbow points adjustment RPC + manual points guard.'),
 ('customer.redemption.manage', true, 'rpc_guard', null, 'Redemption status RPC + points update guard.'),
 ('customer.program.manage', true, 'rpc_guard', null, 'Loyalty programme membership RPCs.'),
 ('customer.shop.manage', true, 'rpc_guard', null, 'Referral/reference RPCs + shop request routes.'),
 ('customer.reward.manage', true, 'read_only', null, 'Reward catalogue routes (server-side).'),
 ('roadtour.kpi.manage', true, 'read_only', null, 'RoadTour KPI routes (server-side).'),
 ('roadtour.report.view', true, 'read_only', null, 'RoadTour reports (server-side).'),
 ('ecommerce.store.manage', true, 'read_only', null, 'Storefront admin routes (server-side).'),
 ('ecommerce.order.manage', true, 'read_only', null, 'Storefront order admin routes (server-side).')
on conflict (permission_key) do update set route_wiring = excluded.route_wiring, database_backstop = excluded.database_backstop,
  intentional_tightening = excluded.intentional_tightening, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- 2. Mode changes
-- ---------------------------------------------------------------------------
create or replace function public.sa_set_migration_mode(p_actor uuid, p_permission text, p_mode text, p_reason text)
returns text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_current text;
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
begin
  if p_mode not in ('LEGACY_ENFORCED','SHADOW','NEW_ENFORCED','LEGACY_RETIRED') then raise exception 'sa_mode_invalid'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'sa_reason_required'; end if;
  -- A human actor is required for every API-originated change; only a direct
  -- database-owner session (reviewed cutover SQL) may act as 'system'.
  if p_actor is null and v_role is not null then raise exception 'sa_actor_required' using errcode = '42501'; end if;
  if p_actor is not null then
    perform public.sa_assert_actor_permission(p_actor, 'security.permission.manage', '{}'::jsonb, public.sa_legacy_is_super_admin(p_actor));
  end if;
  select mode into v_current from public.sa_migration_modes where permission_key = p_permission for update;
  if not found then raise exception 'sa_permission_unknown: %', p_permission; end if;
  if p_mode in ('NEW_ENFORCED','LEGACY_RETIRED')
     and not exists (select 1 from public.sa_enforcement_readiness where permission_key = p_permission) then
    raise exception 'sa_not_enforcement_ready: %', p_permission using hint = 'Every mutation path must be wired before enforcement.';
  end if;
  if p_mode = 'LEGACY_RETIRED' and v_current not in ('NEW_ENFORCED','LEGACY_RETIRED') then
    raise exception 'sa_retire_requires_new_enforced: %', p_permission;
  end if;
  if v_current = p_mode then return v_current; end if;
  update public.sa_migration_modes set mode = p_mode, updated_at = now(), updated_by = p_actor,
    notes = left(btrim(p_reason), 500)
  where permission_key = p_permission;
  perform public.sa_log_access_change(p_actor, 'migration_mode.changed', null, 'sa_migration_mode', p_permission,
    jsonb_build_object('from', v_current, 'to', p_mode), p_reason, case when p_actor is null then 'system' else 'user' end);
  return p_mode;
end $$;
revoke all on function public.sa_set_migration_mode(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.sa_set_migration_mode(uuid,text,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Parity evidence
-- ---------------------------------------------------------------------------
create or replace function public.sa_compat_parity_report(p_permission text default null)
returns table(permission_key text, user_id uuid, role_code text, organization_id uuid, legacy_allows boolean, new_allows boolean, classification text)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  with ids as (
    select u.id, u.role_code, u.organization_id, r.role_level,
      coalesce((select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(r.permissions)='object' then r.permissions else '{}'::jsonb end) k
                where coalesce((r.permissions->>k)::boolean, false)), array[]::text[]) as legacy_perms
    from public.users u left join public.roles r on r.role_code = u.role_code
    where u.account_scope = 'portal' and u.organization_id is not null and u.is_active is true and u.employment_status = 'active'
  ), rules as (
    select c.* from public.sa_legacy_compat_rules c
    where (p_permission is null or c.permission_key = p_permission)
      and c.permission_key not in ('hr.self_service.use')
  ), eval as (
    select c.permission_key, i.id as user_id, i.role_code, i.organization_id,
      (i.role_level = 1 or (c.max_role_level is not null and i.role_level <= c.max_role_level)
        or upper(i.role_code) = any(c.role_codes) or i.legacy_perms && c.legacy_permissions) as legacy_allows,
      public.sa_actor_has_permission(i.id, c.permission_key,
        jsonb_build_object('organization_id', i.organization_id,
          'warehouse_id', case when (select o.org_type_code from public.organizations o where o.id = i.organization_id) = 'WH' then i.organization_id end)) as new_allows
    from ids i cross join rules c
  )
  select e.permission_key, e.user_id, e.role_code, e.organization_id, e.legacy_allows, e.new_allows,
    case when e.legacy_allows = e.new_allows then 'MATCH'
         when e.legacy_allows then 'LEGACY_ALLOW_NEW_DENY'
         else 'LEGACY_DENY_NEW_ALLOW' end
  from eval e
$$;
revoke all on function public.sa_compat_parity_report(text) from public, anon, authenticated;
grant execute on function public.sa_compat_parity_report(text) to service_role;
comment on function public.sa_compat_parity_report(text) is
  'Analytic correct-context parity: legacy role definition vs S&A decision for every active business identity in its own organization. LEGACY_DENY_NEW_ALLOW means an explicit S&A grant beyond legacy (manual/request/template role) and is reviewed, not an error.';

create or replace function public.sa_shadow_parity_summary(p_since interval default interval '30 days')
returns table(permission_key text, migration_mode text, total bigint, match_allow bigint, match_deny bigint,
              legacy_allow_new_deny bigint, legacy_deny_new_allow bigint, other_mismatch bigint, last_seen timestamptz)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select d.permission_key, max(d.migration_mode), count(*),
    count(*) filter (where d.comparison = 'MATCH_ALLOW'),
    count(*) filter (where d.comparison = 'MATCH_DENY'),
    count(*) filter (where d.comparison = 'LEGACY_ALLOW_NEW_DENY'),
    count(*) filter (where d.comparison = 'LEGACY_DENY_NEW_ALLOW'),
    count(*) filter (where d.comparison not in ('MATCH_ALLOW','MATCH_DENY','LEGACY_ALLOW_NEW_DENY','LEGACY_DENY_NEW_ALLOW')),
    max(d.occurred_at)
  from public.sa_authorization_decisions d
  where d.occurred_at >= now() - p_since
  group by d.permission_key
$$;
revoke all on function public.sa_shadow_parity_summary(interval) from public, anon, authenticated;
grant execute on function public.sa_shadow_parity_summary(interval) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Legacy authorization stores → read-only (switch)
-- ---------------------------------------------------------------------------
insert into public.sa_settings(setting_key, setting_value, description) values
 ('legacy_authorization.read_only', 'false'::jsonb,
  'When true, legacy authorization stores (roles.permissions/role_level, departments.permission_overrides, HR access groups, HR permission catalogue) are read-only; Security & Access is the only writable authorization source.')
on conflict (setting_key) do nothing;

create or replace function public.sa_legacy_authorization_read_only()
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select public.sa_setting_bool('legacy_authorization.read_only', false)
$$;
revoke all on function public.sa_legacy_authorization_read_only() from public, anon;
grant execute on function public.sa_legacy_authorization_read_only() to authenticated, service_role;

create or replace function public.sa_legacy_store_read_only_guard()
returns trigger language plpgsql
-- SECURITY INVOKER: current_user identifies API/server callers.
set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('anon','authenticated','service_role') then return coalesce(new, old); end if;
  if not public.sa_legacy_authorization_read_only() then return coalesce(new, old); end if;
  if tg_table_name = 'roles' then
    if tg_op = 'UPDATE' and new.permissions is not distinct from old.permissions
       and new.role_level is not distinct from old.role_level and new.role_code is not distinct from old.role_code then
      return new;
    end if;
  elsif tg_table_name = 'departments' then
    if tg_op = 'DELETE' then return old; end if;
    -- Structure edits stay in HR; only permission overrides are frozen. An
    -- override may still be cleared.
    if new.permission_overrides is not distinct from coalesce(old.permission_overrides, new.permission_overrides)
       or new.permission_overrides = '{"allow": [], "deny": []}'::jsonb then
      return new;
    end if;
  end if;
  raise exception 'legacy_authorization_store_read_only'
    using errcode = '42501', hint = 'Authorization is administered in Security & Access.';
end $$;
revoke all on function public.sa_legacy_store_read_only_guard() from public, anon;
grant execute on function public.sa_legacy_store_read_only_guard() to authenticated, service_role;

do $legacy_stores$
declare t text;
begin
  foreach t in array array['roles','departments','hr_access_groups','hr_access_group_members','hr_access_group_permissions','hr_permissions'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists sa_legacy_store_read_only on public.%I', t);
    if t = 'departments' then
      execute format('create trigger sa_legacy_store_read_only before insert or update of permission_overrides on public.%I
                      for each row execute function public.sa_legacy_store_read_only_guard()', t);
    else
      execute format('create trigger sa_legacy_store_read_only before insert or update or delete on public.%I
                      for each row execute function public.sa_legacy_store_read_only_guard()', t);
    end if;
  end loop;
end
$legacy_stores$;

-- The lifecycle (owner) derives compatibility grants from roles; while the
-- store is writable a role edit refreshes its compatibility role (additive).
create or replace function public.sa_roles_compat_refresh()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform public.sa_refresh_compat_role(new.role_code, false);
  return new;
end $$;
revoke all on function public.sa_roles_compat_refresh() from public, anon, authenticated;
drop trigger if exists sa_roles_compat_refresh on public.roles;
create trigger sa_roles_compat_refresh after update of permissions, role_level on public.roles
for each row execute function public.sa_roles_compat_refresh();

-- ---------------------------------------------------------------------------
-- 5. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare v_gap integer;
begin
  if exists (select 1 from public.sa_enforcement_readiness r
             where not exists (select 1 from public.sa_permissions p where p.permission_key = r.permission_key)) then
    raise exception 'postcondition: readiness references unknown permissions';
  end if;
  if public.sa_legacy_authorization_read_only() then
    raise notice 'legacy authorization stores are already read-only in this environment';
  end if;
  -- Lifecycle/backfill completeness: no active business identity may lack an
  -- S&A grant that its legacy role definition gives it.
  select count(*) into v_gap from public.sa_compat_parity_report(null) where classification = 'LEGACY_ALLOW_NEW_DENY';
  if v_gap > 0 then
    raise exception 'postcondition: % legacy grants are not represented in S&A (see sa_compat_parity_report)', v_gap;
  end if;
  if has_function_privilege('authenticated', 'public.sa_set_migration_mode(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'postcondition: mode changes must be service-only';
  end if;
end $$;
