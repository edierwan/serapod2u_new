import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { governanceError, requireSecurityActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

/** SoD rules, mitigations and recent violations (security.audit.view). */
export async function GET() {
  const actor = await requireSecurityActor('security.audit.view')
  if (actor instanceof NextResponse) return actor
  const [rules, mitigations, violations] = await Promise.all([
    actor.admin.from('sa_sod_rules').select('id,rule_key,name,description,rule_kind,left_key,right_key,document_type,enforcement,status,effective_from,effective_until').order('rule_key'),
    actor.admin.from('sa_sod_mitigations').select('id,rule_id,user_id,reason,approved_by,status,effective_from,effective_until,created_at').order('created_at', { ascending: false }).limit(100),
    actor.admin.from('sa_sod_violations').select('id,detected_at,rule_id,user_id,document_type,document_id,outcome').order('detected_at', { ascending: false }).limit(200),
  ])
  if (rules.error) return NextResponse.json({ error: 'Unable to load SoD data' }, { status: 500 })
  return NextResponse.json({ rules: rules.data || [], mitigations: mitigations.data || [], violations: violations.data || [] })
}

const schema = z.object({
  ruleId: z.string().uuid(), userId: z.string().uuid(),
  reason: z.string().trim().min(10).max(1000), effectiveUntil: z.string().datetime(),
})

/** Time-boxed mitigation for a SoD rule (security.policy.manage; never self-granted). */
export async function POST(request: NextRequest) {
  const actor = await requireSecurityActor('security.policy.manage')
  if (actor instanceof NextResponse) return actor
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid mitigation' }, { status: 400 })
  const { data, error } = await actor.admin.rpc('sa_grant_sod_mitigation', {
    p_actor: actor.userId, p_rule: parsed.data.ruleId, p_user: parsed.data.userId,
    p_reason: parsed.data.reason, p_until: parsed.data.effectiveUntil,
  })
  if (error) return governanceError(error)
  return NextResponse.json({ ok: true, mitigationId: data })
}
