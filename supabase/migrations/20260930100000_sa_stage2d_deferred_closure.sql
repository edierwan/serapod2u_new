-- ============================================================================
-- Identity / S&A Stage 2D — deferred authorization closure (database part)
-- ----------------------------------------------------------------------------
-- Adds what the 53 deferred Stage 2C decisions (and the staging-only Outdoor
-- store rule) need to become Security & Access decisions. No mode is moved to
-- NEW_ENFORCED here: every new permission starts in SHADOW, where the
-- application's legacy evaluator (today's exact rule) still decides and S&A
-- is evaluated and logged next to it. Management moves each key to
-- NEW_ENFORCED with sa_set_migration_mode after reviewing its parity.
--
--  1. sa_readable_organizations(actor, permission [, include_delegation])
--     → uuid[]: every organization X for which
--     sa_evaluate_permission(actor, permission, {organization_id: X}) is
--     ALLOW. Same rules: active user, active membership whose organization is
--     X or an ancestor of X, active assignment of an active role granting the
--     permission, an organization scope that is X or an ancestor of X, plus
--     scoped non-transitive delegation. Used for "which organizations may this
--     person read" list filters (replaces "Super Admin sees everything").
--
--  2. sa_actor_dominates(actor, target) → boolean: the actor holds every
--     grant the target holds, at the same scope (each permission of each of
--     the target's active/suspended assignments, evaluated for the actor in
--     that assignment's scope; own-record scopes are personal and skipped).
--     Replaces "you cannot act on a user with a higher legacy role level" for
--     delete / password reset once the identity permissions are enforced.
--
--  3. Thirteen permissions (SHADOW) with named business roles, each backfilled
--     (sa_stage2d_backfill(), owner-only, re-runnable)
--     to exactly the people today's legacy rule admits (active portal users
--     with an active membership in their organization; organization scope).
--     Legacy authorization is read-only on staging, so compatibility roles no
--     longer pick up new keys; explicit, reviewable roles are used instead and
--     can be granted or removed per person in Security & Access. A re-run never
--     re-grants an assignment an administrator ended.
--
--       permission                          role                          legacy rule reproduced
--       customer.support.administer         support-inbox-administrator   role_code SA / HQ / POWER_USER
--       customer.report.view                customer-report-viewer        role_code SA / HQ / POWER_USER
--       customer.messaging.manage           customer-messaging-manager    role_level <= 20
--       customer.banner.manage              storefront-banner-manager     HQ organization and role_level <= 30
--       manufacturing.adjustment.administer adjustment-administrator      role_code SA
--       platform.user.profile_edit          profile-administrator         role_level 1 or 10
--       hr.employee.view_internal           hr-internal-directory-viewer  role_code MANAGER or role_level <= 50
--       customer.crm.view                   crm-viewer                    HQ organization and role_level <= 50
--       marketing.module.view               marketing-viewer              HQ organization and role_level <= 30
--       product.catalog.view                catalog-viewer                HQ / DIST / SHOP organization and role_level <= 50
--       ecommerce.module.view               ecommerce-viewer              HQ organization and role_level <= 30
--       ecommerce.outdoor.operate           outdoor-store-operator        role_code SA / HQ or role_level <= 10, or HQ organization and role_level <= 30
--       platform.notification_monitor.view  notification-monitor-viewer   internal employee, role_level <= 40, and (role_level <= 20 or HQ organization)
--
-- Mirrors app/src/lib/security-access/stage2d-catalog.ts (lock-step test).
-- Idempotent and autocommit-safe (no session temp tables or settings).
-- Grants: the two functions are service_role only.
-- Rollback: drop function public.sa_readable_organizations(uuid,text,boolean),
--   public.sa_actor_dominates(uuid,uuid); revoke the backfilled assignments
--   (source 'backfill', assignment_reason 'Stage 2D ...') and delete the
--   thirteen permissions (their role grants, readiness and modes cascade or are
--   deleted first). Nothing else is changed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Organization-readable scope
-- ---------------------------------------------------------------------------
create or replace function public.sa_readable_organizations(p_actor uuid, p_permission text, p_include_delegation boolean default true)
returns uuid[] language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $fn$
declare
  v_now timestamptz := now();
  v_direct uuid[];
  v_delegated uuid[] := array[]::uuid[];
  d record;
