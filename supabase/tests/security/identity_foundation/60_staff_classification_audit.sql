-- Identity Foundation — Stage 1 closure: canonical staff, supply partners, audit actions
-- (sa_actor_is_staff reads auth.uid(): evaluated as the API role on a vanilla replica)

-- Fixtures: a shop-style USER account, a store consumer carrying legacy business roles
INSERT INTO auth.users (id, email) VALUES
  (idt.new_uid(80), 'shop.user@saf.test'), (idt.new_uid(81), 'store.hq@saf.test'), (idt.new_uid(82), 'store.user@saf.test');
INSERT INTO public.users (id, email, role_code, organization_id, account_scope) VALUES
  (idt.new_uid(80), 'shop.user@saf.test', 'USER', saf.org('shop_a'), 'portal'),
  (idt.new_uid(81), 'store.hq@saf.test', 'HQ', saf.org('hq_a'), 'store'),
  (idt.new_uid(82), 'store.user@saf.test', 'USER', NULL, 'store');

CREATE FUNCTION idt.staff(p_user uuid, p_level int) RETURNS text LANGUAGE sql AS $$
  SELECT saf.value_as('authenticated', p_user, format('select public.sa_actor_is_staff(%s)::text', p_level)) $$;
CREATE FUNCTION idt.partner(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT saf.value_as('authenticated', p_user, 'select public.sa_actor_is_supply_partner()::text') $$;

DO $$
DECLARE r jsonb;
BEGIN
  -- Legitimate internal enterprise users keep staff status (compatibility role assignment)
  PERFORM saf.expect_eq('S1 internal USER employee with an S&A assignment is staff', idt.staff(saf.uid('emp_a2'), 40), 'true');
  PERFORM saf.expect_eq('S1 HQ admin is admin-level staff', idt.staff(saf.uid('hq_a'), 20), 'true');
  PERFORM saf.expect_eq('S1 legacy level stays a ceiling (USER is not admin-level)', idt.staff(saf.uid('emp_a2'), 20), 'false');

  -- Legacy USER / business levels alone never make staff
  PERFORM saf.expect_eq('S2 shop-style USER account is not staff', idt.staff(idt.new_uid(80), 40), 'false');
  PERFORM saf.expect_eq('S2 store consumer with legacy HQ role is not staff', idt.staff(idt.new_uid(81), 40), 'false');
  PERFORM saf.expect_eq('S2 store consumer with legacy USER role is not staff', idt.staff(idt.new_uid(82), 40), 'false');
  PERFORM saf.expect_eq('S2 consumer is not staff', idt.staff(saf.uid('consumer'), 40), 'false');
  PERFORM saf.expect_eq('S2 inactive account is not staff', idt.staff(saf.uid('inactive'), 40), 'false');

  -- Baseline-only employee (HR onboarding) is not staff
  r := idt.provision(saf.uid('hr_a'), idt.auth_user(83, 'hr.baseline@saf.test'), jsonb_build_object(
         'email', 'hr.baseline@saf.test', 'organization_id', saf.org('hq_a'), 'authorizing_permission', 'hr.employee.manage', 'created_identity', true));
  PERFORM saf.expect_eq('S3 HR onboarding: no-authority legacy code', r->>'legacy_role_code', 'GUEST');
  PERFORM saf.expect_eq('S3 HR-onboarded employee is INTERNAL_EMPLOYEE with membership', r->>'principal_type', 'INTERNAL_EMPLOYEE');
  PERFORM saf.expect_eq('S3 HR-onboarded employee gets no staff authority by default', idt.staff(idt.new_uid(83), 40), 'false');
  PERFORM saf.expect_eq('S3 no legacy-user compatibility role',
    (SELECT count(*) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
      WHERE a.user_id = idt.new_uid(83) AND a.status = 'active' AND br.role_key = 'legacy-user')::int, 0);

  -- Revoking the S&A assignment removes staff even though role_code is unchanged
  UPDATE public.sa_role_assignments a SET status = 'revoked', ended_reason = 'test'
    FROM public.sa_business_roles br WHERE br.id = a.role_id AND a.user_id = saf.uid('emp_a2') AND br.source = 'legacy';
  PERFORM saf.expect_eq('S4 staff requires an active S&A business/compatibility assignment', idt.staff(saf.uid('emp_a2'), 40), 'false');
  UPDATE public.sa_role_assignments a SET status = 'active', ended_reason = NULL
    FROM public.sa_business_roles br WHERE br.id = a.role_id AND a.user_id = saf.uid('emp_a2') AND br.source = 'legacy';

  -- Supply partners: operational reads only, never staff
  PERFORM saf.expect_eq('S5 distributor is not staff', idt.staff(saf.uid('dist_a'), 40), 'false');
  PERFORM saf.expect_eq('S5 distributor is a supply partner', idt.partner(saf.uid('dist_a')), 'true');
  PERFORM saf.expect_eq('S5 shop-style account is not a supply partner', idt.partner(idt.new_uid(80)), 'false');
  PERFORM saf.expect_eq('S5 consumer is not a supply partner', idt.partner(saf.uid('consumer')), 'false');
  PERFORM saf.expect_eq('S5 supply-partner clause is on read policies only',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%sa_actor_is_supply_partner%' AND cmd <> 'SELECT')::int, 0);
  PERFORM saf.expect_eq('S5 the six operational read policies carry it',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND qual LIKE '%sa_actor_is_supply_partner%')::int, 6);

  -- Application audit actions
  PERFORM saf.expect_ok('A1 PASSWORD_RESET audit event persists', 'service_role', NULL,
    'insert into public.audit_logs (user_id, action, entity_type, entity_id) values (''' || saf.uid('hq_a') || ''', ''PASSWORD_RESET'', ''user'', ''' || saf.uid('emp_a2') || ''')');
  PERFORM saf.expect_ok('A1 BULK_ENABLE_STOCK_CONFIGURATIONS audit event persists', 'service_role', NULL,
    'insert into public.audit_logs (user_id, action, entity_type) values (''' || saf.uid('hq_a') || ''', ''BULK_ENABLE_STOCK_CONFIGURATIONS'', ''stock_configuration'')');
  PERFORM saf.expect_err('A2 the action list stays closed', 'service_role', NULL,
    'insert into public.audit_logs (user_id, action, entity_type) values (''' || saf.uid('hq_a') || ''', ''ANYTHING'', ''user'')', 'audit_action_valid');
END $$;
