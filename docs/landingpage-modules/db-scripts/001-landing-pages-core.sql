create extension if not exists pgcrypto;

create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  internal_name text not null,
  public_title text not null,
  slug text not null unique,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source_mode text not null default 'manual' check (source_mode in ('manual', 'category')),
  category_id uuid references public.product_categories(id) on delete set null,
  max_products integer not null default 12 check (max_products between 1 and 60),
  hero jsonb not null default '{"badge_text":"Exclusive Deal","headline":"","subtitle":"","hero_image_url":"","primary_cta_label":"Shop Now","secondary_cta_label":"View Deals","secondary_cta_url":""}'::jsonb,
  display_settings jsonb not null default '{"show_price":true,"show_brand":true,"show_category":true,"hide_out_of_stock":false,"cta_mode":"add_to_cart","enable_add_to_cart":true,"enable_buy_now":true,"enable_whatsapp":false,"whatsapp_phone":""}'::jsonb,
  tracking_defaults jsonb not null default '{"source_code":"","utm_source":"","utm_medium":"","utm_campaign":"","utm_content":"","utm_term":""}'::jsonb,
  publish_start_at timestamptz,
  publish_end_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landing_pages_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint landing_pages_publish_window check (publish_end_at is null or publish_start_at is null or publish_end_at > publish_start_at)
);

create index if not exists idx_landing_pages_organization_status on public.landing_pages(organization_id, status);
create index if not exists idx_landing_pages_slug_status on public.landing_pages(slug, status);
create index if not exists idx_landing_pages_category on public.landing_pages(category_id);

create or replace function public.set_landing_pages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_landing_pages_updated_at on public.landing_pages;
create trigger trg_landing_pages_updated_at
before update on public.landing_pages
for each row execute function public.set_landing_pages_updated_at();