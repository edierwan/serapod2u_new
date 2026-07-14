import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
import { resolveNotificationConfigOrgId } from '@/lib/returns/notifications'
import { sendReportEmail } from '@/lib/email/report-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Audit event code for report emails (registered in notification_types). */
const REPORT_EMAIL_EVENT = 'return_report_email'

const MAX_RECIPIENTS = 20
const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_SUBJECT_LENGTH = 250
const MAX_MESSAGE_LENGTH = 10_000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const USER_SEND_FAILED = 'Unable to send the report. Please check the email configuration and try again.'
const USER_NOT_CONFIGURED = 'Email service is not configured. Please configure an email provider before sending reports.'

function normalizeRecipients(value: unknown): { emails: string[]; invalid: string[] } {
    const raw = Array.isArray(value) ? value : []
    const seen = new Set<string>()
    const emails: string[] = []
    const invalid: string[] = []
    for (const entry of raw) {
        const email = String(entry || '').trim()
        if (!email) continue
        if (!EMAIL_RE.test(email)) { invalid.push(email); continue }
        const key = email.toLowerCase()
        if (seen.has(key)) continue // silently drop duplicates
        seen.add(key)
        emails.push(email)
    }
    return { emails, invalid }
}

function sanitizeFilename(value: unknown): string {
    const name = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!name || !name.toLowerCase().endsWith('.pdf')) return 'Return_Product_Report.pdf'
    return name
}

/**
 * POST /api/returns/reporting/email
 *
 * Sends the management report PDF (generated client-side — the exact document
 * shown in Preview PDF) to the given recipients via the org's configured email
 * provider, then records an audit row in notifications_outbox. Delivery failure
 * never touches any Return Product record.
 */
export async function POST(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    let body: any
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    // ── Validation ──────────────────────────────────────────────────────────
    const to = normalizeRecipients(body.to)
    if (to.invalid.length > 0) {
        return NextResponse.json({ error: `Invalid email address: ${to.invalid[0]}` }, { status: 400 })
    }
    if (to.emails.length === 0) {
        return NextResponse.json({ error: 'At least one valid recipient email is required.' }, { status: 400 })
    }
    const cc = normalizeRecipients(body.cc)
    if (cc.invalid.length > 0) {
        return NextResponse.json({ error: `Invalid CC email address: ${cc.invalid[0]}` }, { status: 400 })
    }
    // A CC that repeats a To recipient is dropped rather than rejected.
    const toKeys = new Set(to.emails.map((e) => e.toLowerCase()))
    const ccEmails = cc.emails.filter((e) => !toKeys.has(e.toLowerCase()))
    if (to.emails.length + ccEmails.length > MAX_RECIPIENTS) {
        return NextResponse.json({ error: `A report can be sent to at most ${MAX_RECIPIENTS} recipients.` }, { status: 400 })
    }

    const subject = String(body.subject || '').trim()
    const message = String(body.message || '').trim()
    if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
    if (subject.length > MAX_SUBJECT_LENGTH) return NextResponse.json({ error: 'Subject is too long.' }, { status: 400 })
    if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
    if (message.length > MAX_MESSAGE_LENGTH) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 })

    const pdfBase64 = String(body.pdfBase64 || '')
    if (!pdfBase64) return NextResponse.json({ error: 'The report PDF is missing.' }, { status: 400 })
    let pdfBytes: number
    try {
        pdfBytes = Buffer.from(pdfBase64, 'base64').byteLength
    } catch {
        return NextResponse.json({ error: 'The report PDF is not valid.' }, { status: 400 })
    }
    if (pdfBytes === 0) return NextResponse.json({ error: 'The report PDF is empty.' }, { status: 400 })
    if (pdfBytes > MAX_PDF_BYTES) {
        return NextResponse.json({ error: 'The report PDF is too large to email (max 10 MB).' }, { status: 400 })
    }

    const filename = sanitizeFilename(body.filename)
    const reportMode = body.reportMode === 'quarterly' ? 'quarterly' : 'monthly'
    const periodLabel = String(body.periodLabel || '').slice(0, 60)

    // ── Provider resolution ─────────────────────────────────────────────────
    const configOrgId = await resolveNotificationConfigOrgId(ctx.admin)
    if (!configOrgId) {
        return NextResponse.json({ error: USER_NOT_CONFIGURED }, { status: 503 })
    }

    // ── Send ────────────────────────────────────────────────────────────────
    const result = await sendReportEmail(ctx.admin, configOrgId, {
        to: to.emails,
        cc: ccEmails,
        subject,
        text: message,
        attachment: { filename, contentBase64: pdfBase64, contentType: 'application/pdf' },
    })

    // ── Audit trail (never store the PDF binary) ────────────────────────────
    try {
        await ctx.admin.from('notifications_outbox').insert({
            org_id: configOrgId,
            event_code: REPORT_EMAIL_EVENT,
            channel: 'email',
            to_email: to.emails.join(', '),
            payload_json: {
                report_type: reportMode,
                period_label: periodLabel,
                subject,
                pdf_filename: filename,
                pdf_size_bytes: pdfBytes,
                recipients: to.emails,
                cc: ccEmails,
                sent_by: ctx.userId,
                delivery_status: result.success ? 'sent' : 'failed',
                ...(result.success ? {} : { failure_reason: result.error || 'Email delivery failed' }),
            },
            provider_name: result.providerName || null,
            provider_message_id: result.messageId || null,
            priority: 'normal',
            status: result.success ? 'sent' : 'failed',
            error: result.success ? null : (result.error || 'Email delivery failed'),
            sent_at: result.success ? new Date().toISOString() : null,
            retry_count: 0,
            max_retries: 0,
        })
    } catch (auditError: any) {
        // The audit row must never block a delivered report.
        console.error('[ReturnReporting] email audit log failed:', auditError?.message || auditError)
    }

    if (!result.success) {
        // Technical detail stays server-side; the user gets a friendly message.
        console.error('[ReturnReporting] report email failed:', result.error)
        if (result.notConfigured) {
            return NextResponse.json({ error: USER_NOT_CONFIGURED }, { status: 503 })
        }
        return NextResponse.json({ error: USER_SEND_FAILED }, { status: 502 })
    }

    return NextResponse.json({
        success: true,
        recipientCount: to.emails.length + ccEmails.length,
        toCount: to.emails.length,
    })
}
