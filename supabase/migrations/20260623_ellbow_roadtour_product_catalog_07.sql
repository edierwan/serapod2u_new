-- Ellbow Loyalty Phase 3: RoadTour Product Catalog assortment rules.
--
-- Purpose
--   Adds program-scoped RoadTour assortment tables so an admin can control which
--   Product Master products appear on the Ellbow RoadTour mobile Product page,
--   WITHOUT duplicating any product, brand, variant, image, stock or pricing data.
--   These tables store only catalog rules and product selections; the existing
--   Product Master (products / product_categories / brands / product_variants)
--   remains the single source of product information and is never modified here.
--
-- Execution order
--   Run AFTER 20260623_ellbow_security_cost_controls_06.sql.
--   This is Ellbow migration _07 (the next sequence after _06).
--
-- Safety
--   * No DROP on existing objects (only `drop policy if exists` / `drop trigger
--     if exists` for the new tables, which is idempotent and safe to re-run).
--   * No Cellera/Vape data is written. The Ellbow Vape category is locked to the
--     'excluded' inclusion mode by a CHECK-style guard in the application and by
--     the default seed (server-side); Vape products can never be auto-included.
--   * No Product Master row is inserted/updated/deleted.
--   * IF NOT EXISTS used throughout; safe for existing organizations.
--   * Reuses the existing public.ellbow_set_updated_at() and
--     public.ellbow_enforce_program_scope() helpers from migration _01.
--
-- Rollback guidance (only before the RoadTour catalog is used)
--   drop table if exists public.roadtour_product_catalog_items;
--   drop table if exists public.roadtour_product_category_rules;
--   drop table if exists public.roadtour_product_catalogs;
--   (No other object created by earlier migrations is touched.)

-- ---------------------------------------------------------------------------
-- 1. Catalogs: one assortment container per organization + loyalty program.
-- ---------------------------------------------------------------------------
create table if not exists public.roadtour_product_catalogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  code text not null check (code ~ '^[a-z][a-z0-9_-]*$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadtour_catalogs_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade,
  -- one catalog per organization + program, and per organization + code
  constraint roadtour_catalogs_org_program_key unique (organization_id, loyalty_program_id),
  constraint roadtour_catalogs_org_code_key unique (organization_id, code),
  -- composite identity so child tables can enforce org + program scope via FK
  constraint roadtour_catalogs_identity_key unique (id, organization_id, loyalty_program_id)
);

create index if not exists roadtour_catalogs_program_idx
  on public.roadtour_product_catalogs(loyalty_program_id, active);

-- ---------------------------------------------------------------------------
-- 2. Category rules: one inclusion mode per catalog + Product Master category.
--    product_categories is GLOBAL master data (no organization_id); we only
--    reference its id and never modify it.
-- ---------------------------------------------------------------------------
create table if not exists public.roadtour_product_category_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  catalog_id uuid not null,
  product_category_id uuid not null references public.product_categories(id) on delete cascade,
  inclusion_mode text not null default 'excluded'
    check (inclusion_mode in ('include_all', 'selected_only', 'excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadtour_category_rules_catalog_fk foreign key (catalog_id, organization_id, loyalty_program_id)
    references public.roadtour_product_catalogs(id, organization_id, loyalty_program_id) on delete cascade,
  constraint roadtour_category_rules_catalog_category_key unique (catalog_id, product_category_id)
);

create index if not exists roadtour_category_rules_catalog_idx
  on public.roadtour_product_category_rules(catalog_id);
create index if not exists roadtour_category_rules_category_idx
  on public.roadtour_product_category_rules(product_category_id);

-- ---------------------------------------------------------------------------
-- 3. Catalog items: per-product override + featured + sort order.
--    products is Product Master data; we only reference its id.
-- ---------------------------------------------------------------------------
create table if not exists public.roadtour_product_catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  catalog_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  visibility_override text check (visibility_override in ('include', 'exclude')),
  featured boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadtour_catalog_items_catalog_fk foreign key (catalog_id, organization_id, loyalty_program_id)
    references public.roadtour_product_catalogs(id, organization_id, loyalty_program_id) on delete cascade,
  constraint roadtour_catalog_items_catalog_product_key unique (catalog_id, product_id)
);

create index if not exists roadtour_catalog_items_catalog_idx
  on public.roadtour_product_catalog_items(catalog_id);
create index if not exists roadtour_catalog_items_product_idx
  on public.roadtour_product_catalog_items(product_id);
