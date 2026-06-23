-- Ellbow Loyalty Phase 8: additive loyalty program membership foundation.
-- Run after 20260623_ellbow_roadtour_product_catalog_07.sql.
-- Rollback guidance: only if no dependent data has been used, drop the two
-- membership tables and helper functions/policies created here. Do not drop
-- public.loyalty_programs or any wallet/reward/transaction table.

create extension if not exists pgcrypto;

insert into public.loyalty_programs (organization_id, code, name, active)
select o.id, 'cellera', 'Cellera Loyalty', true
from public.organizations o
where o.org_type_code = 'HQ'
  and coalesce(o.is_active, true) = true
on conflict (organization_id, code) do update
set name = excluded.name,
    active = true,
    updated_at = now();

create table if not exists public.loyalty_program_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  member_organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive', 'ended', 'deleted')),
  enrollment_source text not null check (enrollment_source in ('legacy_backfill', 'roadtour', 'legacy_registration', 'admin')),
  first_roadtour_run_id uuid references public.roadtour_runs(id) on delete set null,
  first_campaign_id uuid references public.roadtour_campaigns(id) on delete set null,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_program_org_memberships_program_owner_fk
    foreign key (loyalty_program_id, owner_organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  constraint loyalty_program_org_memberships_active_window
    check (ended_at is null or ended_at >= enrolled_at),
  constraint loyalty_program_org_memberships_key
    unique (owner_organization_id, loyalty_program_id, member_organization_id)
);

create table if not exists public.loyalty_program_user_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  member_organization_id uuid references public.organizations(id) on delete set null,
  participant_type text not null check (participant_type in ('organization_user', 'shop_staff', 'consumer')),
  status text not null default 'active' check (status in ('active', 'inactive', 'ended', 'deleted')),
  enrollment_source text not null check (enrollment_source in ('legacy_backfill', 'roadtour', 'legacy_registration', 'admin')),
  first_roadtour_run_id uuid references public.roadtour_runs(id) on delete set null,
  first_campaign_id uuid references public.roadtour_campaigns(id) on delete set null,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_program_user_memberships_program_owner_fk
    foreign key (loyalty_program_id, owner_organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  constraint loyalty_program_user_memberships_active_window
    check (ended_at is null or ended_at >= enrolled_at),
  constraint loyalty_program_user_memberships_key
    unique (owner_organization_id, loyalty_program_id, user_id, participant_type)
);

create index if not exists lpo_memberships_member_idx
  on public.loyalty_program_organization_memberships(member_organization_id, status);
create index if not exists lpo_memberships_program_idx
  on public.loyalty_program_organization_memberships(owner_organization_id, loyalty_program_id, status);
create index if not exists lpu_memberships_user_idx
  on public.loyalty_program_user_memberships(user_id, status);
create index if not exists lpu_memberships_member_org_idx
  on public.loyalty_program_user_memberships(member_organization_id, status);
create index if not exists lpu_memberships_program_idx
  on public.loyalty_program_user_memberships(owner_organization_id, loyalty_program_id, status);

create or replace function public.loyalty_program_membership_owner_org(p_member_organization_id uuid)
returns uuid language sql stable set search_path = public as $$
  with recursive org_path as (
    select o.id, o.parent_org_id, o.org_type_code, 0 as depth
    from public.organizations o
    where o.id = p_member_organization_id
    union all
    select parent.id, parent.parent_org_id, parent.org_type_code, org_path.depth + 1
    from public.organizations parent
    join org_path on org_path.parent_org_id = parent.id
    where org_path.depth < 8
  )
  select coalesce(
    (select id from org_path where org_type_code = 'HQ' order by depth desc limit 1),
    p_member_organization_id
  );
$$;

create or replace function public.loyalty_program_label(p_codes text[])
returns text language sql immutable as $$
  select case
    when coalesce(array_length(p_codes, 1), 0) = 0 then 'Not Enrolled'
    when 'cellera' = any(p_codes) and 'ellbow' = any(p_codes) then 'Cellera + Ellbow'
    when 'cellera' = any(p_codes) then 'Cellera'
    when 'ellbow' = any(p_codes) then 'Ellbow'
    else 'Not Enrolled'
  end;
$$;

