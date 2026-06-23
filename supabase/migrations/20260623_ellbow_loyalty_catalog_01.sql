-- Ellbow Loyalty Phase 1: isolated program identity, reward catalog and settings.
-- Execution order: this is the only Ellbow migration in Phase 1.
-- Rollback (only before Ellbow is used): drop the four ellbow_* child tables, then
-- public.loyalty_programs. No legacy Point Catalog object is read or changed here.

create extension if not exists pgcrypto;

create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_programs_code_format check (code ~ '^[a-z][a-z0-9_-]*$'),
  constraint loyalty_programs_org_code_key unique (organization_id, code),
  constraint loyalty_programs_identity_key unique (id, organization_id)
);

create table if not exists public.ellbow_reward_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_categories_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  constraint ellbow_categories_org_program_name_key unique (organization_id, loyalty_program_id, name),
  constraint ellbow_categories_identity_key unique (id, organization_id, loyalty_program_id)
);

create table if not exists public.ellbow_rewards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  category_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  code text not null check (length(btrim(code)) > 0),
  description text,
  points_required integer not null default 0 check (points_required >= 0),
  point_offer integer check (point_offer is null or point_offer >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  status text not null default 'paused' check (status in ('available', 'scheduled', 'paused', 'expired', 'sold_out')),
  valid_from timestamptz,
  valid_until timestamptz,
  verification_mode text not null default 'manual' check (verification_mode in ('manual', 'automatic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_rewards_valid_window check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint ellbow_rewards_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  constraint ellbow_rewards_category_scope_fk foreign key (category_id, organization_id, loyalty_program_id)
    references public.ellbow_reward_categories(id, organization_id, loyalty_program_id) on delete restrict,
  constraint ellbow_rewards_org_program_code_key unique (organization_id, loyalty_program_id, code),
  constraint ellbow_rewards_identity_key unique (id, organization_id, loyalty_program_id)
);

create table if not exists public.ellbow_reward_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  reward_id uuid not null,
  storage_path text not null check (storage_path like 'loyalty/ellbow/%'),
  sort_order integer not null default 0 check (sort_order between 0 and 4),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ellbow_images_reward_scope_fk foreign key (reward_id, organization_id, loyalty_program_id)
    references public.ellbow_rewards(id, organization_id, loyalty_program_id) on delete cascade,
  constraint ellbow_images_reward_path_key unique (reward_id, storage_path)
);

create unique index if not exists ellbow_reward_images_one_default_idx
  on public.ellbow_reward_images(reward_id) where is_default;

create table if not exists public.ellbow_loyalty_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  active boolean not null default false,
  claim_mode text not null default 'single' check (claim_mode in ('single', 'dual')),
  staff_points_per_scan integer not null default 0 check (staff_points_per_scan >= 0),
  consumer_points_per_scan integer not null default 0 check (consumer_points_per_scan >= 0),
  point_value_rm numeric(12,4) not null default 0 check (point_value_rm >= 0),
  roadtour_reward_points integer not null default 0 check (roadtour_reward_points >= 0),
  registration_bonus integer not null default 0 check (registration_bonus >= 0),
  referral_incentive_default integer not null default 0 check (referral_incentive_default >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_settings_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  constraint ellbow_settings_org_program_key unique (organization_id, loyalty_program_id)
);

create index if not exists ellbow_categories_scope_idx on public.ellbow_reward_categories(organization_id, loyalty_program_id);
create index if not exists ellbow_rewards_scope_status_idx on public.ellbow_rewards(organization_id, loyalty_program_id, status);
create index if not exists ellbow_reward_images_scope_idx on public.ellbow_reward_images(organization_id, loyalty_program_id, reward_id);

create or replace function public.ellbow_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.ellbow_enforce_program_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.loyalty_programs p
    where p.id = new.loyalty_program_id
      and p.organization_id = new.organization_id
      and p.code = 'ellbow'
  ) then
    raise exception 'Ellbow records must belong to the Ellbow loyalty program';
  end if;
  return new;
end;
$$;

create or replace function public.ellbow_validate_reward_image()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.storage_path not like ('loyalty/ellbow/' || new.organization_id::text || '/rewards/' || new.reward_id::text || '/%') then
    raise exception 'Invalid Ellbow reward image path';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.ellbow_reward_images i where i.reward_id = new.reward_id) >= 5 then
    raise exception 'An Ellbow reward can have at most 5 images';
  end if;
  if not exists (
    select 1 from public.loyalty_programs p
    where p.id = new.loyalty_program_id
      and p.organization_id = new.organization_id
      and p.code = 'ellbow'
  ) then
    raise exception 'Ellbow images must belong to the Ellbow loyalty program';
  end if;
  return new;
end;
$$;

