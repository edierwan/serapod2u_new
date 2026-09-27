import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { governanceError, requireSecurityActor, requireSelfServiceActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

const uuid = z.string().uuid()
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'), name: z.string().trim().min(3).max(200),
    organizationId: uuid.nullable().optional(), roleId: uuid.nullable().optional(), reviewerId: uuid,
    dueAt: z.string().datetime().nullable().optional(),
  }),
  z.object({
    action: z.literal('decide'), itemId: uuid, decision: z.enum(['retain', 'revoke', 'modify']),
    reason: z.string().trim().max(1000).optional(), newEffectiveUntil: z.string().datetime().nullable().optional(),
  }),
  z.object({ action: z.literal('complete'), campaignId: uuid }),
])

/** Campaigns and items: managers see all, reviewers see their campaigns. */
export async function GET() {
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor
  const manager = await requireSecurityActor('security.access_review.manage')
  const isManager = !(manager instanceof NextResponse)
  let campaigns = actor.admin.from('sa_access_review_campaigns')
    .select('id,name,organization_id,role_id,reviewer_id,status,due_at,created_at,created_by,completed_at')
    .order('created_at', { ascending: false }).limit(50)
  if (!isManager) campaigns = campaigns.eq('reviewer_id', actor.userId)
  const { data: campaignRows, error } = await campaigns
  if (error) return NextResponse.json({ error: 'Unable to load reviews' }, { status: 500 })
  const ids = (campaignRows || []).map((c: any) => c.id)
  const { data: items } = ids.length
    ? await actor.admin.from('sa_access_review_items')
        .select('id,campaign_id,assignment_id,user_id,role_id,snapshot,decision,decision_reason,new_effective_until,decided_by,decided_at')
        .in('campaign_id', ids).order('decision')
    : { data: [] }
  return NextResponse.json({ campaigns: campaignRows || [], items: items || [], canManage: isManager })
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid review request', issues: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data
  if (body.action === 'create') {
    const actor = await requireSecurityActor('security.access_review.manage')
    if (actor instanceof NextResponse) return actor
    const { data, error } = await actor.admin.rpc('sa_create_access_review', {
      p_actor: actor.userId, p_name: body.name, p_org: body.organizationId ?? null, p_role: body.roleId ?? null,
      p_reviewer: body.reviewerId, p_due: body.dueAt ?? null,
    })
    if (error) return governanceError(error)
    return NextResponse.json({ ok: true, campaignId: data })
  }
  // The assigned reviewer (or a review manager) decides; the database
  // forbids self-certification and re-checks authority.
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor
  const { error } = body.action === 'decide'
    ? await actor.admin.rpc('sa_decide_access_review_item', {
        p_actor: actor.userId, p_item: body.itemId, p_decision: body.decision, p_reason: body.reason ?? null,
        p_new_until: body.newEffectiveUntil ?? null,
      })
    : await actor.admin.rpc('sa_complete_access_review', { p_actor: actor.userId, p_campaign: body.campaignId })
  if (error) return governanceError(error)
  return NextResponse.json({ ok: true })
}
