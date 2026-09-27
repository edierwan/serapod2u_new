-- ============================================================================
-- Security & Access Final Wave — A. Authority & governance foundation
-- ----------------------------------------------------------------------------
-- Purpose (additive; no Wave 1 migration is edited)
--   1. Enterprise permission catalog for Finance, Payroll, HR, remaining Supply
--      Chain, RoadTour, Customer & Growth, E-Commerce, Platform and Security
--      administration (source: app/src/lib/security-access/catalog.ts).
--      Every new permission starts in SHADOW: legacy still decides, the new
--      model is evaluated and logged. No mode is changed for an existing key.
--   2. Compatibility rules (sa_legacy_compat_rules) that describe which legacy
--      role definitions reproduce today's access, plus sa_refresh_compat_role()
--      which materialises them into the legacy-<role_code> compatibility roles.
--      These grants are explicit, visible S&A rows — not implicit role_level.
--   3. Database evaluator sa_evaluate_permission(): the canonical new-model
--      decision (active account → active membership → active assignment →
--      active role/permission → typed scope, org hierarchy aware), with
--      non-transitive scoped delegation that can never exceed the delegator.
--   4. Mode-aware database gates:
--        sa_rls_gate()           for RLS policy expressions
--        sa_require_operation()  for SECURITY DEFINER workflow RPCs
--      Both are no-ops in LEGACY_ENFORCED/SHADOW (the existing legacy checks
--      decide) and deny unless S&A allows in NEW_ENFORCED/LEGACY_RETIRED. A
--      new-model DENY never falls back to a legacy ALLOW.
--   5. Governance: authority policies, segregation of duties (rules,
--      mitigations, violations), delegations, access requests, access reviews,
--      emergency access (disabled: MFA step-up prerequisite not available),
--      service identities (metadata only, never secret values), and an
--      append-only access change log.
--   6. Service-only governance mutation functions that re-verify the acting
--      administrator's authority and the invariants (no self-assignment, no
--      self-approval, no self-certification, delegation ⊆ delegator) inside
--      the database, independent of the application.
--
-- Grants: every new table is RLS-enabled + forced with no anon/authenticated
-- privileges (service_role only). Gate/evaluator functions are EXECUTE-able by
-- authenticated only where RLS/RPC evaluation needs them.
--
-- Rollback guidance (as the migration owner, one transaction; only after every
-- Final Wave permission is back in LEGACY_ENFORCED/SHADOW and migrations B–D
-- are rolled back):
--   drop function if exists public.sa_* functions created below (see list in
--     the post-condition block), drop tables sa_access_review_items,
--     sa_access_review_campaigns, sa_access_requests, sa_delegations,
--     sa_sod_violations, sa_sod_mitigations, sa_sod_rules,
--     sa_authority_policies, sa_emergency_access_grants,
--     sa_service_identities, sa_access_change_log, sa_settings,
--     sa_legacy_compat_rules;
--   delete from sa_business_role_permissions/sa_migration_modes/sa_permissions
--     where permission_key in (catalog keys below) — only if no decision rows
--     reference them (decisions are append-only; otherwise leave them
--     'deprecated');
--   alter table sa_role_assignments drop column source; restore the Wave 1
--     status check; alter table sa_organization_memberships drop column
--     source, drop column ended_reason.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Wave 1 table extensions (additive)
-- ---------------------------------------------------------------------------
alter table public.sa_role_assignments
  add column if not exists source text not null default 'manual';
alter table public.sa_role_assignments
  add column if not exists ended_reason text;
alter table public.sa_organization_memberships
  add column if not exists source text not null default 'manual';
alter table public.sa_organization_memberships
  add column if not exists ended_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sa_role_assignments_source_valid') then
    alter table public.sa_role_assignments add constraint sa_role_assignments_source_valid
      check (source in ('backfill','derived','manual','access_request'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sa_memberships_source_valid') then
    alter table public.sa_organization_memberships add constraint sa_memberships_source_valid
      check (source in ('backfill','derived','manual'));
  end if;
end $$;

-- Wave 1 rows were created by the guarded compatibility backfill.
update public.sa_role_assignments set source = 'backfill'
 where source = 'manual' and assignment_reason = 'Wave 1 guarded legacy compatibility backfill';
update public.sa_organization_memberships set source = 'backfill'
 where source = 'manual' and membership_type = 'legacy_portal' and created_by is null;

comment on column public.sa_role_assignments.source is
  'backfill/derived: managed by the HR/User Management lifecycle sync (joiner/mover/leaver). manual/access_request: granted through S&A administration.';

create index if not exists sa_role_assignments_role_idx on public.sa_role_assignments(role_id, status);
create index if not exists sa_role_assignments_membership_idx on public.sa_role_assignments(membership_id);
create index if not exists sa_memberships_user_status_idx on public.sa_organization_memberships(user_id, status);

-- ---------------------------------------------------------------------------
-- 1. Settings, compatibility rules, access change log
-- ---------------------------------------------------------------------------
create table if not exists public.sa_settings (
  setting_key text primary key check (setting_key ~ '^[a-z][a-z0-9_.]*$'),
  setting_value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);
comment on table public.sa_settings is 'S&A governance configuration. Values are policy parameters, never credentials.';

insert into public.sa_settings(setting_key, setting_value, description) values
 ('lifecycle.sync_enabled', 'true'::jsonb, 'Joiner/Mover/Leaver synchronisation from users employment facts.'),
 ('lifecycle.contractor_default_expiry_days', '90'::jsonb, 'Mandatory expiry for Contract/Intern derived access when no contract expiry date is recorded.'),
 ('access_request.max_temporary_days', '90'::jsonb, 'Maximum length of a temporary access request.'),
 ('access_request.pending_expiry_days', '30'::jsonb, 'Unanswered access requests expire after this many days.'),
 ('delegation.max_days', '90'::jsonb, 'Maximum length of a delegation.'),
 ('emergency_access.enabled', 'false'::jsonb, 'Break-glass access. Cannot be enabled while the MFA step-up prerequisite is unmet.'),
 ('emergency_access.mfa_step_up_available', 'false'::jsonb, 'Set only by a reviewed migration once Supabase MFA (AAL2) is enrolled for administrators and enforced by the application.'),
 ('emergency_access.max_minutes', '240'::jsonb, 'Maximum emergency access window.')
on conflict (setting_key) do nothing;

create table if not exists public.sa_legacy_compat_rules (
  permission_key text primary key references public.sa_permissions(permission_key) on update cascade on delete cascade,
  max_role_level integer,
  role_codes text[] not null default '{}',
  legacy_permissions text[] not null default '{}',
  employee_baseline boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);
comment on table public.sa_legacy_compat_rules is
  'Describes which legacy role definitions reproduce current access for a permission. Used only to materialise explicit grants on legacy-<role_code> compatibility roles; never consulted at authorization time.';

create table if not exists public.sa_access_change_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user','system','service')),
  action text not null check (action ~ '^[a-z][a-z0-9_.]*$'),
  target_user_id uuid references public.users(id) on delete set null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  reason text,
  correlation_id text
);
create index if not exists sa_access_change_log_time_idx on public.sa_access_change_log(occurred_at desc);
create index if not exists sa_access_change_log_target_idx on public.sa_access_change_log(target_user_id, occurred_at desc);
comment on table public.sa_access_change_log is
  'Append-only record of every access change (assignments, memberships, requests, delegations, reviews, lifecycle sync, privileged actions). Never contains secrets.';

create or replace function public.sa_reject_append_only_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception '%_is_append_only', tg_table_name;
end $$;
revoke all on function public.sa_reject_append_only_mutation() from public, anon, authenticated;

drop trigger if exists sa_access_change_log_append_only on public.sa_access_change_log;
create trigger sa_access_change_log_append_only before update or delete on public.sa_access_change_log
for each row execute function public.sa_reject_append_only_mutation();
drop trigger if exists sa_access_change_log_no_truncate on public.sa_access_change_log;
create trigger sa_access_change_log_no_truncate before truncate on public.sa_access_change_log
for each statement execute function public.sa_reject_append_only_mutation();

create or replace function public.sa_log_access_change(
  p_actor uuid, p_action text, p_target uuid, p_entity_type text, p_entity_id text,
  p_details jsonb default '{}'::jsonb, p_reason text default null, p_actor_kind text default 'user')
returns void language sql security definer set search_path = pg_catalog, pg_temp as $$
  insert into public.sa_access_change_log(actor_id, actor_kind, action, target_user_id, entity_type, entity_id, details, reason)
  values (p_actor, coalesce(p_actor_kind, 'user'), p_action, p_target, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb), p_reason)
