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