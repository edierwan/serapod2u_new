import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize } from '@/lib/security-access/authorization'
import { requireSecurityActor } from '@/lib/security-access/admin-api'

const inputSchema = z.object({
  actorId: z.string().uuid(),
  permission: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  resource: z.object({
    type: z.string().min(1).max(100), id: z.string().max(200).optional(), organizationId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), ownerUserId: z.string().uuid().optional(),
    attributes: z.record(z.string().max(100)).optional(),
  }),
})

export async function POST(request: NextRequest) {
  const actor = await requireSecurityActor('security.access.view')
  if (actor instanceof NextResponse) return actor
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid simulation request', issues: parsed.error.flatten() }, { status: 400 })
  const decision = await authorize({ ...parsed.data, context: { explainOnly: true } }, { log: false })
  return NextResponse.json(decision)
}
