import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { cancelSerappOrderHoldByDistributor } from '@/lib/serapp/hold-service'

/**
 * Distributor cancels an active Serapp hold before warehouse acceptance.
 * Releases allocation via cancel + release path.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    if (!orderId) return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        account_scope,
        organizations:organization_id ( id, org_type_code )
      `)
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const organization = Array.isArray(requester.organizations)
      ? requester.organizations[0]
      : requester.organizations

    const access = getSerappAccessDecision({
      accountScope: requester.account_scope,
      orgTypeCode: organization?.org_type_code,
      organizationId: requester.organization_id,
      roleLevel: null,
    })

    if (!access.isDistributor && !access.isHqSupport) {
      return NextResponse.json({ error: 'Not allowed to cancel Serapp holds.' }, { status: 403 })
    }

    const { data: hold, error: holdError } = await supabase
      .from('serapp_order_holds')
      .select('id, order_id, buyer_org_id, status')
      .eq('order_id', orderId)
      .maybeSingle()

    if (holdError) throw holdError
    if (!hold) return NextResponse.json({ error: 'Serapp hold not found.' }, { status: 404 })

    if (access.isDistributor && hold.buyer_org_id !== requester.organization_id) {
      return NextResponse.json({ error: 'You can only cancel your own Serapp orders.' }, { status: 403 })
    }

    const cancelled = await cancelSerappOrderHoldByDistributor(supabase, {
      orderId,
      cancelledBy: user.id,
    })

    return NextResponse.json({
      ok: true,
      hold: cancelled,
      note: 'Serapp hold cancelled and stock released.',
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Cancel failed.',
    }, { status })
  }
}

export const dynamic = 'force-dynamic'
