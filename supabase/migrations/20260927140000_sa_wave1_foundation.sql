-- Security & Access Wave 1: additive foundation.
-- Rollback: drop the sa_* tables in reverse dependency order. This migration
-- does not alter users.organization_id, users.role_code, roles, or Phase 0 RLS.

create table if not exists public.sa_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_type text not null default 'employee' check (membership_type ~ '^[a-z][a-z0-9_]*$'),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('pending','active','suspended','inactive')),
  effective_from timestamptz,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint sa_membership_dates_valid check (effective_until is null or effective_from is null or effective_until > effective_from),
  unique (user_id, organization_id, membership_type)
);
create unique index if not exists sa_one_primary_membership_per_user
  on public.sa_organization_memberships(user_id) where is_primary and status = 'active';
create index if not exists sa_memberships_org_user_idx on public.sa_organization_memberships(organization_id, user_id);

create table if not exists public.sa_permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique check (permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  module text not null,
  resource text not null,
  action text not null,
  description text,
  status text not null default 'active' check (status in ('active','deprecated')),
  source text not null default 'new' check (source in ('legacy','new','template')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint sa_permission_key_parts check (permission_key = module || '.' || resource || '.' || action)
);

create table if not exists public.sa_business_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_-]*$'),
  name text not null,
  description text,
  source text not null default 'new' check (source in ('legacy','new','template')),
  status text not null default 'active' check (status in ('active','deprecated')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

create table if not exists public.sa_business_role_permissions (
  role_id uuid not null references public.sa_business_roles(id) on delete cascade,
  permission_id uuid not null references public.sa_permissions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (role_id, permission_id)
);

create table if not exists public.sa_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.sa_business_roles(id) on delete restrict,
  membership_id uuid not null references public.sa_organization_memberships(id) on delete cascade,
  status text not null default 'active' check (status in ('pending','active','suspended','revoked')),
  effective_from timestamptz,
  effective_until timestamptz,
  assignment_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint sa_assignment_dates_valid check (effective_until is null or effective_from is null or effective_until > effective_from),
  unique (user_id, role_id, membership_id)
);
create index if not exists sa_role_assignments_user_idx on public.sa_role_assignments(user_id, status);

create table if not exists public.sa_scope_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope_type text not null check (scope_type ~ '^[a-z][a-z0-9_]*$'),
  scope_value text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active','deprecated')),
  resource_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);
create unique index if not exists sa_scope_definition_unique
  on public.sa_scope_definitions(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), scope_type, scope_value);

create table if not exists public.sa_assignment_scopes (
  assignment_id uuid not null references public.sa_role_assignments(id) on delete cascade,
  scope_id uuid not null references public.sa_scope_definitions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (assignment_id, scope_id)
);

