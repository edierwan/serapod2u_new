-- Phase 0B / Commit B — sensitive tables, views and HR tenant boundary tests.
-- Requires 00_harness_and_fixtures.sql. Disposable databases only.

-- Fixture rows (inserted as the migration owner, i.e. like server code).
INSERT INTO public.hr_payroll_runs (id, organization_id, period_start, period_end) VALUES
  ('00000000-0000-0000-0000-0000000c0001', phase0b_test.org('hq_a'), '2026-08-01', '2026-08-31'),
  ('00000000-0000-0000-0000-0000000c0002', phase0b_test.org('hq_b'), '2026-08-01', '2026-08-31');
INSERT INTO public.hr_payroll_run_items (organization_id, payroll_run_id, employee_user_id) VALUES
  (phase0b_test.org('hq_a'), '00000000-0000-0000-0000-0000000c0001', phase0b_test.uid('staff_a')),
  (phase0b_test.org('hq_a'), '00000000-0000-0000-0000-0000000c0001', phase0b_test.uid('manager_a')),
  (phase0b_test.org('hq_b'), '00000000-0000-0000-0000-0000000c0002', phase0b_test.uid('staff_b'));
INSERT INTO public.hr_contracts (organization_id, employee_user_id, contract_type, contract_url) VALUES
  (phase0b_test.org('hq_a'), phase0b_test.uid('staff_a'), 'permanent', 'x'),
  (phase0b_test.org('hq_a'), phase0b_test.uid('manager_a'), 'permanent', 'y');
INSERT INTO public.hr_applicants (organization_id, full_name, email) VALUES
  (phase0b_test.org('hq_a'), 'Applicant A', 'applicant-a@phase0b.test'),
  (phase0b_test.org('hq_b'), 'Applicant B', 'applicant-b@phase0b.test');
INSERT INTO public.hr_employee_compensation (employee_id, organization_id) VALUES
  (phase0b_test.uid('staff_a'), phase0b_test.org('hq_a')),
  (phase0b_test.uid('staff_b'), phase0b_test.org('hq_b'));
