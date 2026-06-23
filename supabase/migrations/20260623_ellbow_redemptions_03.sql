-- Ellbow Loyalty Phase 2: atomic reward redemption and auditable lifecycle.
-- Run after 20260623_ellbow_wallet_transactions_02.sql.
-- Rollback (before use only): drop redemption RPCs then ellbow_redemptions.

create table if not exists public.ellbow_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loyalty_program_id uuid not null,
  reward_id uuid not null,
  wallet_id uuid not null,
  user_id uuid not null references public.users(id) on delete restrict,
  wallet_lane text not null default 'consumer' check (wallet_lane = 'consumer'),
  points_used bigint not null check (points_used >= 0),
  status text not null default 'pending' check (status in ('pending','approved','fulfilled','rejected','cancelled')),
  redemption_code text not null unique,
  request_key text not null,
  verification_mode text not null check (verification_mode in ('manual','automatic')),
  bank_id uuid references public.msia_banks(id) on delete set null,
  bank_account_number text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  fulfilled_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  processed_by uuid references public.users(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ellbow_redemptions_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete restrict,
  constraint ellbow_redemptions_reward_scope_fk foreign key (reward_id, organization_id, loyalty_program_id)
    references public.ellbow_rewards(id, organization_id, loyalty_program_id) on delete restrict,
  constraint ellbow_redemptions_wallet_scope_fk foreign key (wallet_id, organization_id, loyalty_program_id, user_id, wallet_lane)
    references public.ellbow_wallets(id, organization_id, loyalty_program_id, owner_user_id, wallet_lane) on delete restrict,
  constraint ellbow_redemptions_request_key unique (organization_id, loyalty_program_id, request_key)
);

create index if not exists ellbow_redemptions_user_created_idx on public.ellbow_redemptions(user_id, created_at desc);
create index if not exists ellbow_redemptions_org_status_idx on public.ellbow_redemptions(organization_id, loyalty_program_id, status, created_at desc);
create index if not exists ellbow_redemptions_reward_idx on public.ellbow_redemptions(reward_id, created_at desc);

drop trigger if exists ellbow_redemptions_set_updated_at on public.ellbow_redemptions;
create trigger ellbow_redemptions_set_updated_at before update on public.ellbow_redemptions
for each row execute function public.ellbow_set_updated_at();

