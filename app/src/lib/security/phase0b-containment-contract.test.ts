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
