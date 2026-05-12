const DEFAULT_CHANNELS = ['whatsapp', 'sms', 'email'] as const
const DEFAULT_PUBLIC_BASE_URL = 'https://app.serapod2u.com'

type SupabaseLikeClient = any

type QueueNotificationEventInput = {
    orgId: string | null | undefined
    eventCode: string
    payload: Record<string, any>
    dedupePayload?: Record<string, any>
    priority?: 'low' | 'normal' | 'high' | 'critical'
}

type BuildOrderPayloadInput = {
    orderId: string
    eventCode: 'order_submitted' | 'order_approved' | 'order_rejected' | 'order_closed'
    baseUrl?: string
}

function formatAmount(value: number) {
    return Number(value || 0).toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
}

function formatDate(value: string | null | undefined, withTime = false) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('en-GB', withTime
        ? {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }
        : {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        })
}

function parseCustomerDetails(notes: string | null | undefined) {
    const safeNotes = String(notes || '')
    const customerMatch = safeNotes.match(/Customer:\s*([^,]+)/i)
    const phoneMatch = safeNotes.match(/Phone:\s*([^,]+)/i)
    const addressMatch = safeNotes.match(/Address:\s*(.+)$/i)

    return {
        customerName: customerMatch?.[1]?.trim() || 'Customer',
        customerPhone: phoneMatch?.[1]?.trim() || '',
        deliveryAddress: addressMatch?.[1]?.trim() || '',
    }
}

export async function queueNotificationEvent(supabase: SupabaseLikeClient, input: QueueNotificationEventInput) {
    const { orgId, eventCode, payload, priority = 'normal' } = input

    if (!orgId) {
        return { queuedCount: 0, skippedReason: 'missing_org' as const }
    }

    const dedupePayload = Object.fromEntries(
        Object.entries(input.dedupePayload || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )

    if (Object.keys(dedupePayload).length > 0) {
        const { data: existing } = await supabase
            .from('notifications_outbox')
            .select('id')
            .eq('org_id', orgId)
            .eq('event_code', eventCode)
            .contains('payload_json', dedupePayload)
            .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
            .limit(1)

        if (existing && existing.length > 0) {
            return { queuedCount: 0, skippedReason: 'duplicate' as const }
        }
    }

    let queuedCount = 0
    const errors: string[] = []

    for (const channel of DEFAULT_CHANNELS) {
        const { data, error } = await supabase.rpc('queue_notification', {
            p_org_id: orgId,
            p_event_code: eventCode,
            p_channel: channel,
            p_recipient_phone: null,
            p_recipient_email: null,
            p_template_code: null,
            p_payload: payload,
            p_priority: priority,
            p_scheduled_for: null,
        })

        if (error) {
            errors.push(`${channel}: ${error.message}`)
            continue
        }

        if (data) {
            queuedCount += 1
        }
    }

    return {
        queuedCount,
        skippedReason: queuedCount === 0 ? 'disabled_or_no_provider' as const : null,
        errors,
    }
}

export async function buildOrderEventPayload(supabase: SupabaseLikeClient, input: BuildOrderPayloadInput) {
    const { orderId, eventCode, baseUrl = DEFAULT_PUBLIC_BASE_URL } = input

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, order_no, display_doc_no, order_type, buyer_org_id, seller_org_id, created_at, approved_at, approved_by, updated_at, notes, status, units_per_case')
        .eq('id', orderId)
        .single()

    if (orderError || !order) {
        throw new Error(orderError?.message || 'Order not found')
    }

    const [{ data: items, error: itemsError }, { data: orgs, error: orgsError }] = await Promise.all([
        supabase
            .from('order_items')
            .select('qty, unit_price, units_per_case, line_total, products(product_name), product_variants(variant_name)')
            .eq('order_id', orderId),
        supabase
            .from('organizations')
            .select('id, org_name')
            .in('id', [order.buyer_org_id, order.seller_org_id].filter(Boolean)),
    ])

    if (itemsError) throw new Error(itemsError.message)
    if (orgsError) throw new Error(orgsError.message)

    const orgNameById = new Map((orgs || []).map((org: any) => [org.id, org.org_name]))
    const displayOrderNo = order.display_doc_no || order.order_no
    const { customerName, customerPhone, deliveryAddress } = parseCustomerDetails(order.notes)

    let totalAmount = 0
    let totalCases = 0
    const itemList = (items || []).map((item: any) => {
        const quantity = Number(item.qty || 0)
        const unitsPerCase = Math.max(Number(item.units_per_case || order.units_per_case || 100), 1)
        const caseCount = Math.ceil(quantity / unitsPerCase)
        const lineTotal = Number(item.line_total || (quantity * Number(item.unit_price || 0)))
        const productName = item.products?.product_name || 'Product'
        const variantName = item.product_variants?.variant_name || ''

        totalAmount += lineTotal
        totalCases += caseCount

        return `• ${productName}${variantName ? ` – ${variantName}` : ''} × ${quantity} units (${caseCount} case${caseCount === 1 ? '' : 's'}) — RM ${formatAmount(lineTotal)}`
    })

    const payload: Record<string, any> = {
        order_id: order.id,
        order_no: displayOrderNo,
        order_date: formatDate(order.created_at),
        order_type: order.order_type,
        status: order.status,
        buyer_org: orgNameById.get(order.buyer_org_id) || '',
        seller_org: orgNameById.get(order.seller_org_id) || '',
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address: deliveryAddress,
        amount: formatAmount(totalAmount),
        total_cases: String(totalCases),
        total_items: String((items || []).length),
        item_list: itemList.length > 0 ? itemList.join('\n') : 'No items',
        order_url: `${baseUrl}/supply-chain`,
    }

    if (eventCode === 'order_approved') {
        let approverName = 'System'
        if (order.approved_by) {
            const { data: approver } = await supabase
                .from('users')
                .select('full_name, email')
                .eq('id', order.approved_by)
                .single()
            approverName = approver?.full_name || approver?.email || approverName
        }

        payload.approved_by = approverName
        payload.approved_at = formatDate(order.approved_at, true)
    }

    if (eventCode === 'order_rejected') {
        const isCancelled = order.status === 'cancelled'
        payload.reason = isCancelled ? 'Order was cancelled' : 'Order was rejected'
        payload.action = isCancelled ? 'Cancelled' : 'Rejected'
    }

    if (eventCode === 'order_closed') {
        payload.closed_at = formatDate(order.updated_at, true)
    }

    return {
        order,
        orgId: order.buyer_org_id || null,
        payload,
    }
}