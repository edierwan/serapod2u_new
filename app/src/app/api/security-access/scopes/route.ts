import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { governanceError, requireSecurityActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

const schema = z.object({
  organizationId: z.string().uuid(),
  scopeType: z.string().regex(/^[a-z][a-z0-9_]*$/).max(40),
  scopeValue: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
})

/** Defines a typed scope (security.scope.manage). Wildcards never mean global. */
export async function POST(request: NextRequest) {
  const actor = await requireSecurityActor('security.scope.manage')
  if (actor instanceof NextResponse) return actor
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  const { data, error } = await actor.admin.rpc('sa_define_scope', {
    p_actor: actor.userId, p_org: parsed.data.organizationId, p_scope_type: parsed.data.scopeType,
    p_scope_value: parsed.data.scopeValue, p_display_name: parsed.data.displayName, p_metadata: {},
  })
  if (error) return governanceError(error)
  return NextResponse.json({ ok: true, scopeId: data })
}
