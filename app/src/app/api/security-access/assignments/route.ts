import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { governanceError, requireSecurityActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

const uuid = z.string().uuid()
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    userId: uuid, roleId: uuid, organizationId: uuid,
    scopeIds: z.array(uuid).min(1).max(20),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveUntil: z.string().datetime().nullable().optional(),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({ action: z.literal('revoke'), assignmentId: uuid, reason: z.string().trim().min(5).max(500) }),
])

/**
 * Grants or revokes a business role assignment. Authority: security.role.assign
 * in the administrator's scope. sa_assign_role / sa_revoke_assignment re-check
 * the actor, forbid self-assignment, require a membership and scopes inside it,
 * enforce SoD, and audit every change.
 */
export async function POST(request: NextRequest) {
  const actor = await requireSecurityActor('security.role.assign')
  if (actor instanceof NextResponse) return actor
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data
  const { data, error } = body.action === 'grant'
    ? await actor.admin.rpc('sa_assign_role', {
        p_actor: actor.userId, p_user: body.userId, p_role: body.roleId, p_org: body.organizationId,
        p_scope_ids: body.scopeIds, p_from: body.effectiveFrom ?? null, p_until: body.effectiveUntil ?? null, p_reason: body.reason,
      })
    : await actor.admin.rpc('sa_revoke_assignment', { p_actor: actor.userId, p_assignment: body.assignmentId, p_reason: body.reason })
  if (error) return governanceError(error)
  return NextResponse.json({ ok: true, assignmentId: body.action === 'grant' ? data : body.assignmentId })
}
