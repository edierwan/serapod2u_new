import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSecurityActor } from '@/lib/security-access/admin-api'

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  roleKey: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(''),
  permissionKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)).max(200),
})

export async function POST(request: NextRequest) {
  const actor = await requireSecurityActor('security.role.manage')
  if (actor instanceof NextResponse) return actor
  const user = { id: actor.userId }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid role', issues: parsed.error.flatten() }, { status: 400 })
  try {
    const admin = actor.admin
    const { data, error } = await admin.rpc('sa_save_business_role', {
      p_actor_id: user.id, p_role_id: parsed.data.id || null, p_role_key: parsed.data.roleKey,
      p_name: parsed.data.name, p_description: parsed.data.description, p_permission_keys: parsed.data.permissionKeys,
    })
    if (error) throw error
    return NextResponse.json({ id: data })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message === 'Forbidden' ? 'Forbidden' : 'Unable to save role', decisionId: error?.decisionId }, { status: error?.message === 'Forbidden' ? 403 : 400 })
  }
}
