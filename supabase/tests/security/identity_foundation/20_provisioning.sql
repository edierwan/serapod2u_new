-- Identity Foundation — canonical provisioning core (identity_provision)
-- Legacy/SHADOW baseline: identity management decided by the legacy rule the
-- application used (user admin ≤ 30 / HR admin ≤ 20 or HR_MANAGER); access
-- administration by the HQ-admin rule (≤ 10); S&A roles by security.role.assign.

DO $$
DECLARE r jsonb; v uuid;
BEGIN
  -- P1 new enterprise identity (User Management, HQ admin)
  v := idt.auth_user(21, 'New.Hire@saf.test');
  r := idt.provision(saf.uid('hq_a'), v, jsonb_build_object(
         'email', 'New.Hire@saf.test', 'phone', '012-000 0021', 'full_name', 'New Hire',
         'organization_id', saf.org('hq_a'), 'expected_principal_type', 'INTERNAL_EMPLOYEE',
         'created_identity', true, 'source', 'user_management'));
  PERFORM saf.expect_eq('P1 status', r->>'status', 'ok');
  PERFORM saf.expect_eq('P1 outcome CREATED', r->>'outcome', 'CREATED');
  PERFORM saf.expect_eq('P1 exactly one profile', (SELECT count(*) FROM public.users WHERE id = v)::int, 1);
  PERFORM saf.expect_eq('P1 canonical email stored', (SELECT email FROM public.users WHERE id = v), 'new.hire@saf.test');
  PERFORM saf.expect_eq('P1 canonical phone stored', (SELECT phone FROM public.users WHERE id = v), '+60120000021');
  PERFORM saf.expect_eq('P1 admin-entered phone is not verified', (SELECT phone_verified_at FROM public.users WHERE id = v), NULL::timestamptz);
  PERFORM saf.expect_eq('P1 principal', (SELECT principal_type FROM public.users WHERE id = v), 'INTERNAL_EMPLOYEE');
  PERFORM saf.expect_eq('P1 status ACTIVE', (SELECT account_status FROM public.users WHERE id = v), 'ACTIVE');
  PERFORM saf.expect_eq('P1 baseline legacy role (compatibility only)', (SELECT role_code FROM public.users WHERE id = v), 'USER');
  PERFORM saf.expect_eq('P1 membership created',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v AND organization_id = saf.org('hq_a') AND status = 'active')::int, 1);
  PERFORM saf.expect_eq('P1 membership returned', (r->>'membership_id')::uuid,
    (SELECT id FROM public.sa_organization_memberships WHERE user_id = v AND status = 'active'));
  PERFORM saf.expect_eq('P1 baseline + compatibility assignments',
    (SELECT string_agg(br.role_key, ',' ORDER BY br.role_key) FROM public.sa_role_assignments a
       JOIN public.sa_business_roles br ON br.id = a.role_id WHERE a.user_id = v AND a.status = 'active'),
    'employee-self-service,legacy-user');
  PERFORM saf.expect_eq('P1 every assignment scoped',
    (SELECT count(*) FROM public.sa_role_assignments a WHERE a.user_id = v AND a.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.sa_assignment_scopes s WHERE s.assignment_id = a.id))::int, 0);
  PERFORM saf.expect_eq('P1 HR employment record references the identity',
    (SELECT count(*) FROM public.hr_employees WHERE user_id = v)::int, 1);
  PERFORM saf.expect_eq('P1 audited',
    (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'identity.provisioned' AND target_user_id = v)::int, 1);

  -- P2 idempotent: same person again → same identity, nothing duplicated
  r := idt.provision(saf.uid('hq_a'), v, jsonb_build_object(
         'email', 'new.hire@saf.test', 'organization_id', saf.org('hq_a'), 'source', 'user_management'));
  PERFORM saf.expect_eq('P2 outcome REUSED', r->>'outcome', 'REUSED');
  PERFORM saf.expect_eq('P2 still one profile', (SELECT count(*) FROM public.users WHERE email_normalized = 'new.hire@saf.test')::int, 1);
  PERFORM saf.expect_eq('P2 still one membership',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v)::int, 1);