create table if not exists public.sa_migration_modes (
  permission_key text primary key references public.sa_permissions(permission_key) on update cascade on delete restrict,
  mode text not null check (mode in ('LEGACY_ENFORCED','SHADOW','NEW_ENFORCED','LEGACY_RETIRED')),
  legacy_permission_key text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

create table if not exists public.sa_authorization_decisions (
  id uuid primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  permission_key text not null,
  resource_type text not null,
  resource_id text,
  decision text not null check (decision in ('ALLOW','DENY')),
  reason_code text not null,
  matched_assignments jsonb not null default '[]'::jsonb,
  resolved_scopes jsonb not null default '[]'::jsonb,
  migration_mode text not null check (migration_mode in ('LEGACY_ENFORCED','SHADOW','NEW_ENFORCED','LEGACY_RETIRED')),
  legacy_decision text check (legacy_decision in ('ALLOW','DENY')),
  new_decision text not null check (new_decision in ('ALLOW','DENY')),
  comparison text not null check (comparison in ('MATCH_ALLOW','MATCH_DENY','LEGACY_ALLOW_NEW_DENY','LEGACY_DENY_NEW_ALLOW','SCOPE_MISMATCH','MISSING_ASSIGNMENT','MISSING_CONTEXT','POLICY_ERROR')),
  correlation_id text,
  policy_version text not null
);
create index if not exists sa_decisions_actor_time_idx on public.sa_authorization_decisions(actor_id, occurred_at desc);
create index if not exists sa_decisions_comparison_time_idx on public.sa_authorization_decisions(comparison, occurred_at desc);
create index if not exists sa_decisions_permission_time_idx on public.sa_authorization_decisions(permission_key, occurred_at desc);

comment on table public.sa_organization_memberships is 'Enterprise business relationships; coexists with users.organization_id during migration.';
comment on table public.sa_permissions is 'Stable generic permission catalog using module.resource.action keys.';
comment on table public.sa_business_roles is 'Composable enterprise roles; never consumer account classifications.';
comment on table public.sa_role_assignments is 'Effective-dated role assignment bound to an organization membership.';
comment on table public.sa_scope_definitions is 'Typed reusable resource scopes. Scope metadata is descriptive, never an authorization expression.';
comment on table public.sa_authorization_decisions is 'Append-oriented server authorization and shadow comparison audit; payloads must not contain secrets.';

do $$
declare t text;
begin
  foreach t in array array[
    'sa_organization_memberships','sa_permissions','sa_business_roles',
    'sa_business_role_permissions','sa_role_assignments','sa_scope_definitions',
    'sa_assignment_scopes','sa_migration_modes','sa_authorization_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- Seed only the canonical vocabulary and templates. No user assignment is made.
insert into public.sa_permissions(permission_key,module,resource,action,description,source) values
 ('security.access.view','security','access','view','View Security & Access administration data','new'),
 ('security.role.assign','security','role','assign','Assign a business role through an authorized server path','new'),
 ('security.permission.manage','security','permission','manage','Manage the canonical permission catalog','new'),
 ('inventory.stock_count.view','inventory','stock_count','view','View stock counts in an authorized scope','new'),
 ('inventory.stock_count.create','inventory','stock_count','create','Create a stock count','new'),
 ('inventory.stock_count.verify','inventory','stock_count','verify','Verify a stock count challenge','new'),
 ('inventory.stock_count.post','inventory','stock_count','post','Post a verified stock count','new'),
 ('inventory.transfer.view','inventory','transfer','view','View stock transfers in an authorized scope','new'),
 ('inventory.transfer.request','inventory','transfer','request','Request a stock transfer','new'),
 ('inventory.transfer.approve','inventory','transfer','approve','Approve a stock transfer','new'),
 ('inventory.transfer.dispatch','inventory','transfer','dispatch','Dispatch a stock transfer','new'),
 ('inventory.transfer.receive','inventory','transfer','receive','Receive a stock transfer','new')
on conflict (permission_key) do nothing;

insert into public.sa_business_roles(role_key,name,description,source) values
 ('warehouse-operator','Warehouse Operator','Template role for scoped warehouse operations','template'),
 ('warehouse-manager','Warehouse Manager','Template role for scoped warehouse management','template')
on conflict (role_key) do nothing;

insert into public.sa_business_role_permissions(role_id,permission_id)
select r.id, p.id from public.sa_business_roles r cross join public.sa_permissions p
where r.role_key = 'warehouse-operator' and p.permission_key in (
  'inventory.stock_count.view','inventory.stock_count.create','inventory.transfer.view',
  'inventory.transfer.request','inventory.transfer.dispatch','inventory.transfer.receive')
on conflict do nothing;
insert into public.sa_business_role_permissions(role_id,permission_id)
select r.id, p.id from public.sa_business_roles r cross join public.sa_permissions p
where r.role_key = 'warehouse-manager' and p.permission_key like 'inventory.%'
on conflict do nothing;

-- Guarded compatibility backfill. account_scope is only an experience
-- classifier here: it is used to exclude store/consumer identities, never to
-- authorize an action. Legacy remains authoritative while these rows provide
-- meaningful SHADOW parity data.
insert into public.sa_organization_memberships(user_id,organization_id,membership_type,is_primary,status)
select u.id,u.organization_id,'legacy_portal',true,'active'
from public.users u
where u.account_scope='portal' and u.organization_id is not null and u.is_active=true
on conflict (user_id,organization_id,membership_type) do nothing;

insert into public.sa_business_roles(role_key,name,description,source,status)
select distinct
  'legacy-' || trim(both '-' from lower(regexp_replace(u.role_code,'[^a-zA-Z0-9]+','-','g'))),
  'Legacy ' || u.role_code,
  'Compatibility-only role generated from the existing role table. Not a target-state business role.',
  'legacy','active'
from public.users u
where u.account_scope='portal' and u.organization_id is not null and u.is_active=true
  and u.role_code is not null and u.role_code ~ '[a-zA-Z0-9]'
on conflict (role_key) do nothing;

with legacy_map(legacy_permission,canonical_permission) as (values
  ('view_inventory','inventory.stock_count.view'),
  ('view_inventory','inventory.transfer.view'),
  ('adjust_stock','inventory.stock_count.create'),
  ('adjust_stock','inventory.transfer.request'),
  ('adjust_stock','inventory.transfer.approve'),
  ('post_stock_count','inventory.stock_count.verify'),
  ('post_stock_count','inventory.stock_count.post'),
  ('ship_goods','inventory.transfer.dispatch'),
  ('receive_goods','inventory.transfer.receive')
), legacy_grants as (
  select role_code,m.canonical_permission
  from (
    select r.role_code,k.permission_key
    from public.roles r
    cross join lateral jsonb_object_keys(case when jsonb_typeof(r.permissions)='object' then r.permissions else '{}'::jsonb end) k(permission_key)
    where coalesce((r.permissions->>k.permission_key)::boolean,false)=true
    union
    select r.role_code,k.permission_key
    from public.roles r
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.permissions)='array' then r.permissions else '[]'::jsonb end) k(permission_key)
  ) legacy_keys
  join legacy_map m on m.legacy_permission=legacy_keys.permission_key
  union
  select r.role_code,p.permission_key from public.roles r cross join public.sa_permissions p
  where r.role_level=1 and p.permission_key like 'inventory.%'
)
insert into public.sa_business_role_permissions(role_id,permission_id)
select br.id,p.id
from legacy_grants g
join public.sa_business_roles br on br.role_key='legacy-' || trim(both '-' from lower(regexp_replace(g.role_code,'[^a-zA-Z0-9]+','-','g')))
join public.sa_permissions p on p.permission_key=g.canonical_permission
on conflict do nothing;

