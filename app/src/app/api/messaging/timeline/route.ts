import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Messaging order timeline (additive audit trail). Uses caller RLS. */
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

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, source_channel')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    const channel = (order.source_channel || '').toLowerCase()
    if (channel !== 'telegram' && channel !== 'whatsapp') {
      return NextResponse.json({ events: [], messaging: false })
    }

    const { data: events, error } = await (supabase as any)
      .from('messaging_order_timeline_events')
      .select('id, action, previous_status, new_status, actor_channel, metadata, created_at, actor_user_id')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(100)

    if (error) throw error

    const { data: discrepancies } = await (supabase as any)
      .from('messaging_delivery_discrepancies')
      .select(`
        id, status, remarks, reported_at, resolution, resolved_at,
        messaging_delivery_discrepancy_items (
          id, issue_type, shipped_quantity, received_quantity, difference_quantity, remarks
        )
      `)
      .eq('order_id', orderId)
      .order('reported_at', { ascending: false })
      .limit(5)

    const admin = createAdminClient()
    const { data: attachments } = await admin
      .from('messaging_delivery_discrepancy_attachments')
      .select('id, discrepancy_id, file_name, mime_type, storage_path, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(20)

    const attachmentsWithUrls = await Promise.all(
      (attachments || []).map(async (row) => {
        const { data: signed } = await admin.storage
          .from('messaging-discrepancy-evidence')
          .createSignedUrl(row.storage_path, 3600)
        return { ...row, signed_url: signed?.signedUrl || null }
      }),
    )

    return NextResponse.json({
      messaging: true,
      events: events || [],
      discrepancies: discrepancies || [],
      attachments: attachmentsWithUrls,
    })
  } catch (error) {
    console.error('[messaging/timeline]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load timeline.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
