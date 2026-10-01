-- HR & Finance test-data cleanup (DESTRUCTIVE; owner-approved 2026-10-01).
--
-- HR and Finance are not live. This removes their demo/test rows only:
--   Finance: every GL journal (with its lines) and every document->GL posting
--            link. Chart of accounts, fiscal years and gl_settings stay, so
--            Finance can go live later without setup being redone.
--   HR:      the DEMO KPI set (DEMO_* metrics, KPI periods and objectives and
--            everything that cascades from them).
--
-- Never touched (shared with supply chain / sign-in / S&A):
--   departments, payment_terms, hr_employees (each portal user's employee
--   record; projects employment facts used by the S&A lifecycle),
--   hr_positions, hr_public_holidays, hr_attendance_policies,
--   hr_overtime_presets, hr_kpi_settings, gl_accounts, fiscal_years,
--   fiscal_periods, gl_settings.
--
-- Supply chain impact: none. documents' GL auto-post triggers only act when
-- gl_settings.posting_mode = 'AUTO' (refused below) and swallow errors.
-- Removing the posting link only makes the old document show "not posted".
--
-- Run FIRST: supabase/diagnostics/hr_finance_inventory_readonly.sql.
-- This script refuses (and changes nothing) if any real-use signal is
-- non-zero. Single transaction; one DO statement plus SELECTs.
begin;

do $cleanup$
declare
  v_signals jsonb;
  v_bad jsonb;
  v_counts jsonb;
begin
  v_signals := jsonb_build_object(
    'gl_auto_posting', (select count(*) from public.gl_settings where posting_mode = 'AUTO'),
    'payroll_runs', (select count(*) from public.hr_payroll_runs),
    'leave_requests', (select count(*) from public.hr_leave_requests),
    'attendance_entries', (select count(*) from public.hr_attendance_entries),
    'expense_claims', (select count(*) from public.hr_expense_claims),
    'hr_gl_postings', (select count(*) from public.hr_gl_postings),
    'bank_reconciliations', (select count(*) from public.bank_reconciliations),
    'manual_gl_journals', (select count(*) from public.gl_journals j
                           where not exists (select 1 from public.gl_document_postings p where p.journal_id = j.id)),
    'non_demo_kpi_metrics', (select count(*) from public.hr_kpi_metrics where kpi_code not like 'DEMO\_%'));
  select jsonb_object_agg(key, value) into v_bad from jsonb_each(v_signals) where value::text <> '0';
  if v_bad is not null then
    raise exception 'refusing: HR/Finance shows real use %; nothing was changed', v_bad;
  end if;

  v_counts := jsonb_build_object(
    'gl_document_postings', (select count(*) from public.gl_document_postings),
    'gl_journals', (select count(*) from public.gl_journals),
    'gl_journal_lines', (select count(*) from public.gl_journal_lines),
    'hr_kpi_objectives', (select count(*) from public.hr_kpi_objectives),
    'hr_kpi_periods', (select count(*) from public.hr_kpi_periods),
    'hr_kpi_metrics_demo', (select count(*) from public.hr_kpi_metrics where kpi_code like 'DEMO\_%'));

  -- Finance: postings first (restrict FK), then journals (lines cascade);
  -- break reversal self-references before deleting.
  delete from public.gl_document_postings;
  update public.gl_journals set reversal_journal_id = null, reversed_journal_id = null
  where reversal_journal_id is not null or reversed_journal_id is not null;
  delete from public.gl_journals;

  -- HR: the DEMO KPI set (children cascade).
  delete from public.hr_kpi_objectives;
  delete from public.hr_kpi_periods;
  delete from public.hr_kpi_metrics where kpi_code like 'DEMO\_%';

  raise notice 'HR/Finance test data removed: %', v_counts;
end $cleanup$;

-- Post-conditions (inspect before COMMIT).
select 'gl_journals' as table_name, count(*) from public.gl_journals
union all select 'gl_journal_lines', count(*) from public.gl_journal_lines
union all select 'gl_document_postings', count(*) from public.gl_document_postings
union all select 'hr_kpi_metrics', count(*) from public.hr_kpi_metrics
union all select 'hr_employees (kept)', count(*) from public.hr_employees
union all select 'departments (kept)', count(*) from public.departments
union all select 'payment_terms (kept)', count(*) from public.payment_terms
union all select 'gl_accounts (kept)', count(*) from public.gl_accounts;

commit;
