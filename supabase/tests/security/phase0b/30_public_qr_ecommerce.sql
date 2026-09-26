-- Phase 0B / Commit C — public QR, reference search, e-commerce and stock tests.
-- Requires 00_harness_and_fixtures.sql. Disposable databases only.

-- Minimal rows; FK/trigger enforcement is skipped for fixture setup only.
SET session_replication_role = replica;
INSERT INTO public.qr_batches (id, order_id, company_id)
  VALUES ('00000000-0000-0000-0000-0000000f0001', gen_random_uuid(), phase0b_test.org('hq_a'));
INSERT INTO public.qr_codes (id, batch_id, company_id, order_id, product_id, variant_id, code, sequence_number) VALUES
  ('00000000-0000-0000-0000-0000000f0101', '00000000-0000-0000-0000-0000000f0001', phase0b_test.org('hq_a'), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'PROD-TEST-0001-abc12345xy', 1),
  ('00000000-0000-0000-0000-0000000f0102', '00000000-0000-0000-0000-0000000f0001', phase0b_test.org('hq_b'), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'PROD-TEST-0002-def67890zz', 2);
INSERT INTO public.storefront_orders (id, order_ref, customer_name, customer_email, customer_phone, organization_id)
  VALUES ('00000000-0000-0000-0000-0000000f0201', 'SO-TEST-1', 'Customer', 'customer@phase0b.test', '+60117777777', phase0b_test.org('hq_a'));
INSERT INTO public.stock_movements (movement_type, variant_id, quantity_change, quantity_before, quantity_after, company_id, created_by, from_organization_id, to_organization_id)
  VALUES ('manual_out', gen_random_uuid(), -1, 1, 0, phase0b_test.org('hq_a'), phase0b_test.uid('wh_a1'), phase0b_test.org('wh_a1'), phase0b_test.org('dist_a'));
SET session_replication_role = origin;

-- Company A requires the security code; company B has no active journey.
INSERT INTO public.journey_configurations (org_id, name, is_active, require_security_code)
  VALUES (phase0b_test.org('hq_a'), 'Secure journey', true, true);

UPDATE public.users SET can_be_reference = true
 WHERE id IN (phase0b_test.uid('staff_a'), phase0b_test.uid('manager_a'));

