-- Ellbow Loyalty Phase 2: independent wallets and immutable transaction ledger.
-- Run after 20260623_ellbow_loyalty_catalog_01.sql.
-- Rollback (before production use only): drop the RPCs/triggers, then
-- ellbow_point_transactions and ellbow_wallets. No legacy point object is touched.

create table if not exists public.ellbow_wallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loyalty_program_id uuid not null,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  wallet_lane text not null check (wallet_lane in ('shop_staff', 'consumer')),
  balance bigint not null default 0 check (balance >= 0),
  total_earned bigint not null default 0 check (total_earned >= 0),
  total_redeemed bigint not null default 0 check (total_redeemed >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_wallets_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete restrict,
  constraint ellbow_wallets_owner_lane_key unique (organization_id, loyalty_program_id, owner_user_id, wallet_lane),
  constraint ellbow_wallets_identity_key unique (id, organization_id, loyalty_program_id, owner_user_id, wallet_lane)
);

create table if not exists public.ellbow_point_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loyalty_program_id uuid not null,
  wallet_id uuid not null,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  wallet_lane text not null check (wallet_lane in ('shop_staff', 'consumer')),
  points_delta bigint not null check (points_delta <> 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  transaction_type text not null check (transaction_type in (
    'qr_scan','roadtour_bonus','registration_bonus','referral_bonus',
    'manual_adjustment','reward_redemption','redemption_refund','system_adjustment'
  )),
  source_type text not null,
  source_id uuid,
  event_id uuid,
  campaign_id uuid,
  product_id uuid,
  scan_id uuid,
  idempotency_key text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ellbow_transactions_wallet_scope_fk foreign key
    (wallet_id, organization_id, loyalty_program_id, owner_user_id, wallet_lane)
    references public.ellbow_wallets(id, organization_id, loyalty_program_id, owner_user_id, wallet_lane) on delete restrict,
  constraint ellbow_transactions_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete restrict,
  constraint ellbow_transactions_balance_math check (balance_after = balance_before + points_delta),
  constraint ellbow_transactions_idempotency_key unique (organization_id, loyalty_program_id, idempotency_key)
);

create index if not exists ellbow_wallets_owner_idx on public.ellbow_wallets(owner_user_id, loyalty_program_id, wallet_lane);
create index if not exists ellbow_wallets_org_lane_idx on public.ellbow_wallets(organization_id, loyalty_program_id, wallet_lane);
create index if not exists ellbow_transactions_wallet_created_idx on public.ellbow_point_transactions(wallet_id, created_at desc);
create index if not exists ellbow_transactions_owner_created_idx on public.ellbow_point_transactions(owner_user_id, loyalty_program_id, created_at desc);
create index if not exists ellbow_transactions_source_idx on public.ellbow_point_transactions(source_type, source_id) where source_id is not null;
create index if not exists ellbow_transactions_event_idx on public.ellbow_point_transactions(event_id, campaign_id) where event_id is not null;

drop trigger if exists ellbow_wallets_set_updated_at on public.ellbow_wallets;
create trigger ellbow_wallets_set_updated_at before update on public.ellbow_wallets
for each row execute function public.ellbow_set_updated_at();

create or replace function public.ellbow_block_transaction_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Ellbow point transactions are immutable';
end;
$$;

drop trigger if exists ellbow_transactions_immutable on public.ellbow_point_transactions;
create trigger ellbow_transactions_immutable before update or delete on public.ellbow_point_transactions
for each row execute function public.ellbow_block_transaction_mutation();