create index if not exists roadtour_catalog_items_featured_idx
  on public.roadtour_product_catalog_items(catalog_id, featured, sort_order);

-- ---------------------------------------------------------------------------
-- 4. Timestamps + program-scope enforcement (reuse Ellbow Phase 1 helpers).
-- ---------------------------------------------------------------------------
drop trigger if exists roadtour_catalogs_set_updated_at on public.roadtour_product_catalogs;
create trigger roadtour_catalogs_set_updated_at before update on public.roadtour_product_catalogs
for each row execute function public.ellbow_set_updated_at();
drop trigger if exists roadtour_category_rules_set_updated_at on public.roadtour_product_category_rules;
create trigger roadtour_category_rules_set_updated_at before update on public.roadtour_product_category_rules
for each row execute function public.ellbow_set_updated_at();
drop trigger if exists roadtour_catalog_items_set_updated_at on public.roadtour_product_catalog_items;
create trigger roadtour_catalog_items_set_updated_at before update on public.roadtour_product_catalog_items
for each row execute function public.ellbow_set_updated_at();

drop trigger if exists roadtour_catalogs_enforce_program on public.roadtour_product_catalogs;
create trigger roadtour_catalogs_enforce_program before insert or update on public.roadtour_product_catalogs
for each row execute function public.ellbow_enforce_program_scope();
drop trigger if exists roadtour_category_rules_enforce_program on public.roadtour_product_category_rules;
create trigger roadtour_category_rules_enforce_program before insert or update on public.roadtour_product_category_rules
for each row execute function public.ellbow_enforce_program_scope();
drop trigger if exists roadtour_catalog_items_enforce_program on public.roadtour_product_catalog_items;
create trigger roadtour_catalog_items_enforce_program before insert or update on public.roadtour_product_catalog_items
for each row execute function public.ellbow_enforce_program_scope();

-- ---------------------------------------------------------------------------
-- 5. Vape lock: a RoadTour category rule for an is_vape category may only be
--    'excluded'. Belt-and-braces guard so Vape can never be auto-included for
--    Ellbow regardless of how the row is written.
-- ---------------------------------------------------------------------------
create or replace function public.roadtour_enforce_vape_excluded()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.inclusion_mode <> 'excluded' and exists (
    select 1 from public.product_categories c
    where c.id = new.product_category_id and c.is_vape = true
  ) then
    raise exception 'Vape categories must remain excluded from the RoadTour catalog';
  end if;
  return new;
end;
$$;

drop trigger if exists roadtour_category_rules_vape_lock on public.roadtour_product_category_rules;
create trigger roadtour_category_rules_vape_lock before insert or update on public.roadtour_product_category_rules
for each row execute function public.roadtour_enforce_vape_excluded();

-- A Vape product can never receive an 'include' override either.
create or replace function public.roadtour_enforce_vape_item_excluded()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.visibility_override = 'include' and exists (
    select 1 from public.products p
    join public.product_categories c on c.id = p.category_id
    where p.id = new.product_id and c.is_vape = true
  ) then
    raise exception 'Vape products cannot be included in the RoadTour catalog';
  end if;
  return new;
end;
$$;

drop trigger if exists roadtour_catalog_items_vape_lock on public.roadtour_product_catalog_items;
create trigger roadtour_catalog_items_vape_lock before insert or update on public.roadtour_product_catalog_items
for each row execute function public.roadtour_enforce_vape_item_excluded();

-- ---------------------------------------------------------------------------
-- 6. RLS: organization isolation + HQ/power-user admin (role_level <= 40),
--    matching the existing Ellbow catalog convention from migration _01.
-- ---------------------------------------------------------------------------
alter table public.roadtour_product_catalogs enable row level security;
alter table public.roadtour_product_category_rules enable row level security;
alter table public.roadtour_product_catalog_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['roadtour_product_catalogs','roadtour_product_category_rules','roadtour_product_catalog_items'] loop
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

comment on table public.roadtour_product_catalogs is
  'Ellbow/Cellera RoadTour assortment container. Stores catalog rules only; product data stays in Product Master.';
comment on table public.roadtour_product_category_rules is
  'Per-category inclusion mode (include_all|selected_only|excluded) for a RoadTour catalog. Vape locked to excluded.';
comment on table public.roadtour_product_catalog_items is
  'Per-product override (include|exclude), featured flag and mobile sort order for a RoadTour catalog.';
