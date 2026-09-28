-- ============================================================================
-- Identity Foundation Stage 1 — STAGING UAT (QA identities; STAGING ONLY)
-- ----------------------------------------------------------------------------
-- Run ONCE on staging after 20260929140000_identity_stage1_closure.sql, as the
-- database owner (SQL editor / psql). NEVER on production.
--
-- Creates disposable QA identities (emails qa-idf-<run>-*@serapod.test, no
-- password: they cannot sign in) and exercises cases A–I through the same
-- database functions the application's provisioning service calls. Each case
-- runs in its own savepoint; an expected refusal never rolls back evidence.
-- Evidence per case is written to sa_access_change_log
-- (action 'uat.identity_stage1', entity_id = case code, details.pass) in
-- addition to the domain rows (users, memberships, assignments,
-- identity_conflicts, audit_logs). Nothing outside the QA identities is
-- changed; no migration mode is changed.
-- ============================================================================
DO $uat$
DECLARE
  v_run text := to_char(clock_timestamp(), 'YYMMDDHH24MISS');
  v_admin uuid;       -- active Super Admin (INTERNAL_EMPLOYEE)
  v_hr uuid;          -- ordinary HR manager: POWER_USER with hr.employee.manage, not an access administrator
  v_org uuid;
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_f uuid := gen_random_uuid(); v_h uuid := gen_random_uuid();
  v_email_a text; v_email_b text; v_phone_a text; v_phone_b text;
  r jsonb; v_n integer; v_ok boolean; v_txt text; v_fail integer := 0;

