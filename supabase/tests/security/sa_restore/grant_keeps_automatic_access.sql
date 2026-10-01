\set ON_ERROR_STOP 1
-- Replica-only behavioural test for 20261001130000_sa_grant_keeps_automatic_access.sql
-- Run ONLY on a throwaway local PG17 replica restored from a schema-only dump
-- plus the S&A catalogue tables (sa_permissions, sa_business_roles,
-- sa_business_role_permissions, sa_migration_modes, sa_settings, sa_sod_rules,
-- sa_legacy_compat_rules, roles, organization_types), BEFORE applying the
-- migration; the script applies it itself (path given with -v migration=...).
-- Never on staging/production: it inserts fixtures.
do $$ begin
  if exists (select 1 from public.users) then raise exception 'refusing to run: public.users is not empty (not a throwaway replica)'; end if;
end $$;

create or replace function pg_temp.assert(p_ok boolean, p_what text) returns text language plpgsql as $$
begin if p_ok is not true then raise exception 'ASSERT FAILED: %', p_what; end if; return 'ok: ' || p_what; end $$;
-- The "succeeded" failure is raised OUTSIDE the inner handler, so it can
-- never be mistaken for the expected error.
create or replace function pg_temp.expect_error(p_sql text, p_pattern text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~ p_pattern then raise exception 'EXPECTED % GOT %', p_pattern, sqlerrm; end if;
    return 'ok: ' || p_pattern;
  end;
  raise exception 'EXPECTED ERROR % but statement succeeded: %', p_pattern, p_sql;
end $$;

begin;
update sa_settings set setting_value = 'false' where setting_key = 'legacy_authorization.read_only';
insert into organizations(id, org_type_code, org_code, org_name) values ('10000000-0000-4000-8000-000000000001', 'HQ', 'TST-HQ', 'Test HQ');
insert into auth.users(id, email) values
  ('20000000-0000-4000-8000-000000000001', 'admin@replica.test'),
  ('20000000-0000-4000-8000-000000000002', 'staff@replica.test');
insert into users(id, email, role_code, principal_type, account_status, is_active, account_scope, organization_id, employment_status) values
  ('20000000-0000-4000-8000-000000000001', 'admin@replica.test', 'SA',   'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'staff@replica.test', 'USER', 'INTERNAL_EMPLOYEE', 'ACTIVE', true, 'portal', '10000000-0000-4000-8000-000000000001', 'active');
update sa_settings set setting_value = 'true' where setting_key = 'legacy_authorization.read_only';
commit;

\set admin '''20000000-0000-4000-8000-000000000001'''
\set staff '''20000000-0000-4000-8000-000000000002'''
\set org '''10000000-0000-4000-8000-000000000001'''
select id as scope_org from sa_scope_definitions where organization_id = :org and scope_type = 'organization' limit 1 \gset
select id as role_auto from sa_business_roles where role_key = 'catalog-viewer' \gset
select id as role_other from sa_business_roles where role_key = 'warehouse-operator' \gset
select id as membership from sa_organization_memberships where user_id = :staff and status = 'active' \gset

-- Stand-in for a Stage 2D backfill row (automatic access).
select sa_create_assignment_internal(null, :staff, :'role_auto', :org, array[:'scope_org']::uuid[], null, null, 'backfill stand-in', 'backfill') as auto_row \gset

\echo '== migration applied'
\i :migration
\i :migration

\echo '== a manual grant of an automatically held role is refused and the automatic row is untouched'
select pg_temp.expect_error(format('select sa_assign_role(%L, %L, %L, %L, array[%L]::uuid[], null, %L, %L)',
  :admin, :staff, :'role_auto', :org, :'scope_org', now() + interval '1 day', 'temporary re-grant'), 'sa_role_already_held');
select pg_temp.assert((select status = 'active' and source = 'backfill' and effective_until is null from sa_role_assignments where id = :'auto_row'), 'automatic row unchanged');

\echo '== an access request for a held role is refused at submit'
select pg_temp.expect_error(format('select sa_submit_access_request(%L, %L, %L, %L, array[%L]::uuid[], null, null, %L)',
  :staff, :staff, :'role_auto', :org, :'scope_org', 'I need catalogue access'), 'sa_role_already_held');

\echo '== other roles: request, approve, then a second request for the now-held role is refused'
select sa_submit_access_request(:staff, :staff, :'role_other', :org, array[:'scope_org']::uuid[], null, now() + interval '1 day', 'Need warehouse operations') as req \gset
select sa_decide_access_request(:admin, :'req', true, 'ok') as granted \gset
select pg_temp.assert((select status = 'active' and source = 'access_request' from sa_role_assignments where id = :'granted'), 'approved request grants');
select pg_temp.expect_error(format('select sa_submit_access_request(%L, %L, %L, %L, array[%L]::uuid[], null, null, %L)',
  :staff, :staff, :'role_other', :org, :'scope_org', 'Asking again for it'), 'sa_role_already_held');

\echo '== changing an existing administrator grant still works (end date update)'
select sa_assign_role(:admin, :staff, :'role_other', :org, array[:'scope_org']::uuid[], null, now() + interval '2 days', 'extend for test') is not null as updated;
select pg_temp.assert((select source = 'manual' and effective_until > now() + interval '1 day' from sa_role_assignments where id = :'granted'), 'manual grant updated');

\echo '== an ENDED automatic row can be granted again manually'
select sa_revoke_assignment(:admin, :'auto_row', 'End automatic for test');
select sa_assign_role(:admin, :staff, :'role_auto', :org, array[:'scope_org']::uuid[], null, null, 'Grant again after revoke') is not null as regranted;
select pg_temp.assert((select status = 'active' and source = 'manual' from sa_role_assignments where id = :'auto_row'), 'ended automatic row re-granted');

\echo '== lifecycle callers are unaffected'
select pg_temp.assert(sa_create_assignment_internal(null, :staff, :'role_auto', :org, array[:'scope_org']::uuid[], null, null, 'lifecycle', 'derived') = :'auto_row'::uuid, 'derived upsert still allowed');

\echo '== grants'
select pg_temp.assert(not has_function_privilege('authenticated', 'sa_create_assignment_internal(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'sa_submit_access_request(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text)', 'execute'), 'not callable by API roles');
\echo 'ALL GRANT-KEEPS-AUTOMATIC TESTS PASSED'
