-- HR & Finance data inventory (READ-ONLY). Run on staging and production
-- before supabase/operations/hr_finance_test_data_cleanup.sql.
--
-- Shows every HR/payroll/finance table with its row count, plus the signals
-- the cleanup treats as "real use" (it refuses to run when any is non-zero).
-- Runs inside a read-only transaction; nothing is changed.
begin transaction read only;

select c.relname as table_name,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as row_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname ~ '^(hr_|payroll|gl_|fiscal_|bank_reconciliation|bank_accounts|tax_codes|accounting_)'
order by row_count desc, table_name;

-- Real-use signals (all must be 0 for the cleanup to run).
select 'gl_settings in AUTO posting mode' as signal, count(*) as n from public.gl_settings where posting_mode = 'AUTO'
union all select 'payroll runs', count(*) from public.hr_payroll_runs
union all select 'leave requests', count(*) from public.hr_leave_requests
union all select 'attendance entries', count(*) from public.hr_attendance_entries
union all select 'expense claims', count(*) from public.hr_expense_claims
union all select 'HR GL postings', count(*) from public.hr_gl_postings
union all select 'bank reconciliations', count(*) from public.bank_reconciliations
union all select 'GL journals entered manually (not from a document posting)', count(*) from public.gl_journals j where not exists (select 1 from public.gl_document_postings p where p.journal_id = j.id)
union all select 'KPI metrics not marked DEMO_', count(*) from public.hr_kpi_metrics where kpi_code not like 'DEMO\_%';

-- What the cleanup would remove.
select 'gl_journals' as target, count(*) from public.gl_journals
union all select 'gl_journal_lines', count(*) from public.gl_journal_lines
union all select 'gl_document_postings', count(*) from public.gl_document_postings
union all select 'hr_kpi_metrics (DEMO_)', count(*) from public.hr_kpi_metrics where kpi_code like 'DEMO\_%'
union all select 'hr_kpi_periods', count(*) from public.hr_kpi_periods
union all select 'hr_kpi_objectives', count(*) from public.hr_kpi_objectives;

rollback;