END $$;

-- P3 conflicting identifiers: blocked, audited, nothing merged or created
DO $$
DECLARE r jsonb; v uuid; n_before int;
BEGIN
  n_before := (SELECT count(*) FROM public.identity_conflicts);
  v := idt.auth_user(22, 'other.person@saf.test');
  r := idt.provision(saf.uid('hq_a'), v, jsonb_build_object(
         'email', 'other.person@saf.test', 'phone', '+60120000005',   -- emp_a's verified phone
         'organization_id', saf.org('hq_a'), 'created_identity', true, 'source', 'user_management'));
  PERFORM saf.expect_eq('P3 blocked', r->>'status', 'blocked');
  PERFORM saf.expect_eq('P3 code', r->>'code', 'IDENTITY_CONFLICT');
  PERFORM saf.expect_eq('P3 no profile created for the new auth identity', (SELECT count(*) FROM public.users WHERE id = v)::int, 0);
  PERFORM saf.expect_eq('P3 conflict recorded', (SELECT count(*) FROM public.identity_conflicts)::int, n_before + 1);
  PERFORM saf.expect_eq('P3 conflict names both identities',
    (SELECT matched_user_ids @> array[v, saf.uid('emp_a')] FROM public.identity_conflicts ORDER BY detected_at DESC LIMIT 1), true);
  PERFORM saf.expect_eq('P3 conflict stores fingerprints, not values',
    (SELECT email_fingerprint ~ '^[0-9a-f]{64}$' AND phone_fingerprint ~ '^[0-9a-f]{64}$' FROM public.identity_conflicts ORDER BY detected_at DESC LIMIT 1), true);
  PERFORM saf.expect_eq('P3 existing identity untouched (no silent merge)',
    (SELECT email || '|' || phone FROM public.users WHERE id = saf.uid('emp_a')), 'fixture5@saf.test|+60120000005');
END $$;

