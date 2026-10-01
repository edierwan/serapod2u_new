\set ON_ERROR_STOP 1
-- Replica-only behavioural test for 20261001120000_sa_remove_legacy_guest_compat_role.sql
-- Run ONLY on a throwaway local PG17 replica restored from a schema-only dump
-- plus the S&A catalogue tables (sa_permissions, sa_business_roles,
-- sa_business_role_permissions, sa_migration_modes, sa_settings, sa_sod_rules,
-- sa_legacy_compat_rules, roles), BEFORE applying the migration; the script
-- applies it itself (path given with -v migration=...). Never on
-- staging/production: it inserts fixtures and toggles session_replication_role.
do $$ begin
  if exists (select 1 from public.users) then raise exception 'refusing to run: public.users is not empty (not a throwaway replica)'; end if;
end $$;

create or replace function pg_temp.assert(p_ok boolean, p_what text) returns text language plpgsql as $$
begin if p_ok is not true then raise exception 'ASSERT FAILED: %', p_what; end if; return 'ok: ' || p_what; end $$;
create or replace function pg_temp.guest_role() returns uuid language sql as $$
  select id from public.sa_business_roles where role_key = 'legacy-guest' $$;
create or replace function pg_temp.holds(p_email text, p_role_key text) returns boolean language sql as $$
  select exists (select 1 from public.sa_role_assignments a join public.sa_business_roles r on r.id = a.role_id
                 join public.users u on u.id = a.user_id where u.email = p_email and r.role_key = p_role_key and a.status = 'active') $$;

-- Fixture with legacy_authorization.read_only = false (production today):
-- the lifecycle derives compatibility roles from role codes.
begin;
update sa_settings set setting_value = 'false' where setting_key = 'legacy_authorization.read_only';
insert into organizations(id, org_type_code, org_code, org_name) values ('10000000-0000-4000-8000-000000000001', 'HQ', 'TST-HQ', 'Test HQ');
insert into auth.users(id, email) values
  ('20000000-0000-4000-8000-000000000001', 'admin@replica.test'),
  ('20000000-0000-4000-8000-000000000002', 'guest@replica.test'),
  ('20000000-0000-4000-8000-000000000003', 'hq@replica.test');
insert into users(id, email, role_code, principal_type, account_status, is_active, account_scope, organization_id, employment_status) values
  ('20000000-0000-4000-8000-000000000001', 'admin@replica.test', 'SA',    'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'guest@replica.test', 'GUEST', 'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000003', 'hq@replica.test',    'HQ',    'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active');
commit;

\echo '== before: the GUEST identity holds legacy-guest (inventory.transfer.cancel)'
select pg_temp.assert(pg_temp.holds('guest@replica.test', 'legacy-guest'), 'guest holds legacy-guest before');
select pg_temp.assert(exists (select 1 from sa_business_role_permissions bp join sa_permissions p on p.id = bp.permission_id
  where bp.role_id = pg_temp.guest_role() and p.permission_key = 'inventory.transfer.cancel'), 'legacy-guest carries inventory.transfer.cancel');

\echo '== refuses while an access request references the role'
begin;
insert into sa_access_requests(requester_id, target_user_id, request_type, role_id, organization_id, reason, status)
select '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'role', pg_temp.guest_role(), '10000000-0000-4000-8000-000000000001', 'test reference row', 'requested';
\set ON_ERROR_STOP 0
\i :migration
\set ON_ERROR_STOP 1
rollback;
select pg_temp.assert(pg_temp.guest_role() is not null, 'role kept when referenced');

\echo '== apply (twice: idempotent)'
\i :migration
\i :migration
select pg_temp.assert(pg_temp.guest_role() is null, 'legacy-guest deleted');
select pg_temp.assert(not exists (select 1 from sa_role_assignments a join users u on u.id = a.user_id
  where u.email = 'guest@replica.test' and a.role_id not in (select id from sa_business_roles)), 'no orphan assignments');
select pg_temp.assert((select count(*) = 1 from sa_access_change_log where action = 'assignment.removed' and details->>'role_key' = 'legacy-guest'), 'removal audited per assignment');
select pg_temp.assert((select count(*) = 1 from sa_access_change_log where action = 'role.deleted' and details->>'role_key' = 'legacy-guest'), 'role deletion audited once');
select pg_temp.assert(pg_temp.holds('guest@replica.test', 'employee-self-service'), 'guest keeps the employee baseline');
select pg_temp.assert(pg_temp.holds('hq@replica.test', 'legacy-hq'), 'other compatibility roles untouched');

\echo '== never re-created: lifecycle sync, roles trigger, new GUEST identity (read_only = false)'
select sa_sync_user_lifecycle('20000000-0000-4000-8000-000000000002', 'test');
update roles set role_name = role_name where role_code = 'GUEST';
insert into auth.users(id, email) values ('20000000-0000-4000-8000-000000000004', 'guest2@replica.test');
insert into users(id, email, role_code, principal_type, account_status, is_active, account_scope, organization_id, employment_status) values
  ('20000000-0000-4000-8000-000000000004', 'guest2@replica.test', 'GUEST', 'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active');
select pg_temp.assert(pg_temp.guest_role() is null, 'legacy-guest not re-created');
select pg_temp.assert(sa_refresh_compat_role('GUEST', true) is null and sa_refresh_compat_role('guest', true) is null, 'refresh returns null for GUEST');
select pg_temp.assert(pg_temp.holds('guest2@replica.test', 'employee-self-service'), 'new GUEST identity still gets the baseline');

\echo '== a GUEST who becomes HQ gets legacy-hq; back to GUEST drops it'
set session_replication_role = replica;
update users set role_code = 'HQ' where email = 'guest2@replica.test';
set session_replication_role = origin;
select sa_sync_user_lifecycle('20000000-0000-4000-8000-000000000004', 'test');
select pg_temp.assert(pg_temp.holds('guest2@replica.test', 'legacy-hq'), 'promoted identity derives legacy-hq');
set session_replication_role = replica;
update users set role_code = 'GUEST' where email = 'guest2@replica.test';
set session_replication_role = origin;
select sa_sync_user_lifecycle('20000000-0000-4000-8000-000000000004', 'test');
select pg_temp.assert(not pg_temp.holds('guest2@replica.test', 'legacy-hq'), 'demoted to GUEST loses compatibility access');

\echo '== grants unchanged'
select pg_temp.assert(not has_function_privilege('authenticated', 'sa_refresh_compat_role(text,boolean)', 'execute')
  and not has_function_privilege('anon', 'sa_refresh_compat_role(text,boolean)', 'execute'), 'refresh not callable by API roles');
\echo 'ALL LEGACY-GUEST REMOVAL TESTS PASSED'
