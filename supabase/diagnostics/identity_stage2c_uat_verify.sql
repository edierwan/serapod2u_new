-- ============================================================================
-- Identity Foundation Stage 2C — staging UAT, part C (verification)
-- READ-ONLY. Run inside: BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;
-- Replace __START__ with the UTC time management noted before Part B
-- (e.g. 2026-09-29 03:00:00+00). Prints role labels only, no identities.
-- ============================================================================
with w as (select timestamptz '__START__' t0),
d as (
  select d.*, coalesce(case when u.email like 'qa-idf2-%-e@%' then 'QA-E' end,
                       u.role_code || '@' || coalesce(o.org_type_code, '-')) actor
  from w cross join public.sa_authorization_decisions d
  left join public.users u on u.id = d.actor_id
  left join public.organizations o on o.id = u.organization_id
  where d.occurred_at >= w.t0
    and d.permission_key in ('hr.employee.manage','hr.settings.manage','hr.compensation.view','hr.performance.manage',
                             'finance.payroll_integration.manage','warehouse.shipment.manage','customer.campaign.manage',
                             'platform.data.destructive','platform.settings.manage','platform.organization.manage')
)
select actor, permission_key, resource_type, decision, legacy_decision, comparison, reason_code, count(*)
from d group by 1,2,3,4,5,6,7 order by 1,2,3,4;

-- QA-E must never be allowed any of the converted permissions (expect 0)
with w as (select timestamptz '__START__' t0)
select count(*) qa_e_allows
from w cross join public.sa_authorization_decisions d join public.users u on u.id = d.actor_id
where d.occurred_at >= w.t0 and u.email like 'qa-idf2-%-e@%' and d.decision = 'ALLOW'
  and d.permission_key not in ('hr.self_service.use');

-- Consumers never reach enterprise S&A decisions (expect 0)
with w as (select timestamptz '__START__' t0)
select count(*) consumer_enterprise_allows
from w cross join public.sa_authorization_decisions d join public.users u on u.id = d.actor_id
where d.occurred_at >= w.t0 and u.account_scope = 'store' and d.decision = 'ALLOW';

-- Identity invariants (Stage 2) unchanged: principal/scope agreement,
-- status/is_active agreement, duplicate identifiers (all expect 0)
select
  (select count(*) from public.users where (principal_type = 'CONSUMER') <> (account_scope = 'store')) principal_scope_mismatch,
  (select count(*) from public.users where (account_status = 'ACTIVE') <> is_active and account_status <> 'INVITED') status_mismatch,
  (select count(*) from (select email_normalized from public.users where email_normalized is not null group by 1 having count(*) > 1) x) dup_email,
  (select count(*) from (select phone from public.users where phone_verified_at is not null group by 1 having count(*) > 1) x) dup_verified_phone;

-- Migration modes unchanged (expect 83 / 11 / 7)
select mode, count(*) from public.sa_migration_modes group by 1 order by 1;
