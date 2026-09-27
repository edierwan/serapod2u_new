-- ============================================================================
-- Blocker A: audit classification + bounded 90-day retention
-- ============================================================================
\set ON_ERROR_STOP on

-- Historical data. Protected rows are inserted with triggers bypassed only to
-- simulate rows that pre-date the readiness migration (UNCLASSIFIED).
DO $$
DECLARE u uuid := sar_test.uid('sa');
BEGIN
  INSERT INTO public.sa_authorization_decisions (id, occurred_at, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, legacy_decision, new_decision, comparison, audit_class, policy_version) VALUES
   ('00000000-0000-0000-0000-00000000d001', now() - interval '10 days',  u, 'inventory.stock_count.view',  'stock_count', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v'),
   ('00000000-0000-0000-0000-00000000d002', now() - interval '89 days',  u, 'inventory.stock_count.view',  'stock_count', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v'),
   ('00000000-0000-0000-0000-00000000d003', now() - interval '91 days',  u, 'inventory.stock_count.view',  'stock_count', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v'),
   ('00000000-0000-0000-0000-00000000d004', now() - interval '400 days', u, 'inventory.transfer.request', 'stock_transfer', 'ALLOW', 'LEGACY_ALLOWED', 'LEGACY_ENFORCED', 'ALLOW', 'DENY', 'LEGACY_ALLOW_NEW_DENY', 'ORDINARY_SHADOW', 'v'),
   ('00000000-0000-0000-0000-00000000d005', now() - interval '200 days', u, 'security.role.assign',       'business_role', 'DENY', 'LEGACY_DENIED', 'LEGACY_ENFORCED', 'DENY', 'DENY', 'MATCH_DENY', 'SECURITY_SENSITIVE', 'v'),
   ('00000000-0000-0000-0000-00000000d006', now() - interval '200 days', u, 'inventory.stock_count.verify','stock_count', 'DENY', 'MISSING_MEMBERSHIP', 'NEW_ENFORCED', 'ALLOW', 'DENY', 'LEGACY_ALLOW_NEW_DENY', 'ENFORCED_DECISION', 'v'),
   ('00000000-0000-0000-0000-00000000d007', now() - interval '200 days', u, 'inventory.stock_count.view',  'stock_count', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'DENY', 'POLICY_ERROR', 'POLICY_ERROR', 'v');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.sa_authorization_decisions (id, occurred_at, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, legacy_decision, new_decision, comparison, audit_class, policy_version) VALUES
   ('00000000-0000-0000-0000-00000000d008', now() - interval '300 days', u, 'inventory.stock_count.view',  'stock_count', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'ALLOW', 'MATCH_ALLOW', 'UNCLASSIFIED', 'v');
END $$;

CREATE FUNCTION sar_test.present(p_id text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.sa_authorization_decisions WHERE id = ('00000000-0000-0000-0000-00000000' || p_id)::uuid) $$;

-- ---- write-time classification is explicit and validated ------------------
SELECT sar_test.expect_err('insert without audit_class is rejected', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'inventory.stock_count.view', 'x', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'MATCH_ALLOW', 'v')$q$, 'audit_class');
SELECT sar_test.expect_err('new UNCLASSIFIED rows are rejected', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'inventory.stock_count.view', 'x', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'MATCH_ALLOW', 'UNCLASSIFIED', 'v')$q$, 'audit_class_required');
SELECT sar_test.expect_err('security permission cannot be ORDINARY_SHADOW', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'security.role.assign', 'x', 'ALLOW', 'LEGACY_ALLOWED', 'LEGACY_ENFORCED', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v')$q$, 'audit_class_invalid');
SELECT sar_test.expect_err('unknown permission cannot be ORDINARY_SHADOW', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'hr.leave.approve', 'x', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v')$q$, 'audit_class_invalid');
SELECT sar_test.expect_err('policy error cannot be ORDINARY_SHADOW', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'inventory.stock_count.view', 'x', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'DENY', 'POLICY_ERROR', 'ORDINARY_SHADOW', 'v')$q$, 'sa_decisions_ordinary_shadow_shape');
SELECT sar_test.expect_err('enforced decision cannot be ORDINARY_SHADOW', 'service_role', NULL,
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'inventory.stock_count.view', 'x', 'ALLOW', 'ALLOWED_BY_ASSIGNMENT', 'NEW_ENFORCED', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v')$q$, 'sa_decisions_ordinary_shadow_shape');
SELECT sar_test.expect_err('authenticated cannot write decisions', 'authenticated', sar_test.uid('sa'),
  $q$INSERT INTO public.sa_authorization_decisions (id, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, new_decision, comparison, audit_class, policy_version)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'inventory.stock_count.verify', 'stock_count', 'ALLOW', 'ALLOWED_BY_ASSIGNMENT', 'NEW_ENFORCED', 'ALLOW', 'MATCH_ALLOW', 'ENFORCED_DECISION', 'v')$q$, '42501');

-- ---- append-only remains -----------------------------------------------------
SELECT sar_test.expect_err('anon cannot delete decisions', 'anon', NULL, $q$DELETE FROM public.sa_authorization_decisions$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot delete decisions', 'authenticated', sar_test.uid('sa'), $q$DELETE FROM public.sa_authorization_decisions$q$, '42501');
SELECT sar_test.expect_err('service_role cannot delete decisions directly', 'service_role', NULL, $q$DELETE FROM public.sa_authorization_decisions WHERE id = '00000000-0000-0000-0000-00000000d003'$q$, '42501');
SELECT sar_test.expect_err('service_role cannot update decisions', 'service_role', NULL, $q$UPDATE public.sa_authorization_decisions SET decision = 'ALLOW'$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot update decisions', 'authenticated', sar_test.uid('sa'), $q$UPDATE public.sa_authorization_decisions SET decision = 'ALLOW'$q$, '42501');
SELECT sar_test.expect_err('service_role cannot truncate decisions', 'service_role', NULL, $q$TRUNCATE public.sa_authorization_decisions$q$, '42501');
-- Even the owner is stopped by the trigger outside the retention function.
SELECT sar_test.expect_err('owner delete of an aged ordinary row outside purge is rejected', 'supabase_admin', NULL,
  $q$DELETE FROM public.sa_authorization_decisions WHERE id = '00000000-0000-0000-0000-00000000d003'$q$, 'append_only');
SELECT sar_test.expect_err('owner delete of a protected row with the purge flag is rejected', 'supabase_admin', NULL,
  $q$SELECT set_config('sa.decision_retention_purge','on',true); DELETE FROM public.sa_authorization_decisions WHERE id = '00000000-0000-0000-0000-00000000d006'$q$, 'append_only');
SELECT sar_test.expect_err('owner delete of a recent ordinary row with the purge flag is rejected', 'supabase_admin', NULL,
  $q$SELECT set_config('sa.decision_retention_purge','on',true); DELETE FROM public.sa_authorization_decisions WHERE id = '00000000-0000-0000-0000-00000000d001'$q$, 'append_only');
SELECT sar_test.expect_err('owner update is rejected', 'supabase_admin', NULL,
  $q$UPDATE public.sa_authorization_decisions SET audit_class = 'ORDINARY_SHADOW' WHERE id = '00000000-0000-0000-0000-00000000d006'$q$, 'append_only');
SELECT sar_test.expect_err('owner truncate is rejected', 'supabase_admin', NULL, $q$TRUNCATE public.sa_authorization_decisions$q$, 'append_only');

-- ---- purge is service-only ---------------------------------------------------
SELECT sar_test.expect_err('anon cannot invoke purge', 'anon', NULL, $q$SELECT public.sa_purge_ordinary_shadow_decisions()$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot invoke purge', 'authenticated', sar_test.uid('sa'), $q$SELECT public.sa_purge_ordinary_shadow_decisions()$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot read retention status', 'authenticated', sar_test.uid('sa'), $q$SELECT public.sa_decision_retention_status()$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot read retention runs', 'authenticated', sar_test.uid('sa'), $q$SELECT count(*) FROM public.sa_retention_runs$q$, '42501');
SELECT sar_test.expect_eq('nothing was removed by the rejected attempts',
  (SELECT count(*) FROM public.sa_authorization_decisions WHERE id::text LIKE '00000000-0000-0000-0000-00000000d%')::int, 8);

-- ---- service purge removes exactly the eligible rows -----------------------------
SELECT sar_test.expect_eq('status before purge: 2 eligible',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_decision_retention_status()->>'eligible_for_purge')$q$), '2');
SELECT sar_test.expect_eq('service purge deletes 2',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_purge_ordinary_shadow_decisions()->>'deleted')$q$), '2');
SELECT sar_test.expect_eq('ordinary <90d (10d) remains', sar_test.present('d001'), true);
SELECT sar_test.expect_eq('ordinary <90d (89d) remains', sar_test.present('d002'), true);
SELECT sar_test.expect_eq('ordinary >90d (91d) removed', sar_test.present('d003'), false);
SELECT sar_test.expect_eq('ordinary >90d (400d, LEGACY_ENFORCED) removed', sar_test.present('d004'), false);
SELECT sar_test.expect_eq('security-sensitive >90d remains', sar_test.present('d005'), true);
SELECT sar_test.expect_eq('enforced decision >90d remains', sar_test.present('d006'), true);
SELECT sar_test.expect_eq('policy error >90d remains', sar_test.present('d007'), true);
SELECT sar_test.expect_eq('pre-classification row >90d remains', sar_test.present('d008'), true);
SELECT sar_test.expect_eq('run recorded', (SELECT deleted_count FROM public.sa_retention_runs ORDER BY run_at DESC LIMIT 1), 2);
SELECT sar_test.expect_eq('run records the invoking API role', (SELECT invoked_by_role FROM public.sa_retention_runs ORDER BY run_at DESC LIMIT 1), 'service_role');

-- ---- idempotent and bounded ----------------------------------------------------
SELECT sar_test.expect_eq('second run deletes 0',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_purge_ordinary_shadow_decisions()->>'deleted')$q$), '0');
SELECT sar_test.expect_eq('third run deletes 0 and reports nothing remaining',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_purge_ordinary_shadow_decisions()->>'more_remaining')$q$), 'false');
INSERT INTO public.sa_authorization_decisions (id, occurred_at, actor_id, permission_key, resource_type, decision, reason_code, migration_mode, legacy_decision, new_decision, comparison, audit_class, policy_version)
SELECT gen_random_uuid(), now() - interval '120 days', sar_test.uid('sa'), 'inventory.transfer.view', 'stock_transfer', 'ALLOW', 'LEGACY_ALLOWED', 'SHADOW', 'ALLOW', 'ALLOW', 'MATCH_ALLOW', 'ORDINARY_SHADOW', 'v'
FROM generate_series(1, 7);
SELECT sar_test.expect_eq('bounded batch deletes at most the limit',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_purge_ordinary_shadow_decisions(3)->>'deleted') || '/' || (public.sa_purge_ordinary_shadow_decisions(0)->>'deleted')$q$), '3/1');
SELECT sar_test.expect_eq('batch limit is clamped to 1..50000',
  (SELECT min(batch_limit) || '/' || max(batch_limit) FROM public.sa_retention_runs), '1/5000');
