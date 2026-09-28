-- Identity Foundation Stage 2 — hr_employees is the employment source; users is the projection
DO $$
DECLARE v_no integer; v_count integer; v_dept uuid := gen_random_uuid(); v_dept2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.departments (id, organization_id, dept_code, dept_name) VALUES
    (v_dept, saf.org('hq_a'), 'QA-OPS', 'QA Operations'), (v_dept2, saf.org('hq_a'), 'QA-FIN', 'QA Finance');

  -- E1 every internal employee has exactly one employment record in their organization
  PERFORM saf.expect_eq('E1 internal employees all have an employment record',
    (SELECT count(*) FROM public.users u WHERE u.principal_type = 'INTERNAL_EMPLOYEE' AND u.organization_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.user_id = u.id AND e.organization_id = u.organization_id))::int, 0);
  PERFORM saf.expect_eq('E1 partners and consumers get none',
    (SELECT count(*) FROM public.hr_employees e JOIN public.users u ON u.id = e.user_id
      WHERE u.id IN (saf.uid('dist_a'), saf.uid('consumer')))::int, 0);

  -- E2 HR edits the employment record → users projection follows
  UPDATE public.hr_employees SET department_id = v_dept, employment_type = 'Part-time'
  WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a');
  PERFORM saf.expect_eq('E2 projection: department', (SELECT department_id FROM public.users WHERE id = saf.uid('emp_a2')), v_dept);
  PERFORM saf.expect_eq('E2 projection: employment type', (SELECT employment_type FROM public.users WHERE id = saf.uid('emp_a2')), 'Part-time');

  -- E3 legacy writers still write users → forwarded into the employment record
  UPDATE public.users SET department_id = v_dept2, manager_user_id = saf.uid('hq_a') WHERE id = saf.uid('emp_a2');
  PERFORM saf.expect_eq('E3 forwarded: department on the employment record',
    (SELECT department_id FROM public.hr_employees WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a')), v_dept2);
  PERFORM saf.expect_eq('E3 forwarded: manager on the employment record',
    (SELECT manager_user_id FROM public.hr_employees WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a')), saf.uid('hq_a'));
  PERFORM saf.expect_eq('E3 users keeps the written value', (SELECT department_id FROM public.users WHERE id = saf.uid('emp_a2')), v_dept2);

  -- E4 HR marks the employee resigned → users.employment_status → S&A leaver
  UPDATE public.hr_employees SET status = 'resigned', end_date = current_date
  WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a');
  PERFORM saf.expect_eq('E4 projection: employment status', (SELECT employment_status FROM public.users WHERE id = saf.uid('emp_a2')), 'resigned');
  PERFORM saf.expect_eq('E4 lifecycle leaver: no active membership',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND status = 'active')::int, 0);
  UPDATE public.hr_employees SET status = 'active', end_date = NULL WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a');
  PERFORM saf.expect_eq('E4 rehire restores the membership',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND status = 'active')::int, 1);
  PERFORM saf.expect_eq('E4 probation stays employed (active projection)',
    (SELECT public.identity_hr_employment_status('probation')), 'active');

  -- E5 move between internal organizations keeps the single record and the employee number
  SELECT employee_no INTO v_no FROM public.hr_employees WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('hq_a');
  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a2'), NULL, saf.org('wh_a1'), true, 'Transfer to warehouse');
  SELECT count(*) INTO v_count FROM public.hr_employees WHERE user_id = saf.uid('emp_a2');
  PERFORM saf.expect_eq('E5 still one employment record', v_count, 1);
  PERFORM saf.expect_eq('E5 record moved to the new organization',
    (SELECT organization_id FROM public.hr_employees WHERE user_id = saf.uid('emp_a2')), saf.org('wh_a1'));
  PERFORM saf.expect_eq('E5 employee number kept', (SELECT employee_no FROM public.users WHERE id = saf.uid('emp_a2')), v_no);

  -- E6 leaving the organization for a partner org keeps the old record as history (no projection)
  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a2'), NULL, saf.org('dist_a'), true, 'Moved to distributor');
  PERFORM saf.expect_eq('E6 principal now DISTRIBUTOR_USER', (SELECT principal_type FROM public.users WHERE id = saf.uid('emp_a2')), 'DISTRIBUTOR_USER');
  PERFORM saf.expect_eq('E6 employment history kept',
    (SELECT count(*) FROM public.hr_employees WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('wh_a1'))::int, 1);
  UPDATE public.hr_employees SET department_id = v_dept WHERE user_id = saf.uid('emp_a2') AND organization_id = saf.org('wh_a1');
  PERFORM saf.expect_eq('E6 a former employer''s record no longer projects',
    (SELECT department_id FROM public.users WHERE id = saf.uid('emp_a2')) IS DISTINCT FROM v_dept, true);
  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a2'), NULL, saf.org('hq_a'), true, 'Back to HQ');

  -- E7 a new internal employee gets a record with the facts given at provisioning
  PERFORM idt.provision(saf.uid('hr_a'), idt.auth_user(90, 'hr.fact@saf.test'), jsonb_build_object(
    'email', 'hr.fact@saf.test', 'organization_id', saf.org('hq_a'), 'authorizing_permission', 'hr.employee.manage',
    'department_id', v_dept, 'employment_type', 'Contract', 'join_date', '2026-10-01', 'created_identity', true));
  PERFORM saf.expect_eq('E7 employment record carries the provisioning facts',
    (SELECT department_id::text || '|' || employment_type || '|' || hire_date FROM public.hr_employees WHERE user_id = idt.new_uid(90)),
    v_dept::text || '|Contract|2026-10-01');
  PERFORM saf.expect_eq('E7 employee number projected',
    (SELECT u.employee_no = e.employee_no FROM public.users u JOIN public.hr_employees e ON e.user_id = u.id WHERE u.id = idt.new_uid(90)), true);

  -- E8 invariants hold across the table
  PERFORM saf.expect_eq('E8 every current employment record matches its projection',
    (SELECT count(*) FROM public.users u JOIN public.hr_employees e ON e.user_id = u.id AND e.organization_id = u.organization_id
      WHERE u.principal_type = 'INTERNAL_EMPLOYEE'
        AND (u.department_id IS DISTINCT FROM e.department_id OR u.employment_type IS DISTINCT FROM e.employment_type
             OR u.employee_no IS DISTINCT FROM e.employee_no
             OR coalesce(u.employment_status, 'active') IS DISTINCT FROM public.identity_hr_employment_status(e.status)))::int, 0);
END $$;
