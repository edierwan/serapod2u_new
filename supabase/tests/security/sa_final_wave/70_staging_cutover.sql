-- S&A Final Wave — the staging cutover script on the fixture world.
-- Runs the real supabase/staging cutover (it COMMITS on this disposable DB),
-- then verifies modes, the lock and that enforcement is effective.
\ir ../../../staging/20260928140000_sa_final_wave_staging_cutover.sql

BEGIN;
SELECT saf.expect_eq('cutover: every registered operation enforced',
  (SELECT count(*) FROM public.sa_enforcement_readiness r
    WHERE public.sa_permission_mode(r.permission_key) NOT IN ('NEW_ENFORCED','LEGACY_RETIRED'))::int, 0);
SELECT saf.expect_eq('cutover: no unregistered operation enforced',
  (SELECT count(*) FROM public.sa_migration_modes m WHERE m.mode IN ('NEW_ENFORCED','LEGACY_RETIRED')
    AND NOT EXISTS (SELECT 1 FROM public.sa_enforcement_readiness r WHERE r.permission_key = m.permission_key))::int, 0);
SELECT saf.expect_eq('cutover: security administration is LEGACY_RETIRED', public.sa_permission_mode('security.role.assign'), 'LEGACY_RETIRED');
SELECT saf.expect_eq('cutover: stock count create stays in its pilot mode', public.sa_permission_mode('inventory.stock_count.create'), 'SHADOW');
SELECT saf.expect_eq('cutover: legacy stores locked', public.sa_legacy_authorization_read_only(), true);
SELECT saf.expect_eq('cutover: audited as system', (SELECT count(*) > 60 FROM public.sa_access_change_log WHERE action = 'migration_mode.changed' AND actor_kind = 'system'), true);
SELECT saf.expect_eq('after cutover: HQ admin still posts journals via compatibility grant',
  saf.decide(saf.uid('hq_a'), 'finance.journal.post', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('after cutover: employee sees no payroll headers',
  saf.value_as('authenticated', saf.uid('emp_a'), $$SELECT count(*)::text FROM public.hr_payroll_runs$$), '0');
SELECT saf.expect_err('after cutover: API roles cannot change migration modes', 'authenticated', saf.uid('emp_a'),
  $$SELECT public.sa_set_migration_mode(null, 'hr.payroll.view', 'SHADOW', 'API role cannot call this')$$, 'permission denied');
ROLLBACK;