create or replace function public.ellbow_redeem_reward(p_reward_id uuid, p_request_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_reward public.ellbow_rewards%rowtype;
  v_wallet public.ellbow_wallets%rowtype;
  v_existing public.ellbow_redemptions%rowtype;
  v_points bigint;
  v_apply jsonb;
  v_redemption_id uuid := gen_random_uuid();
  v_code text;
  v_status text;
  v_bank_id uuid;
  v_bank_account text;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if nullif(btrim(p_request_key), '') is null then raise exception 'Redemption request key is required'; end if;

  select * into v_reward from public.ellbow_rewards r where r.id = p_reward_id for update;
  if not found then raise exception 'Ellbow reward not found'; end if;
  if not exists (select 1 from public.loyalty_programs p where p.id = v_reward.loyalty_program_id and p.organization_id = v_reward.organization_id and p.code = 'ellbow') then
    raise exception 'Reward does not belong to Ellbow Loyalty';
  end if;
  if v_reward.status <> 'available' then raise exception 'Ellbow reward is not available'; end if;
  if v_reward.valid_from is not null and v_reward.valid_from > now() then raise exception 'Ellbow reward has not started'; end if;
  if v_reward.valid_until is not null and v_reward.valid_until < now() then raise exception 'Ellbow reward has expired'; end if;
  if v_reward.stock_quantity is not null and v_reward.stock_quantity <= 0 then raise exception 'Ellbow reward is out of stock'; end if;

  select * into v_existing from public.ellbow_redemptions r
  where r.organization_id = v_reward.organization_id and r.loyalty_program_id = v_reward.loyalty_program_id and r.request_key = p_request_key;
  if found then
    if v_existing.user_id <> v_user then raise exception 'Redemption request key belongs to another user'; end if;
    return jsonb_build_object('success', true, 'duplicate', true, 'redemption_id', v_existing.id,
      'redemption_code', v_existing.redemption_code, 'status', v_existing.status,
      'points_used', v_existing.points_used);
  end if;

  select * into v_wallet from public.ellbow_wallets w
  where w.organization_id = v_reward.organization_id and w.loyalty_program_id = v_reward.loyalty_program_id
    and w.owner_user_id = v_user and w.wallet_lane = 'consumer' and w.active = true
  for update;
  if not found then raise exception 'Ellbow consumer wallet not found'; end if;

  v_points := coalesce(v_reward.point_offer, v_reward.points_required);
  if v_points <= 0 then raise exception 'Ellbow reward point cost must be greater than zero'; end if;
  if v_wallet.balance < v_points then raise exception 'Insufficient Ellbow balance'; end if;

  v_apply := public.ellbow_apply_points_core(v_reward.organization_id, v_reward.loyalty_program_id,
    v_user, 'consumer', -v_points, 'reward_redemption', 'ellbow_reward',
    'redemption:' || p_request_key, 'Redeemed ' || v_reward.name, v_reward.id, null, null, null, null,
    jsonb_build_object('reward_id', v_reward.id), v_user);

  if v_reward.stock_quantity is not null then
    update public.ellbow_rewards set stock_quantity = stock_quantity - 1 where id = v_reward.id and stock_quantity > 0;
    if not found then raise exception 'Ellbow reward is out of stock'; end if;
  end if;

  select u.bank_id, u.bank_account_number into v_bank_id, v_bank_account from public.users u where u.id = v_user;
  v_code := 'ELL-' || upper(substr(replace(v_redemption_id::text, '-', ''), 1, 10));
  v_status := case when v_reward.verification_mode = 'automatic' then 'approved' else 'pending' end;
  insert into public.ellbow_redemptions (
    id, organization_id, loyalty_program_id, reward_id, wallet_id, user_id, wallet_lane,
    points_used, status, redemption_code, request_key, verification_mode, bank_id,
    bank_account_number, approved_at, metadata
  ) values (
    v_redemption_id, v_reward.organization_id, v_reward.loyalty_program_id, v_reward.id,
    v_wallet.id, v_user, 'consumer', v_points, v_status, v_code, p_request_key,
    v_reward.verification_mode, v_bank_id, v_bank_account,
    case when v_status = 'approved' then now() else null end,
    jsonb_build_object('transaction_id', v_apply->>'transaction_id', 'reward_name', v_reward.name)
  );

  return jsonb_build_object('success', true, 'duplicate', false, 'redemption_id', v_redemption_id,
    'redemption_code', v_code, 'status', v_status, 'points_used', v_points,
    'new_balance', (v_apply->>'balance_after')::bigint, 'reward_name', v_reward.name);
end;
$$;
grant execute on function public.ellbow_redeem_reward(uuid,text) to authenticated;

create or replace function public.ellbow_update_redemption_status(p_redemption_id uuid, p_status text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_redemption public.ellbow_redemptions%rowtype;
  v_reward public.ellbow_rewards%rowtype;
  v_refund jsonb;
begin
  if p_status not in ('approved','fulfilled','rejected','cancelled') then raise exception 'Invalid redemption status'; end if;
  select * into v_redemption from public.ellbow_redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Ellbow redemption not found'; end if;
  if not exists (
    select 1 from public.users u join public.roles r on r.role_code = u.role_code
    where u.id = v_actor and u.is_active = true and u.organization_id = v_redemption.organization_id and r.role_level <= 40
  ) then raise exception 'Forbidden'; end if;
  if v_redemption.status in ('fulfilled','rejected','cancelled') then raise exception 'Redemption is already final'; end if;
  if p_status = 'fulfilled' and v_redemption.status <> 'approved' then raise exception 'Only approved redemptions can be fulfilled'; end if;

  if p_status in ('rejected','cancelled') then
    v_refund := public.ellbow_apply_points_core(v_redemption.organization_id, v_redemption.loyalty_program_id,
      v_redemption.user_id, 'consumer', v_redemption.points_used, 'redemption_refund', 'ellbow_redemption',
      'redemption-refund:' || v_redemption.id::text, 'Refund for ' || v_redemption.redemption_code,
      v_redemption.id, null, null, null, null, jsonb_build_object('redemption_id', v_redemption.id), v_actor);
    select * into v_reward from public.ellbow_rewards where id = v_redemption.reward_id for update;
    if v_reward.stock_quantity is not null then update public.ellbow_rewards set stock_quantity = stock_quantity + 1 where id = v_reward.id; end if;
  end if;

  update public.ellbow_redemptions set
    status = p_status, notes = nullif(btrim(p_notes), ''), processed_by = v_actor,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    fulfilled_at = case when p_status = 'fulfilled' then now() else fulfilled_at end,
    rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = v_redemption.id;
  return jsonb_build_object('success', true, 'redemption_id', v_redemption.id, 'status', p_status,
    'refunded', p_status in ('rejected','cancelled'), 'refund_transaction_id', v_refund->>'transaction_id');
end;
$$;
grant execute on function public.ellbow_update_redemption_status(uuid,text,text) to authenticated;

alter table public.ellbow_redemptions enable row level security;
drop policy if exists ellbow_redemptions_self_select on public.ellbow_redemptions;
create policy ellbow_redemptions_self_select on public.ellbow_redemptions for select to authenticated using (user_id = auth.uid());
drop policy if exists ellbow_redemptions_admin_select on public.ellbow_redemptions;
create policy ellbow_redemptions_admin_select on public.ellbow_redemptions for select to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);

comment on table public.ellbow_redemptions is 'Ellbow-only redemption lifecycle and audit record; Cellera redemptions remain unchanged.';
