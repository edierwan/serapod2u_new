\set ON_ERROR_STOP 1
-- Replica-only behavioural test for 20261001100000_sa_restore_overridden_automatic_access.sql
-- Fixture: HQ + WH orgs, SA admin, HQ targets, an ordinary USER.
-- Run ONLY on a throwaway local PG17 replica restored from a schema-only dump
-- plus the S&A catalogue tables (sa_permissions, sa_business_roles,
-- sa_business_role_permissions, sa_migration_modes, sa_settings, sa_sod_rules,
-- roles). Never on staging/production: it inserts fixtures and toggles
-- session_replication_role.
do $$ begin
  if exists (select 1 from public.users) then raise exception 'refusing to run: public.users is not empty (not a throwaway replica)'; end if;
end $$;
begin;
update sa_settings set setting_value = 'false' where setting_key = 'legacy_authorization.read_only'; -- let lifecycle derive compat roles (backfill stand-in)
insert into organizations(id, org_type_code, org_code, org_name) values
  ('10000000-0000-4000-8000-000000000001', 'HQ', 'TST-HQ', 'Test HQ');
insert into organizations(id, org_type_code, org_code, org_name, parent_org_id) values
  ('10000000-0000-4000-8000-000000000002', 'WH', 'TST-WH', 'Test WH', '10000000-0000-4000-8000-000000000001');
insert into auth.users(id, email) select v::uuid, 'u' || right(v, 1) || '@replica.test' from unnest(array[
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004']) v;
insert into users(id, email, role_code, principal_type, account_status, is_active, account_scope, organization_id, employment_status) values
  ('20000000-0000-4000-8000-000000000001', 'u1@replica.test', 'SA',   'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'u2@replica.test', 'HQ',   'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000003', 'u3@replica.test', 'HQ',   'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000004', 'u4@replica.test', 'USER', 'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active');
update sa_settings set setting_value = 'true' where setting_key = 'legacy_authorization.read_only';
commit;

\echo '== fixture assignments'
select u.email, r.role_key, a.status, a.source from sa_role_assignments a join sa_business_roles r on r.id = a.role_id join users u on u.id = a.user_id order by 1, 2;
select sa_permission_mode('security.role.assign') as role_assign_mode;

create or replace function pg_temp.expect_error(p_sql text, p_pattern text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR % but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm !~ p_pattern then raise exception 'EXPECTED % GOT %', p_pattern, sqlerrm; end if;
  return 'ok: ' || p_pattern;
end $$;
create or replace function pg_temp.assert(p_ok boolean, p_what text) returns text language plpgsql as $$
begin if p_ok is not true then raise exception 'ASSERT FAILED: %', p_what; end if; return 'ok: ' || p_what; end $$;

\set admin '''20000000-0000-4000-8000-000000000001'''
\set t2 '''20000000-0000-4000-8000-000000000002'''
\set t3 '''20000000-0000-4000-8000-000000000003'''
\set plain '''20000000-0000-4000-8000-000000000004'''
select a.id as compat2 from sa_role_assignments a join sa_business_roles r on r.id = a.role_id where a.user_id = :t2 and r.role_key = 'legacy-hq' \gset
select a.id as ess2 from sa_role_assignments a join sa_business_roles r on r.id = a.role_id where a.user_id = :t2 and r.role_key = 'employee-self-service' \gset
select a.id as compat3 from sa_role_assignments a join sa_business_roles r on r.id = a.role_id where a.user_id = :t3 and r.role_key = 'legacy-hq' \gset

\echo '== 1. admin revokes legacy compat access; the lifecycle does not bring it back (the original gap)'
select sa_revoke_assignment(:admin, :'compat2', 'Accidental revoke in UAT');
select sa_sync_user_lifecycle(:t2, 'test');
select pg_temp.assert((select status = 'revoked' and source = 'manual' from sa_role_assignments where id = :'compat2'), 'revoked compat row stays revoked after sync');
select pg_temp.assert((select details->>'previous_source' = 'derived' from sa_access_change_log where entity_id = :'compat2' and action = 'assignment.revoked'), 'revoke records previous_source');
select pg_temp.assert(:'compat2' in (select assignment_id::text from sa_restorable_assignments()), 'listed as restorable');
select pg_temp.expect_error(format('select sa_assign_role(%L, %L, (select role_id from sa_role_assignments where id = %L), %L, array[]::uuid[], null, null, %L)',
  :admin, :t2, :'compat2', '10000000-0000-4000-8000-000000000001', 'manual regrant'), 'sa_scope_required|sa_compat_role_not_assignable');

\echo '== 2. guards'
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'compat2', 'no'), 'sa_reason_required');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :t2, :'compat2', 'restore myself'), 'sa_self_assignment_prohibited');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :plain, :'compat2', 'not an admin'), 'sa_authorization_required');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, gen_random_uuid(), 'missing row'), 'sa_assignment_not_found');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'ess2', 'still active'), 'sa_assignment_not_restorable');

