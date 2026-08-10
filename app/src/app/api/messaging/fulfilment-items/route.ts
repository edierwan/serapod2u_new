import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Messaging fulfilment line quantities (§54). */
export async function GET(request: Request) {
  try {
    const orderId = new URL(request.url).searchParams.get('orderId')
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, source_channel')
      .eq('id', orderId)
      .maybeSingle()

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    const channel = (order.source_channel || '').toLowerCase()
    if (channel !== 'telegram' && channel !== 'whatsapp') {
      return NextResponse.json({ messaging: false, lines: [] })
    }

    const { data: lines, error } = await (supabase as any).rpc('messaging_fulfilment_lines', {
      p_order_id: orderId,
    })

    if (error) throw error

    const { data: inbox } = await (supabase as any)
      .from('messaging_warehouse_inbox')
      .select('status, receipt_status, delivery_method, delivery_reference, prepared_started_at, ready_at, shipped_at')
      .eq('order_id', orderId)
      .maybeSingle()

    return NextResponse.json({
      messaging: true,
      lines: lines || [],
      fulfilment: inbox || null,
    })
  } catch (error) {
    console.error('[messaging/fulfilment-items]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load fulfilment data.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
