-- S&A Final Wave — Joiner / Mover / Leaver
BEGIN;

-- JOINER: a new portal employee gets a primary membership, the compatibility
-- role for their legacy role code (org scope) and the self-service baseline.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000031', 'joiner@saf.test');
INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, account_scope, employment_type, employment_status)
VALUES ('00000000-0000-0000-0000-000000000031', 'joiner@saf.test', 'USER', saf.org('hq_a'), true, 'Joiner', 'portal', 'Full-time', 'active');
SELECT saf.expect_eq('joiner: primary membership',
  (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = '00000000-0000-0000-0000-000000000031' AND status = 'active' AND is_primary)::int, 1);
SELECT saf.expect_eq('joiner: baseline + compatibility assignments',
  (SELECT string_agg(br.role_key, ',' ORDER BY br.role_key) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = '00000000-0000-0000-0000-000000000031' AND a.status = 'active'), 'employee-self-service,legacy-user');
SELECT saf.expect_eq('joiner: audited', (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'lifecycle.joiner' AND target_user_id = '00000000-0000-0000-0000-000000000031')::int, 1);

-- Consumer who becomes an employee keeps their consumer history (same row)
-- and gains enterprise access only through the HR/User Management facts.
UPDATE public.users SET account_scope = 'portal', organization_id = saf.org('dist_a'), role_code = 'USER' WHERE id = saf.uid('consumer');
SELECT saf.expect_eq('consumer→employee: membership in the employing org',
  (SELECT organization_id FROM public.sa_organization_memberships WHERE user_id = saf.uid('consumer') AND status = 'active'), saf.org('dist_a'));
UPDATE public.users SET account_scope = 'store', organization_id = NULL, role_code = 'GUEST' WHERE id = saf.uid('consumer');
SELECT saf.expect_eq('employee→consumer: enterprise access ends',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('consumer') AND status = 'active')::int, 0);
SELECT saf.expect_eq('employee→consumer: consumer row survives', (SELECT count(*) FROM public.users WHERE id = saf.uid('consumer'))::int, 1);

