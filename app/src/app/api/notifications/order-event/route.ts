import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildOrderEventPayload, queueNotificationEvent } from '@/lib/notifications/supplyChainEventQueue'

const ALLOWED_EVENT_CODES = new Set(['order_submitted', 'order_approved', 'order_rejected', 'order_closed'])

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const orderId = String(body?.orderId || '')
        const eventCode = String(body?.eventCode || '')

        if (!orderId || !ALLOWED_EVENT_CODES.has(eventCode)) {
            return NextResponse.json({ error: 'Invalid order event request' }, { status: 400 })
        }

        const { data: accessibleOrder, error: accessError } = await supabase
            .from('orders')
            .select('id')
            .eq('id', orderId)
            .single()

        if (accessError || !accessibleOrder) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        const adminSupabase = createAdminClient()
        const { orgId, payload } = await buildOrderEventPayload(adminSupabase, {
            orderId,
            eventCode: eventCode as 'order_submitted' | 'order_approved' | 'order_rejected' | 'order_closed',
            baseUrl: request.nextUrl.origin,
        })

        const result = await queueNotificationEvent(adminSupabase, {
            orgId,
            eventCode,
            payload,
            dedupePayload: { order_no: payload.order_no },
        })

        fetch(`${request.nextUrl.origin}/api/cron/notification-outbox-worker`).catch(() => { })

        return NextResponse.json({ success: true, ...result })
    } catch (error: any) {
        console.error('Failed to queue order event notification:', error)
        return NextResponse.json({ error: error.message || 'Failed to queue order event notification' }, { status: 500 })
    }
}