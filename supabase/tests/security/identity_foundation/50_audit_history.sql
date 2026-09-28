-- Identity Foundation — historical attribution survives account removal

-- Fixtures: three disposable identities
INSERT INTO auth.users (id, email) VALUES
  (idt.new_uid(70), 'history.decisions@saf.test'),
  (idt.new_uid(71), 'history.stock@saf.test'),
  (idt.new_uid(72), 'no.history@saf.test'),
  (idt.new_uid(73), 'gotrue.delete@saf.test');
INSERT INTO public.users (id, email, role_code, account_scope) VALUES
  (idt.new_uid(70), 'history.decisions@saf.test', 'GUEST', 'store'),
  (idt.new_uid(71), 'history.stock@saf.test', 'GUEST', 'store'),
  (idt.new_uid(73), 'gotrue.delete@saf.test', 'GUEST', 'store');
-- Identity 72 owns rows (membership, assignments via the lifecycle; a manager
-- reference) but has no business/audit history.
INSERT INTO public.users (id, email, role_code, account_scope, organization_id) VALUES
  (idt.new_uid(72), 'no.history@saf.test', 'USER', 'portal', saf.org('wh_b'));
UPDATE public.users SET manager_user_id = idt.new_uid(72) WHERE id = saf.uid('hq_b');

INSERT INTO public.sa_authorization_decisions (id, occurred_at, actor_id, permission_key, resource_type, decision, reason_code,
  migration_mode, legacy_decision, new_decision, comparison, audit_class, policy_version)
VALUES ('00000000-0000-0000-0000-00000000e070', now(), idt.new_uid(70), 'security.role.assign', 'business_role', 'DENY',
  'LEGACY_DENIED', 'SHADOW', 'DENY', 'DENY', 'MATCH_DENY', 'SECURITY_SENSITIVE', 'v');

-- A Supply Chain movement by identity 71 (stock_movements.created_by is ON DELETE CASCADE).
SET session_replication_role = replica;  -- fixture only: skip variant/company FK checks
INSERT INTO public.stock_movements (id, movement_type, variant_id, quantity_change, quantity_before, quantity_after, company_id, created_by)
VALUES ('00000000-0000-0000-0000-00000000e071', 'adjustment', gen_random_uuid(), 1, 0, 1, saf.org('hq_a'), idt.new_uid(71));
SET session_replication_role = origin;

