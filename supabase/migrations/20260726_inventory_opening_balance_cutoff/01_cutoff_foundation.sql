begin;

-- Inventory Opening Balance Cut-off — foundation and warehouse freeze.
-- This migration is metadata-only. It neither changes balances nor touches QR data.

alter table public.stock_count_sessions
  drop constraint if exists stock_count_sessions_count_type_check;
alter table public.stock_count_sessions
  add constraint stock_count_sessions_count_type_check
  check (count_type in (
    'full_count', 'cycle_count', 'spot_check',
    'initial_configuration_classification', 'opening_balance_cutoff'
  ));

create table if not exists public.inventory_opening_cutoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id),
  warehouse_organization_id uuid not null references public.organizations(id),
  stock_count_session_id uuid not null unique references public.stock_count_sessions(id),
  proposed_cutoff_at timestamptz not null,
  status text not null default 'counting'
    check (status in ('counting', 'posted', 'cancelled')),
  started_by uuid not null references public.users(id),
  started_at timestamptz not null default now(),
  posted_by uuid references public.users(id),
  posted_at timestamptz,
  cancelled_by uuid references public.users(id),
  cancelled_at timestamptz,
  execution_key uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'counting' and posted_at is null and cancelled_at is null) or
    (status = 'posted' and posted_at is not null and cancelled_at is null) or
    (status = 'cancelled' and cancelled_at is not null and posted_at is null)
  )
);

create unique index if not exists inventory_opening_cutoffs_one_active_warehouse
  on public.inventory_opening_cutoffs (warehouse_organization_id)
  where status = 'counting';

create table if not exists public.inventory_cutoff_decisions (
  id uuid primary key default gen_random_uuid(),
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete restrict,
  transaction_kind text not null check (transaction_kind in ('distributor', 'manufacturer')),
  order_id uuid not null references public.orders(id),
  order_item_id uuid not null references public.order_items(id),
  decision text not null check (decision in (
    'carry_forward', 'cancel_release', 'carry_forward_incoming', 'history_only'
  )),
  stock_config_id uuid references public.inventory_stock_configurations(id),
  quantity integer not null check (quantity > 0),
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cutoff_id, transaction_kind, order_item_id)
);

create table if not exists public.inventory_cutoff_audit_events (
  id bigint generated always as identity primary key,
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete restrict,
  event_type text not null,
  actor_id uuid references public.users(id),
  order_id uuid references public.orders(id),
  order_item_id uuid references public.order_items(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_cutoff_reports (
  id uuid primary key default gen_random_uuid(),
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete restrict,
  report_kind text not null check (report_kind in ('posted')),
  readiness text not null check (readiness in ('Ready', 'Review Required', 'Blocked')),
  report_payload jsonb not null,
  generated_by uuid not null references public.users(id),
  generated_at timestamptz not null default now()
);

-- Unforgeable transaction-scoped posting context. Ordinary roles receive no
-- privileges on this table; only the SECURITY DEFINER posting function may add
-- the current backend/transaction tuple. This replaces a custom GUC, because
-- PostgreSQL permits ordinary roles to set arbitrary two-part custom settings.
create table if not exists public.inventory_cutoff_posting_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete cascade,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (backend_pid, transaction_id, cutoff_id)
);

create index if not exists inventory_cutoff_decisions_cutoff_idx
  on public.inventory_cutoff_decisions(cutoff_id, transaction_kind);
create index if not exists inventory_cutoff_audit_cutoff_idx
  on public.inventory_cutoff_audit_events(cutoff_id, created_at);
create index if not exists inventory_cutoff_reports_cutoff_idx
  on public.inventory_cutoff_reports(cutoff_id, generated_at desc);

alter table public.inventory_opening_cutoffs enable row level security;
alter table public.inventory_cutoff_decisions enable row level security;
alter table public.inventory_cutoff_audit_events enable row level security;
alter table public.inventory_cutoff_reports enable row level security;
alter table public.inventory_cutoff_posting_context enable row level security;

drop policy if exists inventory_cutoffs_read on public.inventory_opening_cutoffs;
create policy inventory_cutoffs_read on public.inventory_opening_cutoffs for select
  using (public.can_access_org(warehouse_organization_id));
drop policy if exists inventory_cutoffs_hq_admin on public.inventory_opening_cutoffs;
create policy inventory_cutoffs_hq_admin on public.inventory_opening_cutoffs for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

drop policy if exists inventory_cutoff_decisions_read on public.inventory_cutoff_decisions;
create policy inventory_cutoff_decisions_read on public.inventory_cutoff_decisions for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));
drop policy if exists inventory_cutoff_decisions_hq_admin on public.inventory_cutoff_decisions;
create policy inventory_cutoff_decisions_hq_admin on public.inventory_cutoff_decisions for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

drop policy if exists inventory_cutoff_audit_read on public.inventory_cutoff_audit_events;
create policy inventory_cutoff_audit_read on public.inventory_cutoff_audit_events for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));
drop policy if exists inventory_cutoff_reports_read on public.inventory_cutoff_reports;
create policy inventory_cutoff_reports_read on public.inventory_cutoff_reports for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

create or replace function public.inventory_cutoff_active(p_warehouse_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.inventory_opening_cutoffs
    where warehouse_organization_id = p_warehouse_id and status = 'counting'
  );