-- HR / department paths: employee management never implies privilege
DO $$
DECLARE r jsonb;
BEGIN
  r := idt.provision(saf.uid('hr_a'), idt.auth_user(23, 'hr.created@saf.test'), jsonb_build_object(
         'email', 'hr.created@saf.test', 'organization_id', saf.org('hq_a'), 'authorizing_permission', 'hr.employee.manage',
         'employment_type', 'Full-time', 'created_identity', true, 'source', 'hr'));
  PERFORM saf.expect_eq('P4 HR manager provisions a baseline employee', r->>'outcome', 'CREATED');
  PERFORM saf.expect_eq('P4 HR onboarding grants no authority (no-authority legacy code, never USER/"staff")', r->>'legacy_role_code', 'GUEST');
  PERFORM saf.expect_eq('P4 baseline employee role only',
    (SELECT string_agg(br.role_key, ',' ORDER BY br.role_key) FROM public.sa_role_assignments a
       JOIN public.sa_business_roles br ON br.id = a.role_id WHERE a.user_id = idt.new_uid(23) AND a.status = 'active'
         AND br.source <> 'legacy'), 'employee-self-service');
  PERFORM saf.expect_eq('P4 principal INTERNAL_EMPLOYEE with membership',
    (SELECT u.principal_type || ':' || count(m.*) FROM public.users u LEFT JOIN public.sa_organization_memberships m
       ON m.user_id = u.id AND m.status = 'active' WHERE u.id = idt.new_uid(23) GROUP BY u.principal_type), 'INTERNAL_EMPLOYEE:1');

  PERFORM saf.expect_raise('P5 HR/department caller cannot create a Super Admin',
    format('select idt.provision(%L, idt.auth_user(24, %L), %L::jsonb)', saf.uid('hr_a'), 'sa.attempt@saf.test',
      jsonb_build_object('email', 'sa.attempt@saf.test', 'organization_id', saf.org('hq_a'),
        'authorizing_permission', 'hr.employee.manage', 'legacy_role_code', 'SA', 'created_identity', true)),
    'identity_role_grant_not_allowed');
  PERFORM saf.expect_eq('P5 atomic: no profile left behind', (SELECT count(*) FROM public.users WHERE id = idt.new_uid(24))::int, 0);

  PERFORM saf.expect_raise('P6 HR manager cannot grant any role above baseline (access administration)',
    format('select idt.provision(%L, idt.auth_user(25, %L), %L::jsonb)', saf.uid('hr_a'), 'mgr.attempt@saf.test',
      jsonb_build_object('email', 'mgr.attempt@saf.test', 'organization_id', saf.org('hq_a'),
        'authorizing_permission', 'hr.employee.manage', 'legacy_role_code', 'MANAGER', 'created_identity', true)),
    'sa_authorization_required');

  PERFORM saf.expect_raise('P7 power user cannot grant a role above their own level',
    format('select idt.provision(%L, idt.auth_user(26, %L), %L::jsonb)', saf.uid('pu_a'), 'hq.attempt@saf.test',
      jsonb_build_object('email', 'hq.attempt@saf.test', 'organization_id', saf.org('hq_a'), 'legacy_role_code', 'HQ', 'created_identity', true)),
    'identity_role_grant_not_allowed');

  PERFORM saf.expect_raise('P7b HQ admin cannot create a Super Admin',
    format('select idt.provision(%L, idt.auth_user(27, %L), %L::jsonb)', saf.uid('hq_a'), 'sa.attempt2@saf.test',
      jsonb_build_object('email', 'sa.attempt2@saf.test', 'organization_id', saf.org('hq_a'), 'legacy_role_code', 'SA', 'created_identity', true)),
    'identity_role_grant_not_allowed');

  r := idt.provision(saf.uid('hq_a'), idt.auth_user(28, 'pu.created@saf.test'), jsonb_build_object(
         'email', 'pu.created@saf.test', 'organization_id', saf.org('hq_a'), 'legacy_role_code', 'POWER_USER', 'created_identity', true));
  PERFORM saf.expect_eq('P8 HQ admin (access administrator) may place a lower legacy role', r->>'legacy_role_code', 'POWER_USER');
  PERFORM saf.expect_eq('P8 compatibility mapping follows the legacy role',
    (SELECT count(*) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
      WHERE a.user_id = idt.new_uid(28) AND a.status = 'active' AND br.role_key = 'legacy-power-user')::int, 1);

  PERFORM saf.expect_raise('P9 HR path cannot create consumers',
    format('select idt.provision(%L, idt.auth_user(29, %L), %L::jsonb)', saf.uid('hr_a'), 'hr.consumer@saf.test',
      jsonb_build_object('email', 'hr.consumer@saf.test', 'account_scope', 'store', 'authorizing_permission', 'hr.employee.manage', 'created_identity', true)),
    'identity_hr_requires_enterprise');
END $$;

-- Consumers stay outside enterprise RBAC
DO $$
DECLARE r jsonb;
BEGIN
  r := idt.provision(saf.uid('hq_a'), idt.auth_user(30, 'shopper@saf.test'), jsonb_build_object(
         'email', 'shopper@saf.test', 'account_scope', 'store', 'created_identity', true, 'source', 'user_management'));
  PERFORM saf.expect_eq('P10 consumer created', r->>'principal_type', 'CONSUMER');
  PERFORM saf.expect_eq('P10 consumer baseline role', r->>'legacy_role_code', 'GUEST');
  PERFORM saf.expect_eq('P10 consumer has no enterprise membership',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = idt.new_uid(30))::int, 0);
  PERFORM saf.expect_eq('P10 consumer has no role assignment',
    (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = idt.new_uid(30))::int, 0);

  PERFORM saf.expect_raise('P11 consumer cannot receive a business role at provisioning',
    format('select idt.provision(%L, idt.auth_user(31, %L), %L::jsonb)', saf.uid('sa'), 'shopper2@saf.test',
      jsonb_build_object('email', 'shopper2@saf.test', 'account_scope', 'store', 'created_identity', true,
        'initial_role_id', saf.role('order-approver'))),
    'identity_consumer_cannot_receive_business_role');
  PERFORM saf.expect_eq('P11 atomic: no consumer profile left behind', (SELECT count(*) FROM public.users WHERE id = idt.new_uid(31))::int, 0);

  r := public.identity_provision(saf.uid('hq_a'), saf.uid('consumer'),
         jsonb_build_object('email', 'fixture10@saf.test', 'organization_id', saf.org('hq_a'), 'source', 'user_management'));
  PERFORM saf.expect_eq('P12 consumer → enterprise requires an explicit upgrade', r->>'code', 'IDENTITY_PRINCIPAL_UPGRADE_REQUIRED');
  PERFORM saf.expect_eq('P12 consumer unchanged', (SELECT account_scope FROM public.users WHERE id = saf.uid('consumer')), 'store');