drop trigger if exists loyalty_programs_set_updated_at on public.loyalty_programs;
create trigger loyalty_programs_set_updated_at before update on public.loyalty_programs
for each row execute function public.ellbow_set_updated_at();
drop trigger if exists ellbow_categories_set_updated_at on public.ellbow_reward_categories;
create trigger ellbow_categories_set_updated_at before update on public.ellbow_reward_categories
for each row execute function public.ellbow_set_updated_at();
drop trigger if exists ellbow_rewards_set_updated_at on public.ellbow_rewards;
create trigger ellbow_rewards_set_updated_at before update on public.ellbow_rewards
for each row execute function public.ellbow_set_updated_at();
drop trigger if exists ellbow_settings_set_updated_at on public.ellbow_loyalty_settings;
create trigger ellbow_settings_set_updated_at before update on public.ellbow_loyalty_settings
for each row execute function public.ellbow_set_updated_at();

drop trigger if exists ellbow_categories_enforce_program on public.ellbow_reward_categories;
create trigger ellbow_categories_enforce_program before insert or update on public.ellbow_reward_categories
for each row execute function public.ellbow_enforce_program_scope();
drop trigger if exists ellbow_rewards_enforce_program on public.ellbow_rewards;
create trigger ellbow_rewards_enforce_program before insert or update on public.ellbow_rewards
for each row execute function public.ellbow_enforce_program_scope();
drop trigger if exists ellbow_settings_enforce_program on public.ellbow_loyalty_settings;
create trigger ellbow_settings_enforce_program before insert or update on public.ellbow_loyalty_settings
for each row execute function public.ellbow_enforce_program_scope();
drop trigger if exists ellbow_images_validate on public.ellbow_reward_images;
create trigger ellbow_images_validate before insert or update on public.ellbow_reward_images
for each row execute function public.ellbow_validate_reward_image();

alter table public.loyalty_programs enable row level security;
alter table public.ellbow_reward_categories enable row level security;
alter table public.ellbow_rewards enable row level security;
alter table public.ellbow_reward_images enable row level security;
alter table public.ellbow_loyalty_settings enable row level security;

-- Reward files stay in the existing public avatars bucket for URL compatibility,
-- but writes are constrained to loyalty/ellbow/{caller's organization}/...
drop policy if exists ellbow_reward_images_select on storage.objects;
create policy ellbow_reward_images_select on storage.objects for select to authenticated using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'loyalty'
  and (storage.foldername(name))[2] = 'ellbow'
  and (storage.foldername(name))[3] = (select u.organization_id::text from public.users u where u.id = auth.uid() and u.is_active = true)
);
drop policy if exists ellbow_reward_images_insert on storage.objects;
create policy ellbow_reward_images_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'loyalty'
  and (storage.foldername(name))[2] = 'ellbow'
  and (storage.foldername(name))[3] = (select u.organization_id::text from public.users u where u.id = auth.uid() and u.is_active = true)
);
drop policy if exists ellbow_reward_images_update on storage.objects;
create policy ellbow_reward_images_update on storage.objects for update to authenticated using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'loyalty'
  and (storage.foldername(name))[2] = 'ellbow'
  and (storage.foldername(name))[3] = (select u.organization_id::text from public.users u where u.id = auth.uid() and u.is_active = true)
) with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'loyalty'
  and (storage.foldername(name))[2] = 'ellbow'
  and (storage.foldername(name))[3] = (select u.organization_id::text from public.users u where u.id = auth.uid() and u.is_active = true)
);
drop policy if exists ellbow_reward_images_delete on storage.objects;
create policy ellbow_reward_images_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'loyalty'
  and (storage.foldername(name))[2] = 'ellbow'
  and (storage.foldername(name))[3] = (select u.organization_id::text from public.users u where u.id = auth.uid() and u.is_active = true)
);

-- Catalog administration follows the existing HQ/power-user convention:
-- authenticated, active users at role level 40 or above in authority (<= 40),
-- constrained to their own organization. Composite foreign keys enforce program scope.
do $$
declare t text;
begin
  foreach t in array array['loyalty_programs','ellbow_reward_categories','ellbow_rewards','ellbow_reward_images','ellbow_loyalty_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (
      organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (
      organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (
      organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    ) with check (
      organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (
      organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
      and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and u.is_active = true and r.role_level <= 40)
    )', t || '_admin_delete', t);
  end loop;
end $$;

comment on table public.loyalty_programs is 'Program identities for additive loyalty programs; legacy Cellera data remains in existing tables.';
comment on table public.ellbow_rewards is 'Ellbow-only Phase 1 rewards. No wallet or redemption behavior is attached.';
comment on table public.ellbow_loyalty_settings is 'Stored Ellbow configuration only; not connected to the legacy point engine in Phase 1.';
