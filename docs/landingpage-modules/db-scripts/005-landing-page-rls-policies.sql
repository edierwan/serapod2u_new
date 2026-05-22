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