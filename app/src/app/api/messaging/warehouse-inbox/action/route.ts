import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatMessagingStatusTelegram,
  notifyMessagingOrderTelegram,
} from '@/lib/messaging/telegram-notify'

type MessagingAction = 'start_preparing' | 'ready_to_ship' | 'ship'

/**
 * Warehouse actions for messaging D2H inbox orders.
 * Uses SECURITY DEFINER RPCs; classic allocate-on-submit path untouched.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    const action = body?.action as MessagingAction
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })
    }
    if (!['start_preparing', 'ready_to_ship', 'ship'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: requester } = await supabase
      .from('users')
      .select('id, organization_id, organizations:organization_id ( org_type_code )')
      .eq('id', user.id)
      .single()

    const organization = Array.isArray(requester?.organizations)
      ? requester?.organizations[0]
      : requester?.organizations
    const orgType = String((organization as { org_type_code?: string } | null)?.org_type_code || '').toUpperCase()
    if (!['HQ', 'WH'].includes(orgType)) {
      return NextResponse.json({ error: 'Only HQ/warehouse users can run messaging fulfilment actions.' }, { status: 403 })
    }

    let rpcResult: unknown
    let rpcError: { message?: string } | null = null

    if (action === 'start_preparing') {
      const res = await supabase.rpc('messaging_start_preparing' as any, { p_order_id: orderId })
      rpcResult = res.data
      rpcError = res.error
    } else if (action === 'ready_to_ship') {
      const res = await supabase.rpc('messaging_ready_to_ship' as any, { p_order_id: orderId })
      rpcResult = res.data
      rpcError = res.error
    } else {
      const res = await supabase.rpc('messaging_ship_order' as any, {
        p_order_id: orderId,
        p_delivery_method: typeof body?.deliveryMethod === 'string' ? body.deliveryMethod : 'other',
        p_delivery_reference: typeof body?.deliveryReference === 'string' ? body.deliveryReference : null,
        p_driver_name: typeof body?.driverName === 'string' ? body.driverName : null,
        p_vehicle_number: typeof body?.vehicleNumber === 'string' ? body.vehicleNumber : null,
        p_remarks: typeof body?.remarks === 'string' ? body.remarks : null,
      })
      rpcResult = res.data
      rpcError = res.error
    }

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message || 'Action failed.' }, { status: 409 })
    }

    const admin = createAdminClient()
    const { data: order } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no, buyer_org_id, created_by, source_channel')
      .eq('id', orderId)
      .maybeSingle()

    const orderNo = order?.display_doc_no || order?.order_no || orderId.slice(0, 8)
    const stage =
      action === 'start_preparing'
        ? 'preparing'
        : action === 'ready_to_ship'
          ? 'ready_to_ship'
          : 'shipped'

    let notify: { sent: boolean; reason?: string } | null = null
    if (order?.buyer_org_id && (order.source_channel === 'telegram' || order.source_channel === 'whatsapp')) {
      const shipPayload = action === 'ship' && rpcResult && typeof rpcResult === 'object'
        ? (rpcResult as { inbox?: { delivery_method?: string; delivery_reference?: string } })
        : null
      notify = await notifyMessagingOrderTelegram({
        buyerOrgId: order.buyer_org_id,
        createdByUserId: order.created_by,
        text: formatMessagingStatusTelegram({
          orderNo,
          stage,
          deliveryMethod: shipPayload?.inbox?.delivery_method,
          deliveryReference: shipPayload?.inbox?.delivery_reference || body?.deliveryReference,
        }),
      })
    }

    return NextResponse.json({
      ok: true,
      action,
      result: rpcResult,
      notification: notify,
    })
  } catch (error) {
    console.error('[messaging/warehouse-inbox action]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Action failed.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
