-- ============================================================================
-- Identity / S&A Stage 2D — post-migration verification (READ-ONLY)
-- Run inside: BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;
-- After 20260930100000_sa_stage2d_deferred_closure.sql. Role labels only.
-- ============================================================================

-- 1. Functions present, API roles cannot call them (expect 4 rows, all false)
select p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE') as api_executable,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as server_executable
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('sa_readable_organizations','sa_actor_dominates','sa_stage2d_legacy_qualifies','sa_stage2d_backfill')
order by 1;

-- 2. The thirteen permissions, their mode (expect SHADOW until management
--    enforces) and how many people hold each through its role
select m.permission_key, m.mode,
       (select count(distinct a.user_id) from public.sa_role_assignments a
          join public.sa_business_role_permissions rp on rp.role_id = a.role_id
          join public.sa_permissions p on p.id = rp.permission_id
        where p.permission_key = m.permission_key and a.status = 'active') as holders
from public.sa_migration_modes m
where m.permission_key in ('customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
                           'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal',
                           'customer.crm.view','marketing.module.view','product.catalog.view','ecommerce.module.view',
                           'ecommerce.outdoor.operate','platform.notification_monitor.view')
order by 1;

-- 3. Readable organizations agree with the single-decision evaluator
--    (every portal user × every non-shop organization + 25 shops; expect 0)
select count(*) as readable_vs_evaluator_mismatches
from public.users u
cross join lateral (select public.sa_readable_organizations(u.id, 'inventory.report.view') as ro) r
cross join (select id from public.organizations where org_type_code is distinct from 'SHOP'
            union all (select id from public.organizations where org_type_code = 'SHOP' order by id limit 25)) o
where u.is_active and u.account_scope = 'portal'
  and ((o.id = any(r.ro))
       <> (coalesce(public.sa_evaluate_permission(u.id, 'inventory.report.view', jsonb_build_object('organization_id', o.id), true)->>'decision','DENY') = 'ALLOW'));

-- 4. SHADOW parity since the migration (the evidence for enforcing a key):
--    every MATCH_* row agrees; any other comparison needs review before the
--    key is moved to NEW_ENFORCED
select d.permission_key, d.comparison, count(*) as decisions,
       count(distinct d.actor_id) as actors, max(d.occurred_at) as last_seen
from public.sa_authorization_decisions d
where d.permission_key in ('customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
                           'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal',
                           'customer.crm.view','marketing.module.view','product.catalog.view','ecommerce.module.view',
                           'ecommerce.outdoor.operate','platform.notification_monitor.view',
                           'platform.identity.view','platform.identity.disable','platform.identity.delete','platform.identity_access.manage')
  and d.occurred_at > now() - interval '14 days'
group by 1, 2 order by 1, 2;

-- 5. Unchanged invariants (all expect 0) and modes
select
  (select count(*) from public.users where (principal_type = 'CONSUMER') <> (account_scope = 'store')) as principal_scope_mismatch,
  (select count(*) from public.users where (account_status = 'ACTIVE') <> is_active and account_status <> 'INVITED') as status_mismatch,
  (select count(*) from (select email_normalized from public.users where email_normalized is not null group by 1 having count(*) > 1) x) as dup_email,
  (select count(*) from (select phone from public.users where phone_verified_at is not null group by 1 having count(*) > 1) x) as dup_verified_phone,
  (select count(*) from public.sa_role_assignments a join public.users u on u.id = a.user_id
    where u.account_scope = 'store' and a.status = 'active') as consumer_enterprise_assignments;
select mode, count(*) from public.sa_migration_modes group by 1 order by 1;
