import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveQuickOrderCatalog } from '@/lib/orders/quick-order-catalog'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (typeof body?.distributorId !== 'string' || !body.distributorId) {
      return NextResponse.json({ error: 'A distributor is required.' }, { status: 400 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    if (requesterError || !requester?.organization_id) return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })

    const catalog = await resolveQuickOrderCatalog(supabase, body.distributorId, requester.organization_id)
    return NextResponse.json({ variants: catalog.variants })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the distributor Quick Order catalog.'
    const status = message.includes('not available') || message.includes('not authorized') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
