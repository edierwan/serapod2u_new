-- ============================================================================
-- Identity Foundation Stage 2 — STAGING UAT (QA identities; STAGING ONLY)
-- ----------------------------------------------------------------------------
-- Run ONCE on staging after 20260929150000 .. 20260929190000, as the database
-- owner (SQL editor / psql). NEVER on production.
--
-- Creates disposable QA identities (qa-idf2-<run>-*@serapod.test, no
-- password: they cannot sign in) and exercises the Stage 2 behaviour through
-- the same database functions the application calls. Each case runs in its
-- own savepoint; an expected refusal never rolls back evidence. One evidence
-- row per case in sa_access_change_log (action 'uat.identity_stage2',
-- entity_id = case code, details.pass). Only QA identities are changed; the
-- identifier-drift check (case F) is read-only. No migration mode changes.
--
--   A  HR employment record is the source; users is the projection
--   B  legacy users writes are forwarded into the employment record
--   C  resigned → leaver; rehire → membership restored
--   D  archive keeps identifiers; re-creation blocked; only a Super Admin reactivates
--   E  suspension holds access (incl. an admin-granted role) and restores it exactly
--   F  disable after suspension ends everything; nothing resurrected
--   G  one identity per normalized email / verified phone (uniqueness)
--   H  signup / import resolution: conflicts refused and recorded, reuse on match
--   I  no identifier drift left (read-only)
-- ============================================================================
DO $uat$
DECLARE
  v_run text := to_char(clock_timestamp(), 'YYMMDDHH24MISS');
  v_admin uuid; v_hr uuid; v_org uuid; v_dept uuid; v_scope uuid; v_role uuid;
  v_e uuid := gen_random_uuid(); v_f uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_email_e text; v_email_f text; v_phone_e text; v_phone_f text;
  r jsonb; v_ok boolean; v_txt text; v_n integer; v_no integer; v_asg uuid; v_fail integer := 0;
