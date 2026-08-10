import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveStandardOrderCatalog } from '@/lib/orders/standard-order-catalog'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (typeof body?.distributorId !== 'string' || !body.distributorId) {
      return NextResponse.json({ error: 'A distributor is required.' }, { status: 400 })
    }
    if (typeof body?.fulfillmentWarehouseId !== 'string' || !body.fulfillmentWarehouseId) {
      return NextResponse.json({ error: 'A fulfillment warehouse is required.' }, { status: 400 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const catalog = await resolveStandardOrderCatalog(
      supabase,
      createAdminClient(),
      body.distributorId,
      requester.organization_id,
      body.fulfillmentWarehouseId,
    )
    return NextResponse.json(catalog)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the distributor Standard Order catalog.'
    const status = message.includes('not available')
      || message.includes('not authorized')
      || message.includes('required')
      || message.includes('not an active warehouse')
      ? 403
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
