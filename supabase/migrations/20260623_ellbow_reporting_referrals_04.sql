-- Ellbow Loyalty Phase 2: referral audit and program-scoped reporting views.
-- Run after 20260623_ellbow_redemptions_03.sql.
-- Rollback: drop the three v_ellbow_* views, then ellbow_referral_accruals.

create table if not exists public.ellbow_referral_accruals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loyalty_program_id uuid not null,
  referrer_user_id uuid not null references public.users(id) on delete restrict,
  referred_user_id uuid not null references public.users(id) on delete restrict,
  event_id uuid,
  campaign_id uuid,
  points_awarded bigint not null check (points_awarded > 0),
  point_value_rm numeric(12,4) not null default 0 check (point_value_rm >= 0),
  transaction_id uuid not null references public.ellbow_point_transactions(id) on delete restrict,
  idempotency_key text not null,
  status text not null default 'awarded' check (status in ('awarded','reversed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ellbow_referrals_program_org_fk foreign key (loyalty_program_id, organization_id)
    references public.loyalty_programs(id, organization_id) on delete restrict,
  constraint ellbow_referrals_people_check check (referrer_user_id <> referred_user_id),
  constraint ellbow_referrals_idempotency_key unique (organization_id, loyalty_program_id, idempotency_key)
);

create index if not exists ellbow_referrals_referrer_idx on public.ellbow_referral_accruals(referrer_user_id, created_at desc);
create index if not exists ellbow_referrals_org_idx on public.ellbow_referral_accruals(organization_id, loyalty_program_id, created_at desc);

alter table public.ellbow_referral_accruals enable row level security;
drop policy if exists ellbow_referrals_participant_select on public.ellbow_referral_accruals;
create policy ellbow_referrals_participant_select on public.ellbow_referral_accruals for select to authenticated
using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());
drop policy if exists ellbow_referrals_admin_select on public.ellbow_referral_accruals;
create policy ellbow_referrals_admin_select on public.ellbow_referral_accruals for select to authenticated using (
  organization_id = (select u.organization_id from public.users u where u.id = auth.uid() and u.is_active = true)
  and exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code where u.id = auth.uid() and r.role_level <= 40)
);

create or replace view public.v_ellbow_wallet_performance
with (security_invoker = true) as
select
  w.id as wallet_id, w.organization_id, w.loyalty_program_id, w.owner_user_id, w.wallet_lane,
  w.balance, w.total_earned, w.total_redeemed, w.active,
  u.full_name, u.email, u.phone, u.organization_id as shop_id,
  o.org_name as shop_name, o.org_type_code,
  count(t.id)::bigint as transaction_count,
  coalesce(sum(t.points_delta) filter (where t.transaction_type = 'manual_adjustment'), 0)::bigint as manual_adjustments,
  coalesce(sum(t.points_delta) filter (where t.transaction_type in ('qr_scan','roadtour_bonus','registration_bonus','referral_bonus')), 0)::bigint as system_awards,
  max(t.created_at) as last_activity_at
from public.ellbow_wallets w
join public.users u on u.id = w.owner_user_id
left join public.organizations o on o.id = u.organization_id
left join public.ellbow_point_transactions t on t.wallet_id = w.id
group by w.id, u.id, o.id;

create or replace view public.v_ellbow_redemption_history
with (security_invoker = true) as
select
  r.*, er.name as reward_name, er.code as reward_code,
  u.full_name as user_name, u.email as user_email, u.phone as user_phone,
  u.organization_id as shop_id, o.org_name as shop_name
from public.ellbow_redemptions r
join public.ellbow_rewards er on er.id = r.reward_id
join public.users u on u.id = r.user_id
left join public.organizations o on o.id = u.organization_id;

create or replace view public.v_ellbow_referral_monitor
with (security_invoker = true) as
select
  a.*, referrer.full_name as referrer_name, referrer.email as referrer_email,
  referred.full_name as referred_name, referred.email as referred_email,
  referrer.organization_id as referrer_shop_id, o.org_name as referrer_shop_name,
  (a.points_awarded * a.point_value_rm)::numeric(14,4) as estimated_cost_rm
from public.ellbow_referral_accruals a
join public.users referrer on referrer.id = a.referrer_user_id
join public.users referred on referred.id = a.referred_user_id
left join public.organizations o on o.id = referrer.organization_id;

grant select on public.v_ellbow_wallet_performance to authenticated;
grant select on public.v_ellbow_redemption_history to authenticated;
grant select on public.v_ellbow_referral_monitor to authenticated;

comment on view public.v_ellbow_wallet_performance is 'Ellbow-only wallet performance; never reads legacy point views.';
comment on view public.v_ellbow_redemption_history is 'Ellbow-only redemption reporting.';
comment on view public.v_ellbow_referral_monitor is 'Ellbow-only referral accrual and estimated cost reporting.';
