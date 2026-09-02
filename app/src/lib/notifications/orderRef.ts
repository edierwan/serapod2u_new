export type NotificationOrderRef = {
    orderId: string | null
    orderNo: string | null
}

function asTrimmed(value: unknown): string | null {
    const text = String(value ?? '').trim()
    return text || null
}

/**
 * Pull a human-readable order number (and UUID) from notification payload / meta.
 * Order notifications store `order_no` and `order_id` on outbox payload_json.
 */
export function extractOrderRef(...sources: unknown[]): NotificationOrderRef {
    let orderId: string | null = null
    let orderNo: string | null = null

    for (const source of sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue
        const row = source as Record<string, unknown>
        const nextNo = asTrimmed(row.order_no) || asTrimmed(row.display_doc_no) || asTrimmed(row.orderNo)
        const nextId = asTrimmed(row.order_id) || asTrimmed(row.orderId)
        if (!orderNo && nextNo) orderNo = nextNo
        if (!orderId && nextId) orderId = nextId
        if (orderNo && orderId) break
    }

    return { orderId, orderNo }
}

export function formatOrderRef(ref: NotificationOrderRef | null | undefined): string {
    if (!ref) return ''
    return ref.orderNo || ref.orderId || ''
}
