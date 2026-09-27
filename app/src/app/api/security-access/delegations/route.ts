import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { actorAlsoHolds, governanceError, requireSelfServiceActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

const uuid = z.string().uuid()
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    delegatorId: uuid.optional(), delegateId: uuid, organizationId: uuid,
    permissionKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)).min(1).max(50),
    effectiveFrom: z.string().datetime().nullable().optional(),
    effectiveUntil: z.string().datetime(),
    reason: z.string().trim().min(5).max(1000),
  }),
  z.object({ action: z.literal('revoke'), delegationId: uuid, reason: z.string().trim().min(5).max(500) }),
])

/** Own delegations (as delegator or delegate); administrators see all. */
export async function GET() {
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor
  const manager = await actorAlsoHolds(actor as any, 'security.delegation.manage')
  let query = actor.admin.from('sa_delegations')
    .select('id,delegator_id,delegate_id,organization_id,permission_keys,reason,status,effective_from,effective_until,created_at,created_by,revoked_at,revoked_by,revoke_reason')
    .order('created_at', { ascending: false }).limit(200)
  if (!manager) query = query.or(`delegator_id.eq.${actor.userId},delegate_id.eq.${actor.userId}`)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Unable to load delegations' }, { status: 500 })
  return NextResponse.json({ delegations: data || [], canManage: manager })
}

/**
 * Anyone may delegate rights they currently hold directly (scoped, time-boxed,
 * non-transitive); delegating on someone else's behalf needs
 * security.delegation.manage. sa_create_delegation enforces all of it.
 */
export async function POST(request: NextRequest) {
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid delegation', issues: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data
  const { data, error } = body.action === 'create'
    ? await actor.admin.rpc('sa_create_delegation', {
        p_actor: actor.userId, p_delegator: body.delegatorId ?? actor.userId, p_delegate: body.delegateId,
        p_org: body.organizationId, p_permission_keys: body.permissionKeys, p_from: body.effectiveFrom ?? null,
        p_until: body.effectiveUntil, p_reason: body.reason,
      })
    : await actor.admin.rpc('sa_revoke_delegation', { p_actor: actor.userId, p_delegation: body.delegationId, p_reason: body.reason })
  if (error) return governanceError(error)
  return NextResponse.json({ ok: true, delegationId: body.action === 'create' ? data : body.delegationId })
}