begin
  if p_actor is null or p_permission is null then return array[]::uuid[]; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active is true) then
    return array[]::uuid[];
  end if;

  -- (organization, ancestor) closure, same depth limit as sa_org_ancestry.
  with recursive up(id, anc, depth) as (
    select o.id, o.id, 0 from public.organizations o
    union all
    select up.id, o.parent_org_id, up.depth + 1
    from up join public.organizations o on o.id = up.anc
    where o.parent_org_id is not null and up.depth < 10
  ),
  grants as (
    select m.organization_id as m_org, (sd.scope_value)::uuid as s_org
    from public.sa_role_assignments a
    join public.sa_business_roles br on br.id = a.role_id and br.status = 'active'
    join public.sa_business_role_permissions rp on rp.role_id = br.id
    join public.sa_permissions p on p.id = rp.permission_id and p.status = 'active' and p.permission_key = p_permission
    join public.sa_organization_memberships m on m.id = a.membership_id and m.user_id = p_actor and m.status = 'active'
      and (m.effective_from is null or m.effective_from <= v_now)
      and (m.effective_until is null or m.effective_until > v_now)
    join public.sa_assignment_scopes x on x.assignment_id = a.id
    join public.sa_scope_definitions sd on sd.id = x.scope_id and sd.status = 'active' and sd.scope_type = 'organization'
    where a.user_id = p_actor and a.status = 'active'
      and (a.effective_from is null or a.effective_from <= v_now)
      and (a.effective_until is null or a.effective_until > v_now)
      and sd.scope_value ~ '^[0-9a-fA-F-]{36}$'
  )
  select coalesce(array_agg(distinct u1.id), array[]::uuid[]) into v_direct
  from grants g
  join up u1 on u1.anc = g.m_org
  join up u2 on u2.id = u1.id and u2.anc = g.s_org;

  if p_include_delegation then
    for d in
      select dl.delegator_id, dl.organization_id from public.sa_delegations dl
      where dl.delegate_id = p_actor and dl.status = 'active'
        and dl.effective_from <= v_now and dl.effective_until > v_now
        and p_permission = any(dl.permission_keys)
    loop
      -- A delegate reaches X when the delegation's organization is X or an
      -- ancestor of X and the delegator directly reaches X.
      v_delegated := v_delegated || coalesce((
        select array_agg(x) from unnest(public.sa_readable_organizations(d.delegator_id, p_permission, false)) x
        where d.organization_id = any(public.sa_org_ancestry(x))), array[]::uuid[]);
    end loop;
  end if;

  return coalesce((select array_agg(distinct x) from unnest(v_direct || v_delegated) x), array[]::uuid[]);