insert into public.sa_role_assignments(user_id,role_id,membership_id,status,assignment_reason)
select u.id,br.id,m.id,'active','Wave 1 guarded legacy compatibility backfill'
from public.users u
join public.sa_organization_memberships m on m.user_id=u.id and m.organization_id=u.organization_id and m.membership_type='legacy_portal'
join public.sa_business_roles br on br.role_key='legacy-' || trim(both '-' from lower(regexp_replace(u.role_code,'[^a-zA-Z0-9]+','-','g')))
where u.account_scope='portal' and u.organization_id is not null and u.is_active=true
on conflict (user_id,role_id,membership_id) do nothing;

insert into public.sa_scope_definitions(organization_id,scope_type,scope_value,display_name,resource_metadata)
select o.id,
  case when o.org_type_code='WH' then 'warehouse' else 'organization' end,
  o.id::text,o.org_name,
  jsonb_build_object('compatibility_source','users.organization_id','org_type_code',o.org_type_code)
from public.organizations o
where exists (select 1 from public.sa_organization_memberships m where m.organization_id=o.id and m.membership_type='legacy_portal')
on conflict do nothing;

insert into public.sa_assignment_scopes(assignment_id,scope_id)
select a.id,s.id
from public.sa_role_assignments a
join public.sa_organization_memberships m on m.id=a.membership_id and m.membership_type='legacy_portal'
join public.sa_scope_definitions s on s.organization_id=m.organization_id
  and s.scope_value=m.organization_id::text
  and s.scope_type=case when exists(select 1 from public.organizations o where o.id=m.organization_id and o.org_type_code='WH') then 'warehouse' else 'organization' end
