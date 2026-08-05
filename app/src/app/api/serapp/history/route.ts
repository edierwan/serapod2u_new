import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { SERAPP_ORDER_SOURCE_MARKER } from '@/lib/serapp/constants'

/**
 * Serapp History — orders + hold rows for the signed-in actor.
 * Hold rows are loaded with the admin client after access checks because
 * distributor/HQ portal RLS on serapp_order_holds is too narrow for reliable UI.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 })
    }

    const admin = createAdminClient()
    const holdByOrder = new Map<string, {
      id: string
      order_id: string
      status: string
      expires_at: string
      accepted_at: string | null
    }>()

    // HQ Support: Serapp is not their order inbox.
    // Show only Serapp holds for this HQ (pending accept + recent resolved).
    if (access.isHqSupport) {
      const { data: holds, error: holdError } = await admin
        .from('serapp_order_holds')
        .select('id, order_id, status, expires_at, accepted_at, seller_hq_id')
        .eq('seller_hq_id', requester.organization_id)
        .order('created_at', { ascending: false })
        .limit(40)

      if (holdError) throw holdError

      for (const hold of holds || []) {
        holdByOrder.set(hold.order_id, {
          id: hold.id,
          order_id: hold.order_id,
          status: hold.status,
          expires_at: hold.expires_at,
          accepted_at: hold.accepted_at,
        })
      }

      const holdOrderIds = [...holdByOrder.keys()]
      if (holdOrderIds.length === 0) {
        return NextResponse.json({
          orders: [],
          actor: { isDistributor: false, isHqSupport: true },
        })
      }

      const { data: orders, error: ordersError } = await admin
        .from('orders')
        .select('id, order_no, display_doc_no, status, notes, created_at')
        .in('id', holdOrderIds)

      if (ordersError) throw ordersError

      const sorted = (orders || [])
        .map(order => ({
          ...order,
          hold: holdByOrder.get(order.id) || null,
          fromSerapp: true,
        }))
        .sort((a, b) => {
          const aActive = a.hold?.status === 'active' ? 0 : 1
          const bActive = b.hold?.status === 'active' ? 0 : 1
          if (aActive !== bActive) return aActive - bActive
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })

      return NextResponse.json({
        orders: sorted,
        actor: { isDistributor: false, isHqSupport: true },
      })
    }

    // Distributor: only their own D2H orders.
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, order_no, display_doc_no, status, notes, created_at')
      .eq('order_type', 'D2H')
      .eq('buyer_org_id', requester.organization_id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (ordersError) throw ordersError

    const rows = orders || []
    const orderIds = rows.map(order => order.id)

    if (orderIds.length > 0) {
      const { data: holds, error: holdError } = await admin
        .from('serapp_order_holds')
        .select('id, order_id, status, expires_at, accepted_at')
        .eq('buyer_org_id', requester.organization_id)
        .in('order_id', orderIds)

      if (holdError) {
        console.warn('[serapp/history] holds:', holdError.message)
      } else {
        for (const hold of holds || []) {
          holdByOrder.set(hold.order_id, {
            id: hold.id,
            order_id: hold.order_id,
            status: hold.status,
            expires_at: hold.expires_at,
            accepted_at: hold.accepted_at,
          })
        }
      }
    }

    const withHolds = rows.map(order => ({
      ...order,
      hold: holdByOrder.get(order.id) || null,
      fromSerapp: (order.notes || '').includes(SERAPP_ORDER_SOURCE_MARKER) || holdByOrder.has(order.id),
    }))

    const sorted = [
      ...withHolds.filter(order => order.fromSerapp),
      ...withHolds.filter(order => !order.fromSerapp),
    ]

    return NextResponse.json({
      orders: sorted,
      actor: {
        isDistributor: true,
        isHqSupport: false,
      },
    })
  } catch (error) {
    console.error('[serapp/history]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load history.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
