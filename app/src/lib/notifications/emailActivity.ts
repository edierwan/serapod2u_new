import { extractOrderRef } from '@/lib/notifications/orderRef'
import { emailRowShouldFailForUiTest } from '@/lib/notifications/emailProviderReady'

export type EmailMonitorStatus = 'pending' | 'sent' | 'delivered' | 'failed'

const ACTION_LABELS: Record<string, string> = {
    order_submitted: 'Order submitted',
    order_approved: 'Order approved',
    order_rejected: 'Order rejected',
    order_closed: 'Order closed',
    order_deleted: 'Order deleted',
    qr_batch_generated: 'QR batch generated',
    manufacturer_scan_complete: 'Manufacture completed',
    warehouse_received: 'Warehouse received order',
    low_stock_alert: 'Low stock alert',
    out_of_stock: 'Out of stock',
    stock_received: 'Stock received',
    stock_count_posting_verification: 'Stock count posting verification',
    qr_activated: 'QR activated',
    points_awarded: 'Points awarded',
    lucky_draw_entry: 'Lucky draw entry',
    redemption_completed: 'Redemption completed',
    user_created: 'User created',
    user_created_shop: 'User create new shop',
    user_activated: 'User activated',
    user_deactivated: 'User deactivated',
    password_changed: 'Password changed',
    password_reset_request: 'Password reset request',
    password_reset_otp: 'Password reset OTP',
    delete_user_otp: 'User deletion OTP',
    login_suspicious: 'Suspicious login',
    po_created: 'PO created',
    po_acknowledged: 'PO acknowledged',
    invoice_created: 'Invoice created',
    invoice_acknowledged: 'Invoice acknowledged',
    balance_request_created: 'Balance request created',
    payment_received: 'Payment received',
    balance_payment_received: 'Balance payment received',
    receipt_issued: 'Receipt issued',
    return_draft_created: 'Return draft created',
    return_submitted: 'Return submitted',
    return_received: 'Return received',
    return_processing: 'Return processing',
    return_completed: 'Return completed',
    roadtour_qr_delivery: 'RoadTour QR delivery',
}

export function toEmailMonitorStatus(raw: string): EmailMonitorStatus {
    const status = raw.toLowerCase()
    if (['failed', 'error', 'cancelled', 'canceled', 'undelivered', 'rejected', 'bounced'].includes(status)) {
        return 'failed'
    }
    if (['delivered', 'success', 'completed'].includes(status)) {
        return 'delivered'
    }
    if (['sent', 'accepted', 'processed'].includes(status)) {
        return 'sent'
    }
    return 'pending'
}

export function overlayEmailStatusForFailedProvider(input: {
    status: EmailMonitorStatus
    createdAt?: string | null
    sentAt?: string | null
    lastTestAt?: string | null
    providerBlockError?: string | null
    existingError?: string | null
}): { status: EmailMonitorStatus; errorMessage: string | null } {
    const existing = input.existingError || null
    if (!input.providerBlockError || (input.status !== 'sent' && input.status !== 'delivered')) {
        return { status: input.status, errorMessage: existing }
    }
    if (!emailRowShouldFailForUiTest({
        createdAt: input.createdAt,
        sentAt: input.sentAt,
        lastTestAt: input.lastTestAt,
    })) {
        return { status: input.status, errorMessage: existing }
    }
    return { status: 'failed', errorMessage: existing || input.providerBlockError }
}

export function formatNotificationAction(eventCode: string | null | undefined): string {
    const code = String(eventCode || '').trim()
    if (!code) return '-'
    if (ACTION_LABELS[code]) return ACTION_LABELS[code]
    return code.replace(/_/g, ' ')
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

export function extractEmailReceiver(...sources: unknown[]): string | null {
    for (const source of sources) {
        if (typeof source === 'string') {
            const email = source.trim()
            if (email) return email
            continue
        }
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue
        const row = source as Record<string, unknown>
        const email = asString(row.to_email)
            || asString(row.recipient_value)
            || asString(row.email)
            || asString(row.created_by_email)
        if (email) return email
    }
    return null
}

export function extractEmailSubject(payload: unknown, eventCode?: string | null): string {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const row = payload as Record<string, unknown>
        const stored = asString(row._email_subject) || asString(row.subject) || asString(row.email_subject)
        if (stored) return stored
    }
    const action = formatNotificationAction(eventCode)
    return action === '-' ? 'Serapod2U notification' : `Serapod2U notification: ${action}`
}

export function extractEmailBody(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
    const row = payload as Record<string, unknown>
    return asString(row._email_body) || asString(row.body) || asString(row.message) || asString(row.message_body)
}

export function emailOrderFields(payload: unknown) {
    const ref = extractOrderRef(payload)
    return { orderId: ref.orderId, orderNo: ref.orderNo }
}
