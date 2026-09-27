import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { authorize } from '@/lib/security-access/authorization'

const schema = z.object({
  transferId: z.string().uuid(),
  action: z.enum(['request', 'approve', 'dispatch', 'receive']),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  // Read with the caller's RLS session. An inaccessible transfer is not exposed
  // through the service-role evaluator or diagnostic response.
  const [{ data: transfer }, { data: actorProfile }] = await Promise.all([
    (supabase as any).from('stock_transfers').select('id,from_organization_id,to_organization_id').eq('id', parsed.data.transferId).maybeSingle(),
    (supabase as any).from('users').select('organization_id').eq('id', user.id).maybeSingle(),
  ])
  if (!transfer || !actorProfile?.organization_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const warehouseId = parsed.data.action === 'receive' ? transfer.to_organization_id : transfer.from_organization_id
  try {
    const decision = await authorize({
      actorId: user.id,
      permission: `inventory.transfer.${parsed.data.action}`,
      resource: { type: 'stock_transfer', id: transfer.id, organizationId: actorProfile.organization_id, warehouseId },
      context: { correlationId: request.headers.get('x-request-id') },
    })
    // SHADOW result is diagnostic only. Do not reveal assignment details here.
    return NextResponse.json({ recorded: true, decisionId: decision.decisionId, migrationMode: decision.migrationMode })
  } catch (error: any) {
    console.error('[sa-shadow] transfer evaluation failed', { transferId: transfer.id, action: parsed.data.action, message: error?.message })
    return NextResponse.json({ recorded: false }, { status: 202 })
  }
}
