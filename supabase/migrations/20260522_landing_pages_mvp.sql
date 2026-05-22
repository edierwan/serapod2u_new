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

create table if not exists public.landing_page_products (
	landing_page_id uuid not null references public.landing_pages(id) on delete cascade,
	product_id uuid not null references public.products(id) on delete cascade,
	sort_order integer not null default 1 check (sort_order > 0),
	created_at timestamptz not null default now(),
	primary key (landing_page_id, product_id)
);

create unique index if not exists idx_landing_page_products_sort_order
	on public.landing_page_products(landing_page_id, sort_order);
create index if not exists idx_landing_page_products_product
	on public.landing_page_products(product_id);

create or replace function public.enforce_landing_page_source_rules()
returns trigger
language plpgsql
as $$
begin
	if new.source_mode = 'manual' then
		new.category_id = null;
	end if;

	if new.source_mode = 'category' and new.category_id is null then
		raise exception 'category_id is required when source_mode is category';
	end if;

	return new;
end;
$$;

drop trigger if exists trg_landing_pages_source_rules on public.landing_pages;
create trigger trg_landing_pages_source_rules
before insert or update of source_mode, category_id on public.landing_pages
for each row execute function public.enforce_landing_page_source_rules();

comment on table public.landing_page_products is 'Manual product source for landing pages. Empty manual selection resolves to no products; it must never fallback to all products.';
comment on column public.landing_pages.source_mode is 'Allowed values: manual or category. No all-products source is supported.';

create table if not exists public.landing_page_sessions (
	id uuid primary key default gen_random_uuid(),
	landing_page_id uuid not null references public.landing_pages(id) on delete cascade,
	landing_page_slug text not null,
	source_code text,
	utm_source text,
	utm_medium text,
	utm_campaign text,
	utm_content text,
	utm_term text,
	fbclid text,
	referrer_domain text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists idx_landing_page_sessions_page_created
	on public.landing_page_sessions(landing_page_id, created_at desc);
create index if not exists idx_landing_page_sessions_campaign
	on public.landing_page_sessions(utm_campaign);

drop trigger if exists trg_landing_page_sessions_updated_at on public.landing_page_sessions;
create trigger trg_landing_page_sessions_updated_at
before update on public.landing_page_sessions
for each row execute function public.set_landing_pages_updated_at();

create table if not exists public.landing_page_events (
	id uuid primary key default gen_random_uuid(),
	landing_page_id uuid not null references public.landing_pages(id) on delete cascade,
	landing_page_slug text not null,
	landing_page_session_id uuid references public.landing_page_sessions(id) on delete set null,
	event_type text not null check (event_type in ('page_view', 'product_impression', 'product_click', 'product_view', 'add_to_cart', 'buy_now_click', 'checkout_start', 'order_created', 'purchase')),
	product_id uuid references public.products(id) on delete set null,
	variant_id uuid references public.product_variants(id) on delete set null,
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_landing_page_events_page_type_created
	on public.landing_page_events(landing_page_id, event_type, created_at desc);
create index if not exists idx_landing_page_events_session
	on public.landing_page_events(landing_page_session_id);
create index if not exists idx_landing_page_events_product
	on public.landing_page_events(product_id);

create table if not exists public.landing_page_order_attributions (
	id uuid primary key default gen_random_uuid(),
	landing_page_id uuid not null references public.landing_pages(id) on delete cascade,
	landing_page_slug text not null,
	landing_page_session_id uuid references public.landing_page_sessions(id) on delete set null,
	order_id uuid not null references public.storefront_orders(id) on delete cascade,
	order_ref text not null,
	order_total numeric(12, 2) not null default 0,
	currency text not null default 'MYR',
	source_code text,
	utm_source text,
	utm_medium text,
	utm_campaign text,
	utm_content text,
	utm_term text,
	fbclid text,
	referrer_domain text,
	created_at timestamptz not null default now(),
	unique (order_id)
);

create index if not exists idx_landing_page_order_attr_page_created
	on public.landing_page_order_attributions(landing_page_id, created_at desc);
create index if not exists idx_landing_page_order_attr_session
	on public.landing_page_order_attributions(landing_page_session_id);
create index if not exists idx_landing_page_order_attr_campaign
	on public.landing_page_order_attributions(utm_campaign);

create or replace function public.is_landing_page_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.users u
		join public.roles r on r.role_code = u.role_code
		join public.organizations o on o.id = u.organization_id
		where u.id = auth.uid()
			and u.organization_id = target_organization_id
			and o.org_type_code = 'HQ'
			and r.role_level <= 30
	);
$$;

alter table public.landing_pages enable row level security;
alter table public.landing_page_products enable row level security;
alter table public.landing_page_sessions enable row level security;
alter table public.landing_page_events enable row level security;
alter table public.landing_page_order_attributions enable row level security;

drop policy if exists landing_pages_public_read_published on public.landing_pages;
create policy landing_pages_public_read_published
on public.landing_pages
for select
using (
	status = 'published'
	and (publish_start_at is null or publish_start_at <= now())
	and (publish_end_at is null or publish_end_at >= now())
);

drop policy if exists landing_pages_admin_all on public.landing_pages;
create policy landing_pages_admin_all
on public.landing_pages
for all
using (public.is_landing_page_admin(organization_id))
with check (public.is_landing_page_admin(organization_id));

drop policy if exists landing_page_products_public_read_published on public.landing_page_products;
create policy landing_page_products_public_read_published
on public.landing_page_products
for select
using (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_products.landing_page_id
			and lp.status = 'published'
			and (lp.publish_start_at is null or lp.publish_start_at <= now())
			and (lp.publish_end_at is null or lp.publish_end_at >= now())
	)
);

drop policy if exists landing_page_products_admin_all on public.landing_page_products;
create policy landing_page_products_admin_all
on public.landing_page_products
for all
using (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_products.landing_page_id
			and public.is_landing_page_admin(lp.organization_id)
	)
)
with check (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_products.landing_page_id
			and public.is_landing_page_admin(lp.organization_id)
	)
);

drop policy if exists landing_page_sessions_admin_read on public.landing_page_sessions;
create policy landing_page_sessions_admin_read
on public.landing_page_sessions
for select
using (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_sessions.landing_page_id
			and public.is_landing_page_admin(lp.organization_id)
	)
);

drop policy if exists landing_page_events_admin_read on public.landing_page_events;
create policy landing_page_events_admin_read
on public.landing_page_events
for select
using (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_events.landing_page_id
			and public.is_landing_page_admin(lp.organization_id)
	)
);

drop policy if exists landing_page_order_attributions_admin_read on public.landing_page_order_attributions;
create policy landing_page_order_attributions_admin_read
on public.landing_page_order_attributions
for select
using (
	exists (
		select 1 from public.landing_pages lp
		where lp.id = landing_page_order_attributions.landing_page_id
			and public.is_landing_page_admin(lp.organization_id)
	)
);

comment on table public.landing_page_events is 'Inserted by server-side API using service role. Direct public inserts are intentionally not granted.';