$$;

create or replace function public.inventory_cutoff_is_hq_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.users u
    join public.roles r on r.role_code=u.role_code
    join public.organizations o on o.id=u.organization_id
    where u.id=auth.uid() and o.org_type_code='HQ' and r.role_level<=10
  );
$$;

create or replace function public.inventory_cutoff_assert_not_frozen(p_warehouse_id uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_cutoff uuid;
begin
  select id into v_cutoff from public.inventory_opening_cutoffs
  where warehouse_organization_id = p_warehouse_id and status = 'counting'
  order by started_at desc limit 1;
  if v_cutoff is not null and not exists (
    select 1 from public.inventory_cutoff_posting_context ctx
    where ctx.cutoff_id=v_cutoff
      and ctx.backend_pid=pg_backend_pid()
      and ctx.transaction_id=txid_current()
      and ctx.created_by=auth.uid()
  ) then
    raise exception 'inventory_cutoff_warehouse_frozen: Warehouse inventory is frozen while opening balance count % is active.', v_cutoff;
  end if;
end;
$$;

create or replace function public.inventory_cutoff_inventory_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.inventory_cutoff_assert_not_frozen(coalesce(new.organization_id, old.organization_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists inventory_cutoff_product_inventory_guard on public.product_inventory;
create trigger inventory_cutoff_product_inventory_guard
before insert or update or delete on public.product_inventory
for each row execute function public.inventory_cutoff_inventory_guard();

create or replace function public.inventory_cutoff_movement_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.from_organization_id is not null then
    perform public.inventory_cutoff_assert_not_frozen(new.from_organization_id);
  end if;
  if new.to_organization_id is not null
     and new.to_organization_id is distinct from new.from_organization_id then
    perform public.inventory_cutoff_assert_not_frozen(new.to_organization_id);
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_cutoff_stock_movement_guard on public.stock_movements;
create trigger inventory_cutoff_stock_movement_guard
before insert on public.stock_movements
for each row execute function public.inventory_cutoff_movement_guard();

create or replace function public.start_inventory_opening_cutoff(
  p_session_id uuid, p_proposed_cutoff_at timestamptz
) returns public.inventory_opening_cutoffs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_session public.stock_count_sessions%rowtype;
  v_company uuid;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_session from public.stock_count_sessions where id = p_session_id for update;
  if not found then raise exception 'stock_count_not_found'; end if;
  if v_session.status <> 'draft' or v_session.count_type <> 'opening_balance_cutoff' then
    raise exception 'inventory_cutoff_requires_opening_balance_draft';
  end if;
  v_company := public.get_company_id(v_session.warehouse_organization_id);
  if v_company is null then raise exception 'organization_mismatch'; end if;
  insert into public.inventory_opening_cutoffs(
    company_id, warehouse_organization_id, stock_count_session_id,
    proposed_cutoff_at, started_by
  ) values (
    v_company, v_session.warehouse_organization_id, v_session.id,
    coalesce(p_proposed_cutoff_at, now()), v_user
  ) returning * into v_cutoff;
  insert into public.inventory_cutoff_audit_events(cutoff_id,event_type,actor_id,details)
  values(v_cutoff.id,'warehouse_freeze_started',v_user,
    jsonb_build_object('warehouse_organization_id',v_cutoff.warehouse_organization_id,
      'stock_count_session_id',v_session.id));
  return v_cutoff;
end;
$$;

create or replace function public.cancel_inventory_opening_cutoff(p_cutoff_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'cancellation_reason_required'; end if;
  update public.inventory_opening_cutoffs set status='cancelled',cancelled_by=v_user,
    cancelled_at=now(),updated_at=now()
  where id=p_cutoff_id and status='counting';
  if not found then raise exception 'inventory_cutoff_not_active'; end if;
  insert into public.inventory_cutoff_audit_events(cutoff_id,event_type,actor_id,details)
  values(p_cutoff_id,'warehouse_freeze_cancelled',v_user,jsonb_build_object('reason',trim(p_reason)));
end;
$$;

revoke all on function public.start_inventory_opening_cutoff(uuid,timestamptz) from public;
revoke all on function public.cancel_inventory_opening_cutoff(uuid,text) from public;
grant execute on function public.start_inventory_opening_cutoff(uuid,timestamptz) to authenticated;
grant execute on function public.cancel_inventory_opening_cutoff(uuid,text) to authenticated;
grant execute on function public.inventory_cutoff_active(uuid) to authenticated;
grant execute on function public.inventory_cutoff_is_hq_admin() to authenticated;

grant select on public.inventory_opening_cutoffs, public.inventory_cutoff_decisions,
  public.inventory_cutoff_audit_events, public.inventory_cutoff_reports to authenticated;
revoke insert, update, delete, truncate on public.inventory_opening_cutoffs,
  public.inventory_cutoff_decisions, public.inventory_cutoff_audit_events,
  public.inventory_cutoff_reports from authenticated;
revoke all on public.inventory_cutoff_posting_context from public, anon, authenticated;

comment on function public.inventory_cutoff_assert_not_frozen(uuid) is
  'Warehouse-scoped freeze gate. product_inventory and stock_movements triggers make allocation, dispatch, receiving, transfer, repack, returns and manual adjustments fail closed during an active opening count.';

commit;