END $$;

-- Initial S&A access: security.role.assign, atomic with the identity
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM saf.expect_raise('P13 HQ admin without security.role.assign cannot attach a business role',
    format('select idt.provision(%L, idt.auth_user(32, %L), %L::jsonb)', saf.uid('hq_a'), 'approver1@saf.test',
      jsonb_build_object('email', 'approver1@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true,
        'initial_role_id', saf.role('order-approver'), 'initial_reason', 'Order approval duty')),
    'sa_authorization_required');
  PERFORM saf.expect_eq('P13 atomic: failed initial access leaves no identity/membership',
    (SELECT count(*) FROM public.users WHERE id = idt.new_uid(32))::int
    + (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = idt.new_uid(32))::int, 0);

  r := idt.provision(saf.uid('sa'), idt.auth_user(33, 'approver2@saf.test'), jsonb_build_object(
         'email', 'approver2@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true,
         'initial_role_id', saf.role('order-approver'), 'initial_reason', 'Order approval duty'));
  PERFORM saf.expect_eq('P14 security administrator attaches the initial business role', r->>'status', 'ok');
  PERFORM saf.expect_eq('P14 role assignment created (manual, scoped)',
    (SELECT count(*) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
      WHERE a.user_id = idt.new_uid(33) AND br.role_key = 'order-approver' AND a.status = 'active' AND a.source = 'manual'
        AND EXISTS (SELECT 1 FROM public.sa_assignment_scopes s WHERE s.assignment_id = a.id))::int, 1);
  PERFORM saf.expect_eq('P14 the new identity is allowed by S&A in scope',
    saf.decide(idt.new_uid(33), 'supply_chain.order.approve', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
END $$;

-- Actor and context validation
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM saf.expect_raise('P15 self-provisioning prohibited',
    format('select idt.provision(%L, %L, %L::jsonb)', saf.uid('hq_a'), saf.uid('hq_a'),
      jsonb_build_object('email', 'fixture2@saf.test', 'organization_id', saf.org('hq_a'))), 'identity_self_provisioning_prohibited');
  PERFORM saf.expect_raise('P16 inactive actor denied',
    format('select idt.provision(%L, idt.auth_user(34, %L), %L::jsonb)', saf.uid('inactive'), 'x34@saf.test',
      jsonb_build_object('email', 'x34@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true)), 'sa_actor_inactive');
  PERFORM saf.expect_raise('P16b ordinary employee cannot provision identities',
    format('select idt.provision(%L, idt.auth_user(35, %L), %L::jsonb)', saf.uid('emp_a2'), 'x35@saf.test',
      jsonb_build_object('email', 'x35@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true)), 'sa_authorization_required');

  r := public.identity_provision(saf.uid('hq_a'), saf.uid('emp_a'),
         jsonb_build_object('email', 'fixture5@saf.test', 'organization_id', saf.org('hq_b'), 'source', 'user_management'));
  PERFORM saf.expect_eq('P17 existing identity in another organization is not moved implicitly', r->>'code', 'IDENTITY_ORG_MOVE_REQUIRED');
  PERFORM saf.expect_eq('P17 organization unchanged', (SELECT organization_id FROM public.users WHERE id = saf.uid('emp_a')), saf.org('hq_a'));

  PERFORM saf.expect_raise('P18 requested principal must match the organization',
    format('select idt.provision(%L, idt.auth_user(36, %L), %L::jsonb)', saf.uid('hq_a'), 'x36@saf.test',
      jsonb_build_object('email', 'x36@saf.test', 'organization_id', saf.org('hq_a'), 'expected_principal_type', 'SHOP_STAFF', 'created_identity', true)),
    'identity_principal_type_mismatch');

  r := idt.provision(saf.uid('hq_a'), idt.auth_user(37, 'dist.staff@saf.test'), jsonb_build_object(
         'email', 'dist.staff@saf.test', 'organization_id', saf.org('dist_a'), 'created_identity', true));
  PERFORM saf.expect_eq('P19 distributor organization → DISTRIBUTOR_USER', r->>'principal_type', 'DISTRIBUTOR_USER');
  r := idt.provision(saf.uid('hq_a'), idt.auth_user(38, 'shop.staff@saf.test'), jsonb_build_object(
         'email', 'shop.staff@saf.test', 'organization_id', saf.org('shop_a'), 'created_identity', true));
  PERFORM saf.expect_eq('P19 shop organization → SHOP_STAFF', r->>'principal_type', 'SHOP_STAFF');

  PERFORM saf.expect_raise('P20 invalid phone rejected (never guessed)',
    format('select idt.provision(%L, idt.auth_user(39, %L), %L::jsonb)', saf.uid('hq_a'), 'x39@saf.test',
      jsonb_build_object('email', 'x39@saf.test', 'phone', '123456789', 'organization_id', saf.org('hq_a'), 'created_identity', true)),
    'identity_phone_invalid');
END $$;

-- NEW_ENFORCED: S&A decides; organization scope applies; legacy ALLOW cannot override
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM saf.set_mode('platform.user.manage', 'NEW_ENFORCED');
  r := idt.provision(saf.uid('hq_a'), idt.auth_user(40, 'enforced.a@saf.test'), jsonb_build_object(
         'email', 'enforced.a@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true));
  PERFORM saf.expect_eq('P21 NEW_ENFORCED: identity admin allowed in own organization', r->>'status', 'ok');
  PERFORM saf.expect_raise('P22 NEW_ENFORCED: HQ admin of B cannot provision into A (legacy would allow)',
    format('select idt.provision(%L, idt.auth_user(41, %L), %L::jsonb)', saf.uid('hq_b'), 'enforced.b@saf.test',
      jsonb_build_object('email', 'enforced.b@saf.test', 'organization_id', saf.org('hq_a'), 'created_identity', true)),
    'sa_authorization_required');
  PERFORM saf.set_mode('platform.user.manage', 'SHADOW');

  PERFORM saf.set_mode('hr.employee.manage', 'NEW_ENFORCED');
  r := idt.provision(saf.uid('hr_a'), idt.auth_user(42, 'hr.enforced@saf.test'), jsonb_build_object(
         'email', 'hr.enforced@saf.test', 'organization_id', saf.org('hq_a'), 'authorizing_permission', 'hr.employee.manage', 'created_identity', true));
  PERFORM saf.expect_eq('P23 NEW_ENFORCED: HR manager provisions baseline employee in scope', r->>'status', 'ok');
  PERFORM saf.set_mode('platform.identity_access.manage', 'NEW_ENFORCED');
  PERFORM saf.expect_raise('P24 NEW_ENFORCED: hr.employee.manage does not grant access administration',
    format('select idt.provision(%L, idt.auth_user(43, %L), %L::jsonb)', saf.uid('hr_a'), 'hr.enforced2@saf.test',
      jsonb_build_object('email', 'hr.enforced2@saf.test', 'organization_id', saf.org('hq_a'), 'authorizing_permission', 'hr.employee.manage',
        'legacy_role_code', 'HR_MANAGER', 'created_identity', true)),
    'sa_authorization_required');
  PERFORM saf.set_mode('hr.employee.manage', 'SHADOW');
  PERFORM saf.set_mode('platform.identity_access.manage', 'SHADOW');
END $$;
