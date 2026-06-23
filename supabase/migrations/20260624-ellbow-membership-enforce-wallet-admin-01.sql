-- Purpose: Phase 4/5 hardening for Ellbow wallet posting and admin membership management.
-- Dependencies:
--   - 20260623_ellbow_program_membership_foundation_08.sql
--   - 20260623_ellbow_wallet_transactions_02.sql
--   - 20260623_ellbow_redemptions_03.sql
--   - 20260623_ellbow_reporting_referrals_04.sql
-- Rollback guidance:
--   Drop the v_ellbow_participant_* views and loyalty_program_membership_audit table,
--   then restore the previous ellbow_apply_points_core and ellbow_redeem_reward
--   functions from the prior migrations if this migration has not been used.
-- Safe to rerun: yes. Objects are created with IF NOT EXISTS or CREATE OR REPLACE.
-- Expected records affected: no existing wallet, transaction, redemption, user, or
-- organization rows are modified. Audit rows are inserted only by future admin RPC calls.

create extension if not exists pgcrypto;

create table if not exists public.loyalty_program_membership_audit (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  loyalty_program_id uuid not null,
  membership_table text not null check (membership_table in ('organization', 'user')),
  membership_id uuid not null,
  action text not null check (action in ('add', 'activate', 'deactivate', 'change_participant_type', 'update')),
  previous_status text,
  new_status text,
  previous_participant_type text,
  new_participant_type text,
  reason text,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint loyalty_program_membership_audit_program_owner_fk
    foreign key (loyalty_program_id, owner_organization_id)
    references public.loyalty_programs(id, organization_id) on delete cascade
);

create index if not exists loyalty_program_membership_audit_target_idx
  on public.loyalty_program_membership_audit(membership_table, membership_id, created_at desc);
create index if not exists loyalty_program_membership_audit_owner_idx
  on public.loyalty_program_membership_audit(owner_organization_id, loyalty_program_id, created_at desc);

alter table public.loyalty_program_membership_audit enable row level security;
drop policy if exists loyalty_program_membership_audit_admin_select on public.loyalty_program_membership_audit;
create policy loyalty_program_membership_audit_admin_select on public.loyalty_program_membership_audit
for select to authenticated using (
  owner_organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (
    select 1
    from public.users u
    join public.roles r on r.role_code = u.role_code
    where u.id = auth.uid() and u.is_active = true and r.role_level <= 40
  )
);

create or replace function public.loyalty_program_current_admin_owner()
returns uuid language sql stable security definer set search_path = public as $$
  select u.organization_id
  from public.users u
  join public.roles r on r.role_code = u.role_code
  where u.id = auth.uid()
    and u.is_active = true
    and r.role_level <= 40
  limit 1;
$$;

create or replace function public.ellbow_has_active_user_membership(
  p_owner_organization_id uuid,
  p_loyalty_program_id uuid,
  p_user_id uuid,
  p_participant_type text
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.loyalty_program_user_memberships m
    where m.owner_organization_id = p_owner_organization_id
      and m.loyalty_program_id = p_loyalty_program_id
      and m.user_id = p_user_id
      and m.participant_type = p_participant_type
      and m.status = 'active'
  );
$$;

