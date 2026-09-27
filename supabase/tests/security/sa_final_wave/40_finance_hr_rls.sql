-- S&A Final Wave — Finance and HR database enforcement (RLS gates, RPC guards,
-- payroll transition guard). Legacy behaviour in SHADOW; S&A in NEW_ENFORCED.
BEGIN;

INSERT INTO public.hr_payroll_runs(id, organization_id, period_start, period_end, status, calculated_by)
VALUES ('00000000-0000-0000-0000-0000000f0001', saf.org('hq_a'), date '2026-08-01', date '2026-08-31', 'calculated', saf.uid('hr_a')),
       ('00000000-0000-0000-0000-0000000f0002', saf.org('hq_b'), date '2026-08-01', date '2026-08-31', 'calculated', saf.uid('hq_b'));
INSERT INTO public.hr_employee_compensation(organization_id, employee_id, status)
VALUES (saf.org('hq_a'), saf.uid('emp_a'), 'active'), (saf.org('hq_a'), saf.uid('emp_a2'), 'active');
INSERT INTO public.gl_journals(id, company_id, journal_number, description, journal_type, status)
VALUES ('00000000-0000-0000-0000-0000000f0101', saf.org('hq_a'), 'JV-SAF-1', 'SAF journal', 'ADJUSTMENT', 'DRAFT');

-- ── SHADOW: exactly the legacy behaviour ────────────────────────────────────
SELECT saf.expect_eq('SHADOW: employee still reads payroll run headers (legacy org read)',
  saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.hr_payroll_runs$$), '1');
SELECT saf.expect_eq('SHADOW: HR manager reads all compensation rows of own org',
  saf.value_as('authenticated', saf.uid('pu_a'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '2');
SELECT saf.expect_eq('SHADOW: employee reads own compensation only',
  saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '1');

-- ── NEW_ENFORCED ───────────────────────────────────────────────────────────
SELECT saf.set_mode(k, 'NEW_ENFORCED') FROM unnest(array['hr.payroll.view','hr.payroll.prepare','hr.payroll.approve',
  'hr.compensation.view','hr.compensation.manage','finance.ledger.view','finance.journal.post','finance.payment.approve']) k;

SELECT saf.expect_eq('NEW: payroll headers restricted to payroll viewers (employee)',
  saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.hr_payroll_runs$$), '0');
SELECT saf.expect_eq('NEW: payroll viewer reads own org only (I: no cross-org payroll)',
  saf.value_as('authenticated', saf.uid('hr_a'), $$SELECT count(*)::text FROM public.hr_payroll_runs$$), '1');
SELECT saf.expect_eq('NEW: employee keeps own-record compensation',
  saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '1');
SELECT saf.expect_eq('NEW: compensation viewer sees org rows',
  saf.value_as('authenticated', saf.uid('pu_a'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '2');
SELECT saf.expect_eq('NEW: other tenant sees nothing',
  saf.value_as('authenticated', saf.uid('hq_b'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '0');

-- Revoking the S&A grant removes database access even though role_level is unchanged.
UPDATE public.sa_role_assignments SET status = 'suspended'
WHERE user_id = saf.uid('pu_a') AND role_id = (SELECT id FROM public.sa_business_roles WHERE role_key = 'legacy-power-user');
SELECT saf.expect_eq('NEW: role_level alone no longer grants compensation',
  saf.value_as('authenticated', saf.uid('pu_a'), $$SELECT count(*)::text FROM public.hr_employee_compensation$$), '0');
UPDATE public.sa_role_assignments SET status = 'active' WHERE user_id = saf.uid('pu_a') AND status = 'suspended';

-- Payroll approval: direct PostgREST transition requires hr.payroll.approve;
-- the calculated_by preparer approving is a monitored SoD violation.
-- RLS hides the row from the employee: the update matches nothing.
SELECT saf.expect_ok('NEW: employee direct approval attempt matches no row', 'authenticated', saf.uid('emp_a'),
  $$UPDATE public.hr_payroll_runs SET status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000f0001'$$);
SELECT saf.expect_eq('NEW: payroll untouched after denied attempt',
  (SELECT status FROM public.hr_payroll_runs WHERE id = '00000000-0000-0000-0000-0000000f0001'), 'calculated');
-- An HR manager whose S&A approval grant is removed is blocked by the guard.
DELETE FROM public.sa_business_role_permissions
WHERE role_id = saf.role('legacy-hr-manager') AND permission_id = (SELECT id FROM public.sa_permissions WHERE permission_key = 'hr.payroll.approve');
SELECT saf.expect_err('NEW: legacy HR manager without S&A approval cannot approve via table', 'authenticated', saf.uid('hr_a'),
  $$UPDATE public.hr_payroll_runs SET status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000f0001'$$, 'sa_authorization_required');
SELECT saf.expect_ok('NEW: S&A payroll approver may approve', 'authenticated', saf.uid('pu_a'),
  $$UPDATE public.hr_payroll_runs SET status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000f0001'$$);
SELECT saf.expect_eq('payroll approved', (SELECT status FROM public.hr_payroll_runs WHERE id = '00000000-0000-0000-0000-0000000f0001'), 'approved');

-- GL: journal visibility and posting follow Finance permissions.
SELECT saf.expect_eq('NEW: finance viewer reads journals', saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.gl_journals$$), '1');
SELECT saf.expect_eq('NEW: other tenant cannot read journals', saf.value_as('authenticated', saf.uid('hq_b'), $$SELECT count(*)::text FROM public.gl_journals$$), '0');
SELECT saf.expect_err('NEW: power user cannot post to GL (no finance.journal.post)', 'authenticated', saf.uid('pu_a'),
  $$SELECT public.post_document_to_gl('SALES_INVOICE', '00000000-0000-0000-0000-00000000dead'::uuid, current_date)$$, 'sa_authorization_required');
SELECT saf.expect_eq('NEW: HQ admin passes the S&A guard (business validation continues)',
  saf.value_as('authenticated', saf.uid('hq_a'), $$SELECT (public.post_document_to_gl('SALES_INVOICE', '00000000-0000-0000-0000-00000000dead'::uuid, current_date))->>'success'$$) NOT LIKE 'ERR:42501%', true);

-- Payment approval: S&A guard + cross-org denial (resource org = document company).
SELECT saf.expect_err('NEW: payment approval denied for another tenant', 'authenticated', saf.uid('hq_b'),
  $$SELECT public.approve_payment_request('00000000-0000-0000-0000-00000000beef'::uuid)$$, 'sa_authorization_required');

-- LEGACY mode keeps legacy RPC behaviour (role guard still applies).
SELECT saf.set_mode('finance.journal.post', 'SHADOW');
SELECT saf.expect_eq('SHADOW: legacy is_hq_admin check still decides post_document_to_gl',
  saf.value_as('authenticated', saf.uid('pu_a'), $$SELECT (public.post_document_to_gl('SALES_INVOICE', '00000000-0000-0000-0000-00000000dead'::uuid, current_date))->>'error'$$),
  'Only HQ Admins can post to GL');

ROLLBACK;
