-- ============================================================================
-- Identity + S&A foundation — READ-ONLY aggregate audit (staging or production)
-- ----------------------------------------------------------------------------
-- Outputs counts only (no email/phone/bank values). Run inside a read-only
-- transaction; nothing is modified:
--   psql ... -f supabase/diagnostics/identity_foundation_readonly_audit.sql
-- Never combine with SET ROLE probes on a live Supabase database.
-- ============================================================================
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
\pset format unaligned
\pset fieldsep ' | '
select 'auth_users', count(*) from auth.users
union all select 'public_users', count(*) from public.users
union all select 'auth_without_profile', count(*) from auth.users a where not exists (select 1 from public.users u where u.id=a.id)
union all select 'auth_without_profile_never_signed_in', count(*) from auth.users a where not exists (select 1 from public.users u where u.id=a.id) and a.last_sign_in_at is null
union all select 'profile_without_auth', count(*) from public.users u where not exists (select 1 from auth.users a where a.id=u.id)
union all select 'email_dup_groups_public', count(*) from (select lower(btrim(email)) from public.users where email is not null group by 1 having count(*)>1) d
union all select 'email_dup_rows_public', coalesce(sum(n),0) from (select count(*) n from public.users where email is not null group by lower(btrim(email)) having count(*)>1) d
union all select 'email_dup_groups_auth', count(*) from (select lower(btrim(email)) from auth.users where email is not null group by 1 having count(*)>1) d
union all select 'email_noncanonical_public', count(*) from public.users where email is not null and email <> lower(btrim(email))
union all select 'email_noncanonical_collides', count(*) from public.users u where u.email <> lower(btrim(u.email)) and exists (select 1 from public.users v where v.id<>u.id and lower(btrim(v.email))=lower(btrim(u.email)))
union all select 'email_public_vs_auth_drift', count(*) from public.users u join auth.users a on a.id=u.id where lower(btrim(u.email)) is distinct from lower(btrim(a.email))
union all select 'email_null_public', count(*) from public.users where email is null or btrim(email)=''
union all select 'phone_null_public', count(*) from public.users where phone is null
union all select 'phone_not_e164', count(*) from public.users where phone is not null and phone !~ '^\+[1-9][0-9]{7,14}$'
union all select 'phone_not_normalized', count(*) from public.users where phone is not null and phone is distinct from public.normalize_phone_e164(phone)
union all select 'phone_dup_groups', count(*) from (select phone from public.users where phone is not null group by 1 having count(*)>1) d
union all select 'phone_dup_rows', coalesce(sum(n),0) from (select count(*) n from public.users where phone is not null group by phone having count(*)>1) d
union all select 'phone_dup_groups_verified_ge2', count(*) from (select phone from public.users where phone is not null and phone_verified_at is not null group by 1 having count(*)>1) d
union all select 'phone_public_vs_auth_drift', count(*) from public.users u join auth.users a on a.id=u.id where u.phone is distinct from public.normalize_phone_e164(a.phone)
union all select 'auth_phone_dup_groups', count(*) from (select public.normalize_phone_e164(phone) p from auth.users where phone is not null and phone<>'' group by 1 having count(*)>1) d
union all select 'email_A_phone_B_conflicts', count(*) from public.users u join public.users v on v.id<>u.id and v.phone=u.phone and u.phone is not null
union all select 'bank_fields_set', count(*) from public.users where coalesce(bank_account_number,'')<>'' or bank_id is not null or coalesce(bank_account_holder_name,'')<>''
union all select 'bank_fields_set_portal', count(*) from public.users where (coalesce(bank_account_number,'')<>'' or bank_id is not null) and account_scope='portal'
union all select 'hr_employees', count(*) from public.hr_employees
union all select 'hr_emp_no_valid_user', count(*) from public.hr_employees e where e.user_id is null or not exists (select 1 from public.users u where u.id=e.user_id)
union all select 'hr_emp_dup_user', count(*) from (select user_id from public.hr_employees group by 1 having count(*)>1) d
union all select 'hr_emp_org_mismatch', count(*) from public.hr_employees e join public.users u on u.id=e.user_id where e.organization_id is distinct from u.organization_id
union all select 'hr_emp_store_scope_user', count(*) from public.hr_employees e join public.users u on u.id=e.user_id where u.account_scope<>'portal'
union all select 'consumer_in_rbac_active_mem', count(distinct m.user_id) from public.sa_organization_memberships m join public.users u on u.id=m.user_id where m.status='active' and (u.account_scope<>'portal' or u.role_code in ('GUEST','CONSUMER'))
union all select 'consumer_in_rbac_active_asg', count(distinct a.user_id) from public.sa_role_assignments a join public.users u on u.id=a.user_id where a.status='active' and (u.account_scope<>'portal' or u.role_code in ('GUEST','CONSUMER'))
union all select 'enterprise_missing_membership', count(*) from public.users u where u.account_scope='portal' and u.organization_id is not null and u.is_active and coalesce(u.employment_status,'active')='active' and not exists (select 1 from public.sa_organization_memberships m where m.user_id=u.id and m.status='active' and m.organization_id=u.organization_id)
union all select 'nonportal_business_role', count(*) from public.users u join public.roles r on r.role_code=u.role_code where u.account_scope<>'portal' and r.role_level<50
union all select 'portal_without_org', count(*) from public.users where account_scope='portal' and organization_id is null
union all select 'dup_active_memberships_user_org', count(*) from (select user_id, organization_id from public.sa_organization_memberships where status='active' group by 1,2 having count(*)>1) d
union all select 'multi_primary_active', count(*) from (select user_id from public.sa_organization_memberships where status='active' and is_primary group by 1 having count(*)>1) d
union all select 'dup_active_assignments', count(*) from (select user_id, role_id, membership_id from public.sa_role_assignments where status='active' group by 1,2,3 having count(*)>1) d
union all select 'asg_orphan_membership', count(*) from public.sa_role_assignments a where not exists (select 1 from public.sa_organization_memberships m where m.id=a.membership_id)
union all select 'asg_user_ne_membership_user', count(*) from public.sa_role_assignments a join public.sa_organization_memberships m on m.id=a.membership_id where m.user_id<>a.user_id
union all select 'asg_active_on_inactive_membership', count(*) from public.sa_role_assignments a join public.sa_organization_memberships m on m.id=a.membership_id where a.status='active' and m.status<>'active'
union all select 'asg_active_without_scope', count(*) from public.sa_role_assignments a where a.status='active' and not exists (select 1 from public.sa_assignment_scopes s where s.assignment_id=a.id)
union all select 'scope_orphan', count(*) from public.sa_assignment_scopes s where not exists (select 1 from public.sa_role_assignments a where a.id=s.assignment_id) or not exists (select 1 from public.sa_scope_definitions d where d.id=s.scope_id)
union all select 'stale_active_mem_inactive_user', count(*) from public.sa_organization_memberships m join public.users u on u.id=m.user_id where m.status='active' and (not u.is_active or coalesce(u.employment_status,'active')<>'active')
union all select 'stale_active_asg_inactive_user', count(*) from public.sa_role_assignments a join public.users u on u.id=a.user_id where a.status='active' and (not u.is_active or coalesce(u.employment_status,'active')<>'active')
union all select 'active_asg_expired', count(*) from public.sa_role_assignments where status='active' and effective_until is not null and effective_until < now()
union all select 'manual_assignments', count(*) from public.sa_role_assignments where source='manual';
select 'mode:'||mode, count(*) from public.sa_migration_modes group by 1 order by 1;
select 'setting:'||setting_key, setting_value::text from public.sa_settings where setting_key like 'legacy%' or setting_key like 'lifecycle%';
select 'scope_x_active:'||account_scope||':'||is_active, count(*) from public.users group by 1 order by 1;
select 'scope_decisions_30d:'||migration_mode||':'||comparison, count(*) from public.sa_authorization_decisions
 where occurred_at > now() - interval '30 days' group by 1 order by 1;
select 'membership:'||status||':'||source, count(*) from public.sa_organization_memberships group by 1 order by 1;
select 'assignment:'||a.status||':'||a.source||':'||br.source, count(*) from public.sa_role_assignments a
  join public.sa_business_roles br on br.id = a.role_id group by 1 order by 1;
ROLLBACK;
