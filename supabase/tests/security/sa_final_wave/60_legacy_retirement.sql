-- S&A Final Wave — cutover control and legacy retirement
BEGIN;

SELECT saf.expect_raise('NEW_ENFORCED requires enforcement readiness',
  $$SELECT public.sa_set_migration_mode(null, 'inventory.stock_count.create', 'NEW_ENFORCED', 'attempt without wiring')$$, 'sa_not_enforcement_ready');
SELECT saf.expect_raise('LEGACY_RETIRED requires NEW_ENFORCED first',
  $$SELECT public.sa_set_migration_mode(null, 'hr.payroll.view', 'LEGACY_RETIRED', 'skip a stage')$$, 'sa_retire_requires_new_enforced');
SELECT saf.expect_raise('mode changes need a reason',
  $$SELECT public.sa_set_migration_mode(null, 'hr.payroll.view', 'NEW_ENFORCED', 'x')$$, 'sa_reason_required');
SELECT public.sa_set_migration_mode(null, 'hr.payroll.view', 'NEW_ENFORCED', 'Staging cutover test');
SELECT saf.expect_eq('mode changed and audited',
  (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'migration_mode.changed' AND entity_id = 'hr.payroll.view')::int, 1);
SELECT saf.expect_raise('API-originated mode change needs a human actor',
  $$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true); SELECT public.sa_set_migration_mode(null, 'hr.payroll.view', 'SHADOW', 'service change without actor')$$,
  'sa_actor_required');
SELECT set_config('request.jwt.claims', '', true);
SELECT saf.expect_raise('non-security administrator cannot change modes',
  format($$SELECT public.sa_set_migration_mode(%L, 'hr.payroll.view', 'SHADOW', 'HQ admin tries to downgrade')$$, saf.uid('hq_a')), 'sa_authorization_required');

-- L: NEW_ENFORCED deny never falls back to a legacy allow (database side).
SELECT saf.set_mode('finance.journal.post', 'NEW_ENFORCED');
DELETE FROM public.sa_business_role_permissions WHERE role_id = saf.role('legacy-hq')
  AND permission_id = (SELECT id FROM public.sa_permissions WHERE permission_key = 'finance.journal.post');
SELECT saf.expect_err('L: legacy HQ admin (is_hq_admin true) denied when S&A denies', 'authenticated', saf.uid('hq_a'),
  $$SELECT public.post_document_to_gl('SALES_INVOICE', gen_random_uuid(), current_date)$$, 'sa_authorization_required');

-- Parity evidence.
SELECT saf.expect_eq('analytic parity: lifecycle reproduces every legacy grant',
  (SELECT count(*) FROM public.sa_compat_parity_report(null) WHERE classification = 'LEGACY_ALLOW_NEW_DENY' AND permission_key <> 'finance.journal.post')::int, 0);

-- Legacy stores: writable until the switch, read-only after.
SELECT saf.expect_ok('legacy role editor writable before switch', 'service_role', null,
  $$UPDATE public.roles SET permissions = '{"approve_orders": true, "view_users": true}' WHERE role_code = 'POWER_USER'$$);
UPDATE public.sa_settings SET setting_value = 'true' WHERE setting_key = 'legacy_authorization.read_only';
SELECT saf.expect_err('legacy role permissions read-only after switch', 'service_role', null,
  $$UPDATE public.roles SET permissions = '{"all": true}' WHERE role_code = 'USER'$$, 'legacy_authorization_store_read_only');
SELECT saf.expect_err('legacy role levels read-only after switch', 'service_role', null,
  $$UPDATE public.roles SET role_level = 1 WHERE role_code = 'USER'$$, 'legacy_authorization_store_read_only');
SELECT saf.expect_err('new legacy roles cannot be created', 'service_role', null,
  $$INSERT INTO public.roles(role_code, role_name, role_level) VALUES ('ROOT','Root',1)$$, 'legacy_authorization_store_read_only');
