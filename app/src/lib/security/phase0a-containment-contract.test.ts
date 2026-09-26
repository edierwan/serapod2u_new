import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
const migration = repoFile('supabase/migrations/20260926200000_phase0a_identity_containment.sql')
const actions = repoFile('app/src/lib/actions.ts')
const departmentActions = repoFile('app/src/lib/actions/departments.ts')
const hrEmployees = repoFile('app/src/app/api/hr/employees/route.ts')
const confirmShipment = repoFile('app/src/app/api/warehouse/confirm-shipment/route.ts')

describe('Phase 0A containment contract', () => {
  it('makes sync_user_profile service-role-only with an internal role check and safe search path', () => {
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(migration).toContain('SET search_path = pg_catalog, public')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sync_user_profile')
    expect(migration).toContain('FROM anon')
    expect(migration).toContain('FROM authenticated')
    expect(migration).toContain('TO service_role')
  })

  it('protects authorization and employment fields against direct own-row updates', () => {
    expect(migration).toContain('users_prevent_self_service_access_field_update')
    for (const field of ['role_code', 'organization_id', 'account_scope', 'is_active', 'department_id', 'employment_status']) {
      expect(migration).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`)
    }
  })

  it('routes every application provisioning caller through an admin client', () => {
    expect(actions.match(/adminClient\s*\n?\s*\.rpc\('sync_user_profile'/g)?.length).toBe(2)
    expect(departmentActions).toMatch(/adminClient\s*\n?\s*\.rpc\('sync_user_profile'/)
    expect(hrEmployees).toMatch(/adminClient\.rpc\('sync_user_profile'/)
  })

  it('does not use request-supplied callerInfo as server-action identity', () => {
    expect(actions).toContain('supabase.auth.getUser()')
    expect(actions).not.toContain('checkPermissionForUser(callerInfo.id')
    expect(actions).not.toContain('callerInfo.id === userId')
    expect(actions).not.toContain('callerInfo?.id')
  })

  it('authenticates shipment confirmation and attributes writes to the session actor', () => {
    expect(confirmShipment).toContain('supabase.auth.getUser()')
    expect(confirmShipment).toContain('authorizeWarehouseShipment')
    expect(confirmShipment).not.toMatch(/const \{ session_id, user_id \}/)
    expect(confirmShipment).toContain('approved_by: actorUserId')
    expect(confirmShipment).toContain('shipped_by: actorUserId')
    expect(confirmShipment).toContain('updated_by: actorUserId')
  })
})