BEGIN
  v_email_a := 'qa-idf-' || v_run || '-a@serapod.test';
  v_email_b := 'qa-idf-' || v_run || '-b@serapod.test';
  v_phone_a := '+6019' || lpad(((extract(epoch from clock_timestamp())::bigint) % 10000000)::text, 7, '0');
  v_phone_b := '+6018' || lpad(((extract(epoch from clock_timestamp())::bigint) % 10000000)::text, 7, '0');

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

  -- A. New employee identity (HR path)
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, phone, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email_a, ltrim(v_phone_a, '+'), now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{"full_name":"QA IDF A"}');
    r := public.identity_provision(v_hr, v_a, jsonb_build_object('email', v_email_a, 'phone', v_phone_a, 'full_name', 'QA IDF A',
           'organization_id', v_org, 'authorizing_permission', 'hr.employee.manage', 'created_identity', true, 'source', 'hr'));
    SELECT count(*) INTO v_n FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
      WHERE a.user_id = v_a AND a.status = 'active' AND br.source <> 'legacy';
    v_ok := r->>'status' = 'ok' AND r->>'outcome' = 'CREATED'
        AND (SELECT count(*) FROM auth.users WHERE id = v_a) = 1
        AND (SELECT count(*) FROM public.users WHERE email_normalized = v_email_a) = 1
        AND (SELECT principal_type FROM public.users WHERE id = v_a) = 'INTERNAL_EMPLOYEE'
        AND (SELECT role_code FROM public.users WHERE id = v_a) = 'GUEST'
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_a AND organization_id = v_org AND status = 'active') = 1
        AND v_n = 1
        AND NOT EXISTS (SELECT 1 FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
                        WHERE a.user_id = v_a AND a.status = 'active' AND br.role_key <> 'employee-self-service' AND br.role_key <> 'legacy-guest');
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'A_new_employee', (r) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'A_new_employee', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- B. Existing-email reuse (User Management path, different case/padding)
  BEGIN
    r := public.identity_resolve('  ' || upper(v_email_a) || ' ', NULL);
    v_ok := r->>'outcome' = 'MATCH' AND (r->>'user_id')::uuid = v_a;
    r := r || jsonb_build_object('provision', public.identity_provision(v_admin, v_a, jsonb_build_object('email', v_email_a,
           'organization_id', v_org, 'source', 'user_management')));
    v_ok := v_ok AND r->'provision'->>'outcome' = 'REUSED'
        AND (SELECT count(*) FROM public.users WHERE email_normalized = v_email_a) = 1
        AND (SELECT count(*) FROM auth.users WHERE lower(email) = v_email_a) = 1;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'B_existing_email_reuse', (r) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'B_existing_email_reuse', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- second identity B (User Management path, admin-entered phone = unverified)
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email_b, now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{"full_name":"QA IDF B"}');
    r := public.identity_provision(v_admin, v_b, jsonb_build_object('email', v_email_b, 'phone', v_phone_b, 'full_name', 'QA IDF B',
           'organization_id', v_org, 'created_identity', true, 'source', 'user_management'));
    IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'QA-B provisioning: %', r; END IF;
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_b, 'uat_case', 'setup_B', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_fail := v_fail + 1;
  END;

  -- C. email A + phone B → blocked, conflict recorded (the service's resolve step)
  BEGIN
    SELECT count(*) INTO v_n FROM public.identity_conflicts;
    r := public.identity_resolve(v_email_a, v_phone_b);
    IF r->>'outcome' = 'IDENTITY_CONFLICT' THEN
      PERFORM public.identity_record_conflict('IDENTITY_CONFLICT', r, v_email_a, v_phone_b, 'uat', v_admin, jsonb_build_object('stage', 'resolve', 'case', 'C'));
    END IF;
    v_ok := r->>'outcome' = 'IDENTITY_CONFLICT' AND r->>'user_id' IS NULL
        AND (r->>'email_user_id')::uuid = v_a AND (r->>'phone_user_id')::uuid = v_b
        AND (SELECT count(*) FROM public.identity_conflicts) = v_n + 1;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'C_email_A_phone_B_conflict', (r) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'C_email_A_phone_B_conflict', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- D. unverified phone-only match → VERIFICATION_REQUIRED, blocked and recorded
  BEGIN
    r := public.identity_resolve('qa-idf-' || v_run || '-d@serapod.test', v_phone_b);
    IF r->>'outcome' = 'IDENTITY_VERIFICATION_REQUIRED' THEN
      PERFORM public.identity_record_conflict('IDENTITY_VERIFICATION_REQUIRED', r, 'qa-idf-' || v_run || '-d@serapod.test', v_phone_b, 'uat', v_admin, jsonb_build_object('stage', 'resolve', 'case', 'D'));
    END IF;
    v_ok := r->>'outcome' = 'IDENTITY_VERIFICATION_REQUIRED' AND r->>'user_id' IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.users WHERE email_normalized = 'qa-idf-' || v_run || '-d@serapod.test');
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'D_unverified_phone_only', (r) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'D_unverified_phone_only', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- E. deactivate / reactivate with audit trail
  BEGIN
    PERFORM public.identity_set_account_status(v_admin, v_a, 'DISABLED', 'UAT deactivate');
    v_txt := (SELECT account_status || ':' || is_active FROM public.users WHERE id = v_a);
    SELECT count(*) INTO v_n FROM public.sa_organization_memberships WHERE user_id = v_a AND status = 'active';
    PERFORM public.identity_set_account_status(v_admin, v_a, 'ACTIVE', 'UAT reactivate');
    v_ok := v_txt = 'DISABLED:false' AND v_n = 0
        AND (SELECT account_status || ':' || is_active FROM public.users WHERE id = v_a) = 'ACTIVE:true'
        AND (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = v_a AND status = 'active') = 1
        AND (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'identity.status_changed' AND target_user_id = v_a) = 2;
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'E_deactivate_reactivate', (jsonb_build_object('while_disabled', v_txt, 'active_memberships_while_disabled', v_n)) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_a, 'uat_case', 'E_deactivate_reactivate', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- F. ordinary HR manager cannot create a Super Admin
  BEGIN
    v_txt := NULL;
    BEGIN
      INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (v_f, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-idf-' || v_run || '-f@serapod.test', now(), now(), now());
      PERFORM public.identity_provision(v_hr, v_f, jsonb_build_object('email', 'qa-idf-' || v_run || '-f@serapod.test',
        'organization_id', v_org, 'authorizing_permission', 'hr.employee.manage', 'legacy_role_code', 'SA', 'created_identity', true, 'source', 'hr'));
      v_txt := 'ALLOWED';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;   -- rolls back the attempt (auth identity included)
    END;
    v_ok := v_txt IN ('identity_role_grant_not_allowed', 'sa_authorization_required')
        AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_f)
        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_f);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'F_hr_manager_cannot_grant_super_admin', (jsonb_build_object('actor_role', 'POWER_USER (hr.employee.manage)', 'requested_role', 'SA', 'denied_with', v_txt)) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'F_hr_manager_cannot_grant_super_admin', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- I. password reset audit event persists (the /api/users/reset-password insert)
  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, new_values)
    VALUES (v_admin, NULL, 'PASSWORD_RESET', 'user', v_b, jsonb_build_object('target_user_id', v_b, 'uat', true));
    v_ok := EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'PASSWORD_RESET' AND entity_id = v_b);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_b, 'uat_case', 'I_password_reset_audit', ('{}'::jsonb) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_b, 'uat_case', 'I_password_reset_audit', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- G. identity with business/audit history is archived, not deleted
  BEGIN
    -- B's own audited action (row-change audit event authored by B)
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (v_b, 'UPDATE', 'user', v_b, jsonb_build_object('uat', true, 'field', 'call_name'));
    v_txt := array_to_string(public.identity_history_references(v_b), ',');
    PERFORM public.identity_set_account_status(v_admin, v_b, 'ARCHIVED', 'UAT archive (has history)');
    v_ok := v_txt <> ''
        AND (SELECT account_status || ':' || is_active FROM public.users WHERE id = v_b) = 'ARCHIVED:false'
        AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_b)
        AND EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = v_b AND action = 'PASSWORD_RESET');
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_b, 'uat_case', 'G_archive_not_delete', (jsonb_build_object('history', v_txt)) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_b, 'uat_case', 'G_archive_not_delete', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- H. consumer boundary
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
    VALUES (v_h, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-idf-' || v_run || '-h@serapod.test', now(), now(), now());
    r := public.identity_provision(v_admin, v_h, jsonb_build_object('email', 'qa-idf-' || v_run || '-h@serapod.test', 'full_name', 'QA IDF H',
           'account_scope', 'store', 'created_identity', true, 'source', 'user_management'));
    v_ok := r->>'status' = 'ok' AND r->>'principal_type' = 'CONSUMER'
        AND NOT EXISTS (SELECT 1 FROM public.sa_organization_memberships WHERE user_id = v_h)
        AND NOT EXISTS (SELECT 1 FROM public.sa_role_assignments WHERE user_id = v_h);
    PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_h, 'uat_case', 'H_consumer_outside_rbac', (r) || jsonb_build_object('pass', v_ok, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  EXCEPTION WHEN OTHERS THEN PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', v_h, 'uat_case', 'H_consumer_outside_rbac', (jsonb_build_object('error', SQLERRM)) || jsonb_build_object('pass', false, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system'); v_ok := false;
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  PERFORM public.sa_log_access_change(NULL, 'uat.identity_stage1', NULL, 'uat_case', 'SUMMARY', (jsonb_build_object('run', v_run, 'failed_cases', v_fail)) || jsonb_build_object('pass', v_fail = 0, 'run', v_run), 'Identity Foundation Stage 1 staging UAT', 'system');
  RAISE NOTICE 'Identity Stage 1 staging UAT run % finished: % failed case(s). Evidence: sa_access_change_log action uat.identity_stage1', v_run, v_fail;
END
$uat$;