-- MOVER (organization): lifecycle-owned access in the old org ends; manual
-- grants on the old membership end too; delegations are revoked.
SELECT public.sa_assign_role(saf.uid('sa'), saf.uid('emp_a2'), saf.role('finance-viewer'), saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, null, 'Before move');
SELECT public.sa_create_delegation(saf.uid('pu_a'), saf.uid('pu_a'), saf.uid('emp_a2'), saf.org('hq_a'), ARRAY['finance.payment.approve'], null, now() + interval '3 days', 'Cover before move');
UPDATE public.users SET organization_id = saf.org('dist_a') WHERE id = saf.uid('emp_a2');
SELECT saf.expect_eq('mover: old membership inactive',
  (SELECT status FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a')), 'inactive');
SELECT saf.expect_eq('mover: new membership active',
  (SELECT status FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('dist_a')), 'active');
SELECT saf.expect_eq('mover: access in old org removed',
  saf.decide(saf.uid('emp_a2'), 'finance.report.view_sensitive', saf.ctx('hq_a')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('mover: delegation revoked',
  (SELECT status FROM public.sa_delegations WHERE delegate_id = saf.uid('emp_a2')), 'revoked');
SELECT saf.expect_eq('mover: baseline in new org',
  saf.decide(saf.uid('emp_a2'), 'hr.self_service.use', jsonb_build_object('organization_id', saf.org('dist_a'), 'owner_user_id', saf.uid('emp_a2'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');

-- MOVER (role code): compatibility role follows the legacy role code.
UPDATE public.users SET role_code = 'POWER_USER' WHERE id = saf.uid('emp_a');
SELECT saf.expect_eq('role change: new compatibility role',
  (SELECT string_agg(br.role_key, ',' ORDER BY br.role_key) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = saf.uid('emp_a') AND a.status = 'active' AND br.source = 'legacy'), 'legacy-power-user');
SELECT saf.expect_eq('role change: old compatibility role revoked',
  (SELECT a.status FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = saf.uid('emp_a') AND br.role_key = 'legacy-user'), 'revoked');

-- An administrator's revocation of a lifecycle-owned grant is final.
SELECT public.sa_revoke_assignment(saf.uid('sa'), (SELECT a.id FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
  WHERE a.user_id = saf.uid('emp_a') AND br.role_key = 'legacy-power-user'), 'Compatibility access withdrawn');
SELECT public.sa_sync_user_lifecycle(saf.uid('emp_a'), 'test');
SELECT saf.expect_eq('lifecycle does not resurrect an administrator revocation',
  (SELECT a.status || ':' || a.source FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
    WHERE a.user_id = saf.uid('emp_a') AND br.role_key = 'legacy-power-user'), 'revoked:manual');

-- TEMPORARY / CONTRACTOR: mandatory expiry (contract end date when recorded).
SELECT saf.expect_eq('contractor: default expiry applied',
  (SELECT bool_and(effective_until IS NOT NULL AND effective_until <= now() + interval '91 days')
     FROM public.sa_role_assignments WHERE user_id = saf.uid('contractor') AND status = 'active'), true);
INSERT INTO public.hr_contracts(organization_id, employee_user_id, contract_type, contract_url, status, expiry_date)
VALUES (saf.org('hq_a'), saf.uid('contractor'), 'fixed_term', 'https://example.invalid/c.pdf', 'active', current_date + 20);
SELECT public.sa_sync_user_lifecycle(saf.uid('contractor'), 'test');
SELECT saf.expect_eq('contractor: expiry follows the contract end',
  (SELECT min(effective_until)::date FROM public.sa_role_assignments WHERE user_id = saf.uid('contractor') AND status = 'active'), current_date + 21);
UPDATE public.users SET employment_type = 'Full-time' WHERE id = saf.uid('contractor');
SELECT saf.expect_eq('converted to permanent: expiry removed',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('contractor') AND status = 'active' AND effective_until IS NOT NULL)::int, 0);

-- LEAVER: all business access, delegations and pending requests end; history kept.
SELECT public.sa_create_delegation(saf.uid('hq_a'), saf.uid('hq_a'), saf.uid('pu_a'), saf.org('hq_a'), ARRAY['finance.journal.post'], null, now() + interval '3 days', 'Cover');
SELECT public.sa_submit_access_request(saf.uid('hq_a'), saf.uid('hq_a'), saf.role('finance-viewer'), saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, null, 'Pending before leaving');
SELECT saf.expect_eq('delegate allowed before leaver', saf.decide(saf.uid('pu_a'), 'finance.journal.post', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_DELEGATION');
UPDATE public.users SET employment_status = 'resigned' WHERE id = saf.uid('hq_a');
SELECT saf.expect_eq('D: leaver has no active assignments',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('hq_a') AND status = 'active')::int, 0);
SELECT saf.expect_eq('D: leaver memberships inactive',
  (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('hq_a') AND status = 'active')::int, 0);
SELECT saf.expect_eq('D: leaver loses business access even though the account is still active',
  saf.decide(saf.uid('hq_a'), 'finance.journal.post', saf.ctx('hq_a')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('leaver: delegations they granted are revoked',
  saf.decide(saf.uid('pu_a'), 'finance.journal.post', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
SELECT saf.expect_eq('leaver: pending requests cancelled',
  (SELECT status FROM public.sa_access_requests WHERE requester_id = saf.uid('hq_a')), 'cancelled');
SELECT saf.expect_eq('leaver: history retained (rows kept, attribution intact)',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('hq_a'))::int > 0, true);
SELECT saf.expect_eq('leaver: audited',
  (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'lifecycle.leaver' AND target_user_id = saf.uid('hq_a'))::int, 1);
-- Deactivation (is_active=false) is also a leaver event.
UPDATE public.users SET is_active = false WHERE id = saf.uid('pu_a2');
SELECT saf.expect_eq('deactivated user loses assignments',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('pu_a2') AND status = 'active')::int, 0);
-- Rehire: access is re-derived (new facts), not resurrected from history.
UPDATE public.users SET employment_status = 'active' WHERE id = saf.uid('hq_a');
SELECT saf.expect_eq('rehire: baseline access re-derived',
  saf.decide(saf.uid('hq_a'), 'hr.self_service.use', jsonb_build_object('organization_id', saf.org('hq_a'), 'owner_user_id', saf.uid('hq_a'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');

ROLLBACK;
