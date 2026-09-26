import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

describe('Phase 0B commit A: privileged RPC containment contract', () => {
  const migration = repoFile('supabase/migrations/20260927100000_phase0b_privileged_rpc_containment.sql')

  it('revokes API execution tier by tier and grants only the required roles', () => {
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn)")
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role")
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role")
    for (const sig of [
      "('delete_all_transactions_with_inventory_v3()', 'SERVER')",
      "('hard_delete_organization(uuid)', 'SERVER')",
      "('adjust_inventory_quantity(uuid,uuid,integer)', 'SERVER')",
      "('wms_ship_unique_auto(uuid[],uuid,uuid,uuid,timestamp with time zone)', 'SERVER')",
      "('search_eligible_references(text,integer)', 'SERVER')",
      "('consumer_collect_points(text,text,numeric,text,boolean)', 'SERVER')",
      "('approve_payment_request(uuid)', 'USER')",
      "('get_email_by_phone(text)', 'PUBLIC')",
      "('play_scratch_card_turn(uuid,text,uuid,uuid)', 'PUBLIC')",
    ]) {
      expect(migration).toContain(sig)
    }
  })

  it('adds internal actor guards that never trust caller-supplied actor ids', () => {
    expect(migration).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN")
    expect(migration).toContain('p_claimed_actor IS DISTINCT FROM v_uid')
    expect(migration).toContain('PERFORM public.sa_assert_service_role();')
    expect(migration).toContain('PERFORM public.sa_assert_staff_actor(20, true);')
    expect(migration).toContain('PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);')
    expect(migration).toContain('PERFORM public.sa_assert_warehouse_shipment_actor(v_master.warehouse_org_id);')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sa_assert_staff_actor(integer, boolean, uuid) FROM PUBLIC, anon, authenticated;')
  })

  it('pins search_path on every SECURITY DEFINER function and asserts the result', () => {
    expect(migration).toContain("ALTER FUNCTION %s SET search_path = public, extensions, pg_temp")
    expect(migration).toContain('SECURITY DEFINER functions without fixed search_path')
    expect(migration).toContain('anon can still execute SECURITY DEFINER functions')
  })

  it('runs the destructive transaction wipe only through the admin client after the guard', () => {
    const route = repoFile('app/src/app/api/admin/delete-transactions-v2/route.ts')
    expect(route).toContain("assertDestructiveOpsAllowed(request, 'delete-transactions-v2')")
    expect(route).toMatch(/createAdminClient\(\)\s*\n\s*\.rpc\('delete_all_transactions_with_inventory_v3'\)/)
  })
})

describe('Phase 0B commit B: sensitive tables, views and HR tenant boundaries', () => {
  const migration = repoFile('supabase/migrations/20260927110000_phase0b_sensitive_tables_hr_rls.sql')

  it('enables RLS and resets API grants on formerly unprotected sensitive tables', () => {
    for (const table of [
      'hr_payroll_run_items', 'hr_payroll_runs', 'hr_applicants', 'hr_contracts', 'hr_payslip_access_logs',
      'otp_challenges', 'points_transactions', 'notifications_outbox', 'qr_validation_reports', 'qr_movements',
      'shop_requests', 'journey_configurations', 'consumer_activations',
    ]) {
      expect(migration, table).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
      expect(migration, table).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated;`)
    }
  })

  it('binds HR tenant checks to the target row instead of comparing the actor to itself', () => {
    expect(migration).toContain('ALTER POLICY hr_employee_compensation_select ON public.hr_employee_compensation')
    expect(migration).toContain('u.organization_id = hr_employee_compensation.organization_id')
    const alterStatements = migration.match(/^ALTER POLICY [\s\S]*?;$/gm) || []
    expect(alterStatements.length).toBe(51)
    for (const statement of alterStatements) {
      expect(statement).not.toContain('u.organization_id = u.organization_id')
    }
    expect(migration).toContain('tautological tenant policies remain')
  })

  it('limits salary lines to the employee and HR managers', () => {
    expect(migration).toMatch(/CREATE POLICY sa_hr_self_or_manager_read ON public\.hr_payroll_run_items FOR SELECT TO authenticated\s+USING \(organization_id = public\.sa_actor_org_id\(\) AND \(employee_user_id = auth\.uid\(\) OR public\.sa_actor_is_hr_manager\(\)\)\)/)
    expect(migration).toMatch(/CREATE POLICY sa_hr_manager_insert ON public\.hr_payroll_run_items/)
  })

  it('never lets non-staff accounts credit points', () => {
    expect(migration).toContain("transaction_type = 'redeem' AND points_amount < 0")
    expect(migration).toContain('sa_redeem_items_restrict_non_staff_update')
  })

  it('removes anonymous view access and fails if any remains', () => {
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', v.rel);")
    expect(migration).toContain('anon can still read views')
    expect(migration).toContain('API-accessible tables without RLS remain')
  })
})

describe('Phase 0B follow-up: points_transactions company scope', () => {
  const migration = repoFile('supabase/migrations/20260927130000_phase0b_points_company_scope_fix.sql')

  it('resolves the row company (shop org ids, legacy NULL) instead of comparing raw ids', () => {
    expect(migration).toContain('public.get_company_id(company_id) = public.sa_actor_company_id()')
    expect(migration).toContain('company_id IS NULL OR public.get_company_id(company_id)')
    expect(migration).toMatch(/sa_member_redemption_debit_insert[\s\S]*transaction_type = 'redeem'\s+AND points_amount < 0/)
  })
})