BEGIN
  v_email_e := 'qa-idf2-' || v_run || '-e@serapod.test';
  v_email_f := 'qa-idf2-' || v_run || '-f@serapod.test';
  v_phone_e := '+6017' || lpad(((extract(epoch from clock_timestamp())::bigint) % 10000000)::text, 7, '0');
  v_phone_f := '+6016' || lpad(((extract(epoch from clock_timestamp())::bigint) % 10000000)::text, 7, '0');

  SELECT u.id, u.organization_id INTO v_admin, v_org
  FROM public.users u JOIN public.roles r2 ON r2.role_code = u.role_code JOIN public.organizations o ON o.id = u.organization_id
  WHERE r2.role_level = 1 AND u.principal_type = 'INTERNAL_EMPLOYEE' AND u.account_status = 'ACTIVE' AND o.org_type_code = 'HQ'
    AND EXISTS (SELECT 1 FROM public.sa_organization_memberships m WHERE m.user_id = u.id AND m.status = 'active')
  ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_hr FROM public.users u
  WHERE u.role_code = 'POWER_USER' AND u.principal_type = 'INTERNAL_EMPLOYEE' AND u.account_status = 'ACTIVE' AND u.organization_id = v_org
    AND EXISTS (SELECT 1 FROM public.sa_organization_memberships m WHERE m.user_id = u.id AND m.status = 'active')
  ORDER BY u.created_at LIMIT 1;
  IF v_admin IS NULL OR v_hr IS NULL THEN RAISE EXCEPTION 'UAT prerequisites missing (Super Admin / POWER_USER in HQ)'; END IF;
  SELECT d.id INTO v_dept FROM public.departments d WHERE d.organization_id = v_org AND d.is_active IS NOT FALSE ORDER BY d.dept_name LIMIT 1;
  SELECT id INTO v_scope FROM public.sa_scope_definitions
  WHERE organization_id = v_org AND scope_value = v_org::text AND scope_type = 'organization' AND status = 'active' LIMIT 1;
  SELECT id INTO v_role FROM public.sa_business_roles WHERE role_key = 'order-approver' AND status = 'active';

  -- setup: QA employee E (HR path), QA person F (User Management path)
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, phone, email_confirmed_at, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (v_e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email_e, ltrim(v_phone_e, '+'), now(), now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{"full_name":"QA IDF2 E"}');
    r := public.identity_provision(v_hr, v_e, jsonb_build_object('email', v_email_e, 'phone', v_phone_e, 'full_name', 'QA IDF2 E',
           'organization_id', v_org, 'authorizing_permission', 'hr.employee.manage', 'employment_type', 'Full-time',
           'created_identity', true, 'source', 'hr'));
    IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'QA-E provisioning: %', r; END IF;
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (v_f, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email_f, now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{"full_name":"QA IDF2 F"}');
    r := public.identity_provision(v_admin, v_f, jsonb_build_object('email', v_email_f, 'phone', v_phone_f, 'full_name', 'QA IDF2 F',
           'organization_id', v_org, 'created_identity', true, 'source', 'user_management'));
    IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'QA-F provisioning: %', r; END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'setup', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
    RAISE NOTICE 'Stage 2 UAT setup failed: %', SQLERRM;
    RETURN;
  END;

  -- A. employment record is the source; users follows
  BEGIN
    UPDATE public.hr_employees SET employment_type = 'Part-time', department_id = coalesce(v_dept, department_id)
    WHERE user_id = v_e AND organization_id = v_org;
    v_ok := (SELECT count(*) FROM public.hr_employees WHERE user_id = v_e) = 1
        AND (SELECT employment_type FROM public.users WHERE id = v_e) = 'Part-time'
        AND (SELECT u.department_id IS NOT DISTINCT FROM e.department_id AND u.employee_no = e.employee_no
             FROM public.users u JOIN public.hr_employees e ON e.user_id = u.id AND e.organization_id = u.organization_id WHERE u.id = v_e);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'A_hr_record_projects', jsonb_build_object('pass', v_ok, 'run', v_run, 'department_used', v_dept IS NOT NULL), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'A_hr_record_projects', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- B. legacy writers of users are forwarded into the employment record
  BEGIN
    UPDATE public.users SET employment_type = 'Contract', manager_user_id = v_hr WHERE id = v_e;
    v_ok := (SELECT employment_type = 'Contract' AND manager_user_id = v_hr FROM public.hr_employees WHERE user_id = v_e AND organization_id = v_org);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'B_users_writes_forwarded', jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'B_users_writes_forwarded', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- C. resigned → leaver; rehire → restored
  BEGIN
    UPDATE public.hr_employees SET status = 'resigned', end_date = current_date WHERE user_id = v_e AND organization_id = v_org;
    v_txt := (SELECT employment_status FROM public.users WHERE id = v_e);
    SELECT count(*) INTO v_n FROM public.sa_organization_memberships WHERE user_id = v_e AND status = 'active';
    UPDATE public.hr_employees SET status = 'active', end_date = NULL, employment_type = 'Full-time' WHERE user_id = v_e AND organization_id = v_org;
    v_ok := v_txt = 'resigned' AND v_n = 0
        AND (SELECT employment_status FROM public.users WHERE id = v_e) = 'active'
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_e AND status = 'active') = 1;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'C_resign_rehire', jsonb_build_object('pass', v_ok, 'run', v_run, 'status_while_resigned', v_txt, 'active_memberships_while_resigned', v_n), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_e, 'uat_case', 'C_resign_rehire', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- D. archive keeps identifiers; re-creation blocked; only a Super Admin reactivates
  BEGIN
    SELECT employee_no INTO v_no FROM public.users WHERE id = v_f;
    PERFORM public.identity_set_account_status(v_admin, v_f, 'ARCHIVED', 'UAT archive');
    v_ok := (SELECT email = v_email_f AND phone = v_phone_f AND account_status = 'ARCHIVED' FROM public.users WHERE id = v_f)
        AND public.identity_resolve(v_email_f, NULL)->>'outcome' = 'IDENTITY_ARCHIVED';
    v_txt := NULL;
    BEGIN
      PERFORM public.identity_set_account_status(v_hr, v_f, 'ACTIVE', 'UAT non-admin reactivation attempt');
      v_txt := 'ALLOWED';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    v_ok := v_ok AND v_txt = 'sa_authorization_required';
    PERFORM public.identity_set_account_status(v_admin, v_f, 'ACTIVE', 'UAT reactivation by Super Admin');
    v_ok := v_ok
        AND (SELECT account_status || ':' || is_active FROM public.users WHERE id = v_f) = 'ACTIVE:true'
        AND (SELECT employee_no FROM public.users WHERE id = v_f) IS NOT DISTINCT FROM v_no
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_f AND status = 'active') = 1
        AND (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'identity.reactivated' AND target_user_id = v_f) = 1;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'D_archive_keeps_identifiers_reactivate', jsonb_build_object('pass', v_ok, 'run', v_run, 'non_admin_reactivation', v_txt), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'D_archive_keeps_identifiers_reactivate', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- E. suspension holds access (incl. an admin-granted role) and restores it exactly
  BEGIN
    IF v_scope IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'order-approver role or organization scope missing'; END IF;
    v_asg := public.sa_assign_role(v_admin, v_f, v_role, v_org, array[v_scope], now(), NULL, 'UAT order approval duty');
    v_txt := public.sa_evaluate_permission(v_f, 'supply_chain.order.approve', jsonb_build_object('organization_id', v_org))->>'decision';
    PERFORM public.identity_set_account_status(v_admin, v_f, 'SUSPENDED', 'UAT suspension');
    v_ok := v_txt = 'ALLOW'
        AND (SELECT status FROM public.sa_role_assignments WHERE id = v_asg) = 'suspended'
        AND (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = v_f AND status = 'active') = 0
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_f AND status = 'suspended') = 1
        AND public.sa_evaluate_permission(v_f, 'supply_chain.order.approve', jsonb_build_object('organization_id', v_org))->>'decision' = 'DENY';
    PERFORM public.identity_set_account_status(v_admin, v_f, 'ACTIVE', 'UAT suspension cleared');
    v_ok := v_ok
        AND (SELECT status FROM public.sa_role_assignments WHERE id = v_asg) = 'active'
        AND public.sa_evaluate_permission(v_f, 'supply_chain.order.approve', jsonb_build_object('organization_id', v_org))->>'decision' = 'ALLOW'
        AND (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'lifecycle.suspended' AND target_user_id = v_f) = 1;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'E_suspend_restore', jsonb_build_object('pass', v_ok, 'run', v_run, 'decision_before', v_txt), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'E_suspend_restore', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- F. disable after suspension ends everything; nothing resurrected
  BEGIN
    PERFORM public.identity_set_account_status(v_admin, v_f, 'SUSPENDED', 'UAT suspension 2');
    PERFORM public.identity_set_account_status(v_admin, v_f, 'DISABLED', 'UAT leaves');
    v_ok := (SELECT status FROM public.sa_role_assignments WHERE id = v_asg) = 'revoked'
        AND (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = v_f AND status = 'suspended') = 0
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_f AND status = 'suspended') = 0;
    PERFORM public.identity_set_account_status(v_admin, v_f, 'ACTIVE', 'UAT rehire');
    v_ok := v_ok AND (SELECT status FROM public.sa_role_assignments WHERE id = v_asg) = 'revoked';
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'F_disable_after_suspension', jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', v_f, 'uat_case', 'F_disable_after_suspension', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- G. one identity per normalized email / verified phone
  BEGIN
    v_txt := NULL;
    BEGIN
      INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      VALUES (v_x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x-' || v_email_e, now(), now());
      INSERT INTO public.users (id, email, role_code, account_scope) VALUES (v_x, upper(v_email_e), 'GUEST', 'store');
      v_txt := 'ALLOWED';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    v_ok := v_txt LIKE '%users_email_normalized_key%';
    UPDATE public.users SET phone_verified_at = now() WHERE id = v_e;          -- E's phone verified (its login confirmed it)
    v_txt := NULL;
    BEGIN
      UPDATE public.users SET phone = v_phone_e, phone_verified_at = now() WHERE id = v_f;
      v_txt := 'ALLOWED';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    v_ok := v_ok AND v_txt LIKE '%users_verified_phone_key%'
        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_x);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'G_uniqueness', jsonb_build_object('pass', v_ok, 'run', v_run, 'verified_phone_duplicate', v_txt), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'G_uniqueness', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- H. signup / import resolution (the calls the application makes before creating a login)
  BEGIN
    SELECT count(*) INTO v_n FROM public.identity_conflicts;
    r := public.identity_resolve('qa-idf2-' || v_run || '-new@serapod.test', v_phone_f);   -- F's phone is unverified
    IF r->>'outcome' IN ('IDENTITY_VERIFICATION_REQUIRED', 'IDENTITY_CONFLICT', 'IDENTITY_AMBIGUOUS_PHONE') THEN
      PERFORM public.identity_record_conflict(r->>'outcome', r, 'qa-idf2-' || v_run || '-new@serapod.test', v_phone_f, 'consumer_signup', NULL, jsonb_build_object('stage', 'resolve', 'uat', true));
    END IF;
    v_ok := r->>'outcome' = 'IDENTITY_VERIFICATION_REQUIRED' AND r->>'user_id' IS NULL;
    r := public.identity_resolve(v_email_e, v_phone_f);                                     -- email E + phone F
    IF r->>'outcome' = 'IDENTITY_CONFLICT' THEN
      PERFORM public.identity_record_conflict('IDENTITY_CONFLICT', r, v_email_e, v_phone_f, 'import', v_admin, jsonb_build_object('stage', 'resolve', 'uat', true));
    END IF;
    v_ok := v_ok AND r->>'outcome' = 'IDENTITY_CONFLICT'
        AND public.identity_resolve('  ' || upper(v_email_e) || ' ', v_phone_e)->>'user_id' = v_e::text     -- import reuse
        AND (SELECT count(*) FROM public.identity_conflicts) = v_n + 2;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'H_signup_import_resolution', jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'H_signup_import_resolution', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- I. no identifier drift left (read-only)
  BEGIN
    SELECT count(*) INTO v_n FROM public.users u JOIN auth.users a ON a.id = u.id
    WHERE (public.identity_normalize_email(a.email) IS NOT NULL AND u.email IS DISTINCT FROM public.identity_normalize_email(a.email))
       OR (coalesce(a.phone, '') <> '' AND public.identity_normalize_phone('+' || ltrim(a.phone, '+')) IS NOT NULL
           AND u.phone IS DISTINCT FROM public.identity_normalize_phone('+' || ltrim(a.phone, '+')));
    v_ok := v_n = 0;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'I_no_identifier_drift', jsonb_build_object('pass', v_ok, 'run', v_run, 'drifting_identities', v_n), 'Identity Foundation Stage 2 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN v_ok := false; PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'I_no_identifier_drift', jsonb_build_object('pass', false, 'run', v_run, 'error', SQLERRM), 'Identity Foundation Stage 2 staging UAT', 'system');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage2', NULL, 'uat_case', 'SUMMARY', jsonb_build_object('pass', v_fail = 0, 'run', v_run, 'failed_cases', v_fail), 'Identity Foundation Stage 2 staging UAT', 'system');
  RAISE NOTICE 'Identity Stage 2 staging UAT run % finished: % failed case(s). Evidence: sa_access_change_log action uat.identity_stage2', v_run, v_fail;
END
$uat$;