end
$fn$;
revoke all on function public.sa_readable_organizations(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.sa_readable_organizations(uuid,text,boolean) to service_role;
comment on function public.sa_readable_organizations(uuid,text,boolean) is
  'Organizations X for which sa_evaluate_permission(actor, permission, {organization_id: X}) is ALLOW (same membership, assignment, scope and delegation rules). Service role only.';

-- ---------------------------------------------------------------------------
-- 2. Target protection: the actor covers every grant of the target
-- ---------------------------------------------------------------------------
create or replace function public.sa_actor_dominates(p_actor uuid, p_target uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $fn$
declare
  g record;
  v_ctx jsonb;
begin
  if p_actor is null or p_target is null then return false; end if;
  if p_actor = p_target then return true; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active is true) then return false; end if;

  for g in
    select distinct p.permission_key, sd.scope_type, sd.scope_value, sd.organization_id
    from public.sa_role_assignments a
    join public.sa_business_roles br on br.id = a.role_id
    join public.sa_business_role_permissions rp on rp.role_id = br.id
    join public.sa_permissions p on p.id = rp.permission_id and p.status = 'active'
    join public.sa_assignment_scopes x on x.assignment_id = a.id
    join public.sa_scope_definitions sd on sd.id = x.scope_id
    where a.user_id = p_target and a.status in ('active', 'suspended')
      and (a.effective_until is null or a.effective_until > now())
      and sd.scope_type not in ('own_record', 'direct_reports')
  loop
    v_ctx := case g.scope_type
      when 'organization' then jsonb_build_object('organization_id', g.scope_value)
      when 'warehouse'    then jsonb_build_object('warehouse_id', g.scope_value, 'organization_id', g.organization_id)
      when 'department'   then jsonb_build_object('department_id', g.scope_value, 'organization_id', g.organization_id)
      else jsonb_strip_nulls(jsonb_build_object('organization_id', g.organization_id,
                                                'attributes', jsonb_build_object(g.scope_type, g.scope_value)))
    end;
    if coalesce(public.sa_evaluate_permission(p_actor, g.permission_key, v_ctx, false)->>'decision', 'DENY') <> 'ALLOW' then
      return false;
    end if;
  end loop;
  return true;
end
$fn$;
revoke all on function public.sa_actor_dominates(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sa_actor_dominates(uuid,uuid) to service_role;
comment on function public.sa_actor_dominates(uuid,uuid) is
  'True when the actor holds every grant of the target (each permission of each active/suspended assignment, in that assignment''s scope; own-record scopes skipped). Target protection for delete / password reset. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. Permissions, roles, readiness and backfill
-- ---------------------------------------------------------------------------
insert into public.sa_permissions(permission_key, module, resource, action, description, source, audit_sensitivity) values
 ('customer.support.administer','customer','support','administer','Administer the support inbox: every customer conversation, blasts, tags and agents','new','security_sensitive'),
 ('customer.report.view','customer','report','view','View cross-shop customer, consumer and points reports','new','security_sensitive'),
 ('customer.messaging.manage','customer','messaging','manage','Manage outbound customer messaging: short links, message previews and WhatsApp audiences','new','security_sensitive'),
 ('customer.banner.manage','customer','banner','manage','Manage the consumer app master banner','new','ordinary'),
 ('manufacturing.adjustment.administer','manufacturing','adjustment','administer','Administer stock adjustments across manufacturers (assign, resolve, view all)','new','security_sensitive'),
 ('platform.user.profile_edit','platform','user','profile_edit','Edit another person''s profile details (name, contact, preferences)','new','security_sensitive'),
 ('hr.employee.view_internal','hr','employee','view_internal','See colleagues'' internal (non-sensitive) employment details such as work email and hire date','new','security_sensitive'),
 ('customer.crm.view','customer','crm','view','Open the CRM module','new','ordinary'),
 ('marketing.module.view','marketing','module','view','Open the Marketing module','new','ordinary'),
 ('product.catalog.view','product','catalog','view','Open the product catalogue module','new','ordinary'),
 ('ecommerce.module.view','ecommerce','module','view','Open the E-Commerce module','new','ordinary'),
 ('ecommerce.outdoor.operate','ecommerce','outdoor','operate','Operate the Outdoor store: fulfilment, products, customer updates, requests and courier connection','new','security_sensitive'),
 ('platform.notification_monitor.view','platform','notification_monitor','view','View the email and SMS delivery monitors','new','security_sensitive')
on conflict (permission_key) do nothing;

insert into public.sa_migration_modes(permission_key, mode, legacy_permission_key, notes)
select k, 'SHADOW', null, 'Stage 2D: legacy decides while the new model is evaluated and logged; management enforces after parity review.'
from unnest(array['customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
                  'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal',
                  'customer.crm.view','marketing.module.view','product.catalog.view','ecommerce.module.view',
                  'ecommerce.outdoor.operate','platform.notification_monitor.view']) k
on conflict (permission_key) do nothing;

insert into public.sa_enforcement_readiness(permission_key, route_wiring, database_backstop, intentional_tightening, notes)
select k, true, 'decision_backstop', null, 'Stage 2D: every route and page for this permission decides through S&A (legacy evaluator until enforced).'
from unnest(array['customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
                  'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal',
                  'customer.crm.view','marketing.module.view','product.catalog.view','ecommerce.module.view',
                  'ecommerce.outdoor.operate','platform.notification_monitor.view']) k
on conflict (permission_key) do nothing;

insert into public.sa_business_roles(role_key, name, description, source) values
 ('support-inbox-administrator','Support Inbox Administrator','Handles every customer support conversation, blasts and support agents.','template'),
 ('customer-report-viewer','Customer Report Viewer','Views cross-shop customer, consumer and points reports.','template'),
 ('customer-messaging-manager','Customer Messaging Manager','Manages short links, message previews and WhatsApp marketing audiences.','template'),
 ('storefront-banner-manager','Storefront Banner Manager','Manages the consumer app master banner.','template'),
 ('adjustment-administrator','Stock Adjustment Administrator','Assigns and resolves stock adjustments across manufacturers.','template'),
 ('profile-administrator','Profile Administrator','Edits other people''s profile details.','template'),
 ('hr-internal-directory-viewer','Internal Directory Viewer','Sees colleagues'' internal employment details (work email, hire date, employment type).','template'),
 ('crm-viewer','CRM User','Opens the CRM module.','template'),
 ('marketing-viewer','Marketing User','Opens the Marketing module.','template'),
 ('catalog-viewer','Catalogue User','Opens the product catalogue module.','template'),
 ('ecommerce-viewer','E-Commerce User','Opens the E-Commerce module.','template'),
 ('outdoor-store-operator','Outdoor Store Operator','Operates the Outdoor store (fulfilment, products, customer updates, requests, courier).','template'),
 ('notification-monitor-viewer','Notification Monitor Viewer','Views the email and SMS delivery monitors.','template')
on conflict (role_key) do nothing;

insert into public.sa_business_role_permissions(role_id, permission_id)
select br.id, p.id
from (values
  ('support-inbox-administrator','customer.support.administer'),
  ('customer-report-viewer','customer.report.view'),
  ('customer-messaging-manager','customer.messaging.manage'),
  ('storefront-banner-manager','customer.banner.manage'),
  ('adjustment-administrator','manufacturing.adjustment.administer'),
  ('profile-administrator','platform.user.profile_edit'),
  ('hr-internal-directory-viewer','hr.employee.view_internal'),
  ('crm-viewer','customer.crm.view'),
  ('marketing-viewer','marketing.module.view'),
  ('catalog-viewer','product.catalog.view'),
  ('ecommerce-viewer','ecommerce.module.view'),
  ('outdoor-store-operator','ecommerce.outdoor.operate'),
  ('notification-monitor-viewer','platform.notification_monitor.view')
) as t(role_key, permission_key)
join public.sa_business_roles br on br.role_key = t.role_key
join public.sa_permissions p on p.permission_key = t.permission_key
on conflict do nothing;

-- Who qualifies today (the legacy rule each route still applies). Kept as a
-- view-like function so the backfill and its post-condition use one rule.
create or replace function public.sa_stage2d_legacy_qualifies(p_role_key text, p_role_code text, p_level integer, p_org_type text, p_principal text)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $fn$
  select case p_role_key
    when 'support-inbox-administrator'  then upper(coalesce(p_role_code,'')) in ('SA','HQ','POWER_USER')
    when 'customer-report-viewer'       then upper(coalesce(p_role_code,'')) in ('SA','HQ','POWER_USER')
    when 'customer-messaging-manager'   then coalesce(p_level <= 20, false)
    when 'storefront-banner-manager'    then p_org_type = 'HQ' and coalesce(p_level <= 30, false)
    when 'adjustment-administrator'     then upper(coalesce(p_role_code,'')) = 'SA'
    when 'profile-administrator'        then coalesce(p_level in (1, 10), false) or upper(coalesce(p_role_code,'')) in ('SUPER','SUPERADMIN','HQ_ADMIN')
    when 'hr-internal-directory-viewer' then upper(coalesce(p_role_code,'')) = 'MANAGER' or coalesce(p_level <= 50, false)
    when 'crm-viewer'                   then p_org_type = 'HQ' and coalesce(p_level <= 50, false)
    when 'marketing-viewer'             then p_org_type = 'HQ' and coalesce(p_level <= 30, false)
    when 'catalog-viewer'               then p_org_type in ('HQ','DIST','SHOP') and coalesce(p_level <= 50, false)
    when 'ecommerce-viewer'             then p_org_type = 'HQ' and coalesce(p_level <= 30, false)
    when 'outdoor-store-operator'       then upper(coalesce(p_role_code,'')) in ('SA','HQ') or coalesce(p_level <= 10, false)
                                             or (p_org_type = 'HQ' and coalesce(p_level <= 30, false))
    when 'notification-monitor-viewer'  then p_principal = 'INTERNAL_EMPLOYEE' and coalesce(p_level <= 40, false)
                                             and (coalesce(p_level <= 20, false) or p_org_type = 'HQ')
    else false end
$fn$;
revoke all on function public.sa_stage2d_legacy_qualifies(text,text,integer,text,text) from public, anon, authenticated;

create or replace function public.sa_stage2d_backfill()
returns integer language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $backfill$
declare
  r record;
  v_scope uuid;
  n integer := 0;
begin
  for r in
    select br.id as role_id, br.role_key, u.id as user_id, u.organization_id as org
    from public.sa_business_roles br
    cross join public.users u
    join public.roles lr on lr.role_code = u.role_code
    left join public.organizations o on o.id = u.organization_id
    where br.role_key in ('support-inbox-administrator','customer-report-viewer','customer-messaging-manager','storefront-banner-manager',
                          'adjustment-administrator','profile-administrator','hr-internal-directory-viewer','crm-viewer',
                          'marketing-viewer','catalog-viewer','ecommerce-viewer','outdoor-store-operator','notification-monitor-viewer')
      and u.is_active and u.account_scope = 'portal' and u.organization_id is not null
      and public.sa_stage2d_legacy_qualifies(br.role_key, u.role_code, lr.role_level, o.org_type_code, u.principal_type)
      and exists (select 1 from public.sa_organization_memberships m
                  where m.user_id = u.id and m.organization_id = u.organization_id and m.status = 'active'
                    and (m.effective_until is null or m.effective_until > now()))
      -- never re-grant: any existing row (including one an administrator ended) wins
      and not exists (select 1 from public.sa_role_assignments a where a.user_id = u.id and a.role_id = br.id)
    order by br.role_key, u.id
  loop
    v_scope := public.sa_ensure_scope_internal(r.org, 'organization', r.org::text,
      coalesce((select org_name from public.organizations where id = r.org), r.org::text), '{}'::jsonb);
    perform public.sa_create_assignment_internal(null, r.user_id, r.role_id, r.org, array[v_scope], null, null,
      'Stage 2D backfill: holds this access under today''s legacy rule', 'backfill');
    n := n + 1;
  end loop;
  raise notice 'Stage 2D backfill: % assignment(s) created', n;
  return n;
end
$backfill$;
revoke all on function public.sa_stage2d_backfill() from public, anon, authenticated, service_role;
comment on function public.sa_stage2d_backfill() is
  'Grants the Stage 2D roles to people today''s legacy rules admit (never re-grants an ended assignment). Owner-run maintenance.';

select public.sa_stage2d_backfill();

-- ---------------------------------------------------------------------------
-- 4. Post-conditions
-- ---------------------------------------------------------------------------
do $post$
declare v_bad integer;
begin
  select count(*) into v_bad from public.sa_migration_modes
  where permission_key in ('customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
                           'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal',
                           'customer.crm.view','marketing.module.view','product.catalog.view','ecommerce.module.view',
                           'ecommerce.outdoor.operate','platform.notification_monitor.view');
  if v_bad <> 13 then raise exception 'postcondition: expected 13 Stage 2D permissions with a mode, found %', v_bad; end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('sa_readable_organizations','sa_actor_dominates','sa_stage2d_legacy_qualifies','sa_stage2d_backfill')
               and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'postcondition: Stage 2D functions must not be executable by anon/authenticated';
  end if;

  -- Parity at backfill time: every qualifying portal user with a membership
  -- is allowed by S&A in their own organization, unless an administrator
  -- ended that assignment.
  select count(*) into v_bad
  from public.sa_business_roles br
  join public.sa_business_role_permissions rp on rp.role_id = br.id
  join public.sa_permissions p on p.id = rp.permission_id
  cross join public.users u
  join public.roles lr on lr.role_code = u.role_code
  left join public.organizations o on o.id = u.organization_id
  where br.role_key in ('support-inbox-administrator','customer-report-viewer','customer-messaging-manager','storefront-banner-manager',
                        'adjustment-administrator','profile-administrator','hr-internal-directory-viewer','crm-viewer',
                        'marketing-viewer','catalog-viewer','ecommerce-viewer','outdoor-store-operator','notification-monitor-viewer')
    and u.is_active and u.account_scope = 'portal' and u.organization_id is not null
    and public.sa_stage2d_legacy_qualifies(br.role_key, u.role_code, lr.role_level, o.org_type_code, u.principal_type)
    and exists (select 1 from public.sa_organization_memberships m
                where m.user_id = u.id and m.organization_id = u.organization_id and m.status = 'active')
    and not exists (select 1 from public.sa_role_assignments a where a.user_id = u.id and a.role_id = br.id and a.status <> 'active')
    and coalesce(public.sa_evaluate_permission(u.id, p.permission_key, jsonb_build_object('organization_id', u.organization_id), false)->>'decision','DENY') <> 'ALLOW';
  if v_bad > 0 then raise exception 'postcondition: % qualifying users are not allowed by S&A after the backfill', v_bad; end if;

  -- The readable-organization function agrees with the evaluator for every
  -- portal user on one enforced organization-scoped permission.
  -- (every non-shop organization plus a sample of 25 shops keeps this bounded)
  select count(*) into v_bad
  from public.users u
  cross join lateral (select public.sa_readable_organizations(u.id, 'inventory.report.view') as ro) r
  cross join (select id from public.organizations where org_type_code is distinct from 'SHOP'
              union all (select id from public.organizations where org_type_code = 'SHOP' order by id limit 25)) o
  where u.is_active and u.account_scope = 'portal'
    and ((o.id = any(r.ro))
         <> (coalesce(public.sa_evaluate_permission(u.id, 'inventory.report.view', jsonb_build_object('organization_id', o.id), true)->>'decision','DENY') = 'ALLOW'));
  if v_bad > 0 then raise exception 'postcondition: sa_readable_organizations disagrees with sa_evaluate_permission in % case(s)', v_bad; end if;
end
$post$;