\echo '== 3. admin restores; row returns to lifecycle ownership and survives sync'
select sa_restore_assignment(:admin, :'compat2', 'Revoked by mistake during UAT');
select pg_temp.assert((select status = 'active' and source = 'derived' and ended_reason is null and effective_until is null from sa_role_assignments where id = :'compat2'), 'restored active + derived');
select pg_temp.assert((select count(*) = 1 from sa_access_change_log where entity_id = :'compat2' and action = 'assignment.restored' and actor_id = :admin and reason = 'Revoked by mistake during UAT'), 'restore audited');
select pg_temp.assert(:'compat2' not in (select assignment_id::text from sa_restorable_assignments()), 'no longer restorable');
select sa_sync_user_lifecycle(:t2, 'test');
select pg_temp.assert((select status = 'active' from sa_role_assignments where id = :'compat2'), 'still active after sync');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'compat2', 'restore twice'), 'sa_assignment_not_restorable');

\echo '== 4. a revoked administrator grant is not restorable (grant again instead)'
select id as scope_hq from sa_scope_definitions where organization_id = '10000000-0000-4000-8000-000000000001' and scope_type = 'organization' limit 1 \gset
select id as tmpl_role from sa_business_roles where source <> 'legacy' and status = 'active' and role_key <> 'employee-self-service'
  and id not in (select role_id from sa_role_assignments where user_id = :t2) order by role_key limit 1 \gset
select sa_assign_role(:admin, :t2, :'tmpl_role', '10000000-0000-4000-8000-000000000001', array[:'scope_hq']::uuid[], null, null, 'Granted for test') as granted \gset
select sa_revoke_assignment(:admin, :'granted', 'No longer needed');
select pg_temp.assert(:'granted' not in (select assignment_id::text from sa_restorable_assignments()), 'manual grant not listed');
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'granted', 'try restore'), 'sa_assignment_not_restorable');

\echo '== 5. automatic non-legacy access (employee self-service) is restorable'
select sa_revoke_assignment(:admin, :'ess2', 'Override baseline for test');
select sa_restore_assignment(:admin, :'ess2', 'Restore baseline for test');
select pg_temp.assert((select status = 'active' and source = 'derived' from sa_role_assignments where id = :'ess2'), 'baseline restored');

\echo '== 6. stale compatibility role: legacy role code changed after the revoke'
select sa_revoke_assignment(:admin, :'compat3', 'Override compat for test');
set session_replication_role = replica; -- bypass the access-field guard triggers for the fixture change only
update users set role_code = 'MANAGER' where id = :t3;
set session_replication_role = origin;
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'compat3', 'restore stale'), 'sa_compat_role_stale');

\echo '== 7. historical revoke (logged before previous_source existed)'
set session_replication_role = replica;
update users set role_code = 'HQ' where id = :t3;
set session_replication_role = origin;
insert into sa_access_change_log(actor_id, actor_kind, action, target_user_id, entity_type, entity_id, details, reason)
values (:admin, 'user', 'assignment.revoked', :t3, 'sa_role_assignment', :'compat3', jsonb_build_object('role_id', 'x'), 'Old revoke format');
select pg_temp.assert(sa_assignment_overridden_source(:'compat3') = 'derived', 'legacy role falls back to derived');
select sa_restore_assignment(:admin, :'compat3', 'Restore historical revoke');
select pg_temp.assert((select status = 'active' from sa_role_assignments where id = :'compat3'), 'historical revoke restored');

\echo '== 8. inactive target cannot be restored'
select sa_revoke_assignment(:admin, :'compat3', 'Override before leaving');
set session_replication_role = replica;
update users set is_active = false, account_status = 'DISABLED' where id = :t3;
set session_replication_role = origin;
select pg_temp.expect_error(format('select sa_restore_assignment(%L, %L, %L)', :admin, :'compat3', 'restore leaver'), 'sa_target_inactive|sa_membership_required');

\echo '== 9. grants'
select pg_temp.assert(not has_function_privilege('authenticated', 'sa_restore_assignment(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'sa_restore_assignment(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'sa_restore_assignment(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'sa_restorable_assignments()', 'execute')
  and not has_function_privilege('authenticated', 'sa_assignment_overridden_source(uuid)', 'execute'), 'service_role only');
\echo 'ALL RESTORE TESTS PASSED'
