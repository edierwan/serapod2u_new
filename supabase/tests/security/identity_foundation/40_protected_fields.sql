-- Identity Foundation — browser/API-role writes to identity & access fields
-- (PostgREST simulated with SET ROLE + request.jwt.claims: vanilla replica only)
DO $$
DECLARE
  hq uuid := saf.uid('hq_a');
  emp uuid := saf.uid('emp_a2');
  q text := 'update public.users set %s where id = ''' || saf.uid('emp_a2') || '''';
BEGIN
  -- An HQ admin passes users_admin_all (legacy is_hq_admin in SHADOW): the row
  -- is reachable, but access fields are not writable through the API.
  PERFORM saf.expect_err('F1 API: role_code', 'authenticated', hq, format(q, 'role_code = ''SA'''), 'identity_protected_field');
  PERFORM saf.expect_err('F2 API: organization_id', 'authenticated', hq, format(q, 'organization_id = ''' || saf.org('hq_b') || ''''), 'identity_protected_field');
  PERFORM saf.expect_err('F3 API: is_active', 'authenticated', hq, format(q, 'is_active = false'), 'identity_protected_field');
  PERFORM saf.expect_err('F4 API: account_status', 'authenticated', hq, format(q, 'account_status = ''DISABLED'''), 'identity_protected_field');
  PERFORM saf.expect_err('F5 API: account_scope', 'authenticated', hq, format(q, 'account_scope = ''store'''), 'identity_protected_field');
  PERFORM saf.expect_err('F6 API: principal_type', 'authenticated', hq, format(q, 'principal_type = ''SHOP_STAFF'''), 'identity_p');
  PERFORM saf.expect_err('F7 API: phone', 'authenticated', hq, format(q, 'phone = ''+60129990000'''), 'identity_protected_field');
  PERFORM saf.expect_err('F8 API: email', 'authenticated', hq, format(q, 'email = ''hijack@saf.test'''), 'identity_protected_field');
  PERFORM saf.expect_err('F9 API: phone verification', 'authenticated', hq, format(q, 'phone_verified_at = now()'), 'identity_protected_field');
  PERFORM saf.expect_ok('F10 API: profile field still editable by an authorized admin', 'authenticated', hq, format(q, 'full_name = ''Employee A2 (renamed)'''));
  PERFORM saf.expect_ok('F11 API: HR employment fact still editable', 'authenticated', hq, format(q, 'employment_type = ''Part-time'''));
  PERFORM saf.expect_eq('F10 profile change applied', (SELECT full_name FROM public.users WHERE id = emp), 'Employee A2 (renamed)');

  -- Self-service: own access fields and phone are not writable either.
  PERFORM saf.expect_err('F12 self: role_code', 'authenticated', emp, format(q, 'role_code = ''SA'''), 'Self-service cannot modify protected');
  PERFORM saf.expect_err('F13 self: phone (verification bypass)', 'authenticated', emp, format(q, 'phone = ''+60129990001'''), 'identity_protected_field');
  PERFORM saf.expect_ok('F14 self: own display name', 'authenticated', emp, format(q, 'call_name = ''A2'''));

  -- Identities are created/removed only by the server.
  PERFORM saf.expect_err('F15 API: insert identity', 'authenticated', hq,
    'insert into public.users (id, email, role_code, organization_id, account_scope) values (''' || idt.new_uid(60) || ''', ''api.insert@saf.test'', ''SA'', ''' || saf.org('hq_a') || ''', ''portal'')',
    'identity_create_requires_provisioning');
  PERFORM saf.expect_err('F16 API: delete identity', 'authenticated', hq,
    'delete from public.users where id = ''' || saf.uid('emp_a2') || '''', 'identity_delete_requires_lifecycle');
  PERFORM saf.expect_eq('F16 identity still present', (SELECT count(*) FROM public.users WHERE id = emp)::int, 1);

  -- NEW_ENFORCED hr.employee.manage: HR edits HR facts, never access.
  PERFORM saf.set_mode('hr.employee.manage', 'NEW_ENFORCED');
  PERFORM saf.expect_ok('F17 NEW_ENFORCED HR manager edits an HR fact', 'authenticated', saf.uid('hr_a'), format(q, 'employment_type = ''Full-time'''));
  PERFORM saf.expect_err('F18 NEW_ENFORCED HR manager cannot change role_code', 'authenticated', saf.uid('hr_a'), format(q, 'role_code = ''HQ'''), 'identity_protected_field');
  PERFORM saf.expect_err('F19 NEW_ENFORCED HR manager cannot move organization', 'authenticated', saf.uid('hr_a'),
    format(q, 'organization_id = ''' || saf.org('dist_a') || ''''), 'identity_protected_field');
  PERFORM saf.set_mode('hr.employee.manage', 'SHADOW');

  PERFORM saf.expect_eq('F20 role unchanged after all attempts', (SELECT role_code FROM public.users WHERE id = emp), 'USER');
  PERFORM saf.expect_eq('F20 organization unchanged', (SELECT organization_id FROM public.users WHERE id = emp), saf.org('hq_a'));

  -- The trusted server (service_role) remains able to act after its S&A decision.
  PERFORM saf.expect_ok('F21 service_role may change access fields', 'service_role', NULL,
    format(q, 'role_code = ''MANAGER'''));
  PERFORM saf.expect_eq('F21 applied', (SELECT role_code FROM public.users WHERE id = emp), 'MANAGER');
  UPDATE public.users SET role_code = 'USER' WHERE id = emp;
END $$;