create or replace function public.loyalty_program_upsert_organization_membership(
  p_program_code text,
  p_member_organization_id uuid,
  p_enrollment_source text,
  p_owner_organization_id uuid default null,
  p_first_roadtour_run_id uuid default null,
  p_first_campaign_id uuid default null,
  p_created_by uuid default null,
  p_status text default 'active'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_program public.loyalty_programs%rowtype;
  v_membership_id uuid;
  v_program_name text;
begin
  if p_program_code not in ('cellera', 'ellbow') then
    raise exception 'Unsupported loyalty program code: %', p_program_code;
  end if;

  v_owner := coalesce(p_owner_organization_id, public.loyalty_program_membership_owner_org(p_member_organization_id));
  v_program_name := case p_program_code when 'cellera' then 'Cellera Loyalty' when 'ellbow' then 'Ellbow Loyalty' end;

  insert into public.loyalty_programs (organization_id, code, name, active)
  values (v_owner, p_program_code, v_program_name, true)
  on conflict (organization_id, code) do update
  set name = excluded.name,
      active = true,
      updated_at = now()
  returning * into v_program;

  insert into public.loyalty_program_organization_memberships (
    owner_organization_id, loyalty_program_id, member_organization_id, status,
    enrollment_source, first_roadtour_run_id, first_campaign_id, created_by
  ) values (
    v_owner, v_program.id, p_member_organization_id, coalesce(p_status, 'active'),
    p_enrollment_source, p_first_roadtour_run_id, p_first_campaign_id, p_created_by
  )
  on conflict (owner_organization_id, loyalty_program_id, member_organization_id) do update
  set status = case when loyalty_program_organization_memberships.status in ('ended', 'deleted') then loyalty_program_organization_memberships.status else excluded.status end,
      first_roadtour_run_id = coalesce(loyalty_program_organization_memberships.first_roadtour_run_id, excluded.first_roadtour_run_id),
      first_campaign_id = coalesce(loyalty_program_organization_memberships.first_campaign_id, excluded.first_campaign_id),
      updated_at = now()
  returning id into v_membership_id;

  return v_membership_id;
end;
$$;

create or replace function public.loyalty_program_upsert_user_membership(
  p_program_code text,
  p_user_id uuid,
  p_participant_type text,
  p_enrollment_source text,
  p_member_organization_id uuid default null,
  p_owner_organization_id uuid default null,
  p_first_roadtour_run_id uuid default null,
  p_first_campaign_id uuid default null,
  p_created_by uuid default null,
  p_status text default 'active'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_member_org uuid;
  v_owner uuid;
  v_program public.loyalty_programs%rowtype;
  v_membership_id uuid;
  v_program_name text;
begin
  if p_program_code not in ('cellera', 'ellbow') then
    raise exception 'Unsupported loyalty program code: %', p_program_code;
  end if;
  if p_participant_type not in ('organization_user', 'shop_staff', 'consumer') then
    raise exception 'Unsupported loyalty participant type: %', p_participant_type;
  end if;

  select coalesce(p_member_organization_id, u.organization_id)
  into v_member_org
  from public.users u
  where u.id = p_user_id;

  v_owner := coalesce(
    p_owner_organization_id,
    case when v_member_org is not null then public.loyalty_program_membership_owner_org(v_member_org) end
  );

  if v_owner is null then
    select organization_id into v_owner
    from public.loyalty_programs
    where code = p_program_code
    order by created_at asc
    limit 1;
  end if;
  if v_owner is null then
    raise exception 'Cannot resolve loyalty program owner for user %', p_user_id;
  end if;

  v_program_name := case p_program_code when 'cellera' then 'Cellera Loyalty' when 'ellbow' then 'Ellbow Loyalty' end;
  insert into public.loyalty_programs (organization_id, code, name, active)
  values (v_owner, p_program_code, v_program_name, true)
  on conflict (organization_id, code) do update
  set name = excluded.name,
      active = true,
      updated_at = now()
  returning * into v_program;

  insert into public.loyalty_program_user_memberships (
    owner_organization_id, loyalty_program_id, user_id, member_organization_id,
    participant_type, status, enrollment_source, first_roadtour_run_id, first_campaign_id, created_by
  ) values (
    v_owner, v_program.id, p_user_id, v_member_org, p_participant_type,
    coalesce(p_status, 'active'), p_enrollment_source, p_first_roadtour_run_id, p_first_campaign_id, p_created_by
  )
  on conflict (owner_organization_id, loyalty_program_id, user_id, participant_type) do update
  set member_organization_id = coalesce(excluded.member_organization_id, loyalty_program_user_memberships.member_organization_id),
      status = case when loyalty_program_user_memberships.status in ('ended', 'deleted') then loyalty_program_user_memberships.status else excluded.status end,
      first_roadtour_run_id = coalesce(loyalty_program_user_memberships.first_roadtour_run_id, excluded.first_roadtour_run_id),
      first_campaign_id = coalesce(loyalty_program_user_memberships.first_campaign_id, excluded.first_campaign_id),
      updated_at = now()
  returning id into v_membership_id;

  return v_membership_id;
end;
$$;

create or replace function public.loyalty_program_set_membership_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lpo_memberships_set_updated_at on public.loyalty_program_organization_memberships;
create trigger lpo_memberships_set_updated_at before update on public.loyalty_program_organization_memberships
for each row execute function public.loyalty_program_set_membership_updated_at();

drop trigger if exists lpu_memberships_set_updated_at on public.loyalty_program_user_memberships;
create trigger lpu_memberships_set_updated_at before update on public.loyalty_program_user_memberships
for each row execute function public.loyalty_program_set_membership_updated_at();

alter table public.loyalty_program_organization_memberships enable row level security;
alter table public.loyalty_program_user_memberships enable row level security;

do $$
declare t text;
begin
  foreach t in array array['loyalty_program_organization_memberships','loyalty_program_user_memberships'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (
      owner_organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (
      owner_organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (
      owner_organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    ) with check (
      owner_organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_update', t);
  end loop;
end $$;

revoke all on function public.loyalty_program_upsert_organization_membership(text, uuid, text, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.loyalty_program_upsert_user_membership(text, uuid, text, text, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.loyalty_program_upsert_organization_membership(text, uuid, text, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.loyalty_program_upsert_user_membership(text, uuid, text, text, uuid, uuid, uuid, uuid, uuid, text) to service_role;

comment on table public.loyalty_program_organization_memberships is 'Additive mapping of organizations to loyalty programs such as Cellera and Ellbow. Wallets are intentionally separate.';
comment on table public.loyalty_program_user_memberships is 'Additive mapping of users to loyalty programs and participant lanes. Wallets are intentionally separate.';