DO $$
BEGIN
  PERFORM saf.expect_eq('H0 decision FK removed (append-only history keeps raw ids)',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.sa_authorization_decisions'::regclass
       AND contype = 'f' AND confrelid = 'public.users'::regclass)::int, 0);
  PERFORM saf.expect_eq('H0 no append-only S&A table references users',
    (SELECT count(*) FROM pg_constraint c JOIN pg_trigger t ON t.tgrelid = c.conrelid AND NOT t.tgisinternal
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass AND p.proname LIKE 'sa\_reject\_%')::int, 0);

  PERFORM saf.expect_eq('H1 history references detected (decisions)',
    'sa_authorization_decisions.actor_id' = ANY(public.identity_history_references(idt.new_uid(70))), true);
  PERFORM saf.expect_eq('H1 history references detected (Supply Chain)',
    'stock_movements.created_by' = ANY(public.identity_history_references(idt.new_uid(71))), true);
  PERFORM saf.expect_eq('H1 fixture 72 owns a membership and assignments',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = idt.new_uid(72))::int > 0
    AND (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = idt.new_uid(72))::int > 0, true);
  PERFORM saf.expect_eq('H1 identity-owned rows are not history', cardinality(public.identity_history_references(idt.new_uid(72))), 0);

  -- The trusted server cannot hard-delete an identity with history.
  PERFORM saf.expect_err('H2 server delete refused (authorization history)', 'service_role', NULL,
    'delete from public.users where id = ''' || idt.new_uid(70) || '''', 'identity_has_history');
  PERFORM saf.expect_err('H3 server delete refused (Supply Chain history would cascade)', 'service_role', NULL,
    'delete from public.users where id = ''' || idt.new_uid(71) || '''', 'identity_has_history');
  PERFORM saf.expect_eq('H3 stock movement intact', (SELECT count(*) FROM public.stock_movements WHERE id = '00000000-0000-0000-0000-00000000e071')::int, 1);

  -- No history → ordinary removal still works.
  PERFORM saf.expect_ok('H4 server delete of an identity without history', 'service_role', NULL,
    'delete from public.users where id = ''' || idt.new_uid(72) || '''');
  PERFORM saf.expect_eq('H4 removed', (SELECT count(*) FROM public.users WHERE id = idt.new_uid(72))::int, 0);
  PERFORM saf.expect_eq('H4 owned membership removed with it',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = idt.new_uid(72))::int, 0);
  PERFORM saf.expect_eq('H4 manager reference released', (SELECT manager_user_id FROM public.users WHERE id = saf.uid('hq_b')), NULL::uuid);
END $$;

-- GoTrue (auth.admin.deleteUser) cascades through users_id_fkey: also guarded.
GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
GRANT SELECT, DELETE ON auth.users TO supabase_auth_admin;
INSERT INTO public.sa_access_change_log (actor_id, actor_kind, action, target_user_id, entity_type, entity_id)
VALUES (idt.new_uid(73), 'user', 'test.history', NULL, 'user', 'x');
SET SESSION AUTHORIZATION supabase_auth_admin;
DO $$
BEGIN
  BEGIN
    DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000173';
    RAISE EXCEPTION 'FAIL [H5 GoTrue delete of an identity with history]: expected identity_has_history, got success';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%identity_has_history%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS [H5 GoTrue delete of an identity with history refused] (%)', SQLERRM;
  END;
END $$;
RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  PERFORM saf.expect_eq('H5 auth identity and profile intact',
    (SELECT count(*) FROM auth.users WHERE id = idt.new_uid(73))::int + (SELECT count(*) FROM public.users WHERE id = idt.new_uid(73))::int, 2);

  -- A database-owner maintenance delete (reviewed SQL) is possible and leaves
  -- append-only history untouched: the actor id is preserved, not nulled.
  DELETE FROM public.users WHERE id = idt.new_uid(70);
  PERFORM saf.expect_eq('H6 decision row survives account removal',
    (SELECT actor_id FROM public.sa_authorization_decisions WHERE id = '00000000-0000-0000-0000-00000000e070'), idt.new_uid(70));

  PERFORM saf.expect_raise('H7 decisions remain append-only (update)',
    'update public.sa_authorization_decisions set decision = ''ALLOW'' where id = ''00000000-0000-0000-0000-00000000e070''',
    'authorization_decisions_are_append_only');
  PERFORM saf.expect_raise('H7 decisions remain append-only (delete)',
    'delete from public.sa_authorization_decisions where id = ''00000000-0000-0000-0000-00000000e070''',
    'authorization_decisions_are_append_only');
  PERFORM saf.expect_raise('H7 access change log remains append-only',
    'delete from public.sa_access_change_log where action = ''test.history''', 'sa_access_change_log_is_append_only');

  PERFORM saf.expect_eq('H8 identity conflicts exist from provisioning tests', (SELECT count(*) > 0 FROM public.identity_conflicts), true);
  PERFORM saf.expect_raise('H8 identity conflicts are append-only (update)',
    'update public.identity_conflicts set source = ''x''', 'identity_conflicts_is_append_only');
  PERFORM saf.expect_raise('H8 identity conflicts are append-only (delete)',
    'delete from public.identity_conflicts', 'identity_conflicts_is_append_only');
  PERFORM saf.expect_raise('H8 identity conflicts cannot be truncated',
    'truncate public.identity_conflicts', 'identity_conflicts_is_append_only');
  PERFORM saf.expect_err('H8 identity conflicts not readable through the API', 'authenticated', saf.uid('sa'),
    'select count(*) from public.identity_conflicts', 'permission denied');

  -- Archived identities keep resolving for historical Supply Chain rows.
  PERFORM public.identity_set_account_status(saf.uid('sa'), idt.new_uid(71), 'ARCHIVED', 'Offboarded; keep history');
  PERFORM saf.expect_eq('H9 historical actor still resolves after archive',
    (SELECT u.email FROM public.stock_movements m JOIN public.users u ON u.id = m.created_by
      WHERE m.id = '00000000-0000-0000-0000-00000000e071'), 'history.stock@saf.test');
END $$;