create or replace function public.ellbow_apply_points_core(
  p_organization_id uuid,
  p_loyalty_program_id uuid,
  p_owner_user_id uuid,
  p_wallet_lane text,
  p_points_delta bigint,
  p_transaction_type text,
  p_source_type text,
  p_idempotency_key text,
  p_description text default null,
  p_source_id uuid default null,
  p_event_id uuid default null,
  p_campaign_id uuid default null,
  p_product_id uuid default null,
  p_scan_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.ellbow_wallets%rowtype;
  v_existing public.ellbow_point_transactions%rowtype;
  v_after bigint;
  v_transaction_id uuid;
begin
  if p_points_delta = 0 then raise exception 'Point delta cannot be zero'; end if;
  if p_wallet_lane not in ('shop_staff','consumer') then raise exception 'Invalid Ellbow wallet lane'; end if;
  if p_transaction_type not in ('qr_scan','roadtour_bonus','registration_bonus','referral_bonus','manual_adjustment','reward_redemption','redemption_refund','system_adjustment') then
    raise exception 'Invalid Ellbow transaction type';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'Idempotency key is required'; end if;
  if not exists (select 1 from public.loyalty_programs p where p.id = p_loyalty_program_id and p.organization_id = p_organization_id and p.code = 'ellbow') then
    raise exception 'Invalid Ellbow loyalty program';
  end if;
  if not exists (select 1 from public.users u where u.id = p_owner_user_id and u.is_active = true) then
    raise exception 'Invalid Ellbow wallet owner';
  end if;

  select * into v_existing from public.ellbow_point_transactions t
  where t.organization_id = p_organization_id and t.loyalty_program_id = p_loyalty_program_id
    and t.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('success', true, 'duplicate', true, 'wallet_id', v_existing.wallet_id,
      'transaction_id', v_existing.id, 'balance_before', v_existing.balance_before, 'balance_after', v_existing.balance_after,
      'points_delta', v_existing.points_delta, 'wallet_lane', v_existing.wallet_lane);
  end if;

  insert into public.ellbow_wallets (organization_id, loyalty_program_id, owner_user_id, wallet_lane)
  values (p_organization_id, p_loyalty_program_id, p_owner_user_id, p_wallet_lane)
  on conflict (organization_id, loyalty_program_id, owner_user_id, wallet_lane) do nothing;

  select * into v_wallet from public.ellbow_wallets w
  where w.organization_id = p_organization_id and w.loyalty_program_id = p_loyalty_program_id
    and w.owner_user_id = p_owner_user_id and w.wallet_lane = p_wallet_lane
  for update;
  if not found or not v_wallet.active then raise exception 'Ellbow wallet is unavailable'; end if;

  v_after := v_wallet.balance + p_points_delta;
  if v_after < 0 then raise exception 'Insufficient Ellbow balance'; end if;

  update public.ellbow_wallets set
    balance = v_after,
    total_earned = total_earned + greatest(p_points_delta, 0),
    total_redeemed = total_redeemed + greatest(-p_points_delta, 0)
  where id = v_wallet.id;

  insert into public.ellbow_point_transactions (
    organization_id, loyalty_program_id, wallet_id, owner_user_id, wallet_lane,
    points_delta, balance_before, balance_after, transaction_type, source_type,
    source_id, event_id, campaign_id, product_id, scan_id, idempotency_key,
    description, metadata, created_by
  ) values (
    p_organization_id, p_loyalty_program_id, v_wallet.id, p_owner_user_id, p_wallet_lane,
    p_points_delta, v_wallet.balance, v_after, p_transaction_type, p_source_type,
    p_source_id, p_event_id, p_campaign_id, p_product_id, p_scan_id, p_idempotency_key,
    p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by
  ) returning id into v_transaction_id;

  return jsonb_build_object('success', true, 'duplicate', false, 'wallet_id', v_wallet.id,
    'transaction_id', v_transaction_id, 'balance_before', v_wallet.balance, 'balance_after', v_after,
    'points_delta', p_points_delta, 'wallet_lane', p_wallet_lane);
exception when unique_violation then
  select * into v_existing from public.ellbow_point_transactions t
  where t.organization_id = p_organization_id and t.loyalty_program_id = p_loyalty_program_id
    and t.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('success', true, 'duplicate', true, 'wallet_id', v_existing.wallet_id,
      'transaction_id', v_existing.id, 'balance_before', v_existing.balance_before, 'balance_after', v_existing.balance_after,
      'points_delta', v_existing.points_delta, 'wallet_lane', v_existing.wallet_lane);
  end if;
  raise;
end;
$$;

revoke all on function public.ellbow_apply_points_core(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb,uuid) from public, anon, authenticated;

create or replace function public.ellbow_admin_adjust_points(
  p_owner_user_id uuid,
  p_wallet_lane text,
  p_points_delta bigint,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_program uuid;
begin
  select u.organization_id into v_org from public.users u join public.roles r on r.role_code = u.role_code
  where u.id = auth.uid() and u.is_active = true and r.role_level <= 40;
  if v_org is null then raise exception 'Forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Adjustment reason is required'; end if;
  select p.id into v_program from public.loyalty_programs p where p.organization_id = v_org and p.code = 'ellbow';
  if v_program is null then raise exception 'Ellbow Loyalty is not configured'; end if;
  return public.ellbow_apply_points_core(v_org, v_program, p_owner_user_id, p_wallet_lane, p_points_delta,
    'manual_adjustment', 'admin', p_idempotency_key, p_reason, null, null, null, null, null,
    jsonb_build_object('reason', p_reason), auth.uid());
end;
$$;
grant execute on function public.ellbow_admin_adjust_points(uuid,text,bigint,text,text) to authenticated;

alter table public.ellbow_wallets enable row level security;
alter table public.ellbow_point_transactions enable row level security;

drop policy if exists ellbow_wallets_self_select on public.ellbow_wallets;
create policy ellbow_wallets_self_select on public.ellbow_wallets for select to authenticated
using (owner_user_id = auth.uid());
drop policy if exists ellbow_wallets_admin_select on public.ellbow_wallets;
create policy ellbow_wallets_admin_select on public.ellbow_wallets for select to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);
drop policy if exists ellbow_transactions_self_select on public.ellbow_point_transactions;
create policy ellbow_transactions_self_select on public.ellbow_point_transactions for select to authenticated
using (owner_user_id = auth.uid());
drop policy if exists ellbow_transactions_admin_select on public.ellbow_point_transactions;
create policy ellbow_transactions_admin_select on public.ellbow_point_transactions for select to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);

comment on table public.ellbow_wallets is 'Independent Ellbow balances. A user may have separate shop_staff and consumer lanes.';
comment on table public.ellbow_point_transactions is 'Immutable Ellbow-only balance ledger. No Cellera transaction is copied here.';
