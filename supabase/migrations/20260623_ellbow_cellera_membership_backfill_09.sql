-- Ellbow Loyalty Phase 9: one-time idempotent Cellera membership backfill.
-- Run after 20260623_ellbow_program_membership_foundation_08.sql.
-- Rollback guidance: if this data patch is applied by mistake before use,
-- delete rows from the two membership tables where enrollment_source =
-- 'legacy_backfill' and loyalty_program_id belongs to code 'cellera'. Do not
-- modify users, organizations, wallets, points, transactions, or redemptions.

insert into public.loyalty_programs (organization_id, code, name, active)
select o.id, 'cellera', 'Cellera Loyalty', true
from public.organizations o
where o.org_type_code = 'HQ'
  and coalesce(o.is_active, true) = true
on conflict (organization_id, code) do update
set name = excluded.name,
    active = true,
    updated_at = now();

with eligible_orgs as (
  select
    o.id as member_organization_id,
    public.loyalty_program_membership_owner_org(o.id) as owner_organization_id,
    case when coalesce(o.is_active, true) = true then 'active' else 'inactive' end as membership_status
  from public.organizations o
  where o.org_type_code in ('SHOP', 'DIST')
)
insert into public.loyalty_program_organization_memberships (
  owner_organization_id,
  loyalty_program_id,
  member_organization_id,
  status,
  enrollment_source,
  enrolled_at
)
select
  e.owner_organization_id,
  p.id,
  e.member_organization_id,
  e.membership_status,
  'legacy_backfill',
  now()
from eligible_orgs e
join public.loyalty_programs p
  on p.organization_id = e.owner_organization_id
 and p.code = 'cellera'
on conflict (owner_organization_id, loyalty_program_id, member_organization_id) do nothing;

with eligible_users as (
  select
    u.id as user_id,
    u.organization_id as member_organization_id,
    public.loyalty_program_membership_owner_org(u.organization_id) as owner_organization_id,
    case when coalesce(u.is_active, true) = true then 'active' else 'inactive' end as membership_status
  from public.users u
  join public.organizations o on o.id = u.organization_id
  where o.org_type_code in ('SHOP', 'DIST')
)
insert into public.loyalty_program_user_memberships (
  owner_organization_id,
  loyalty_program_id,
  user_id,
  member_organization_id,
  participant_type,
  status,
  enrollment_source,
  enrolled_at
)
select
  e.owner_organization_id,
  p.id,
  e.user_id,
  e.member_organization_id,
  'organization_user',
  e.membership_status,
  'legacy_backfill',
  now()
from eligible_users e
join public.loyalty_programs p
  on p.organization_id = e.owner_organization_id
 and p.code = 'cellera'
on conflict (owner_organization_id, loyalty_program_id, user_id, participant_type) do nothing;

comment on table public.loyalty_program_organization_memberships is 'Includes idempotent Cellera legacy backfill rows for existing Shop and Distributor organizations.';
comment on table public.loyalty_program_user_memberships is 'Includes idempotent Cellera legacy backfill rows for existing users attached to Shop and Distributor organizations.';