INSERT INTO public.departments (id, dept_name, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000d0001', 'Dept A', phase0b_test.org('hq_a'));
INSERT INTO public.otp_challenges (org_id, subject_type, channel, code_hash, salt, expires_at)
  VALUES (phase0b_test.org('hq_a'), 'staff', 'sms', 'h', 's', now() + interval '5 minutes');
INSERT INTO public.redeem_items (id, item_name, item_code, company_id, points_required, stock_quantity) VALUES
  ('00000000-0000-0000-0000-0000000e0001', 'Reward A', 'RWD-A', phase0b_test.org('hq_a'), 100, 10);
INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES
  (phase0b_test.org('hq_a'), phase0b_test.uid('consumer'), '+60110000006', 'earn', 50, 50),
  (phase0b_test.org('hq_a'), NULL, '+60119999999', 'earn', 70, 70),
  (phase0b_test.org('hq_b'), NULL, '+60118888888', 'earn', 90, 90);
INSERT INTO public.qr_validation_reports (company_id, warehouse_org_id, distributor_org_id, created_by, expected_quantities, scanned_quantities)
  VALUES (phase0b_test.org('hq_a'), phase0b_test.org('wh_a1'), phase0b_test.org('dist_a'), phase0b_test.uid('wh_a1'), '{}', '{}');
INSERT INTO public.journey_configurations (org_id, name, is_active)
  VALUES (phase0b_test.org('hq_a'), 'Active journey', true), (phase0b_test.org('hq_a'), 'Draft journey', false);

DO $tests$
DECLARE
  t record;
BEGIN
  -- -------------------------------------------------------------------------
  -- ANONYMOUS: no access to formerly unprotected sensitive tables and views
  -- -------------------------------------------------------------------------
  FOR t IN SELECT * FROM (VALUES
    ('hr_payroll_run_items'), ('hr_payroll_runs'), ('hr_contracts'), ('hr_applicants'), ('hr_payslip_access_logs'),
    ('hr_expense_claims'), ('hr_timesheet_entries'), ('otp_challenges'), ('points_transactions'),
    ('notifications_outbox'), ('qr_validation_reports'), ('qr_movements'), ('shop_requests'),
    ('consumer_activations'), ('lucky_draw_entries'), ('redeem_items'), ('hr_gl_mappings'),
    ('v_admin_redemptions'), ('hr_employee_dashboard'), ('v_consumer_points_balance'),
    ('shop_points_ledger'), ('phone_normalization_collision_report'), ('v_support_admin_inbox')
  ) AS v(tbl) LOOP
    PERFORM phase0b_test.expect_count('anon cannot read ' || t.tbl, 'anon', NULL,
      format('SELECT count(*) FROM public.%I', t.tbl), -1);
  END LOOP;
  PERFORM phase0b_test.expect_denied('anon cannot write points_transactions', 'anon', NULL,
    format('INSERT INTO public.points_transactions (company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, 1000, 1000)',
           phase0b_test.org('hq_a'), '+60110000000', 'earn'));
  PERFORM phase0b_test.expect_denied('anon cannot queue outbound messages', 'anon', NULL,
    format('INSERT INTO public.notifications_outbox (org_id, channel) VALUES (%L, %L)', phase0b_test.org('hq_a'), 'whatsapp'));

  -- Public journey reads that must keep working.
  PERFORM phase0b_test.expect_count('anon reads bank list (public journey)', 'anon', NULL, 'SELECT count(*) FROM public.msia_banks', 0);
  PERFORM phase0b_test.expect_count('anon reads only ACTIVE journey configs (middleware)', 'anon', NULL,
    'SELECT count(*) FROM public.journey_configurations', 1);

  -- -------------------------------------------------------------------------
  -- EMPLOYEE SELF (staff_a, level 40, org A)
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('employee sees only own payroll lines', 'authenticated', phase0b_test.uid('staff_a'),
    'SELECT count(*) FROM public.hr_payroll_run_items', 1);
  PERFORM phase0b_test.expect_count('employee payslip join keeps run header visible', 'authenticated', phase0b_test.uid('staff_a'),
    'SELECT count(*) FROM public.hr_payroll_run_items i JOIN public.hr_payroll_runs r ON r.id = i.payroll_run_id', 1);
  PERFORM phase0b_test.expect_count('employee sees own contract only', 'authenticated', phase0b_test.uid('staff_a'),
    'SELECT count(*) FROM public.hr_contracts', 1);
  PERFORM phase0b_test.expect_count('employee cannot list applicants', 'authenticated', phase0b_test.uid('staff_a'),
    'SELECT count(*) FROM public.hr_applicants', 0);
  PERFORM phase0b_test.expect_denied('employee cannot create payroll lines', 'authenticated', phase0b_test.uid('staff_a'),
    format('INSERT INTO public.hr_payroll_run_items (organization_id, payroll_run_id, employee_user_id) VALUES (%L, %L, %L)',
           phase0b_test.org('hq_a'), '00000000-0000-0000-0000-0000000c0001', phase0b_test.uid('staff_a')));
  PERFORM phase0b_test.expect_ok('employee submits own expense claim', 'authenticated', phase0b_test.uid('staff_a'),
    format('INSERT INTO public.hr_expense_claims (organization_id, employee_user_id) VALUES (%L, %L)',
           phase0b_test.org('hq_a'), phase0b_test.uid('staff_a')));
  PERFORM phase0b_test.expect_denied('employee cannot submit a claim for someone else', 'authenticated', phase0b_test.uid('staff_a'),
    format('INSERT INTO public.hr_expense_claims (organization_id, employee_user_id) VALUES (%L, %L)',
           phase0b_test.org('hq_a'), phase0b_test.uid('manager_a')));
  PERFORM phase0b_test.expect_count('employee cannot approve own claim (update filtered)', 'authenticated', phase0b_test.uid('staff_a'),
    'WITH u AS (UPDATE public.hr_expense_claims SET organization_id = organization_id RETURNING 1) SELECT count(*) FROM u', 0);

  -- -------------------------------------------------------------------------
  -- MANAGER (manager_a, level 30, not an HR manager): own records only
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('non-HR manager sees only own payroll line', 'authenticated', phase0b_test.uid('manager_a'),
    'SELECT count(*) FROM public.hr_payroll_run_items', 1);
  PERFORM phase0b_test.expect_count('non-HR manager sees only own compensation', 'authenticated', phase0b_test.uid('manager_a'),
    'SELECT count(*) FROM public.hr_employee_compensation', 0);

  -- -------------------------------------------------------------------------
  -- HR (hq_a, level 10, org A): whole organization A, nothing from org B
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('HR admin sees all org A payroll lines only', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT count(*) FROM public.hr_payroll_run_items', 2);
  PERFORM phase0b_test.expect_count('HR admin sees org A applicants only', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT count(*) FROM public.hr_applicants', 1);
  PERFORM phase0b_test.expect_count('HR admin sees org A compensation only', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT count(*) FROM public.hr_employee_compensation', 1);
  PERFORM phase0b_test.expect_ok('HR admin creates compensation in own org', 'authenticated', phase0b_test.uid('hq_a'),
    format('INSERT INTO public.hr_employee_compensation (employee_id, organization_id) VALUES (%L, %L)',
           phase0b_test.uid('manager_a'), phase0b_test.org('hq_a')));
  PERFORM phase0b_test.expect_ok('HR admin creates payroll line in own org', 'authenticated', phase0b_test.uid('pu_a'),
    format('INSERT INTO public.hr_payroll_run_items (organization_id, payroll_run_id, employee_user_id) VALUES (%L, %L, %L)',
           phase0b_test.org('hq_a'), '00000000-0000-0000-0000-0000000c0001', phase0b_test.uid('pu_a')));
  PERFORM phase0b_test.expect_denied('inactive HR admin is denied', 'authenticated', phase0b_test.uid('inactive'),
    format('INSERT INTO public.hr_payroll_run_items (organization_id, payroll_run_id, employee_user_id) VALUES (%L, %L, %L)',
           phase0b_test.org('hq_a'), '00000000-0000-0000-0000-0000000c0001', phase0b_test.uid('staff_a')));

  -- -------------------------------------------------------------------------
  -- CROSS ORGANIZATION (hq_b admin of company B against organization A)
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('cross-org HR admin sees no org A payroll', 'authenticated', phase0b_test.uid('hq_b'),
    format('SELECT count(*) FROM public.hr_payroll_run_items WHERE organization_id = %L', phase0b_test.org('hq_a')), 0);
  PERFORM phase0b_test.expect_count('cross-org HR admin sees no org A compensation (tautology fixed)', 'authenticated', phase0b_test.uid('hq_b'),
    format('SELECT count(*) FROM public.hr_employee_compensation WHERE organization_id = %L', phase0b_test.org('hq_a')), 0);
  PERFORM phase0b_test.expect_denied('cross-org HR admin cannot insert org A compensation (tautology fixed)', 'authenticated', phase0b_test.uid('hq_b'),
    format('INSERT INTO public.hr_employee_compensation (employee_id, organization_id) VALUES (%L, %L)',
           phase0b_test.uid('staff_a'), phase0b_test.org('hq_a')));
  PERFORM phase0b_test.expect_count('cross-org admin cannot update org A department (tautology fixed)', 'authenticated', phase0b_test.uid('hq_b'),
    'WITH u AS (UPDATE public.departments SET dept_name = ''hijacked'' WHERE id = ''00000000-0000-0000-0000-0000000d0001'' RETURNING 1) SELECT count(*) FROM u', 0);
  PERFORM phase0b_test.expect_count('same-org admin can update own department', 'authenticated', phase0b_test.uid('hq_a'),
    'WITH u AS (UPDATE public.departments SET dept_name = ''Dept A'' WHERE id = ''00000000-0000-0000-0000-0000000d0001'' RETURNING 1) SELECT count(*) FROM u', 1);
  PERFORM phase0b_test.expect_count('cross-org HR admin sees no org A applicants', 'authenticated', phase0b_test.uid('hq_b'),
    format('SELECT count(*) FROM public.hr_applicants WHERE organization_id = %L', phase0b_test.org('hq_a')), 0);

  -- Payroll GL mappings were USING (true) for any authenticated account.
  PERFORM phase0b_test.expect_count('shop account cannot read payroll GL mappings', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT count(*) FROM public.hr_gl_mappings', 0);
  PERFORM phase0b_test.expect_denied('shop account cannot write payroll GL mappings', 'authenticated', phase0b_test.uid('shop_a'),
    format('INSERT INTO public.hr_gl_mappings (organization_id, document_type) VALUES (%L, %L)', phase0b_test.org('hq_a'), 'PAYROLL'));

  -- -------------------------------------------------------------------------
  -- POINTS / LOYALTY
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('consumer sees only own points', 'authenticated', phase0b_test.uid('consumer'),
    'SELECT count(*) FROM public.points_transactions', 1);
  PERFORM phase0b_test.expect_count('company staff see company points only', 'authenticated', phase0b_test.uid('staff_a'),
    'SELECT count(*) FROM public.points_transactions', 2);
  PERFORM phase0b_test.expect_count('other company staff see none of company A', 'authenticated', phase0b_test.uid('staff_b'),
    format('SELECT count(*) FROM public.points_transactions WHERE company_id = %L', phase0b_test.org('hq_a')), 0);
  PERFORM phase0b_test.expect_ok('shop records a redemption debit (ShopCatalogPage)', 'authenticated', phase0b_test.uid('shop_a'),
    format('INSERT INTO public.points_transactions (company_id, consumer_phone, transaction_type, points_amount, balance_after, redeem_item_id) VALUES (%L, %L, %L, -100, 0, %L)',
           phase0b_test.org('hq_a'), '+60110000005', 'redeem', '00000000-0000-0000-0000-0000000e0001'));
  PERFORM phase0b_test.expect_denied('shop cannot mint points', 'authenticated', phase0b_test.uid('shop_a'),
    format('INSERT INTO public.points_transactions (company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, 1000, 1000)',
           phase0b_test.org('hq_a'), '+60110000005', 'earn'));
  PERFORM phase0b_test.expect_denied('shop cannot debit another company', 'authenticated', phase0b_test.uid('shop_a'),
    format('INSERT INTO public.points_transactions (company_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, -1, 0)',
           phase0b_test.org('hq_b'), '+60110000005', 'redeem'));
  PERFORM phase0b_test.expect_ok('shop takes one unit of reward stock', 'authenticated', phase0b_test.uid('shop_a'),
    'UPDATE public.redeem_items SET stock_quantity = stock_quantity - 1 WHERE id = ''00000000-0000-0000-0000-0000000e0001''');
  PERFORM phase0b_test.expect_denied('shop cannot reprice rewards', 'authenticated', phase0b_test.uid('shop_a'),
    'UPDATE public.redeem_items SET points_required = 1 WHERE id = ''00000000-0000-0000-0000-0000000e0001''');
  PERFORM phase0b_test.expect_ok('staff reprices rewards', 'authenticated', phase0b_test.uid('hq_a'),
    'UPDATE public.redeem_items SET points_required = 120 WHERE id = ''00000000-0000-0000-0000-0000000e0001''');
  PERFORM phase0b_test.expect_count('shop reads the reward catalog', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT count(*) FROM public.redeem_items', 1);
  PERFORM phase0b_test.expect_count('authenticated shop still reads its points ledger view', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT (count(*) >= 0)::int FROM public.shop_points_ledger', 1);

  -- -------------------------------------------------------------------------
  -- WAREHOUSE SESSIONS / QR MOVEMENTS
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('warehouse user sees own warehouse session', 'authenticated', phase0b_test.uid('wh_a1'),
    'SELECT count(*) FROM public.qr_validation_reports', 1);
  PERFORM phase0b_test.expect_count('other warehouse cannot see the session', 'authenticated', phase0b_test.uid('wh_a2'),
    'SELECT count(*) FROM public.qr_validation_reports', 0);
  PERFORM phase0b_test.expect_count('shop account cannot see warehouse sessions', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT count(*) FROM public.qr_validation_reports', 0);
  PERFORM phase0b_test.expect_count('HQ admin sees company warehouse sessions', 'authenticated', phase0b_test.uid('hq_a'),
    'SELECT count(*) FROM public.qr_validation_reports', 1);
  PERFORM phase0b_test.expect_denied('other warehouse cannot start a session for WH A1', 'authenticated', phase0b_test.uid('wh_a2'),
    format('INSERT INTO public.qr_validation_reports (company_id, warehouse_org_id, distributor_org_id, created_by, expected_quantities, scanned_quantities) VALUES (%L, %L, %L, %L, ''{}'', ''{}'')',
           phase0b_test.org('hq_a'), phase0b_test.org('wh_a1'), phase0b_test.org('dist_a'), phase0b_test.uid('wh_a2')));

  -- -------------------------------------------------------------------------
  -- SERVER-ONLY tables and views stay available to service_role
  -- -------------------------------------------------------------------------
  PERFORM phase0b_test.expect_count('guest cannot read OTP challenges', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT count(*) FROM public.otp_challenges', -1);
  PERFORM phase0b_test.expect_count('guest cannot read admin redemption view', 'authenticated', phase0b_test.uid('shop_a'),
    'SELECT count(*) FROM public.v_admin_redemptions', -1);
  PERFORM phase0b_test.expect_count('service_role reads OTP challenges', 'service_role', NULL,
    'SELECT count(*) FROM public.otp_challenges', 1);
  PERFORM phase0b_test.expect_count('service_role reads admin redemption view', 'service_role', NULL,
    'SELECT (count(*) >= 0)::int FROM public.v_admin_redemptions', 1);
END
$tests$;
