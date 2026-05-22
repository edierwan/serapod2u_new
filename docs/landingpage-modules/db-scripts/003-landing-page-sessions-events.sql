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