INSERT INTO public.departments(id, organization_id, dept_name) VALUES ('00000000-0000-0000-0000-0000000de001', saf.org('hq_a'), 'Finance');
SELECT saf.expect_err('department overrides read-only', 'service_role', null,
  $$UPDATE public.departments SET permission_overrides = '{"allow":["manage_all"],"deny":[]}' WHERE id = '00000000-0000-0000-0000-0000000de001'$$, 'legacy_authorization_store_read_only');
SELECT saf.expect_ok('department structure edits unaffected', 'service_role', null,
  $$UPDATE public.departments SET dept_name = 'Finance & Accounts' WHERE id = '00000000-0000-0000-0000-0000000de001'$$);
SELECT saf.expect_err('HR access groups read-only', 'service_role', null,
  format($$INSERT INTO public.hr_access_groups(organization_id, name) VALUES (%L, 'Payroll team')$$, saf.org('hq_a')), 'legacy_authorization_store_read_only');
SELECT saf.expect_ok('user profile edits unaffected', 'service_role', null,
  $$UPDATE public.users SET full_name = 'Renamed' WHERE id = '00000000-0000-0000-0000-000000000005'$$);

-- After the lock a legacy role code grants nothing (no escalation through
-- users.role_code); existing lifecycle access is kept; a role change only
-- removes the old compatibility access.
UPDATE public.users SET role_code = 'SA' WHERE id = saf.uid('emp_a2');
SELECT saf.expect_eq('locked: role_code change to SA grants no compatibility access',
  (SELECT count(*) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = saf.uid('emp_a2') AND a.status = 'active' AND br.source = 'legacy')::int, 0);
SELECT saf.expect_eq('locked: self-service baseline kept',
  saf.decide(saf.uid('emp_a2'), 'hr.self_service.use', jsonb_build_object('organization_id', saf.org('hq_a'), 'owner_user_id', saf.uid('emp_a2'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('locked: escalated role code has no Finance authority',
  saf.decide(saf.uid('emp_a2'), 'finance.journal.post', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000061', 'lockedjoiner@saf.test');
INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, account_scope, employment_type, employment_status)
VALUES ('00000000-0000-0000-0000-000000000061', 'lockedjoiner@saf.test', 'HQ', saf.org('hq_a'), true, 'Locked Joiner', 'portal', 'Full-time', 'active');
SELECT saf.expect_eq('locked: joiner gets baseline only',
  (SELECT string_agg(br.role_key, ',') FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = '00000000-0000-0000-0000-000000000061' AND a.status = 'active'), 'employee-self-service');

-- Newly gated business tables decide through S&A in NEW_ENFORCED.
INSERT INTO public.roadtour_runs(id, org_id, name, status, start_date, end_date) VALUES ('00000000-0000-0000-0000-0000000f0301', saf.org('hq_a'), 'SAF Run', 'active', current_date, current_date + 30);
SELECT saf.set_mode('roadtour.campaign.manage', 'NEW_ENFORCED');
DELETE FROM public.sa_business_role_permissions WHERE role_id = saf.role('legacy-hq')
  AND permission_id = (SELECT id FROM public.sa_permissions WHERE permission_key = 'roadtour.campaign.manage');
SELECT saf.try_as('authenticated', saf.uid('hq_a'), $$UPDATE public.roadtour_runs SET name = 'renamed' WHERE id = '00000000-0000-0000-0000-0000000f0301'$$);
SELECT saf.expect_eq('NEW: legacy HQ role code no longer edits RoadTour runs without S&A',
  (SELECT name FROM public.roadtour_runs WHERE id = '00000000-0000-0000-0000-0000000f0301'), 'SAF Run');
SELECT saf.expect_ok('NEW: S&A holder edits RoadTour runs', 'authenticated', saf.uid('pu_a'),
  $$UPDATE public.roadtour_runs SET name = 'renamed' WHERE id = '00000000-0000-0000-0000-0000000f0301'$$);
SELECT saf.expect_eq('NEW: edit applied', (SELECT name FROM public.roadtour_runs WHERE id = '00000000-0000-0000-0000-0000000f0301'), 'renamed');

ROLLBACK;
