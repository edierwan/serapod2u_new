import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { authorize } from '@/lib/security-access/authorization'

const inputSchema = z.object({
  actorId: z.string().uuid(),
  permission: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  resource: z.object({
    type: z.string().min(1).max(100), id: z.string().max(200).optional(), organizationId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), ownerUserId: z.string().uuid().optional(),
  }),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await checkPermissionForUser(user.id, 'manage_authorization')).allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid simulation request', issues: parsed.error.flatten() }, { status: 400 })
  const decision = await authorize({ ...parsed.data, context: { explainOnly: true } }, { log: false })
  return NextResponse.json(decision)
}