create or replace function public.loyalty_program_admin_upsert_organization_membership(
  p_member_organization_id uuid,
  p_program_code text default 'ellbow',
  p_status text default 'active',
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.loyalty_program_current_admin_owner();
  v_program public.loyalty_programs%rowtype;
  v_org public.organizations%rowtype;
  v_existing public.loyalty_program_organization_memberships%rowtype;
  v_membership_id uuid;
  v_action text;
begin
  if v_owner is null then raise exception 'Forbidden'; end if;
  if p_program_code not in ('cellera','ellbow') then raise exception 'Unsupported loyalty program'; end if;
  if p_status not in ('active','inactive') then raise exception 'Unsupported membership status'; end if;

  select * into v_org from public.organizations where id = p_member_organization_id;
  if not found then raise exception 'Organization not found'; end if;

  insert into public.loyalty_programs (organization_id, code, name, active)
  values (v_owner, p_program_code, case p_program_code when 'ellbow' then 'Ellbow Loyalty' else 'Cellera Loyalty' end, true)
  on conflict (organization_id, code) do update set name = excluded.name, active = true, updated_at = now()
  returning * into v_program;

  select * into v_existing
  from public.loyalty_program_organization_memberships
  where owner_organization_id = v_owner
    and loyalty_program_id = v_program.id
    and member_organization_id = p_member_organization_id
  for update;

  if found then
    update public.loyalty_program_organization_memberships
    set status = p_status,
        ended_at = case when p_status = 'inactive' then coalesce(ended_at, now()) else null end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_membership_id;
    v_action := case
      when v_existing.status <> 'active' and p_status = 'active' then 'activate'
      when v_existing.status = 'active' and p_status = 'inactive' then 'deactivate'
      else 'update'
    end;
  else
    insert into public.loyalty_program_organization_memberships (
      owner_organization_id, loyalty_program_id, member_organization_id,
      status, enrollment_source, created_by, ended_at
    ) values (
      v_owner, v_program.id, p_member_organization_id,
      p_status, 'admin', auth.uid(), case when p_status = 'inactive' then now() else null end
    ) returning id into v_membership_id;
    v_action := 'add';
  end if;

  insert into public.loyalty_program_membership_audit (
    owner_organization_id, loyalty_program_id, membership_table, membership_id,
    action, previous_status, new_status, reason, actor_user_id
  ) values (
    v_owner, v_program.id, 'organization', v_membership_id, v_action,
    v_existing.status, p_status, nullif(btrim(p_reason), ''), auth.uid()
  );

  return jsonb_build_object('success', true, 'membership_id', v_membership_id, 'action', v_action);
end;
$$;

create or replace function public.loyalty_program_admin_upsert_user_membership(
  p_user_id uuid,
  p_participant_type text,
  p_member_organization_id uuid default null,
  p_program_code text default 'ellbow',
  p_status text default 'active',
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.loyalty_program_current_admin_owner();
  v_program public.loyalty_programs%rowtype;
  v_user public.users%rowtype;
  v_existing public.loyalty_program_user_memberships%rowtype;
  v_membership_id uuid;
  v_member_org uuid;
  v_action text;
begin
  if v_owner is null then raise exception 'Forbidden'; end if;
  if p_program_code not in ('cellera','ellbow') then raise exception 'Unsupported loyalty program'; end if;
  if p_participant_type not in ('organization_user','shop_staff','consumer') then raise exception 'Unsupported participant type'; end if;
  if p_status not in ('active','inactive') then raise exception 'Unsupported membership status'; end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  v_member_org := coalesce(p_member_organization_id, v_user.organization_id);

  insert into public.loyalty_programs (organization_id, code, name, active)
  values (v_owner, p_program_code, case p_program_code when 'ellbow' then 'Ellbow Loyalty' else 'Cellera Loyalty' end, true)
  on conflict (organization_id, code) do update set name = excluded.name, active = true, updated_at = now()
  returning * into v_program;

  select * into v_existing
  from public.loyalty_program_user_memberships
  where owner_organization_id = v_owner
    and loyalty_program_id = v_program.id
    and user_id = p_user_id
    and participant_type = p_participant_type
  for update;

  if found then
    update public.loyalty_program_user_memberships
    set member_organization_id = v_member_org,
        status = p_status,
        ended_at = case when p_status = 'inactive' then coalesce(ended_at, now()) else null end,
        updated_at = now()
    where id = v_existing.id
    returning id into v_membership_id;
    v_action := case
      when v_existing.status <> 'active' and p_status = 'active' then 'activate'
      when v_existing.status = 'active' and p_status = 'inactive' then 'deactivate'
      else 'update'
    end;
  else
    insert into public.loyalty_program_user_memberships (
      owner_organization_id, loyalty_program_id, user_id, member_organization_id,
      participant_type, status, enrollment_source, created_by, ended_at
    ) values (
      v_owner, v_program.id, p_user_id, v_member_org, p_participant_type,
      p_status, 'admin', auth.uid(), case when p_status = 'inactive' then now() else null end
    ) returning id into v_membership_id;
    v_action := 'add';
  end if;

  insert into public.loyalty_program_membership_audit (
    owner_organization_id, loyalty_program_id, membership_table, membership_id,
    action, previous_status, new_status, previous_participant_type, new_participant_type,
    reason, actor_user_id
  ) values (
    v_owner, v_program.id, 'user', v_membership_id, v_action,
    v_existing.status, p_status, v_existing.participant_type, p_participant_type,
    nullif(btrim(p_reason), ''), auth.uid()
  );

  return jsonb_build_object('success', true, 'membership_id', v_membership_id, 'action', v_action);
end;
$$;

create or replace function public.loyalty_program_admin_update_user_membership(
  p_membership_id uuid,
  p_participant_type text default null,
  p_member_organization_id uuid default null,
  p_status text default null,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.loyalty_program_current_admin_owner();
  v_existing public.loyalty_program_user_memberships%rowtype;
  v_next_type text;
  v_next_status text;
  v_next_org uuid;
  v_action text;
begin
  if v_owner is null then raise exception 'Forbidden'; end if;

  select m.* into v_existing
  from public.loyalty_program_user_memberships m
  join public.loyalty_programs p on p.id = m.loyalty_program_id and p.organization_id = m.owner_organization_id and p.code = 'ellbow'
  where m.id = p_membership_id
    and m.owner_organization_id = v_owner
  for update;
  if not found then raise exception 'Ellbow user membership not found'; end if;

  v_next_type := coalesce(nullif(btrim(p_participant_type), ''), v_existing.participant_type);
  v_next_status := coalesce(nullif(btrim(p_status), ''), v_existing.status);
  v_next_org := coalesce(p_member_organization_id, v_existing.member_organization_id);
  if v_next_type not in ('organization_user','shop_staff','consumer') then raise exception 'Unsupported participant type'; end if;
  if v_next_status not in ('active','inactive') then raise exception 'Unsupported membership status'; end if;

  if v_next_type <> v_existing.participant_type and exists (
    select 1 from public.loyalty_program_user_memberships other
    where other.owner_organization_id = v_existing.owner_organization_id
      and other.loyalty_program_id = v_existing.loyalty_program_id
      and other.user_id = v_existing.user_id
      and other.participant_type = v_next_type
      and other.id <> v_existing.id
  ) then
    raise exception 'User already has an Ellbow % membership', v_next_type;
  end if;

  update public.loyalty_program_user_memberships
  set participant_type = v_next_type,
      member_organization_id = v_next_org,
      status = v_next_status,
      ended_at = case when v_next_status = 'inactive' then coalesce(ended_at, now()) else null end,
      updated_at = now()
  where id = v_existing.id;

  v_action := case
    when v_next_type <> v_existing.participant_type then 'change_participant_type'
    when v_existing.status <> 'active' and v_next_status = 'active' then 'activate'
    when v_existing.status = 'active' and v_next_status = 'inactive' then 'deactivate'
    else 'update'
  end;

  insert into public.loyalty_program_membership_audit (
    owner_organization_id, loyalty_program_id, membership_table, membership_id,
    action, previous_status, new_status, previous_participant_type, new_participant_type,
    reason, actor_user_id
  ) values (
    v_existing.owner_organization_id, v_existing.loyalty_program_id, 'user', v_existing.id,
    v_action, v_existing.status, v_next_status, v_existing.participant_type, v_next_type,
    nullif(btrim(p_reason), ''), auth.uid()
  );

  return jsonb_build_object('success', true, 'membership_id', v_existing.id, 'action', v_action);
end;
$$;

grant execute on function public.loyalty_program_admin_upsert_organization_membership(uuid,text,text,text) to authenticated;
grant execute on function public.loyalty_program_admin_upsert_user_membership(uuid,text,uuid,text,text,text) to authenticated;
grant execute on function public.loyalty_program_admin_update_user_membership(uuid,text,uuid,text,text) to authenticated;

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
  if p_transaction_type not in ('redemption_refund','system_adjustment')
     and not public.ellbow_has_active_user_membership(p_organization_id, p_loyalty_program_id, p_owner_user_id, p_wallet_lane) then
    raise exception 'Active Ellbow % membership is required', p_wallet_lane;
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
  if not public.ellbow_has_active_user_membership(v_reward.organization_id, v_reward.loyalty_program_id, v_user, 'consumer') then
    raise exception 'Active Ellbow consumer membership is required';
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

create or replace view public.v_ellbow_participant_organizations
with (security_invoker = true) as
select
  m.id as membership_id,
  m.owner_organization_id as organization_id,
  m.loyalty_program_id,
  m.member_organization_id,
  o.org_name,
  o.org_type_code,
  s.state_name,
  o.city,
  m.status,
  m.enrollment_source,
  m.enrolled_at,
  m.ended_at,
  count(um.id) filter (where um.status = 'active')::bigint as active_users,
  max(a.created_at) as last_audit_at
from public.loyalty_program_organization_memberships m
join public.loyalty_programs p on p.id = m.loyalty_program_id and p.organization_id = m.owner_organization_id and p.code = 'ellbow'
join public.organizations o on o.id = m.member_organization_id
left join public.states s on s.id = o.state_id
left join public.loyalty_program_user_memberships um
  on um.owner_organization_id = m.owner_organization_id
 and um.loyalty_program_id = m.loyalty_program_id
 and um.member_organization_id = m.member_organization_id
left join public.loyalty_program_membership_audit a
  on a.membership_table = 'organization' and a.membership_id = m.id
group by m.id, o.id, s.state_name;

create or replace view public.v_ellbow_participant_users
with (security_invoker = true) as
select
  m.id as membership_id,
  m.owner_organization_id as organization_id,
  m.loyalty_program_id,
  m.user_id,
  u.full_name,
  u.email,
  u.phone,
  m.member_organization_id,
  o.org_name,
  m.participant_type,
  m.status,
  m.enrollment_source,
  m.enrolled_at,
  m.ended_at,
  w.id as wallet_id,
  coalesce(w.balance, 0)::bigint as wallet_balance,
  coalesce(w.total_earned, 0)::bigint as total_earned,
  coalesce(w.total_redeemed, 0)::bigint as total_redeemed,
  max(t.created_at) as last_activity_at
from public.loyalty_program_user_memberships m
join public.loyalty_programs p on p.id = m.loyalty_program_id and p.organization_id = m.owner_organization_id and p.code = 'ellbow'
join public.users u on u.id = m.user_id
left join public.organizations o on o.id = m.member_organization_id
left join public.ellbow_wallets w
  on w.organization_id = m.owner_organization_id
 and w.loyalty_program_id = m.loyalty_program_id
 and w.owner_user_id = m.user_id
 and w.wallet_lane = m.participant_type
left join public.ellbow_point_transactions t on t.wallet_id = w.id
where m.participant_type in ('shop_staff','consumer','organization_user')
group by m.id, u.id, o.id, w.id;

grant select on public.v_ellbow_participant_organizations to authenticated;
grant select on public.v_ellbow_participant_users to authenticated;

comment on table public.loyalty_program_membership_audit is 'Audit log for admin loyalty membership changes. It does not alter master users or organizations.';
comment on view public.v_ellbow_participant_organizations is 'Ellbow organization participants only, derived from loyalty_program_organization_memberships.';
comment on view public.v_ellbow_participant_users is 'Ellbow user participants only, including Ellbow wallet balances where they exist.';

-- Post-run validation queries:
-- select count(*) from public.v_ellbow_participant_organizations;
-- select count(*) from public.v_ellbow_participant_users;
-- select public.ellbow_has_active_user_membership('<owner>'::uuid, '<program>'::uuid, '<user>'::uuid, 'consumer');