on conflict do nothing;

insert into public.sa_migration_modes(permission_key,mode,legacy_permission_key,notes)
select permission_key,
  case when permission_key like 'inventory.%' then 'SHADOW' else 'LEGACY_ENFORCED' end,
  case permission_key
    when 'inventory.stock_count.view' then 'view_inventory'
    when 'inventory.stock_count.create' then 'adjust_stock'
    when 'inventory.stock_count.verify' then 'post_stock_count'
    when 'inventory.stock_count.post' then 'post_stock_count'
    when 'inventory.transfer.view' then 'view_inventory'
    when 'inventory.transfer.request' then 'adjust_stock'
    when 'inventory.transfer.approve' then 'adjust_stock'
    when 'inventory.transfer.dispatch' then 'ship_goods'
    when 'inventory.transfer.receive' then 'receive_goods'
    when 'security.access.view' then 'view_users'
    when 'security.role.assign' then 'manage_authorization'
    else null end,
  'Wave 1 compatibility mode; changing to NEW_ENFORCED requires reviewed parity evidence.'
from public.sa_permissions
on conflict (permission_key) do nothing;

-- Atomic mutation path for new-model roles. It is service-role-only; the API
-- authenticates and authorizes the human actor before calling it. Legacy roles
-- can never be modified through this function.
create or replace function public.sa_save_business_role(
  p_actor_id uuid,
  p_role_id uuid,
  p_role_key text,
  p_name text,
  p_description text,
  p_permission_keys text[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_expected integer;
  v_found integer;
begin
  if p_actor_id is null or p_name is null or btrim(p_name) = '' or p_role_key !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'invalid_role';
  end if;
  select count(*) into v_expected from (select distinct unnest(coalesce(p_permission_keys, array[]::text[]))) q;
  select count(*) into v_found from public.sa_permissions
    where status = 'active' and permission_key = any(coalesce(p_permission_keys, array[]::text[]));
  if v_expected <> v_found then raise exception 'invalid_permission'; end if;

  if p_role_id is null then
    insert into public.sa_business_roles(role_key,name,description,source,created_by,updated_by)
    values (p_role_key,btrim(p_name),nullif(btrim(p_description),''),'new',p_actor_id,p_actor_id)
    returning id into v_role_id;
  else
    update public.sa_business_roles set
      role_key=p_role_key,name=btrim(p_name),description=nullif(btrim(p_description),''),
      updated_at=now(),updated_by=p_actor_id,version=version+1
    where id=p_role_id and source='new'
    returning id into v_role_id;
    if v_role_id is null then raise exception 'role_not_editable'; end if;
  end if;
  delete from public.sa_business_role_permissions where role_id=v_role_id;
  insert into public.sa_business_role_permissions(role_id,permission_id,created_by)
    select v_role_id,id,p_actor_id from public.sa_permissions
    where permission_key = any(coalesce(p_permission_keys, array[]::text[]));
  return v_role_id;
end $$;
revoke all on function public.sa_save_business_role(uuid,uuid,text,text,text,text[]) from public, anon, authenticated;
grant execute on function public.sa_save_business_role(uuid,uuid,text,text,text,text[]) to service_role;
comment on function public.sa_save_business_role(uuid,uuid,text,text,text,text[]) is
  'Atomic service-only mutation for new S&A roles. Caller must authorize p_actor_id before invocation.';

create or replace function public.sa_reject_decision_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'authorization_decisions_are_append_only';
end $$;
revoke all on function public.sa_reject_decision_mutation() from public, anon, authenticated;
drop trigger if exists sa_authorization_decisions_append_only on public.sa_authorization_decisions;
create trigger sa_authorization_decisions_append_only
before update or delete on public.sa_authorization_decisions
for each row execute function public.sa_reject_decision_mutation();