$$;
revoke all on function public.sa_log_access_change(uuid,text,uuid,text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.sa_log_access_change(uuid,text,uuid,text,text,jsonb,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Permission catalog (Final Wave) + compatibility rules + modes
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.sa_final_catalog;
create temporary table sa_final_catalog (
  permission_key text primary key, module text, resource text, action text, description text,
  sensitivity text, max_role_level integer, role_codes text[], legacy_permissions text[], employee_baseline boolean
);

insert into sa_final_catalog values
 ('security.role.manage','security','role','manage','Create and edit new-model business roles and their permissions','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.scope.manage','security','scope','manage','Create and retire typed scope definitions','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.policy.manage','security','policy','manage','Manage authority policies, segregation-of-duties rules and mitigations','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.audit.view','security','audit','view','View authorization decisions, access changes and privileged actions','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.access_request.approve','security','access_request','approve','Approve or deny access requests in an authorized scope','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.access_review.manage','security','access_review','manage','Run access review campaigns and certify assignments','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.delegation.manage','security','delegation','manage','Create or revoke delegations on behalf of other users','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.service_identity.manage','security','service_identity','manage','Register and manage non-human service identities (never secret values)','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('security.emergency_access.grant','security','emergency_access','grant','Grant time-boxed emergency access (requires MFA step-up)','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('finance.module.view','finance','module','view','Open the Finance module and its status overview','security_sensitive',40,'{}'::text[],array['view_settings']::text[],false),
 ('finance.ledger.view','finance','ledger','view','View GL journals, journal detail, pending postings and document GL status','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('finance.report.view_sensitive','finance','report','view_sensitive','View trial balance, profit & loss, balance sheet, GL detail and cashflow','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('finance.receivable.view','finance','receivable','view','View AR invoices, receipts and receivable aging','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('finance.payable.view','finance','payable','view','View AP bills, supplier payments and payable aging','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('finance.cash.view','finance','cash','view','View bank accounts and reconciliation status','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('finance.reconciliation.perform','finance','reconciliation','perform','Maintain bank accounts and perform bank reconciliation','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('finance.journal.post','finance','journal','post','Post a supported business document to the General Ledger','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('finance.account.manage','finance','account','manage','Manage the chart of accounts','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('finance.settings.manage','finance','settings','manage','Manage accounting settings, posting rules, currencies and fiscal periods','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('finance.data.reset','finance','data','reset','Reset accounting data for an organization (destructive)','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('finance.payment.approve','finance','payment','approve','Approve a supplier balance payment request','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('finance.payroll_integration.manage','finance','payroll_integration','manage','Manage payroll/benefit GL mappings and control accounts','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.module.view','hr','module','view','Open the HR module','ordinary',20,array['HR_MANAGER']::text[],array['view_users','view_settings','manage_org_chart','edit_org_settings']::text[],false),
 ('hr.employee.view','hr','employee','view','View the employee directory of an organization','ordinary',20,array['HR_MANAGER']::text[],array['view_users','view_settings','manage_org_chart','edit_org_settings']::text[],false),
 ('hr.employee.manage','hr','employee','manage','Create and maintain employee master data and positions','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.attendance.manage','hr','attendance','manage','Manage attendance policy, shifts, corrections, overtime and timesheets','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.leave.approve','hr','leave','approve','Approve or reject leave requests and manage leave configuration','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.payroll.view','hr','payroll','view','View payroll runs and payroll line items','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.payroll.prepare','hr','payroll','prepare','Create and calculate payroll runs','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.payroll.approve','hr','payroll','approve','Approve a calculated payroll run','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.payroll.release','hr','payroll','release','Post an approved payroll run to the General Ledger or reverse it','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('hr.compensation.view','hr','compensation','view','View employee compensation, allowances and deductions','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.compensation.manage','hr','compensation','manage','Manage compensation, salary bands, allowances, deductions and statutory settings','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.contract.view','hr','contract','view','View employment contracts','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.contract.manage','hr','contract','manage','Manage employment contracts','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.benefits.manage','hr','benefits','manage','Manage benefit plans, providers, enrollments and contribution runs','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.learning.manage','hr','learning','manage','Manage courses, enrollments and certifications','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.onboarding.manage','hr','onboarding','manage','Manage onboarding templates, instances and tasks','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.recruitment.manage','hr','recruitment','manage','Manage job postings, applicants, interviews and offers','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.policy.manage','hr','policy','manage','Manage HR policies and acknowledgements','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.performance.manage','hr','performance','manage','Manage appraisals, performance reviews, templates and KPI programmes','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.expense.manage','hr','expense','manage','Manage timesheet entries and expense claims','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.analytics.view','hr','analytics','view','View HR analytics, snapshots and the HR AI audit','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.settings.manage','hr','settings','manage','Manage HR configuration, public holidays and HR setup','ordinary',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.ai.use','hr','ai','use','Use the HR AI assistant and its actions','security_sensitive',20,array['HR_MANAGER']::text[],array['manage_org_chart','edit_org_settings']::text[],false),
 ('hr.self_service.use','hr','self_service','use','Use employee self-service for the employee''s own record','security_sensitive',null,'{}'::text[],'{}'::text[],true),
 ('supply_chain.order.create','supply_chain','order','create','Create and submit orders','ordinary',40,'{}'::text[],array['create_orders']::text[],false),
 ('supply_chain.order.approve','supply_chain','order','approve','Approve a submitted order','security_sensitive',30,'{}'::text[],array['approve_orders']::text[],false),
 ('supply_chain.order.cancel','supply_chain','order','cancel','Cancel an order before fulfilment','security_sensitive',40,'{}'::text[],array['create_orders','cancel_orders']::text[],false),
 ('supply_chain.document.acknowledge','supply_chain','document','acknowledge','Acknowledge PO, invoice and payment documents','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('supply_chain.document.manage','supply_chain','document','manage','Generate and upload supply chain documents','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('inventory.transfer.cancel','inventory','transfer','cancel','Cancel a stock transfer before dispatch','ordinary',50,'{}'::text[],'{}'::text[],false),
 ('inventory.adjustment.post','inventory','adjustment','post','Post manual stock additions, adjustments and reversals','security_sensitive',30,'{}'::text[],array['adjust_stock','manage_inventory']::text[],false),
 ('inventory.opening_balance.manage','inventory','opening_balance','manage','Run inventory opening balance and classification cut-offs','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('inventory.stock_config.manage','inventory','stock_config','manage','Manage variant stock configurations','ordinary',10,'{}'::text[],'{}'::text[],false),
 ('inventory.return.manage','inventory','return','manage','Create, update and receive return cases','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('inventory.report.view','inventory','report','view','View inventory movements and stock reports','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('warehouse.receipt.post','warehouse','receipt','post','Receive goods into a warehouse','ordinary',40,'{}'::text[],array['receive_goods','manage_inventory']::text[],false),
 ('warehouse.shipment.manage','warehouse','shipment','manage','Start, scan, confirm, complete and cancel warehouse shipments','ordinary',40,'{}'::text[],array['ship_goods','manage_inventory']::text[],false),
 ('manufacturing.production.manage','manufacturing','production','manage','Pack, link and complete production batches','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('manufacturing.adjustment.manage','manufacturing','adjustment','manage','Manage manufacturer quality adjustments','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('manufacturing.scan.reverse','manufacturing','scan','reverse','Reverse or delete production scan history','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('qr.batch.manage','qr','batch','manage','Generate, process and download QR batches','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('product.catalog.manage','product','catalog','manage','Manage products, variants and product documents','ordinary',10,'{}'::text[],'{}'::text[],false),
 ('roadtour.campaign.manage','roadtour','campaign','manage','Manage RoadTour events, settings and QR distribution','ordinary',30,'{}'::text[],'{}'::text[],false),
 ('roadtour.kpi.manage','roadtour','kpi','manage','Manage RoadTour KPI plans, cycles, teams and rules','ordinary',20,'{}'::text[],'{}'::text[],false),
 ('roadtour.report.view','roadtour','report','view','View RoadTour KPI and performance reports','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('roadtour.visit.manage','roadtour','visit','manage','Manage RoadTour visits and participants','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('customer.loyalty.adjust','customer','loyalty','adjust','Manually adjust consumer or shop point balances','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('customer.reward.manage','customer','reward','manage','Manage reward catalogue, categories and loyalty settings','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('customer.redemption.manage','customer','redemption','manage','Review and update reward redemptions','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('customer.program.manage','customer','program','manage','Manage loyalty programme memberships and mappings','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('customer.consumer.view','customer','consumer','view','Look up consumers and consumer activity for support','security_sensitive',40,'{}'::text[],'{}'::text[],false),
 ('customer.shop.manage','customer','shop','manage','Approve shop requests and manage shop/reference mappings','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('customer.campaign.manage','customer','campaign','manage','Manage journeys, landing pages, games and marketing campaigns','ordinary',30,'{}'::text[],'{}'::text[],false),
 ('customer.support.manage','customer','support','manage','Handle support conversations and messaging administration','ordinary',40,'{}'::text[],'{}'::text[],false),
 ('ecommerce.store.manage','ecommerce','store','manage','Manage storefront configuration and banners','ordinary',20,'{}'::text[],'{}'::text[],false),
 ('ecommerce.order.manage','ecommerce','order','manage','Manage storefront orders and fulfilment','security_sensitive',20,'{}'::text[],'{}'::text[],false),
 ('ecommerce.channel.manage','ecommerce','channel','manage','Manage e-commerce channel connections (metadata only)','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('platform.settings.manage','platform','settings','manage','Manage platform integrations, notification providers and AI settings','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('platform.organization.manage','platform','organization','manage','Import, configure and remove organizations','security_sensitive',10,'{}'::text[],'{}'::text[],false),
 ('platform.user.manage','platform','user','manage','Administer user profiles, credentials resets and phone changes','security_sensitive',30,'{}'::text[],array['edit_users','create_users']::text[],false),
 ('platform.data.destructive','platform','data','destructive','Run destructive data maintenance (environment-gated)','security_sensitive',1,'{}'::text[],'{}'::text[],false),
 ('reporting.analytics.view','reporting','analytics','view','View cross-module business analytics','ordinary',40,'{}'::text[],'{}'::text[],false);

insert into public.sa_permissions(permission_key, module, resource, action, description, source, audit_sensitivity)
select permission_key, module, resource, action, description, 'new', sensitivity from sa_final_catalog
on conflict (permission_key) do nothing;

insert into public.sa_legacy_compat_rules(permission_key, max_role_level, role_codes, legacy_permissions, employee_baseline, notes)
select permission_key, max_role_level, role_codes, legacy_permissions, employee_baseline,
       'Final Wave compatibility mapping (app/src/lib/security-access/catalog.ts)'
from sa_final_catalog
on conflict (permission_key) do update set
  max_role_level = excluded.max_role_level, role_codes = excluded.role_codes,
  legacy_permissions = excluded.legacy_permissions, employee_baseline = excluded.employee_baseline,
  notes = excluded.notes, updated_at = now();

-- Wave 1 pilot and security keys, expressed in the same rule vocabulary so the
-- lifecycle can derive compatibility roles for new role codes consistently.
insert into public.sa_legacy_compat_rules(permission_key, max_role_level, role_codes, legacy_permissions, notes)
select v.permission_key, v.max_role_level, '{}'::text[], v.legacy_permissions, 'Wave 1 compatibility mapping'
from (values
  ('inventory.stock_count.view', 1, array['view_inventory']),
  ('inventory.stock_count.create', 1, array['adjust_stock']),
  ('inventory.stock_count.verify', 1, array['post_stock_count']),
  ('inventory.stock_count.post', 1, array['post_stock_count']),
  ('inventory.transfer.view', 1, array['view_inventory']),
  ('inventory.transfer.request', 1, array['adjust_stock']),
  ('inventory.transfer.approve', 1, array['adjust_stock']),
  ('inventory.transfer.dispatch', 1, array['ship_goods']),
  ('inventory.transfer.receive', 1, array['receive_goods']),
  ('security.access.view', 1, array['manage_authorization']),
  ('security.role.assign', 1, array['manage_authorization']),
  ('security.permission.manage', 1, array['manage_authorization'])
) as v(permission_key, max_role_level, legacy_permissions)
where exists (select 1 from public.sa_permissions p where p.permission_key = v.permission_key)
on conflict (permission_key) do nothing;

insert into public.sa_migration_modes(permission_key, mode, legacy_permission_key, notes)
select permission_key, 'SHADOW', null,
       'Final Wave: legacy decides while the new model is evaluated and logged. NEW_ENFORCED requires enforcement wiring and reviewed parity.'
from sa_final_catalog
on conflict (permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Organization hierarchy + scope + permission evaluation
-- ---------------------------------------------------------------------------
create or replace function public.sa_org_ancestry(p_org uuid)
returns uuid[] language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  with recursive up(id, parent_org_id, depth) as (
    select o.id, o.parent_org_id, 0 from public.organizations o where o.id = p_org
    union all
    select o.id, o.parent_org_id, up.depth + 1
    from public.organizations o join up on o.id = up.parent_org_id
    where up.depth < 10
  )
  select coalesce(array_agg(id order by depth), array[]::uuid[]) from up
$$;
revoke all on function public.sa_org_ancestry(uuid) from public, anon;
grant execute on function public.sa_org_ancestry(uuid) to authenticated, service_role;
comment on function public.sa_org_ancestry(uuid) is
  '[org, parent, grandparent, ...]. An organization-scoped membership/assignment on an ancestor covers descendant resources (mirrors public.can_access_org descendant rule).';

-- Returns true / false, or null when the resource context lacks the attribute
-- the scope needs (reported as MISSING_CONTEXT; never treated as a match).
create or replace function public.sa_scope_matches(
  p_actor uuid, p_scope_type text, p_scope_value text, p_context jsonb, p_ancestry uuid[])
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_owner uuid;
begin
  if p_scope_type = 'organization' then
    if coalesce(array_length(p_ancestry, 1), 0) = 0 then return null; end if;
    return p_scope_value = any(p_ancestry::text[]);
  elsif p_scope_type = 'warehouse' then
    if nullif(p_context->>'warehouse_id', '') is null then return null; end if;
    return p_scope_value = p_context->>'warehouse_id';
  elsif p_scope_type = 'department' then
    if nullif(p_context->>'department_id', '') is null then return null; end if;
    return p_scope_value = p_context->>'department_id';
  elsif p_scope_type = 'own_record' then
    if nullif(p_context->>'owner_user_id', '') is null then return null; end if;
    return p_context->>'owner_user_id' = p_actor::text;
  elsif p_scope_type = 'direct_reports' then
    if nullif(p_context->>'owner_user_id', '') is null then return null; end if;
    v_owner := (p_context->>'owner_user_id')::uuid;
    return exists (select 1 from public.users u where u.id = v_owner and u.manager_user_id = p_actor);
  else
    -- Generic typed scopes (territory, campaign, program, cost_center,
    -- document_type, ...) match an attribute of the same name supplied by the
    -- server from trusted resource data. No attribute → missing context.
    if nullif(p_context->'attributes'->>p_scope_type, '') is null then return null; end if;
    return p_scope_value = p_context->'attributes'->>p_scope_type;
  end if;
end $$;
revoke all on function public.sa_scope_matches(uuid,text,text,jsonb,uuid[]) from public, anon, authenticated;

-- Canonical new-model decision. p_context keys: organization_id, warehouse_id,
-- department_id, owner_user_id, attributes{}. The caller supplies context
-- resolved from trusted server/database data, never from the browser.
create or replace function public.sa_evaluate_permission(
  p_actor uuid, p_permission text, p_context jsonb default '{}'::jsonb, p_include_delegation boolean default true)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz := now();
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_org uuid;
  v_ancestry uuid[] := array[]::uuid[];
  v_active boolean;
  v_membership_ids uuid[];
  v_has_assignment boolean;
  v_matched jsonb := '[]'::jsonb;
  v_permitted jsonb := '[]'::jsonb;
  v_scopes jsonb := '[]'::jsonb;
  v_missing_context boolean := false;
  v_assignment_matched boolean;
  v_match boolean;
  r record;
  s record;
  d record;
begin
  if p_actor is null or p_permission is null then
    return jsonb_build_object('decision','DENY','reason_code','MISSING_CONTEXT','matched_assignments','[]'::jsonb,'resolved_scopes','[]'::jsonb);
  end if;
  select u.is_active into v_active from public.users u where u.id = p_actor;
  if v_active is not true then
    return jsonb_build_object('decision','DENY','reason_code','ACCOUNT_INACTIVE','matched_assignments','[]'::jsonb,'resolved_scopes','[]'::jsonb);
  end if;

  v_org := nullif(v_ctx->>'organization_id', '')::uuid;
  if v_org is not null then v_ancestry := public.sa_org_ancestry(v_org); end if;

  select coalesce(array_agg(m.id), array[]::uuid[]) into v_membership_ids
  from public.sa_organization_memberships m
  where m.user_id = p_actor and m.status = 'active'
    and (m.effective_from is null or m.effective_from <= v_now)
    and (m.effective_until is null or m.effective_until > v_now)
    and (v_org is null or m.organization_id = any(v_ancestry));
  if coalesce(array_length(v_membership_ids, 1), 0) = 0 then
    return jsonb_build_object('decision','DENY','reason_code','MISSING_MEMBERSHIP','matched_assignments','[]'::jsonb,'resolved_scopes','[]'::jsonb);
  end if;

  select exists (
    select 1 from public.sa_role_assignments a
    where a.user_id = p_actor and a.membership_id = any(v_membership_ids) and a.status = 'active'
      and (a.effective_from is null or a.effective_from <= v_now)
      and (a.effective_until is null or a.effective_until > v_now)
  ) into v_has_assignment;

  for r in
    select a.id as assignment_id, a.membership_id, br.id as role_id, br.role_key, br.name as role_name
    from public.sa_role_assignments a
    join public.sa_business_roles br on br.id = a.role_id and br.status = 'active'
    join public.sa_business_role_permissions rp on rp.role_id = br.id
    join public.sa_permissions p on p.id = rp.permission_id and p.status = 'active' and p.permission_key = p_permission
    where a.user_id = p_actor and a.membership_id = any(v_membership_ids) and a.status = 'active'
      and (a.effective_from is null or a.effective_from <= v_now)
      and (a.effective_until is null or a.effective_until > v_now)
  loop
    v_permitted := v_permitted || jsonb_build_array(jsonb_build_object(
      'assignmentId', r.assignment_id, 'roleId', r.role_id, 'roleKey', r.role_key,
      'roleName', r.role_name, 'membershipId', r.membership_id));
    v_assignment_matched := false;
    for s in
      select sd.scope_type, sd.scope_value from public.sa_assignment_scopes x
      join public.sa_scope_definitions sd on sd.id = x.scope_id and sd.status = 'active'
      where x.assignment_id = r.assignment_id
    loop
      v_match := public.sa_scope_matches(p_actor, s.scope_type, s.scope_value, v_ctx, v_ancestry);
      if v_match is null then v_missing_context := true; end if;
      v_scopes := v_scopes || jsonb_build_array(jsonb_build_object(
        'assignmentId', r.assignment_id, 'scopeType', s.scope_type, 'scopeValue', s.scope_value, 'matched', coalesce(v_match, false)));
      if v_match is true then v_assignment_matched := true; end if;
    end loop;
    -- An assignment without scopes grants nothing (no implicit global access).
    if v_assignment_matched then
      v_matched := v_matched || jsonb_build_array(jsonb_build_object(
        'assignmentId', r.assignment_id, 'roleId', r.role_id, 'roleKey', r.role_key,
        'roleName', r.role_name, 'membershipId', r.membership_id));
    end if;
  end loop;

  if jsonb_array_length(v_matched) > 0 then
    return jsonb_build_object('decision','ALLOW','reason_code','ALLOWED_BY_ASSIGNMENT','matched_assignments',v_matched,'resolved_scopes',v_scopes);
  end if;

  -- Scoped, non-transitive delegation. The delegator is evaluated WITHOUT
  -- delegations, for this exact resource context, at decision time: a
  -- delegate can never exceed what the delegator currently holds directly.
  if p_include_delegation then
    for d in
      select dl.id, dl.delegator_id from public.sa_delegations dl
      where dl.delegate_id = p_actor and dl.status = 'active'
        and dl.effective_from <= v_now and dl.effective_until > v_now
        and p_permission = any(dl.permission_keys)
        and (v_org is null or dl.organization_id = any(v_ancestry))
    loop
      if (public.sa_evaluate_permission(d.delegator_id, p_permission, v_ctx, false)->>'decision') = 'ALLOW' then
        return jsonb_build_object('decision','ALLOW','reason_code','ALLOWED_BY_DELEGATION',
          'matched_assignments', jsonb_build_array(jsonb_build_object('delegationId', d.id, 'delegatorId', d.delegator_id)),
          'resolved_scopes', v_scopes);
      end if;
    end loop;
  end if;

  if not v_has_assignment then
    return jsonb_build_object('decision','DENY','reason_code','MISSING_ASSIGNMENT','matched_assignments','[]'::jsonb,'resolved_scopes','[]'::jsonb);
  end if;
  if jsonb_array_length(v_permitted) = 0 then
    return jsonb_build_object('decision','DENY','reason_code','MISSING_PERMISSION','matched_assignments','[]'::jsonb,'resolved_scopes','[]'::jsonb);
  end if;
  return jsonb_build_object('decision','DENY',
    'reason_code', case when v_missing_context then 'MISSING_CONTEXT' else 'SCOPE_MISMATCH' end,
    'matched_assignments', v_permitted, 'resolved_scopes', v_scopes);
end $$;
revoke all on function public.sa_evaluate_permission(uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.sa_evaluate_permission(uuid,text,jsonb,boolean) to service_role;
comment on function public.sa_evaluate_permission(uuid,text,jsonb,boolean) is
  'Canonical S&A new-model decision with explanation. Service-only; database gates call it internally for auth.uid().';

create or replace function public.sa_actor_has_permission(p_actor uuid, p_permission text, p_context jsonb default '{}'::jsonb)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce((public.sa_evaluate_permission(p_actor, p_permission, p_context, true)->>'decision') = 'ALLOW', false)
$$;
revoke all on function public.sa_actor_has_permission(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.sa_actor_has_permission(uuid,text,jsonb) to service_role;

create or replace function public.sa_permission_mode(p_permission text)
returns text language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce((select m.mode from public.sa_migration_modes m where m.permission_key = p_permission), 'LEGACY_ENFORCED')
$$;
revoke all on function public.sa_permission_mode(text) from public, anon;
grant execute on function public.sa_permission_mode(text) to authenticated, service_role;

create or replace function public.sa_is_new_authoritative(p_permission text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select public.sa_permission_mode(p_permission) in ('NEW_ENFORCED','LEGACY_RETIRED')
$$;
revoke all on function public.sa_is_new_authoritative(text) from public, anon;
grant execute on function public.sa_is_new_authoritative(text) to authenticated, service_role;

-- RLS gate: legacy expression decides in LEGACY_ENFORCED/SHADOW; the verified
-- caller's S&A decision alone decides in NEW_ENFORCED/LEGACY_RETIRED.
create or replace function public.sa_rls_gate(p_permission text, p_organization_id uuid, p_legacy boolean)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select case
    when public.sa_is_new_authoritative(p_permission) then
      auth.uid() is not null and public.sa_actor_has_permission(auth.uid(), p_permission,
        jsonb_build_object('organization_id', p_organization_id))
    else coalesce(p_legacy, false)
  end
$$;
revoke all on function public.sa_rls_gate(text,uuid,boolean) from public, anon;
grant execute on function public.sa_rls_gate(text,uuid,boolean) to authenticated, service_role;

-- Own-record variant (employee self-service rows).
create or replace function public.sa_rls_gate_owned(p_permission text, p_organization_id uuid, p_owner_user_id uuid, p_legacy boolean)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select case
    when public.sa_is_new_authoritative(p_permission) then
      auth.uid() is not null and public.sa_actor_has_permission(auth.uid(), p_permission,
        jsonb_build_object('organization_id', p_organization_id, 'owner_user_id', p_owner_user_id))
    else coalesce(p_legacy, false)
  end
$$;
revoke all on function public.sa_rls_gate_owned(text,uuid,uuid,boolean) from public, anon;
grant execute on function public.sa_rls_gate_owned(text,uuid,uuid,boolean) to authenticated, service_role;

-- RPC gate, injected at the top of SECURITY DEFINER workflow functions.
--   * No PostgREST request (claims absent: migrations, database owner,
--     internal jobs) and service_role (trusted server that already authorized
--     through requireAuthorization) pass through.
--   * LEGACY_ENFORCED/SHADOW: no-op; the function's existing checks decide.
--   * NEW_ENFORCED/LEGACY_RETIRED: the verified caller (auth.uid()) must be
--     allowed by S&A for the resource context computed inside the function
--     from trusted rows. Denial raises 42501 before any business mutation.
create or replace function public.sa_require_operation(
  p_permission text, p_context jsonb, p_resource_type text default null, p_resource_id text default null)
returns void language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
  v_uid uuid := auth.uid();
begin
  if v_role is null or v_role = 'service_role' then return; end if;
  if not public.sa_is_new_authoritative(p_permission) then return; end if;
  if v_uid is null or not public.sa_actor_has_permission(v_uid, p_permission, coalesce(p_context, '{}'::jsonb)) then
    raise exception 'sa_authorization_required'
      using errcode = '42501',
            detail = format('permission=%s resource=%s:%s', p_permission, coalesce(p_resource_type, '-'), coalesce(p_resource_id, '-'));
  end if;
end $$;
revoke all on function public.sa_require_operation(text,jsonb,text,text) from public, anon;
grant execute on function public.sa_require_operation(text,jsonb,text,text) to authenticated, service_role;
comment on function public.sa_require_operation(text,jsonb,text,text) is
  'Database backstop for migrated workflow RPCs. No-op until the permission is NEW_ENFORCED/LEGACY_RETIRED; then the caller must hold the permission in the trusted resource scope.';

-- Service-side assertion used by governance functions: the acting
-- administrator must be authorized by S&A (new modes) or by the legacy rule
-- the application used (legacy modes). Never trusts the application alone.
create or replace function public.sa_legacy_is_super_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code
                 where u.id = p_actor and u.is_active is true and r.role_level = 1)
$$;
revoke all on function public.sa_legacy_is_super_admin(uuid) from public, anon, authenticated;

create or replace function public.sa_assert_actor_permission(p_actor uuid, p_permission text, p_context jsonb, p_legacy boolean)
returns void language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_actor is null then raise exception 'sa_actor_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active is true) then
    raise exception 'sa_actor_inactive' using errcode = '42501';
  end if;
  if public.sa_is_new_authoritative(p_permission) then
    if not public.sa_actor_has_permission(p_actor, p_permission, coalesce(p_context, '{}'::jsonb)) then
      raise exception 'sa_authorization_required' using errcode = '42501', detail = p_permission;
    end if;
  elsif not coalesce(p_legacy, false) then
    raise exception 'sa_authorization_required' using errcode = '42501', detail = p_permission;
  end if;
end $$;
revoke all on function public.sa_assert_actor_permission(uuid,text,jsonb,boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Governance tables
-- ---------------------------------------------------------------------------
create table if not exists public.sa_authority_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique check (policy_key ~ '^[a-z][a-z0-9_.-]*$'),
  name text not null,
  description text,
  permission_key text not null references public.sa_permissions(permission_key) on update cascade,
  document_type text not null check (document_type ~ '^[a-z][a-z0-9_]*$'),
  organization_id uuid references public.organizations(id) on delete cascade,
  role_id uuid references public.sa_business_roles(id) on delete cascade,
  currency text check (currency ~ '^[A-Z]{3}$'),
  min_amount numeric(18,2) check (min_amount is null or min_amount >= 0),
  max_amount numeric(18,2) check (max_amount is null or max_amount >= 0),
  max_variance_percent numeric(9,4) check (max_variance_percent is null or max_variance_percent >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  effective_from timestamptz,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint sa_authority_amount_range check (max_amount is null or min_amount is null or max_amount >= min_amount),
  constraint sa_authority_dates_valid check (effective_until is null or effective_from is null or effective_until > effective_from)
);
comment on table public.sa_authority_policies is
  'Approval authority (amount/currency/variance limits) per permission and document type. Permission is not authority: when active policies exist for a permission+document type, the actor must also be covered by one. No policy → current workflow behaviour. Amounts come from trusted documents, never the browser. No thresholds are seeded: none are documented in the current application.';

create table if not exists public.sa_sod_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique check (rule_key ~ '^[a-z][a-z0-9_.-]*$'),
  name text not null,
  description text,
  rule_kind text not null check (rule_kind in ('role_conflict','permission_conflict','same_document')),
  left_key text not null,
  right_key text not null,
  document_type text,
  enforcement text not null default 'monitor' check (enforcement in ('enforce','monitor')),
  status text not null default 'active' check (status in ('active','inactive')),
  effective_from timestamptz,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint sa_sod_same_document_type check (rule_kind <> 'same_document' or document_type is not null)
);
comment on table public.sa_sod_rules is
  'Segregation of duties. role_conflict/permission_conflict: incompatible holdings for one person. same_document: the maker of a document may not perform the checker step on the same document. enforce blocks; monitor records violations only.';

create table if not exists public.sa_sod_mitigations (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.sa_sod_rules(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 10),
  approved_by uuid not null references public.users(id),
  status text not null default 'active' check (status in ('active','revoked')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sa_sod_mitigation_dates check (effective_until > effective_from),
  constraint sa_sod_mitigation_not_self check (approved_by <> user_id)
);

create table if not exists public.sa_sod_violations (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  rule_id uuid not null references public.sa_sod_rules(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  document_type text,
  document_id text,
  outcome text not null check (outcome in ('blocked','allowed_monitor','allowed_mitigated')),
  details jsonb not null default '{}'::jsonb
);
create index if not exists sa_sod_violations_time_idx on public.sa_sod_violations(detected_at desc);
drop trigger if exists sa_sod_violations_append_only on public.sa_sod_violations;
create trigger sa_sod_violations_append_only before update or delete on public.sa_sod_violations
for each row execute function public.sa_reject_append_only_mutation();

create table if not exists public.sa_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references public.users(id) on delete cascade,
  delegate_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission_keys text[] not null check (cardinality(permission_keys) between 1 and 50),
  reason text not null check (length(btrim(reason)) >= 5),
  status text not null default 'active' check (status in ('active','revoked','expired')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id),
  revoke_reason text,
  constraint sa_delegation_not_self check (delegator_id <> delegate_id),
  constraint sa_delegation_dates check (effective_until > effective_from)
);
create index if not exists sa_delegations_delegate_idx on public.sa_delegations(delegate_id, status);
create index if not exists sa_delegations_delegator_idx on public.sa_delegations(delegator_id, status);
comment on table public.sa_delegations is
  'Scoped, time-boxed, non-transitive delegation. Effective only while the delegator directly (not via delegation) holds the permission for the same resource context.';

create table if not exists public.sa_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  request_type text not null check (request_type in ('role','temporary_role','scope')),
  role_id uuid not null references public.sa_business_roles(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_ids uuid[] not null default '{}',
  reason text not null check (length(btrim(reason)) >= 10),
  effective_from timestamptz,
  effective_until timestamptz,
  status text not null default 'requested' check (status in ('requested','approved','denied','cancelled','expired')),
  approver_id uuid references public.users(id),
  decided_at timestamptz,
  decision_reason text,
  resulting_assignment_id uuid references public.sa_role_assignments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sa_access_request_temporary_needs_end check (request_type <> 'temporary_role' or effective_until is not null),
  constraint sa_access_request_dates check (effective_until is null or effective_from is null or effective_until > effective_from),
  constraint sa_access_request_not_self_approved check (approver_id is null or (approver_id <> requester_id and approver_id <> target_user_id))
);
create index if not exists sa_access_requests_status_idx on public.sa_access_requests(status, created_at desc);

create table if not exists public.sa_access_review_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  organization_id uuid references public.organizations(id) on delete cascade,
  role_id uuid references public.sa_business_roles(id) on delete cascade,
  reviewer_id uuid not null references public.users(id),
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  completed_at timestamptz
);

create table if not exists public.sa_access_review_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sa_access_review_campaigns(id) on delete cascade,
  assignment_id uuid references public.sa_role_assignments(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.sa_business_roles(id),
  snapshot jsonb not null,
  decision text not null default 'pending' check (decision in ('pending','retain','revoke','modify')),
  decision_reason text,
  new_effective_until timestamptz,
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  constraint sa_review_modify_needs_date check (decision <> 'modify' or new_effective_until is not null),
  constraint sa_review_no_self_certification check (decided_by is null or decided_by <> user_id)
);
create index if not exists sa_access_review_items_campaign_idx on public.sa_access_review_items(campaign_id, decision);

create table if not exists public.sa_emergency_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission_keys text[] not null check (cardinality(permission_keys) between 1 and 20),
  reason text not null check (length(btrim(reason)) >= 20),
  status text not null default 'requested' check (status in ('requested','active','expired','revoked','rejected')),
  authentication_assurance text,
  requested_at timestamptz not null default now(),
  activated_at timestamptz,
  effective_until timestamptz,
  granted_by uuid references public.users(id),
  post_use_review_status text not null default 'pending' check (post_use_review_status in ('pending','reviewed')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  constraint sa_emergency_not_self_granted check (granted_by is null or granted_by <> user_id)
);
comment on table public.sa_emergency_access_grants is
  'Break-glass access, separate from Super Admin. Disabled until the MFA step-up prerequisite (AAL2) is available; see sa_settings emergency_access.*.';

create table if not exists public.sa_service_identities (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique check (identity_key ~ '^[a-z][a-z0-9_-]*$'),
  name text not null,
  purpose text not null,
  identity_kind text not null check (identity_kind in ('cron_worker','queue_worker','integration','webhook','application_server','agent')),
  owner_team text not null,
  status text not null default 'active' check (status in ('active','disabled','retired')),
  credential_type text not null check (credential_type in ('shared_secret','service_role_key','api_key','webhook_signature','none')),
  -- Name of the environment variable holding the credential. Never a value.
  credential_reference text check (credential_reference ~ '^[A-Z][A-Z0-9_]*$'),
  permission_keys text[] not null default '{}',
  scope_description text not null,
  last_used_at timestamptz,
  last_rotated_at timestamptz,
  rotation_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.sa_service_identities is
  'Non-human principals. Metadata only: credential_reference is an environment variable NAME, never a secret value. Service identities cannot hold human role assignments.';

insert into public.sa_service_identities(identity_key, name, purpose, identity_kind, owner_team, credential_type, credential_reference, scope_description) values
 ('app-server', 'Application server', 'Trusted Next.js server that performs authorized mutations after S&A decisions', 'application_server', 'Platform', 'service_role_key', 'SUPABASE_SERVICE_ROLE_KEY', 'All organizations; acts only after a server-side S&A decision for a human actor or as a registered worker'),
 ('cron-scheduler', 'In-process cron scheduler', 'Dispatches scheduled worker routes with a worker lease', 'cron_worker', 'Platform', 'shared_secret', 'CRON_SECRET', 'Invokes /api/cron/* only'),
 ('qr-generation-worker', 'QR generation worker', 'Generates queued QR batches', 'queue_worker', 'Supply Chain', 'shared_secret', 'CRON_SECRET', 'qr_batches queue'),
 ('qr-reverse-worker', 'QR reverse worker', 'Processes queued QR reverse jobs', 'queue_worker', 'Supply Chain', 'shared_secret', 'CRON_SECRET', 'QR reverse jobs'),
 ('manufacturer-packing-worker', 'Manufacturer packing worker', 'Processes queued packing jobs', 'queue_worker', 'Supply Chain', 'shared_secret', 'CRON_SECRET', 'Manufacturer packing queue'),
 ('notification-outbox-worker', 'Notification outbox worker', 'Delivers queued SMS/WhatsApp/email notifications', 'queue_worker', 'Platform', 'shared_secret', 'CRON_SECRET', 'notifications_outbox'),
 ('serapp-hold-expiry', 'Serapp hold expiry', 'Expires stale Serapp order holds', 'cron_worker', 'Supply Chain', 'shared_secret', 'CRON_SECRET', 'serapp_order_holds'),
 ('sa-decision-retention', 'S&A decision retention', 'Purges ordinary shadow decisions after 90 days', 'cron_worker', 'Security', 'shared_secret', 'CRON_SECRET', 'sa_authorization_decisions ORDINARY_SHADOW only'),
 ('sa-governance-maintenance', 'S&A governance maintenance', 'Expires temporary access, delegations and stale requests; re-syncs lifecycle', 'cron_worker', 'Security', 'shared_secret', 'CRON_SECRET', 'S&A governance tables'),
 ('whatsapp-agent', 'WhatsApp agent', 'Agent lookups for WhatsApp customer service', 'agent', 'Customer & Growth', 'api_key', 'WHATSAPP_AGENT_KEY', 'Read-only consumer order/points lookups'),
 ('moltbot-agent', 'Moltbot agent', 'Agent API for the Moltbot assistant', 'agent', 'Customer & Growth', 'api_key', 'AGENT_API_KEY', 'Agent context/order/points/redeem lookups'),
 ('baileys-gateway', 'WhatsApp gateway (Baileys)', 'WhatsApp session gateway', 'integration', 'Platform', 'api_key', 'BAILEYS_API_KEY', 'Outbound WhatsApp messaging'),
 ('meta-whatsapp-webhook', 'Meta WhatsApp webhook', 'Inbound WhatsApp Cloud API events', 'webhook', 'Platform', 'webhook_signature', null, 'Inbound message ingestion'),
 ('sms-gateway-webhook', 'SMS gateway webhook', 'SMS delivery status callbacks', 'webhook', 'Platform', 'shared_secret', 'SMS_GATEWAY_PASSWORD', 'SMS delivery status'),
 ('telegram-webhook', 'Telegram webhook', 'Telegram bot updates', 'webhook', 'Platform', 'webhook_signature', 'TELEGRAM_WEBHOOK_SECRET', 'Telegram notifications linking'),
 ('ellbow-connector', 'Ellbow e-commerce connector', 'Catalogue export and order import for the Ellbow channel', 'integration', 'E-Commerce', 'api_key', 'ELLBOW_SYNC_KEY', 'Catalogue export, order import'),
 ('storefront-payment-webhook', 'Storefront payment webhook', 'Payment provider callbacks for storefront checkout', 'webhook', 'E-Commerce', 'webhook_signature', null, 'Storefront order payment status'),
 ('stock-count-verification-signer', 'Stock count verification signer', 'Signs stock count verification challenges', 'integration', 'Supply Chain', 'shared_secret', 'STOCK_COUNT_VERIFICATION_SECRET', 'Stock count OTP challenges')
on conflict (identity_key) do nothing;

do $$
declare t text;
begin
  foreach t in array array[
    'sa_settings','sa_legacy_compat_rules','sa_access_change_log','sa_authority_policies',
    'sa_sod_rules','sa_sod_mitigations','sa_sod_violations','sa_delegations','sa_access_requests',
    'sa_access_review_campaigns','sa_access_review_items','sa_emergency_access_grants','sa_service_identities'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke all on table public.%I from service_role', t);
    execute format('grant select on table public.%I to service_role', t);
  end loop;
end $$;

-- The application server reads S&A configuration and appends authorization
-- decisions; every access CHANGE goes through the SECURITY DEFINER functions
-- below, which enforce the invariants (no self-assignment, no self-approval,
-- delegation within the delegator's rights, SoD, audit logging). The server
-- therefore loses direct write access to the Wave 1 configuration tables.
-- (Migrations and the database owner are unaffected.)
do $$
declare t text;
begin
  foreach t in array array[
    'sa_organization_memberships','sa_permissions','sa_business_roles','sa_business_role_permissions',
    'sa_role_assignments','sa_scope_definitions','sa_assignment_scopes','sa_migration_modes'
  ] loop
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from service_role', t);
    execute format('grant select on table public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Compatibility roles, baseline roles, templates
-- ---------------------------------------------------------------------------
create or replace function public.sa_compat_role_key(p_role_code text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select 'legacy-' || trim(both '-' from lower(regexp_replace(p_role_code, '[^a-zA-Z0-9]+', '-', 'g')))
$$;
revoke all on function public.sa_compat_role_key(text) from public, anon, authenticated;

-- Materialise compatibility grants for one legacy role code (idempotent;
-- additive only: an explicitly removed grant is re-added only by re-running
-- this for a role code, which lifecycle does only when creating the role).
create or replace function public.sa_refresh_compat_role(p_role_code text, p_create boolean default true)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_role_id uuid;
  v_level integer;
  v_perms text[];
  v_key text := public.sa_compat_role_key(p_role_code);
begin
  if p_role_code is null or p_role_code !~ '[a-zA-Z0-9]' then return null; end if;
  select r.role_level,
    coalesce((select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(r.permissions)='object' then r.permissions else '{}'::jsonb end) k
               where coalesce((r.permissions->>k)::boolean, false)), array[]::text[])
    || coalesce((select array_agg(k) from jsonb_array_elements_text(case when jsonb_typeof(r.permissions)='array' then r.permissions else '[]'::jsonb end) k), array[]::text[])
  into v_level, v_perms
  from public.roles r where r.role_code = p_role_code;

  select id into v_role_id from public.sa_business_roles where role_key = v_key;
  if v_role_id is null then
    if not p_create then return null; end if;
    insert into public.sa_business_roles(role_key, name, description, source, status)
    values (v_key, 'Legacy ' || p_role_code,
            'Compatibility-only role generated from the existing role table. Not a target-state business role.',
            'legacy', 'active')
    on conflict (role_key) do nothing
    returning id into v_role_id;
    if v_role_id is null then select id into v_role_id from public.sa_business_roles where role_key = v_key; end if;
  end if;

  insert into public.sa_business_role_permissions(role_id, permission_id)
  select v_role_id, p.id
  from public.sa_legacy_compat_rules c
  join public.sa_permissions p on p.permission_key = c.permission_key and p.status = 'active'
  -- Own-record permissions come only from the lifecycle baseline role with an
  -- own_record scope; a compatibility role (organization scope) must never
  -- hold them.
  where not c.employee_baseline and (
      v_level = 1
      or (c.max_role_level is not null and v_level is not null and v_level <= c.max_role_level)
      or upper(p_role_code) = any(c.role_codes)
      or (v_perms && c.legacy_permissions)
    )
  on conflict do nothing;
  return v_role_id;
end $$;
revoke all on function public.sa_refresh_compat_role(text,boolean) from public, anon, authenticated;

-- Materialise grants for every compatibility role that already exists. The
-- Wave 1 security keys follow legacy 'manage_authorization', which only
-- Super Admin (role_level 1) holds through checkPermissionForUser.
select public.sa_refresh_compat_role(r.role_code, false)
from public.roles r
where exists (select 1 from public.sa_business_roles br where br.role_key = public.sa_compat_role_key(r.role_code));

-- Target-state business roles (templates, no assignments). Names follow the
-- application's existing Finance role vocabulary (FinancePermissionsSettings)
-- and HR/Supply Chain concepts already present in the product.
insert into public.sa_business_roles(role_key, name, description, source) values
 ('employee-self-service', 'Employee Self-Service', 'Baseline for every active employee: own-record HR self-service. Assigned by the lifecycle sync.', 'template'),
 ('security-administrator', 'Security Administrator', 'Administers Security & Access. Does not include business approval authority.', 'template'),
 ('access-reviewer', 'Access Reviewer', 'Certifies access in review campaigns and views the audit trail.', 'template'),
 ('finance-admin', 'Finance Admin', 'Full Finance module administration including settings.', 'template'),
 ('finance-gl-clerk', 'GL Clerk', 'Posts documents to the ledger and maintains the chart of accounts.', 'template'),
 ('finance-ar-clerk', 'AR Clerk', 'Receivables, receipts and receivable reporting.', 'template'),
 ('finance-ap-clerk', 'AP Clerk', 'Payables and supplier payments (without approval).', 'template'),
 ('finance-viewer', 'Finance Viewer', 'Read-only Finance access including sensitive reports.', 'template'),
 ('payment-approver', 'Payment Approver', 'Approves supplier balance payment requests.', 'template'),
 ('hr-manager', 'HR Manager', 'HR administration without payroll approval or release.', 'template'),
 ('payroll-officer', 'Payroll Officer', 'Prepares payroll and maintains compensation.', 'template'),
 ('payroll-approver', 'Payroll Approver', 'Approves calculated payroll runs.', 'template'),
 ('payroll-finance-approver', 'Payroll Finance Approver', 'Releases approved payroll to the General Ledger.', 'template'),
 ('order-approver', 'Order Approver', 'Approves submitted orders in scope.', 'template'),
 ('roadtour-manager', 'RoadTour Manager', 'RoadTour campaign, visit and KPI administration.', 'template'),
 ('loyalty-administrator', 'Loyalty Administrator', 'Rewards, redemptions and programme administration.', 'template'),
 ('ecommerce-administrator', 'E-Commerce Administrator', 'Storefront and e-commerce order administration.', 'template')
on conflict (role_key) do nothing;

insert into public.sa_business_role_permissions(role_id, permission_id)
select br.id, p.id
from (values
  ('employee-self-service', array['hr.self_service.use']),
  ('security-administrator', array['security.access.view','security.role.assign','security.permission.manage','security.role.manage','security.scope.manage','security.policy.manage','security.audit.view','security.access_request.approve','security.delegation.manage','security.service_identity.manage']),
  ('access-reviewer', array['security.access.view','security.audit.view','security.access_review.manage']),
  ('finance-admin', array['finance.module.view','finance.ledger.view','finance.report.view_sensitive','finance.receivable.view','finance.payable.view','finance.cash.view','finance.reconciliation.perform','finance.journal.post','finance.account.manage','finance.settings.manage','finance.payroll_integration.manage']),
  ('finance-gl-clerk', array['finance.module.view','finance.ledger.view','finance.journal.post','finance.account.manage']),
  ('finance-ar-clerk', array['finance.module.view','finance.ledger.view','finance.receivable.view']),
  ('finance-ap-clerk', array['finance.module.view','finance.ledger.view','finance.payable.view']),
  ('finance-viewer', array['finance.module.view','finance.ledger.view','finance.report.view_sensitive','finance.receivable.view','finance.payable.view','finance.cash.view']),
  ('payment-approver', array['finance.module.view','finance.payable.view','finance.payment.approve']),
  ('hr-manager', array['hr.module.view','hr.employee.view','hr.employee.manage','hr.attendance.manage','hr.leave.approve','hr.contract.view','hr.contract.manage','hr.benefits.manage','hr.learning.manage','hr.onboarding.manage','hr.recruitment.manage','hr.policy.manage','hr.performance.manage','hr.expense.manage','hr.analytics.view','hr.settings.manage']),
  ('payroll-officer', array['hr.module.view','hr.payroll.view','hr.payroll.prepare','hr.compensation.view','hr.compensation.manage']),
  ('payroll-approver', array['hr.module.view','hr.payroll.view','hr.payroll.approve','hr.compensation.view']),
  ('payroll-finance-approver', array['finance.module.view','hr.payroll.view','hr.payroll.release']),
  ('order-approver', array['supply_chain.order.approve']),
  ('roadtour-manager', array['roadtour.campaign.manage','roadtour.kpi.manage','roadtour.report.view','roadtour.visit.manage']),
  ('loyalty-administrator', array['customer.reward.manage','customer.redemption.manage','customer.program.manage','customer.consumer.view']),
  ('ecommerce-administrator', array['ecommerce.store.manage','ecommerce.order.manage'])
) as t(role_key, keys)
join public.sa_business_roles br on br.role_key = t.role_key
join public.sa_permissions p on p.permission_key = any(t.keys)
on conflict do nothing;

-- Existing segregation-of-duties evidence in the application:
--   * orders: "you cannot approve an order you created" (OrdersView; until now
--     enforced only in the browser) → enforce.
--   * stock transfers: requester cannot self-approve unless independently an
--     HQ admin (lib/inventory/stock-transfer.ts) → already enforced in its RPC.
-- Payroll and payment-request maker/checker have no documented rule: they are
-- seeded in MONITOR mode so conflicts are visible without changing authority.
insert into public.sa_sod_rules(rule_key, name, description, rule_kind, left_key, right_key, document_type, enforcement) values
 ('order-maker-checker', 'Order maker/checker', 'The creator of an order may not approve it.', 'same_document', 'supply_chain.order.create', 'supply_chain.order.approve', 'order', 'enforce'),
 ('payroll-prepare-approve', 'Payroll prepare vs approve', 'The person who calculated a payroll run should not approve it.', 'same_document', 'hr.payroll.prepare', 'hr.payroll.approve', 'payroll_run', 'monitor'),
 ('payment-request-maker-checker', 'Payment request maker/checker', 'The person who raised a balance payment request should not approve it.', 'same_document', 'supply_chain.document.manage', 'finance.payment.approve', 'payment_request', 'monitor'),
 ('payroll-prepare-release', 'Payroll preparation vs release', 'Holding both payroll preparation and GL release concentrates payroll authority.', 'permission_conflict', 'hr.payroll.prepare', 'hr.payroll.release', null, 'monitor'),
 ('security-admin-vs-payment-approval', 'Security administration vs payment approval', 'A person who can grant access should not also approve payments.', 'permission_conflict', 'security.role.assign', 'finance.payment.approve', null, 'monitor')
on conflict (rule_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. SoD evaluation
-- ---------------------------------------------------------------------------
create or replace function public.sa_sod_rule_active(p_rule public.sa_sod_rules)
returns boolean language sql stable set search_path = pg_catalog, pg_temp as $$
  select p_rule.status = 'active'
     and (p_rule.effective_from is null or p_rule.effective_from <= now())
     and (p_rule.effective_until is null or p_rule.effective_until > now())
$$;
revoke all on function public.sa_sod_rule_active(public.sa_sod_rules) from public, anon, authenticated;

create or replace function public.sa_sod_has_mitigation(p_rule_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.sa_sod_mitigations x
                 where x.rule_id = p_rule_id and x.user_id = p_user and x.status = 'active'
                   and x.effective_from <= now() and x.effective_until > now())
$$;
revoke all on function public.sa_sod_has_mitigation(uuid,uuid) from public, anon, authenticated;

-- Transaction-time maker/checker. p_makers come from trusted domain rows
-- (e.g. orders.created_by), never from the client.
create or replace function public.sa_enforce_same_document_sod(
  p_rule_key text, p_document_id text, p_checker uuid, p_makers uuid[])
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_rule public.sa_sod_rules;
begin
  if p_checker is null then return; end if;
  select * into v_rule from public.sa_sod_rules where rule_key = p_rule_key and rule_kind = 'same_document';
  if not found or not public.sa_sod_rule_active(v_rule) then return; end if;
  if not (p_checker = any(coalesce(p_makers, array[]::uuid[]))) then return; end if;
  if public.sa_sod_has_mitigation(v_rule.id, p_checker) then
    insert into public.sa_sod_violations(rule_id, user_id, document_type, document_id, outcome)
    values (v_rule.id, p_checker, v_rule.document_type, p_document_id, 'allowed_mitigated');
    return;
  end if;
  if v_rule.enforcement = 'enforce' then
    raise exception 'sod_violation: %', v_rule.name using errcode = '42501', detail = v_rule.rule_key;
  end if;
  insert into public.sa_sod_violations(rule_id, user_id, document_type, document_id, outcome)
  values (v_rule.id, p_checker, v_rule.document_type, p_document_id, 'allowed_monitor');
end $$;
revoke all on function public.sa_enforce_same_document_sod(text,text,uuid,uuid[]) from public, anon;
grant execute on function public.sa_enforce_same_document_sod(text,text,uuid,uuid[]) to authenticated, service_role;

-- Holdings a user would have (optionally with one extra role) that conflict
-- with active role/permission SoD rules.
create or replace function public.sa_sod_holding_conflicts(p_user uuid, p_extra_role uuid default null)
returns table(rule_id uuid, rule_key text, enforcement text, mitigated boolean)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  with roles_held as (
    select a.role_id from public.sa_role_assignments a
    where a.user_id = p_user and a.status = 'active'
      and (a.effective_until is null or a.effective_until > now())
    union select p_extra_role where p_extra_role is not null
  ), perms_held as (
    select distinct p.permission_key from roles_held rh
    join public.sa_business_role_permissions rp on rp.role_id = rh.role_id
    join public.sa_permissions p on p.id = rp.permission_id
  ), role_keys as (
    select br.role_key from roles_held rh join public.sa_business_roles br on br.id = rh.role_id
  )
  select r.id, r.rule_key, r.enforcement, public.sa_sod_has_mitigation(r.id, p_user)
  from public.sa_sod_rules r
  where public.sa_sod_rule_active(r)
    and ((r.rule_kind = 'permission_conflict'
          and exists (select 1 from perms_held where permission_key = r.left_key)
          and exists (select 1 from perms_held where permission_key = r.right_key))
      or (r.rule_kind = 'role_conflict'
          and exists (select 1 from role_keys where role_key = r.left_key)
          and exists (select 1 from role_keys where role_key = r.right_key)))
$$;
revoke all on function public.sa_sod_holding_conflicts(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sa_sod_holding_conflicts(uuid,uuid) to service_role;

-- Authority policy evaluation against a TRUSTED document amount.
-- NOT_APPLICABLE when no active policy exists for permission+document type in
-- the organization's hierarchy (current workflow behaviour is preserved).
create or replace function public.sa_evaluate_authority(
  p_actor uuid, p_permission text, p_document_type text, p_organization_id uuid,
  p_amount numeric, p_currency text, p_variance_percent numeric default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_ancestry uuid[] := public.sa_org_ancestry(p_organization_id);
  v_policy record;
  v_applicable boolean := false;
begin
  for v_policy in
    select ap.* from public.sa_authority_policies ap
    where ap.permission_key = p_permission and ap.document_type = p_document_type and ap.status = 'active'
      and (ap.effective_from is null or ap.effective_from <= now())
      and (ap.effective_until is null or ap.effective_until > now())
      and (ap.organization_id is null or ap.organization_id = any(v_ancestry))
      and (ap.currency is null or ap.currency = upper(p_currency))
  loop
    v_applicable := true;
    if (v_policy.role_id is null or exists (
          select 1 from public.sa_role_assignments a
          join public.sa_organization_memberships m on m.id = a.membership_id and m.status = 'active'
          where a.user_id = p_actor and a.role_id = v_policy.role_id and a.status = 'active'
            and (a.effective_until is null or a.effective_until > now())
            and m.organization_id = any(v_ancestry)))
       and (v_policy.min_amount is null or p_amount >= v_policy.min_amount)
       and (v_policy.max_amount is null or p_amount <= v_policy.max_amount)
       and (v_policy.max_variance_percent is null or p_variance_percent is null or p_variance_percent <= v_policy.max_variance_percent)
    then
      return jsonb_build_object('decision','ALLOW','policy_id',v_policy.id,'policy_key',v_policy.policy_key);
    end if;
  end loop;
  if not v_applicable then return jsonb_build_object('decision','NOT_APPLICABLE'); end if;
  return jsonb_build_object('decision','DENY','reason','no_authority_policy_covers_amount');
end $$;
revoke all on function public.sa_evaluate_authority(uuid,text,text,uuid,numeric,text,numeric) from public, anon, authenticated;
grant execute on function public.sa_evaluate_authority(uuid,text,text,uuid,numeric,text,numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Governance mutation functions (service_role only; each re-verifies the
--    acting administrator and the invariants in the database)
-- ---------------------------------------------------------------------------
create or replace function public.sa_setting_int(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce((select (s.setting_value #>> '{}')::integer from public.sa_settings s where s.setting_key = p_key), p_default)
$$;
revoke all on function public.sa_setting_int(text,integer) from public, anon, authenticated;

create or replace function public.sa_setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce((select (s.setting_value #>> '{}')::boolean from public.sa_settings s where s.setting_key = p_key), p_default)
$$;
revoke all on function public.sa_setting_bool(text,boolean) from public, anon, authenticated;

-- End timestamp for a row being ended now that respects "until > from".
create or replace function public.sa_end_at(p_from timestamptz, p_until timestamptz)
returns timestamptz language sql stable set search_path = pg_catalog, pg_temp as $$
  select case when p_from is not null and p_from >= now() then p_until
              else least(coalesce(p_until, now()), now()) end
$$;
revoke all on function public.sa_end_at(timestamptz,timestamptz) from public, anon, authenticated;

-- Internal: create an assignment on the user's active membership in p_org.
-- No authorization here; callers (below) authorize.
create or replace function public.sa_create_assignment_internal(
  p_actor uuid, p_user uuid, p_role uuid, p_org uuid, p_scope_ids uuid[],
  p_from timestamptz, p_until timestamptz, p_reason text, p_source text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_membership uuid;
  v_assignment uuid;
  v_conflict record;
  v_scope_count integer;
begin
  if p_user is null or p_role is null or p_org is null then raise exception 'sa_invalid_assignment'; end if;
  if not exists (select 1 from public.sa_business_roles where id = p_role and status = 'active') then
    raise exception 'sa_role_not_assignable';
  end if;
  if exists (select 1 from public.sa_business_roles where id = p_role and source = 'legacy') and p_source not in ('backfill','derived') then
    raise exception 'sa_compat_role_not_assignable' using hint = 'Compatibility roles are managed by the lifecycle sync.';
  end if;
  -- Enterprise identity required: an active membership created from HR/User
  -- Management facts. Consumer relationships never qualify.
  select m.id into v_membership from public.sa_organization_memberships m
  where m.user_id = p_user and m.organization_id = p_org and m.status = 'active'
    and (m.effective_until is null or m.effective_until > now())
  order by m.is_primary desc limit 1;
  if v_membership is null then raise exception 'sa_membership_required'; end if;
  if not exists (select 1 from public.users u where u.id = p_user and u.is_active is true) then
    raise exception 'sa_target_inactive';
  end if;
  if coalesce(cardinality(p_scope_ids), 0) = 0 then raise exception 'sa_scope_required'; end if;
  -- Every scope must lie inside the membership organization's subtree;
  -- organization-independent typed scopes (territory, campaign, ...) are
  -- allowed only for non-structural scope types.
  select count(*) into v_scope_count from public.sa_scope_definitions sd
  where sd.id = any(p_scope_ids) and sd.status = 'active'
    and ((sd.organization_id is not null and p_org = any(public.sa_org_ancestry(sd.organization_id)))
      or (sd.organization_id is null and sd.scope_type not in ('organization','warehouse','department','own_record','direct_reports')));
  if v_scope_count <> cardinality(p_scope_ids) then raise exception 'sa_scope_outside_membership'; end if;

  for v_conflict in select * from public.sa_sod_holding_conflicts(p_user, p_role) loop
    if v_conflict.enforcement = 'enforce' and not v_conflict.mitigated then
      raise exception 'sod_violation: %', v_conflict.rule_key using errcode = '42501';
    end if;
    insert into public.sa_sod_violations(rule_id, user_id, outcome, details)
    values (v_conflict.rule_id, p_user, case when v_conflict.mitigated then 'allowed_mitigated' else 'allowed_monitor' end,
            jsonb_build_object('role_id', p_role, 'context', 'assignment'));
  end loop;

  insert into public.sa_role_assignments(user_id, role_id, membership_id, status, effective_from, effective_until,
                                         assignment_reason, source, created_by, updated_by)
  values (p_user, p_role, v_membership, 'active', p_from, p_until, p_reason, p_source, p_actor, p_actor)
  on conflict (user_id, role_id, membership_id) do update set
    status = 'active', effective_from = excluded.effective_from, effective_until = excluded.effective_until,
    assignment_reason = excluded.assignment_reason, source = excluded.source, ended_reason = null,
    updated_at = now(), updated_by = excluded.updated_by
  returning id into v_assignment;
  delete from public.sa_assignment_scopes where assignment_id = v_assignment;
  insert into public.sa_assignment_scopes(assignment_id, scope_id, created_by)
  select v_assignment, unnest(p_scope_ids), p_actor on conflict do nothing;

  perform public.sa_log_access_change(p_actor, 'assignment.granted', p_user, 'sa_role_assignment', v_assignment::text,
    jsonb_build_object('role_id', p_role, 'organization_id', p_org, 'scope_ids', p_scope_ids,
                       'effective_from', p_from, 'effective_until', p_until, 'source', p_source),
    p_reason, case when p_source in ('backfill','derived') then 'system' else 'user' end);
  return v_assignment;
end $$;
revoke all on function public.sa_create_assignment_internal(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public, anon, authenticated;

create or replace function public.sa_assign_role(
  p_actor uuid, p_user uuid, p_role uuid, p_org uuid, p_scope_ids uuid[],
  p_from timestamptz, p_until timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_actor = p_user then raise exception 'sa_self_assignment_prohibited' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'sa_reason_required'; end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.role.assign',
    jsonb_build_object('organization_id', p_org), public.sa_legacy_is_super_admin(p_actor));
  return public.sa_create_assignment_internal(p_actor, p_user, p_role, p_org, p_scope_ids, p_from, p_until, btrim(p_reason), 'manual');
end $$;
revoke all on function public.sa_assign_role(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.sa_assign_role(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text) to service_role;

create or replace function public.sa_revoke_assignment(p_actor uuid, p_assignment uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_a record;
begin
  select a.*, m.organization_id into v_a from public.sa_role_assignments a
  join public.sa_organization_memberships m on m.id = a.membership_id where a.id = p_assignment for update of a;
  if not found then raise exception 'sa_assignment_not_found'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'sa_reason_required'; end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.role.assign',
    jsonb_build_object('organization_id', v_a.organization_id), public.sa_legacy_is_super_admin(p_actor));
  -- An administrator's decision is final: a lifecycle-owned row becomes
  -- administrator-owned so the lifecycle sync never re-activates it.
  update public.sa_role_assignments set status = 'revoked', ended_reason = btrim(p_reason),
    source = case when source in ('backfill','derived') then 'manual' else source end,
    effective_until = public.sa_end_at(effective_from, effective_until), updated_at = now(), updated_by = p_actor
  where id = p_assignment and status <> 'revoked';
  perform public.sa_log_access_change(p_actor, 'assignment.revoked', v_a.user_id, 'sa_role_assignment', p_assignment::text,
    jsonb_build_object('role_id', v_a.role_id, 'organization_id', v_a.organization_id), btrim(p_reason));
end $$;
revoke all on function public.sa_revoke_assignment(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.sa_revoke_assignment(uuid,uuid,text) to service_role;

-- Scope definitions ---------------------------------------------------------
create or replace function public.sa_define_scope(
  p_actor uuid, p_org uuid, p_scope_type text, p_scope_value text, p_display_name text, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if p_scope_type !~ '^[a-z][a-z0-9_]*$' or p_scope_value is null or btrim(p_scope_value) = '' then
    raise exception 'sa_scope_invalid';
  end if;
  -- Empty or wildcard values never mean global access.
  if p_scope_value in ('*','all','global') then raise exception 'sa_scope_wildcard_prohibited'; end if;
  if p_scope_type in ('organization','warehouse') and not exists (select 1 from public.organizations o where o.id::text = p_scope_value) then
    raise exception 'sa_scope_unknown_organization';
  end if;
  if p_scope_type = 'department' and not exists (select 1 from public.departments d where d.id::text = p_scope_value and d.organization_id = p_org) then
    raise exception 'sa_scope_unknown_department';
  end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.scope.manage',
    jsonb_build_object('organization_id', p_org), public.sa_legacy_is_super_admin(p_actor));
  insert into public.sa_scope_definitions(organization_id, scope_type, scope_value, display_name, resource_metadata, created_by, updated_by)
  values (p_org, p_scope_type, btrim(p_scope_value), btrim(p_display_name), coalesce(p_metadata, '{}'::jsonb), p_actor, p_actor)
  on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), scope_type, scope_value)
  do update set display_name = excluded.display_name, status = 'active', updated_at = now(), updated_by = p_actor
  returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'scope.defined', null, 'sa_scope_definition', v_id::text,
    jsonb_build_object('scope_type', p_scope_type, 'scope_value', p_scope_value, 'organization_id', p_org));
  return v_id;
end $$;
revoke all on function public.sa_define_scope(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.sa_define_scope(uuid,uuid,text,text,text,jsonb) to service_role;

-- Access requests ---------------------------------------------------------
create or replace function public.sa_submit_access_request(
  p_actor uuid, p_target uuid, p_role uuid, p_org uuid, p_scope_ids uuid[],
  p_from timestamptz, p_until timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_max_days integer := public.sa_setting_int('access_request.max_temporary_days', 90);
  v_type text := case when p_until is not null then 'temporary_role' else 'role' end;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor and u.is_active is true) then
    raise exception 'sa_actor_inactive' using errcode = '42501';
  end if;
  -- Requests are raised by business members for themselves or their org.
  if not exists (select 1 from public.sa_organization_memberships m where m.user_id = p_actor and m.status = 'active') then
    raise exception 'sa_membership_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sa_organization_memberships m where m.user_id = p_target and m.organization_id = p_org and m.status = 'active') then
    raise exception 'sa_membership_required';
  end if;
  if exists (select 1 from public.sa_business_roles where id = p_role and (status <> 'active' or source = 'legacy')) then
    raise exception 'sa_role_not_requestable';
  end if;
  if coalesce(cardinality(p_scope_ids), 0) = 0 then raise exception 'sa_scope_required'; end if;
  if p_until is not null and p_until > coalesce(p_from, now()) + make_interval(days => v_max_days) then
    raise exception 'sa_temporary_access_too_long';
  end if;
  insert into public.sa_access_requests(requester_id, target_user_id, request_type, role_id, organization_id, scope_ids,
                                        reason, effective_from, effective_until)
  values (p_actor, p_target, v_type, p_role, p_org, p_scope_ids, btrim(p_reason), p_from, p_until)
  returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'access_request.submitted', p_target, 'sa_access_request', v_id::text,
    jsonb_build_object('role_id', p_role, 'organization_id', p_org, 'scope_ids', p_scope_ids, 'effective_until', p_until), btrim(p_reason));
  return v_id;
end $$;
revoke all on function public.sa_submit_access_request(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.sa_submit_access_request(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text) to service_role;

create or replace function public.sa_decide_access_request(p_actor uuid, p_request uuid, p_approve boolean, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_req public.sa_access_requests;
  v_assignment uuid;
begin
  select * into v_req from public.sa_access_requests where id = p_request for update;
  if not found then raise exception 'sa_access_request_not_found'; end if;
  if v_req.status <> 'requested' then raise exception 'sa_access_request_not_pending'; end if;
  if p_actor = v_req.requester_id or p_actor = v_req.target_user_id then
    raise exception 'sa_self_approval_prohibited' using errcode = '42501';
  end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.access_request.approve',
    jsonb_build_object('organization_id', v_req.organization_id), public.sa_legacy_is_super_admin(p_actor));
  if p_approve and v_req.effective_until is not null and v_req.effective_until <= now() then
    update public.sa_access_requests set status = 'expired', updated_at = now() where id = p_request;
    perform public.sa_log_access_change(p_actor, 'access_request.expired', v_req.target_user_id, 'sa_access_request', p_request::text, '{}'::jsonb, 'window elapsed before approval');
    return null;
  end if;
  if p_approve then
    -- Access is granted only here, after the approval is complete.
    v_assignment := public.sa_create_assignment_internal(p_actor, v_req.target_user_id, v_req.role_id, v_req.organization_id,
      v_req.scope_ids, v_req.effective_from, v_req.effective_until, 'Access request ' || v_req.id::text || ': ' || v_req.reason, 'access_request');
    update public.sa_access_requests set status = 'approved', approver_id = p_actor, decided_at = now(),
      decision_reason = nullif(btrim(p_reason), ''), resulting_assignment_id = v_assignment, updated_at = now()
    where id = p_request;
  else
    update public.sa_access_requests set status = 'denied', approver_id = p_actor, decided_at = now(),
      decision_reason = nullif(btrim(p_reason), ''), updated_at = now()
    where id = p_request;
  end if;
  perform public.sa_log_access_change(p_actor, case when p_approve then 'access_request.approved' else 'access_request.denied' end,
    v_req.target_user_id, 'sa_access_request', p_request::text,
    jsonb_build_object('assignment_id', v_assignment, 'role_id', v_req.role_id), p_reason);
  return v_assignment;
end $$;
revoke all on function public.sa_decide_access_request(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.sa_decide_access_request(uuid,uuid,boolean,text) to service_role;

create or replace function public.sa_cancel_access_request(p_actor uuid, p_request uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_req public.sa_access_requests;
begin
  select * into v_req from public.sa_access_requests where id = p_request for update;
  if not found or v_req.status <> 'requested' then raise exception 'sa_access_request_not_pending'; end if;
  if v_req.requester_id <> p_actor then raise exception 'sa_only_requester_can_cancel' using errcode = '42501'; end if;
  update public.sa_access_requests set status = 'cancelled', updated_at = now() where id = p_request;
  perform public.sa_log_access_change(p_actor, 'access_request.cancelled', v_req.target_user_id, 'sa_access_request', p_request::text);
end $$;
revoke all on function public.sa_cancel_access_request(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sa_cancel_access_request(uuid,uuid) to service_role;

-- Delegations -------------------------------------------------------------
create or replace function public.sa_create_delegation(
  p_actor uuid, p_delegator uuid, p_delegate uuid, p_org uuid, p_permission_keys text[],
  p_from timestamptz, p_until timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_key text;
  v_from timestamptz := coalesce(p_from, now());
  v_ctx jsonb := jsonb_build_object('organization_id', p_org);
begin
  if p_delegator = p_delegate then raise exception 'sa_self_delegation_prohibited'; end if;
  if p_until is null or p_until <= v_from then raise exception 'sa_delegation_end_required'; end if;
  if p_until > v_from + make_interval(days => public.sa_setting_int('delegation.max_days', 90)) then
    raise exception 'sa_delegation_too_long';
  end if;
  if p_actor <> p_delegator then
    perform public.sa_assert_actor_permission(p_actor, 'security.delegation.manage', v_ctx, public.sa_legacy_is_super_admin(p_actor));
  end if;
  if not exists (select 1 from public.users u where u.id = p_delegate and u.is_active is true)
     or not exists (select 1 from public.sa_organization_memberships m where m.user_id = p_delegate and m.status = 'active'
                    and m.organization_id = any(public.sa_org_ancestry(p_org))) then
    raise exception 'sa_delegate_must_be_member';
  end if;
  -- The delegator must directly hold every delegated permission for the scope
  -- right now; delegated rights can never be delegated onward.
  foreach v_key in array p_permission_keys loop
    if (public.sa_evaluate_permission(p_delegator, v_key, v_ctx, false)->>'decision') <> 'ALLOW' then
      raise exception 'sa_delegation_exceeds_delegator: %', v_key using errcode = '42501';
    end if;
  end loop;
  insert into public.sa_delegations(delegator_id, delegate_id, organization_id, permission_keys, reason,
                                    effective_from, effective_until, created_by)
  values (p_delegator, p_delegate, p_org, p_permission_keys, btrim(p_reason), v_from, p_until, p_actor)
  returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'delegation.created', p_delegate, 'sa_delegation', v_id::text,
    jsonb_build_object('delegator_id', p_delegator, 'organization_id', p_org, 'permission_keys', p_permission_keys, 'effective_until', p_until), p_reason);
  return v_id;
end $$;
revoke all on function public.sa_create_delegation(uuid,uuid,uuid,uuid,text[],timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.sa_create_delegation(uuid,uuid,uuid,uuid,text[],timestamptz,timestamptz,text) to service_role;

create or replace function public.sa_revoke_delegation(p_actor uuid, p_delegation uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_d public.sa_delegations;
begin
  select * into v_d from public.sa_delegations where id = p_delegation for update;
  if not found then raise exception 'sa_delegation_not_found'; end if;
  if p_actor not in (v_d.delegator_id, v_d.delegate_id) then
    perform public.sa_assert_actor_permission(p_actor, 'security.delegation.manage',
      jsonb_build_object('organization_id', v_d.organization_id), public.sa_legacy_is_super_admin(p_actor));
  end if;
  update public.sa_delegations set status = 'revoked', revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
  where id = p_delegation and status = 'active';
  perform public.sa_log_access_change(p_actor, 'delegation.revoked', v_d.delegate_id, 'sa_delegation', p_delegation::text, '{}'::jsonb, p_reason);
end $$;
revoke all on function public.sa_revoke_delegation(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.sa_revoke_delegation(uuid,uuid,text) to service_role;

-- Access reviews ----------------------------------------------------------
create or replace function public.sa_create_access_review(
  p_actor uuid, p_name text, p_org uuid, p_role uuid, p_reviewer uuid, p_due timestamptz)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid; v_count integer;
begin
  perform public.sa_assert_actor_permission(p_actor, 'security.access_review.manage',
    jsonb_build_object('organization_id', p_org), public.sa_legacy_is_super_admin(p_actor));
  if not exists (select 1 from public.users u where u.id = p_reviewer and u.is_active is true) then
    raise exception 'sa_reviewer_inactive';
  end if;
  insert into public.sa_access_review_campaigns(name, organization_id, role_id, reviewer_id, due_at, created_by)
  values (btrim(p_name), p_org, p_role, p_reviewer, p_due, p_actor) returning id into v_id;
  insert into public.sa_access_review_items(campaign_id, assignment_id, user_id, role_id, snapshot)
  select v_id, a.id, a.user_id, a.role_id,
         jsonb_build_object('role_key', br.role_key, 'role_name', br.name, 'organization_id', m.organization_id,
                            'source', a.source, 'effective_from', a.effective_from, 'effective_until', a.effective_until,
                            'scopes', coalesce((select jsonb_agg(jsonb_build_object('type', sd.scope_type, 'value', sd.scope_value, 'name', sd.display_name))
                                                from public.sa_assignment_scopes x join public.sa_scope_definitions sd on sd.id = x.scope_id
                                                where x.assignment_id = a.id), '[]'::jsonb))
  from public.sa_role_assignments a
  join public.sa_organization_memberships m on m.id = a.membership_id
  join public.sa_business_roles br on br.id = a.role_id
  where a.status = 'active'
    and (a.effective_until is null or a.effective_until > now())
    and (p_org is null or m.organization_id = p_org)
    and (p_role is null or a.role_id = p_role);
  get diagnostics v_count = row_count;
  perform public.sa_log_access_change(p_actor, 'access_review.created', null, 'sa_access_review_campaign', v_id::text,
    jsonb_build_object('items', v_count, 'organization_id', p_org, 'role_id', p_role, 'reviewer_id', p_reviewer));
  return v_id;
end $$;
revoke all on function public.sa_create_access_review(uuid,text,uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.sa_create_access_review(uuid,text,uuid,uuid,uuid,timestamptz) to service_role;

create or replace function public.sa_decide_access_review_item(
  p_actor uuid, p_item uuid, p_decision text, p_reason text, p_new_until timestamptz default null)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_item public.sa_access_review_items;
  v_campaign public.sa_access_review_campaigns;
begin
  select * into v_item from public.sa_access_review_items where id = p_item for update;
  if not found then raise exception 'sa_review_item_not_found'; end if;
  select * into v_campaign from public.sa_access_review_campaigns where id = v_item.campaign_id;
  if v_campaign.status <> 'active' then raise exception 'sa_review_campaign_closed'; end if;
  if v_item.decision <> 'pending' then raise exception 'sa_review_item_already_decided'; end if;
  if p_actor = v_item.user_id then raise exception 'sa_self_certification_prohibited' using errcode = '42501'; end if;
  if p_actor <> v_campaign.reviewer_id then
    perform public.sa_assert_actor_permission(p_actor, 'security.access_review.manage',
      jsonb_build_object('organization_id', v_campaign.organization_id), public.sa_legacy_is_super_admin(p_actor));
  end if;
  if p_decision not in ('retain','revoke','modify') then raise exception 'sa_review_decision_invalid'; end if;
  if p_decision in ('revoke','modify') and (p_reason is null or length(btrim(p_reason)) < 5) then raise exception 'sa_reason_required'; end if;
  if p_decision = 'modify' and (p_new_until is null or p_new_until <= now()) then raise exception 'sa_review_modify_needs_future_end'; end if;

  update public.sa_access_review_items set decision = p_decision, decision_reason = p_reason,
    new_effective_until = p_new_until, decided_by = p_actor, decided_at = now()
  where id = p_item;
  if p_decision = 'revoke' and v_item.assignment_id is not null then
    update public.sa_role_assignments set status = 'revoked', ended_reason = 'Access review: ' || btrim(p_reason),
      source = case when source in ('backfill','derived') then 'manual' else source end,
      effective_until = public.sa_end_at(effective_from, effective_until), updated_at = now(), updated_by = p_actor
    where id = v_item.assignment_id and status = 'active';
  elsif p_decision = 'modify' and v_item.assignment_id is not null then
    update public.sa_role_assignments set effective_until = p_new_until, updated_at = now(), updated_by = p_actor
    where id = v_item.assignment_id and status = 'active';
  end if;
  perform public.sa_log_access_change(p_actor, 'access_review.' || p_decision, v_item.user_id, 'sa_access_review_item', p_item::text,
    jsonb_build_object('assignment_id', v_item.assignment_id, 'campaign_id', v_item.campaign_id, 'new_effective_until', p_new_until), p_reason);
end $$;
revoke all on function public.sa_decide_access_review_item(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.sa_decide_access_review_item(uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.sa_complete_access_review(p_actor uuid, p_campaign uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_campaign public.sa_access_review_campaigns;
begin
  select * into v_campaign from public.sa_access_review_campaigns where id = p_campaign for update;
  if not found or v_campaign.status <> 'active' then raise exception 'sa_review_campaign_closed'; end if;
  if p_actor <> v_campaign.reviewer_id then
    perform public.sa_assert_actor_permission(p_actor, 'security.access_review.manage',
      jsonb_build_object('organization_id', v_campaign.organization_id), public.sa_legacy_is_super_admin(p_actor));
  end if;
  if exists (select 1 from public.sa_access_review_items where campaign_id = p_campaign and decision = 'pending') then
    raise exception 'sa_review_items_pending';
  end if;
  update public.sa_access_review_campaigns set status = 'completed', completed_at = now() where id = p_campaign;
  perform public.sa_log_access_change(p_actor, 'access_review.completed', null, 'sa_access_review_campaign', p_campaign::text);
end $$;
revoke all on function public.sa_complete_access_review(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sa_complete_access_review(uuid,uuid) to service_role;

-- SoD mitigations -----------------------------------------------------------
create or replace function public.sa_grant_sod_mitigation(
  p_actor uuid, p_rule uuid, p_user uuid, p_reason text, p_until timestamptz)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if p_actor = p_user then raise exception 'sa_self_mitigation_prohibited' using errcode = '42501'; end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.policy.manage', '{}'::jsonb, public.sa_legacy_is_super_admin(p_actor));
  if p_until is null or p_until <= now() or p_until > now() + interval '365 days' then raise exception 'sa_mitigation_end_invalid'; end if;
  insert into public.sa_sod_mitigations(rule_id, user_id, reason, approved_by, effective_until)
  values (p_rule, p_user, btrim(p_reason), p_actor, p_until) returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'sod.mitigation_granted', p_user, 'sa_sod_mitigation', v_id::text,
    jsonb_build_object('rule_id', p_rule, 'effective_until', p_until), p_reason);
  return v_id;
end $$;
revoke all on function public.sa_grant_sod_mitigation(uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.sa_grant_sod_mitigation(uuid,uuid,uuid,text,timestamptz) to service_role;

-- Emergency access: disabled until MFA step-up exists. The function exists so
-- the capability and its prerequisite are explicit; it can never activate
-- access without an AAL2 session and the reviewed enablement setting.
create or replace function public.sa_request_emergency_access(
  p_org uuid, p_permission_keys text[], p_reason text, p_minutes integer)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not public.sa_setting_bool('emergency_access.mfa_step_up_available', false)
     or not public.sa_setting_bool('emergency_access.enabled', false) then
    raise exception 'emergency_access_unavailable: MFA step-up (AAL2) prerequisite is not met' using errcode = '42501';
  end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'emergency_access_requires_aal2' using errcode = '42501';
  end if;
  raise exception 'emergency_access_activation_not_implemented' using errcode = '0A000';
end $$;
revoke all on function public.sa_request_emergency_access(uuid,text[],text,integer) from public, anon;
grant execute on function public.sa_request_emergency_access(uuid,text[],text,integer) to authenticated;

-- Refuse to enable emergency access without the prerequisite.
create or replace function public.sa_guard_settings()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if new.setting_key = 'emergency_access.enabled' and (new.setting_value #>> '{}')::boolean
     and not public.sa_setting_bool('emergency_access.mfa_step_up_available', false) then
    raise exception 'emergency_access_prerequisite_unmet';
  end if;
  return new;
end $$;
revoke all on function public.sa_guard_settings() from public, anon, authenticated;
drop trigger if exists sa_settings_guard on public.sa_settings;
create trigger sa_settings_guard before insert or update on public.sa_settings
for each row execute function public.sa_guard_settings();

-- Service identity usage (metadata only).
create or replace function public.sa_touch_service_identity(p_identity_key text)
returns void language sql security definer set search_path = pg_catalog, pg_temp as $$
  update public.sa_service_identities set last_used_at = now() where identity_key = p_identity_key and status = 'active'
$$;
revoke all on function public.sa_touch_service_identity(text) from public, anon, authenticated;
grant execute on function public.sa_touch_service_identity(text) to service_role;

-- Periodic maintenance: expire time-boxed access and stale requests.
create or replace function public.sa_governance_maintenance()
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_assignments integer; v_delegations integer; v_requests integer; v_mitigations integer;
begin
  with x as (
    update public.sa_role_assignments set status = 'revoked', ended_reason = coalesce(ended_reason, 'expired'), updated_at = now()
    where status = 'active' and effective_until is not null and effective_until <= now()
      and source not in ('backfill','derived')   -- lifecycle-owned rows are re-derived by the lifecycle sync
    returning id, user_id)
  select count(*) into v_assignments from x;
  with x as (
    update public.sa_delegations set status = 'expired'
    where status = 'active' and effective_until <= now() returning id)
  select count(*) into v_delegations from x;
  with x as (
    update public.sa_access_requests set status = 'expired', updated_at = now()
    where status = 'requested' and (created_at < now() - make_interval(days => public.sa_setting_int('access_request.pending_expiry_days', 30))
                                    or (effective_until is not null and effective_until <= now()))
    returning id)
  select count(*) into v_requests from x;
  with x as (
    update public.sa_sod_mitigations set status = 'revoked' where status = 'active' and effective_until <= now() returning id)
  select count(*) into v_mitigations from x;
  if v_assignments + v_delegations + v_requests + v_mitigations > 0 then
    perform public.sa_log_access_change(null, 'governance.maintenance', null, 'sa_governance', null,
      jsonb_build_object('assignments_expired', v_assignments, 'delegations_expired', v_delegations,
                         'requests_expired', v_requests, 'mitigations_expired', v_mitigations), null, 'system');
  end if;
  return jsonb_build_object('assignments_expired', v_assignments, 'delegations_expired', v_delegations,
                            'requests_expired', v_requests, 'mitigations_expired', v_mitigations);
end $$;
revoke all on function public.sa_governance_maintenance() from public, anon, authenticated;
grant execute on function public.sa_governance_maintenance() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing integer;
  v_t text;
begin
  select count(*) into v_missing from sa_final_catalog c
  where not exists (select 1 from public.sa_permissions p where p.permission_key = c.permission_key)
     or not exists (select 1 from public.sa_migration_modes m where m.permission_key = c.permission_key);
  if v_missing > 0 then raise exception 'postcondition: % catalog permissions missing a row or mode', v_missing; end if;

  if exists (select 1 from public.sa_migration_modes m join sa_final_catalog c using (permission_key)
             where m.mode in ('NEW_ENFORCED','LEGACY_RETIRED')) then
    raise notice 'Final Wave catalog permissions already NEW_ENFORCED/LEGACY_RETIRED were left unchanged';
  end if;

  foreach v_t in array array['sa_settings','sa_legacy_compat_rules','sa_access_change_log','sa_authority_policies',
    'sa_sod_rules','sa_sod_mitigations','sa_sod_violations','sa_delegations','sa_access_requests',
    'sa_access_review_campaigns','sa_access_review_items','sa_emergency_access_grants','sa_service_identities'] loop
    if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception 'postcondition: % must have forced RLS', v_t;
    end if;
    if has_table_privilege('anon', 'public.' || v_t, 'SELECT') or has_table_privilege('authenticated', 'public.' || v_t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_t, 'INSERT') then
      raise exception 'postcondition: % must not be reachable by API roles', v_t;
    end if;
  end loop;

  if has_table_privilege('service_role', 'public.sa_access_change_log', 'UPDATE')
     or has_table_privilege('service_role', 'public.sa_access_change_log', 'DELETE') then
    raise exception 'postcondition: access change log must be append-only';
  end if;

  if has_function_privilege('authenticated', 'public.sa_evaluate_permission(uuid,text,jsonb,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sa_assign_role(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sa_decide_access_request(uuid,uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sa_require_operation(text,jsonb,text,text)', 'EXECUTE') then
    raise exception 'postcondition: governance/evaluator privileges too broad';
  end if;

  if has_table_privilege('service_role', 'public.sa_role_assignments', 'INSERT')
     or has_table_privilege('service_role', 'public.sa_assignment_scopes', 'INSERT')
     or has_table_privilege('service_role', 'public.sa_migration_modes', 'UPDATE')
     or has_table_privilege('service_role', 'public.sa_delegations', 'INSERT') then
    raise exception 'postcondition: access changes must go through the governance functions';
  end if;

  if public.sa_setting_bool('emergency_access.enabled', false) then
    raise exception 'postcondition: emergency access must be disabled';
  end if;

  if exists (select 1 from public.sa_service_identities where credential_reference is not null and credential_reference !~ '^[A-Z][A-Z0-9_]*$') then
    raise exception 'postcondition: service identities must reference credentials by env var name only';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'sa\_%' and p.prosecdef
               and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%pg_temp%')) then
    raise exception 'postcondition: every SECURITY DEFINER sa_* function must pin search_path ending in pg_temp';
  end if;
end $$;

drop table if exists pg_temp.sa_final_catalog;
