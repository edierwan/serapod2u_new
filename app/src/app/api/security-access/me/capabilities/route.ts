import { NextRequest, NextResponse } from 'next/server'
import { requireSelfServiceActor } from '@/lib/security-access/admin-api'
import { currentMigrationMode } from '@/lib/security-access/authorization'
import { isNewAuthoritative } from '@/lib/security-access/enforcement'

export const dynamic = 'force-dynamic'

const PERMISSION_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PERMISSIONS = 20

/**
 * GET /api/security-access/me/capabilities?permissions=a.b.c,d.e.f[&organizationId=]
 *
 * Read-only view of the caller's own Security & Access answers, so the UI can
 * show what the server will allow. For each permission:
 *   allowed    the S&A decision (sa_evaluate_permission) in the organization
 *              (default: the caller's own)
 *   enforced   whether S&A is authoritative for it (NEW_ENFORCED /
 *              LEGACY_RETIRED); until then the UI keeps its legacy rule
 * No decision audit rows are written (nothing is being authorized here) and
 * the server still decides every operation independently.
 */
export async function GET(request: NextRequest) {
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor

  const requested = (request.nextUrl.searchParams.get('permissions') || '')
    .split(',').map(p => p.trim()).filter(Boolean)
  const permissions = Array.from(new Set(requested)).slice(0, MAX_PERMISSIONS)
  if (permissions.length === 0 || permissions.some(p => !PERMISSION_KEY.test(p))) {
    return NextResponse.json({ error: 'permissions must be a comma-separated list of permission keys' }, { status: 400 })
  }
  const orgParam = request.nextUrl.searchParams.get('organizationId')
  if (orgParam && !UUID.test(orgParam)) {
    return NextResponse.json({ error: 'organizationId must be a UUID' }, { status: 400 })
  }
  const organizationId = orgParam || actor.organizationId

  const capabilities: Record<string, { allowed: boolean; enforced: boolean }> = {}
  await Promise.all(permissions.map(async (permission) => {
    let enforced = false
    let allowed = false
    try {
      enforced = isNewAuthoritative(await currentMigrationMode(permission))
      const { data, error } = await actor.admin.rpc('sa_evaluate_permission', {
        p_actor: actor.userId,
        p_permission: permission,
        p_context: organizationId ? { organization_id: organizationId } : {},
        p_include_delegation: true,
      })
      allowed = !error && data?.decision === 'ALLOW'
    } catch {
      allowed = false
    }
    capabilities[permission] = { allowed, enforced }
  }))

  return NextResponse.json({ organizationId, capabilities }, { headers: { 'Cache-Control': 'no-store' } })
}