SELECT sar_test.expect_eq('draining the backlog completes',
  sar_test.value_as('service_role', NULL, $q$SELECT (public.sa_purge_ordinary_shadow_decisions()->>'deleted') || '/' || (public.sa_purge_ordinary_shadow_decisions()->>'more_remaining')$q$), '3/false');
SELECT sar_test.expect_err('retention runs are append-only', 'supabase_admin', NULL, $q$DELETE FROM public.sa_retention_runs$q$, 'append_only');
SELECT sar_test.expect_err('service_role cannot write retention runs', 'service_role', NULL,
  $q$INSERT INTO public.sa_retention_runs (target_table, audit_class, retention_window, cutoff, batch_limit, deleted_count, more_remaining, invoked_by_role) VALUES ('sa_authorization_decisions','ORDINARY_SHADOW','1 day',now(),1,0,false,'x')$q$, '42501');

-- ---- grants / search_path post-conditions --------------------------------------
SELECT sar_test.expect_eq('all new S&A functions pin search_path',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('sa_purge_ordinary_shadow_decisions','sa_decision_retention_status','sa_reject_decision_mutation',
     'sa_validate_decision_audit_class','sa_has_recent_enforced_allow','sa_enforce_stock_count_verify','sa_ordinary_shadow_retention','sa_reject_decision_truncate','sa_reject_retention_run_mutation',
     'sa_save_business_role')
     AND NOT (coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog, pg_temp'])), 0::bigint);
SELECT sar_test.expect_eq('no new S&A function is executable by anon/authenticated',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('sa_purge_ordinary_shadow_decisions','sa_decision_retention_status','sa_has_recent_enforced_allow','sa_enforce_stock_count_verify','sa_ordinary_shadow_retention')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0::bigint);

SELECT 'retention suite passed' AS status;
