-- Phase 0B / Commit A — privileged RPC containment tests.
-- Requires 00_harness_and_fixtures.sql. Disposable databases only.

CREATE OR REPLACE FUNCTION phase0b_test.expect_not_denied(p_label text, p_role text, p_sub uuid, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v text := phase0b_test.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'FAIL [%]: legitimate caller was denied: %', p_label, v;
  END IF;
  RAISE NOTICE 'PASS [%] (%)', p_label, left(v, 90);
END;
$$;
GRANT EXECUTE ON FUNCTION phase0b_test.expect_not_denied(text, text, uuid, text) TO PUBLIC;

-- Test-only SECURITY DEFINER shims so the internal guard helpers (no API
-- grants) can be exercised with a simulated caller JWT.
CREATE FUNCTION phase0b_test.warehouse_guard(p_wh uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN PERFORM public.sa_assert_warehouse_shipment_actor(p_wh); END $$;
CREATE FUNCTION phase0b_test.staff_guard(p_level int, p_hq boolean, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN PERFORM public.sa_assert_staff_actor(p_level, p_hq, p_actor); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA phase0b_test TO PUBLIC;

DO $tests$
DECLARE
  t record;
BEGIN
  -- -------------------------------------------------------------------------
  -- A. Anonymous callers cannot execute privileged RPCs
  -- -------------------------------------------------------------------------
  FOR t IN SELECT * FROM (VALUES
    ('delete_all_transactions_with_inventory_v3', 'SELECT public.delete_all_transactions_with_inventory_v3()'),
    ('delete_all_transactions_with_inventory',    'SELECT public.delete_all_transactions_with_inventory()'),
    ('hard_delete_organization',                  'SELECT public.hard_delete_organization(gen_random_uuid())'),
    ('adjust_inventory_quantity',                 'SELECT public.adjust_inventory_quantity(gen_random_uuid(), gen_random_uuid(), 1)'),
    ('wms_ship_unique_auto',                      'SELECT public.wms_ship_unique_auto(ARRAY[]::uuid[], gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())'),
    ('wms_ship_master_auto',                      'SELECT public.wms_ship_master_auto(gen_random_uuid())'),
    ('wms_ship_mixed',                            'SELECT public.wms_ship_mixed(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)'),
    ('record_stock_movement',                     'SELECT public.record_stock_movement(''manual_in'', gen_random_uuid(), gen_random_uuid(), 1)'),
    ('approve_payment_request',                   'SELECT public.approve_payment_request(gen_random_uuid())'),
    ('post_payroll_run_to_gl',                    'SELECT public.post_payroll_run_to_gl(gen_random_uuid(), current_date)'),
    ('post_payroll_payment_to_gl',                'SELECT public.post_payroll_payment_to_gl(gen_random_uuid(), current_date)'),
    ('search_eligible_references',                'SELECT * FROM public.search_eligible_references(''a'', 5)'),
    ('get_user_by_email',                         'SELECT * FROM public.get_user_by_email(''fixture1@phase0b.test'')'),
    ('process_referral_claim',                    'SELECT public.process_referral_claim(gen_random_uuid(), ''approve'', NULL)'),
    ('backfill_display_doc_numbers',              'SELECT public.backfill_display_doc_numbers(gen_random_uuid())'),
    ('sync_user_profile',                         'SELECT public.sync_user_profile(gen_random_uuid(), ''x@y.z'')')
  ) AS v(label, sql) LOOP
    PERFORM phase0b_test.expect_denied('anon: ' || t.label, 'anon', NULL, t.sql);
  END LOOP;

  -- Explicit catalog check: anon EXECUTE on consumer point/gift RPCs is gone.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('consumer_collect_points', 'evaluate_user_registration_bonus', 'consumer_claim_gift')
             AND pronamespace = 'public'::regnamespace
             AND (has_function_privilege('anon', oid, 'EXECUTE') OR has_function_privilege('authenticated', oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'FAIL: consumer point/gift RPCs still executable by API roles';
  END IF;
  RAISE NOTICE 'PASS [consumer point/gift RPCs are service-role only]';

  -- -------------------------------------------------------------------------
  -- B. Ordinary authenticated users (GUEST shop/consumer) cannot execute
  --    privileged RPCs directly
  -- -------------------------------------------------------------------------
  FOR t IN SELECT * FROM (VALUES
    ('delete_all_transactions_with_inventory_v3', 'SELECT public.delete_all_transactions_with_inventory_v3()'),
    ('hard_delete_organization',                  'SELECT public.hard_delete_organization(gen_random_uuid())'),
    ('adjust_inventory_quantity',                 'SELECT public.adjust_inventory_quantity(gen_random_uuid(), gen_random_uuid(), 1)'),
    ('wms_ship_unique_auto',                      'SELECT public.wms_ship_unique_auto(ARRAY[]::uuid[], gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())'),
    ('search_eligible_references',                'SELECT * FROM public.search_eligible_references(''a'', 5)'),
    ('approve_payment_request',                   'SELECT public.approve_payment_request(gen_random_uuid())'),
    ('post_payroll_run_to_gl',                    'SELECT public.post_payroll_run_to_gl(gen_random_uuid(), current_date)'),
    ('reverse_payroll_gl_posting',                'SELECT public.reverse_payroll_gl_posting(gen_random_uuid(), ''x'', current_date)'),
    ('seed_payroll_components',                   'SELECT public.seed_payroll_components(gen_random_uuid())'),
    ('generate_fiscal_periods',                   'SELECT public.generate_fiscal_periods(gen_random_uuid())'),
    ('backfill_display_doc_numbers',              'SELECT public.backfill_display_doc_numbers(gen_random_uuid())'),
    ('process_referral_claim',                    'SELECT public.process_referral_claim(gen_random_uuid(), ''approve'', ''00000000-0000-0000-0000-000000000005'')'),
    ('approve_reference_change',                  'SELECT public.approve_reference_change(gen_random_uuid(), ''approve'', ''00000000-0000-0000-0000-000000000005'')'),
    ('bulk_reassign_reference',                   'SELECT public.bulk_reassign_reference(gen_random_uuid(), gen_random_uuid(), ''00000000-0000-0000-0000-000000000005'')'),
    ('mark_batch_as_printed',                     'SELECT public.mark_batch_as_printed(gen_random_uuid())'),
    ('propagate_warehouse_to_master_codes',       'SELECT public.propagate_warehouse_to_master_codes(gen_random_uuid())'),
    ('get_user_by_email',                         'SELECT * FROM public.get_user_by_email(''fixture1@phase0b.test'')'),
    ('get_reference_assigned_shops',              'SELECT * FROM public.get_reference_assigned_shops(gen_random_uuid())'),
    ('fn_consumer_unique_list',                   'SELECT * FROM public.fn_consumer_unique_list(gen_random_uuid())'),
    ('sa_assert_service_role (internal helper)',  'SELECT public.sa_assert_service_role()')
  ) AS v(label, sql) LOOP
    PERFORM phase0b_test.expect_denied('guest: ' || t.label, 'authenticated', phase0b_test.uid('shop_a'), t.sql);
  END LOOP;

  -- Inactive staff are denied even with an admin role.
  PERFORM phase0b_test.expect_denied('inactive HQ admin: approve_payment_request', 'authenticated', phase0b_test.uid('inactive'),
    'SELECT public.approve_payment_request(gen_random_uuid())');

  -- -------------------------------------------------------------------------
  -- C. Spoofed actor identifiers are rejected
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_denied('HQ admin spoofing reviewer id (process_referral_claim)', 'authenticated', phase0b_test.uid('hq_a'),
    format('SELECT public.process_referral_claim(gen_random_uuid(), %L, %L)', 'approve', phase0b_test.uid('sa')));
  PERFORM phase0b_test.expect_denied('HQ admin spoofing admin id (bulk_reassign_reference)', 'authenticated', phase0b_test.uid('hq_a'),
    format('SELECT public.bulk_reassign_reference(gen_random_uuid(), gen_random_uuid(), %L)', phase0b_test.uid('sa')));
  PERFORM phase0b_test.expect_denied('user updating another user''s last login', 'authenticated', phase0b_test.uid('shop_a'),
    format('SELECT public.update_last_login(%L)', phase0b_test.uid('hq_a')));

  -- -------------------------------------------------------------------------
  -- D. Legitimate callers keep working
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_ok('user updates own last login', 'authenticated', phase0b_test.uid('shop_a'),
    format('SELECT public.update_last_login(%L)', phase0b_test.uid('shop_a')));
  PERFORM phase0b_test.expect_ok('HQ admin processes referral claim as self (claim not found result)', 'authenticated', phase0b_test.uid('hq_a'),
    format('SELECT public.process_referral_claim(gen_random_uuid(), %L, %L)', 'approve', phase0b_test.uid('hq_a')));
  PERFORM phase0b_test.expect_ok('power user reads reference shops', 'authenticated', phase0b_test.uid('pu_a'),
    'SELECT count(*) FROM public.get_reference_assigned_shops(gen_random_uuid())');
  PERFORM phase0b_test.expect_ok('super admin diagnostic user lookup', 'authenticated', phase0b_test.uid('sa'),
    'SELECT count(*) FROM public.get_user_by_email(''fixture2@phase0b.test'')');
  PERFORM phase0b_test.expect_ok('HQ staff reads consumer list', 'authenticated', phase0b_test.uid('staff_a'),
    format('SELECT count(*) FROM public.fn_consumer_unique_list(%L)', phase0b_test.org('hq_a')));
  PERFORM phase0b_test.expect_not_denied('HQ admin approve_payment_request passes guard', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT public.approve_payment_request(gen_random_uuid())');
  PERFORM phase0b_test.expect_denied('manager (level 30) approve_payment_request', 'authenticated', phase0b_test.uid('manager_a'),
    'SELECT public.approve_payment_request(gen_random_uuid())');
  PERFORM phase0b_test.expect_not_denied('power user generate_fiscal_periods passes guard', 'authenticated', phase0b_test.uid('pu_a'),
    'SELECT public.generate_fiscal_periods(gen_random_uuid())');
  PERFORM phase0b_test.expect_not_denied('warehouse user record_stock_movement keeps EXECUTE (internal org checks apply)', 'authenticated', phase0b_test.uid('wh_a1'),
    format('SELECT public.record_stock_movement(''manual_in'', gen_random_uuid(), %L, 1, p_created_by := %L)', phase0b_test.org('wh_a1'), phase0b_test.uid('wh_a1')));

  -- Service role (server routes) passes guards.
  PERFORM phase0b_test.expect_ok('service_role hard_delete_organization (not found result)', 'service_role', NULL,
    'SELECT public.hard_delete_organization(gen_random_uuid())');
  PERFORM phase0b_test.expect_ok('service_role sa_assert_service_role', 'service_role', NULL,
    'SELECT public.sa_assert_service_role()');
  PERFORM phase0b_test.expect_ok('service_role search_eligible_references', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''abc'', 5)');

  -- -------------------------------------------------------------------------
  -- E. Warehouse shipment actor guard (mirrors Phase 0A route rule)
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_ok('WH user ships from own warehouse', 'authenticated', phase0b_test.uid('wh_a1'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_denied('warehouse user (level 30, WH org) approve_payment_request', 'authenticated', phase0b_test.uid('wh_a1'),
    'SELECT public.approve_payment_request(gen_random_uuid())');
  PERFORM phase0b_test.expect_denied('WH user ships from another warehouse', 'authenticated', phase0b_test.uid('wh_a1'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a2')));
  PERFORM phase0b_test.expect_ok('HQ admin ships for own company warehouse', 'authenticated', phase0b_test.uid('hq_a'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a2')));
  PERFORM phase0b_test.expect_denied('HQ admin of company B ships company A warehouse', 'authenticated', phase0b_test.uid('hq_b'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_denied('shop user ships', 'authenticated', phase0b_test.uid('shop_a'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_denied('inactive HQ admin ships', 'authenticated', phase0b_test.uid('inactive'),
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_denied('anonymous ships', 'anon', NULL,
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_ok('service role ships', 'service_role', NULL,
    format('SELECT phase0b_test.warehouse_guard(%L)', phase0b_test.org('wh_a1')));
  PERFORM phase0b_test.expect_denied('staff guard rejects spoofed actor even for SA', 'authenticated', phase0b_test.uid('sa'),
    format('SELECT phase0b_test.staff_guard(20, false, %L)', phase0b_test.uid('hq_a')));

  IF position('sa_assert_warehouse_shipment_actor(v_master.warehouse_org_id)' IN
             (SELECT prosrc FROM pg_proc WHERE oid = 'public.wms_ship_master_auto(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL: wms_ship_master_auto lost its warehouse guard';
  END IF;
  RAISE NOTICE 'PASS [wms_ship_master_auto carries warehouse guard]';

  -- -------------------------------------------------------------------------
  -- F. Public-by-design journeys remain callable anonymously
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_ok('anon get_public_branding', 'anon', NULL, 'SELECT public.get_public_branding()');
  PERFORM phase0b_test.expect_ok('anon get_email_by_phone (login)', 'anon', NULL, 'SELECT public.get_email_by_phone(''0110000001'')');
  PERFORM phase0b_test.expect_ok('anon check_serapod_user_phone', 'anon', NULL, 'SELECT public.check_serapod_user_phone(''0110000001'')');
  PERFORM phase0b_test.expect_ok('anon validate_roadtour_qr_token', 'anon', NULL, 'SELECT public.validate_roadtour_qr_token(''nope'')');
  PERFORM phase0b_test.expect_ok('anon play_scratch_card_turn', 'anon', NULL, 'SELECT public.play_scratch_card_turn(NULL, ''0110000006'', NULL, NULL)');
  PERFORM phase0b_test.expect_ok('anon policy helper is_hq_admin', 'anon', NULL, 'SELECT public.is_hq_admin()');
  PERFORM phase0b_test.expect_ok('anon policy helper can_access_org', 'anon', NULL, format('SELECT public.can_access_org(%L)', phase0b_test.org('hq_a')));

  -- -------------------------------------------------------------------------
  -- G. Catalog invariants
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%pg_temp%')
  ) THEN
    RAISE EXCEPTION 'FAIL: SECURITY DEFINER function without fixed search_path';
  END IF;
  RAISE NOTICE 'PASS [all SECURITY DEFINER functions pin search_path]';
END
$tests$;
