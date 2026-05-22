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