DO $tests$
BEGIN
  -- -------------------------------------------------------------------------
  -- Public QR journey: narrow RPC works anonymously, raw tables do not
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('anon cannot list QR codes', 'anon', NULL, 'SELECT count(*) FROM public.qr_codes', -1);
  PERFORM phase0b_test.expect_count('anon cannot list master codes', 'anon', NULL, 'SELECT count(*) FROM public.qr_master_codes', -1);
  PERFORM phase0b_test.expect_count('anon cannot list QR batches', 'anon', NULL, 'SELECT count(*) FROM public.qr_batches', -1);
  PERFORM phase0b_test.expect_denied('anon cannot flip QR state', 'anon', NULL,
    'UPDATE public.qr_codes SET status = ''redeemed''');
  PERFORM phase0b_test.expect_count('anon RPC: security required for company A journey', 'anon', NULL,
    'SELECT public.get_qr_security_requirement(''PROD-TEST-0001-abc12345xy'')::int', 1);
  PERFORM phase0b_test.expect_count('anon RPC: no active journey means no security', 'anon', NULL,
    'SELECT public.get_qr_security_requirement(''PROD-TEST-0002-def67890zz'')::int', 0);
  PERFORM phase0b_test.expect_count('anon RPC: unknown code is indistinguishable (false)', 'anon', NULL,
    'SELECT public.get_qr_security_requirement(''does-not-exist'')::int', 0);

  -- Consumer / shop accounts (GUEST) never touch QR rows directly.
  PERFORM phase0b_test.expect_count('consumer sees no QR codes', 'authenticated', phase0b_test.uid('consumer'),
    'SELECT count(*) FROM public.qr_codes', 0);
  PERFORM phase0b_test.expect_count('shop cannot mark QR codes collected', 'authenticated', phase0b_test.uid('shop_a'),
    'WITH u AS (UPDATE public.qr_codes SET is_points_collected = true RETURNING 1) SELECT count(*) FROM u', 0);
  PERFORM phase0b_test.expect_denied('shop cannot create QR codes', 'authenticated', phase0b_test.uid('shop_a'),
    format('INSERT INTO public.qr_codes (batch_id, company_id, order_id, product_id, variant_id, code, sequence_number) VALUES (%L, %L, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), %L, 9)',
           '00000000-0000-0000-0000-0000000f0001', phase0b_test.org('hq_a'), 'FORGED'));

  -- Supply-chain staff keep working.
  PERFORM phase0b_test.expect_count('warehouse staff read QR codes', 'authenticated', phase0b_test.uid('wh_a1'),
    'SELECT count(*) FROM public.qr_codes', 2);
  PERFORM phase0b_test.expect_count('HQ staff update QR state', 'authenticated', phase0b_test.uid('staff_a'),
    'WITH u AS (UPDATE public.qr_codes SET updated_at = now() WHERE id = ''00000000-0000-0000-0000-0000000f0101'' RETURNING 1) SELECT count(*) FROM u', 1);

  -- -------------------------------------------------------------------------
  -- Reference search: minimised, no listing, no email
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('reference search: empty term lists nothing', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references('''', 10)', 0);
  PERFORM phase0b_test.expect_count('reference search: 2-char term lists nothing', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''HQ'', 10)', 0);
  PERFORM phase0b_test.expect_count('reference search: name search works', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''staff'', 10)', 1);
  PERFORM phase0b_test.expect_count('reference search: never returns email', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''Manager'', 10) WHERE email IS NOT NULL', 0);
  PERFORM phase0b_test.expect_count('reference search: exact email match only', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''fixture11@phase0b.test'', 10)', 1);
  PERFORM phase0b_test.expect_count('reference search: partial email does not match', 'service_role', NULL,
    'SELECT count(*) FROM public.search_eligible_references(''phase0b.test'', 10)', 0);
  PERFORM phase0b_test.expect_count('reference search: result cap is 10', 'service_role', NULL,
    'SELECT (count(*) <= 10)::int FROM public.search_eligible_references(''+6011'', 500)', 1);

  -- -------------------------------------------------------------------------
  -- E-commerce storefront orders: service-role only
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('anon cannot read storefront orders', 'anon', NULL, 'SELECT count(*) FROM public.storefront_orders', -1);
  PERFORM phase0b_test.expect_denied('anon cannot modify storefront orders', 'anon', NULL,
    'UPDATE public.storefront_orders SET status = ''refunded''');
  PERFORM phase0b_test.expect_count('authenticated user cannot read storefront orders directly', 'authenticated', phase0b_test.uid('hq_b'),
    'SELECT count(*) FROM public.storefront_orders', -1);
  PERFORM phase0b_test.expect_count('service role (admin routes) reads storefront orders', 'service_role', NULL,
    'SELECT count(*) FROM public.storefront_orders', 1);

  -- -------------------------------------------------------------------------
  -- Broad stock / product policies
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('source warehouse sees its movement', 'authenticated', phase0b_test.uid('wh_a1'),
    'SELECT count(*) FROM public.stock_movements', 1);
  PERFORM phase0b_test.expect_count('other warehouse cannot see the movement', 'authenticated', phase0b_test.uid('wh_a2'),
    'SELECT count(*) FROM public.stock_movements', 0);
  PERFORM phase0b_test.expect_count('HQ admin sees company movements', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT count(*) FROM public.stock_movements', 1);
  PERFORM phase0b_test.expect_count('consumer sees no stock movements', 'authenticated', phase0b_test.uid('consumer'),
    'SELECT count(*) FROM public.stock_movements', 0);
  PERFORM phase0b_test.expect_denied('consumer cannot create product variants', 'authenticated', phase0b_test.uid('consumer'),
    'INSERT INTO public.product_variants (product_id, variant_code, variant_name) VALUES (gen_random_uuid(), ''X'', ''X'')');
  PERFORM phase0b_test.expect_count('consumer cannot edit product variants', 'authenticated', phase0b_test.uid('consumer'),
    'WITH u AS (UPDATE public.product_variants SET variant_name = ''x'' RETURNING 1) SELECT count(*) FROM u', 0);
  PERFORM phase0b_test.expect_denied('anon cannot write document sequences', 'anon', NULL,
    'INSERT INTO public.doc_sequences DEFAULT VALUES');
  PERFORM phase0b_test.expect_denied('authenticated cannot write payroll journals', 'authenticated', phase0b_test.uid('hq_a'),
    'INSERT INTO public.payroll_journals DEFAULT VALUES');
END
$tests$;
