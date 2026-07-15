const PREVIEW_TEXT = 'A verification code was requested to approve a Stock Count inventory adjustment.'

export interface StockCountVerificationEmailInput {
    warehouse_name: string
    organization_name?: string | null
    count_date: string
    count_type: string
    reference_name?: string | null
    requested_by: string
    requested_at?: Date | string
    total_variants_counted: number
    variance_items: number
    net_quantity_adjustment: number
    estimated_adjustment_value: number
    notes: string
    high_impact?: boolean
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]!))

const titleCase = (value: string) => value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
const formatNumber = (value: number) => Number(value || 0).toLocaleString('en-MY')
const formatSignedNumber = (value: number) => `${value > 0 ? '+' : ''}${formatNumber(value)}`
const formatMoney = (value: number) => `RM ${Number(value || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plain = (value: unknown, fallback = '—') => String(value ?? '').trim() || fallback
const htmlWithLineBreaks = (value: unknown) => escapeHtml(plain(value)).replace(/\r?\n/g, '<br>')

function detailRow(label: string, value: unknown) {
    return `<tr><td style="padding:8px 0;color:#667085;border-bottom:1px solid #eaecf0;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#101828;border-bottom:1px solid #eaecf0;vertical-align:top">${escapeHtml(plain(value))}</td></tr>`
}

function metric(label: string, value: string, warning: boolean) {
    return `<td width="50%" style="padding:6px"><table role="presentation" width="100%" style="border-collapse:collapse;background:${warning ? '#fff7ed' : '#f8fafc'};border:1px solid ${warning ? '#fed7aa' : '#e2e8f0'};border-radius:8px"><tr><td style="padding:12px"><div style="font-size:12px;color:#667085">${escapeHtml(label)}</div><div style="margin-top:5px;font-size:18px;font-weight:700;color:${warning ? '#b42318' : '#101828'}">${escapeHtml(value)}</div></td></tr></table></td>`
}

export function buildStockCountEmail(input: StockCountVerificationEmailInput, code: string) {
    if (!/^\d{8}$/.test(code)) throw new Error('Stock Count verification code must contain exactly eight digits.')

    const reference = plain(input.reference_name)
    const requestedAtValue = input.requested_at ? new Date(input.requested_at) : new Date()
    const requestedAt = new Intl.DateTimeFormat('en-MY', {
        dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur',
    }).format(requestedAtValue)
    const countType = titleCase(plain(input.count_type, 'Stock Count'))
    const netAdjustment = Number(input.net_quantity_adjustment || 0)
    const estimatedValue = Number(input.estimated_adjustment_value || 0)
    const highImpact = input.high_impact ?? (Math.abs(estimatedValue) >= 10_000 || Math.abs(netAdjustment) >= 1_000)
    const subjectReference = input.reference_name?.trim().replace(/[\r\n]+/g, ' ').slice(0, 120)
    const subject = subjectReference
        ? `Serapod2U Stock Count Verification Code — ${subjectReference}`
        : 'Serapod2U Stock Count Posting Verification Code'

    const details = [
        detailRow('Warehouse', input.warehouse_name),
        detailRow('Organization', input.organization_name),
        detailRow('Count date', input.count_date),
        detailRow('Count type', countType),
        detailRow('Reference / batch', reference),
        detailRow('Requested by', input.requested_by),
        detailRow('Request date and time', `${requestedAt} (Asia/Kuala_Lumpur)`),
    ].join('')

    const highImpactHtml = highImpact ? `<tr><td style="padding:0 30px 22px"><table role="presentation" width="100%" style="border-collapse:collapse;background:#fffaeb;border:1px solid #fedf89;border-radius:10px"><tr><td style="padding:15px;color:#7a2e0e;line-height:1.5"><strong>High-impact adjustment</strong><br>Review the quantities and estimated value carefully before approving this Stock Count.</td></tr></table></td></tr>` : ''

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#101828"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(PREVIEW_TEXT)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f2f4f7"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border-collapse:separate;background:#ffffff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden"><tr><td style="padding:22px 30px;background:#c2410c;color:#ffffff;font-size:22px;font-weight:700">Serapod2U</td></tr><tr><td style="padding:30px 30px 10px"><div style="font-size:12px;font-weight:700;letter-spacing:1.6px;color:#c2410c">STOCK COUNT VERIFICATION</div><h1 style="margin:10px 0 12px;font-size:28px;line-height:1.25;color:#101828">Verify Stock Count Posting</h1><p style="margin:0;color:#475467;line-height:1.65">A request was made to post a Stock Count that will update inventory balances. Review the adjustment details below before providing the verification code.</p></td></tr><tr><td style="padding:18px 30px 24px"><table role="presentation" width="100%" style="border-collapse:collapse;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px"><tr><td align="center" style="padding:23px 16px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:#9a3412">Your verification code</div><div aria-label="Verification code ${escapeHtml(code)}" style="margin-top:12px;font-family:Consolas,Monaco,monospace;font-size:36px;line-height:1.2;font-weight:800;letter-spacing:8px;color:#9a3412">${escapeHtml(code)}</div><div style="margin-top:12px;font-size:13px;color:#9a3412">This code is valid for 15 minutes and can only be used once.</div></td></tr></table></td></tr>${highImpactHtml}<tr><td style="padding:0 24px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metric('Total variants counted', formatNumber(input.total_variants_counted), false)}${metric('Variance items', formatNumber(input.variance_items), input.variance_items > 0)}</tr><tr>${metric('Net quantity adjustment', formatSignedNumber(netAdjustment), netAdjustment < 0)}${metric('Estimated adjustment value', formatMoney(estimatedValue), estimatedValue < 0)}</tr></table></td></tr><tr><td style="padding:0 30px 24px"><h2 style="margin:0 0 8px;font-size:18px">Stock Count details</h2><table role="presentation" width="100%" style="border-collapse:collapse">${details}</table></td></tr><tr><td style="padding:0 30px 24px"><h2 style="margin:0 0 8px;font-size:18px">Posting Note</h2><div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#344054;line-height:1.6">${htmlWithLineBreaks(input.notes)}</div></td></tr><tr><td style="padding:0 30px 28px"><table role="presentation" width="100%" style="border-collapse:collapse;background:#fef3f2;border-left:4px solid #d92d20"><tr><td style="padding:16px;color:#912018;line-height:1.55"><strong>Security warning</strong><br>Only provide this code after you have reviewed and approved the Stock Count details above. Do not share it if you do not recognize this request.<br><br>Serapod2U will never ask you to send this code by reply email or disclose it over an unsolicited phone call.</td></tr></table></td></tr><tr><td style="padding:20px 30px;background:#f9fafb;color:#667085;font-size:12px;line-height:1.6">You received this email because you are configured as an authorized recipient for Stock Count posting verification.<br>If you do not recognize this request, do not share the code and contact your system administrator.<br><br><strong style="color:#344054">Serapod2U</strong><br>Automated Inventory Security Notification</td></tr></table></td></tr></table></body></html>`

    const text = `SERAPOD2U — STOCK COUNT VERIFICATION\n\nVerify Stock Count Posting\n\n${PREVIEW_TEXT}\n\nYour verification code: ${code}\nThis code is valid for 15 minutes and can only be used once.\n\n${highImpact ? 'HIGH-IMPACT ADJUSTMENT\nReview the quantities and estimated value carefully before approving this Stock Count.\n\n' : ''}IMPACT SUMMARY\nTotal variants counted: ${formatNumber(input.total_variants_counted)}\nVariance items: ${formatNumber(input.variance_items)}\nNet quantity adjustment: ${formatSignedNumber(netAdjustment)}\nEstimated adjustment value: ${formatMoney(estimatedValue)}\n\nSTOCK COUNT DETAILS\nWarehouse: ${plain(input.warehouse_name)}\nOrganization: ${plain(input.organization_name)}\nCount date: ${plain(input.count_date)}\nCount type: ${countType}\nReference / batch: ${reference}\nRequested by: ${plain(input.requested_by)}\nRequest date and time: ${requestedAt} (Asia/Kuala_Lumpur)\n\nPOSTING NOTE\n${plain(input.notes)}\n\nSECURITY WARNING\nOnly provide this code after you have reviewed and approved the Stock Count details above. Do not share it if you do not recognize this request.\nSerapod2U will never ask you to send this code by reply email or disclose it over an unsolicited phone call.\n\nYou received this email because you are configured as an authorized recipient for Stock Count posting verification. If you do not recognize this request, do not share the code and contact your system administrator.\n\nSerapod2U\nAutomated Inventory Security Notification`

    if (!html.trim() || !text.trim()) throw new Error('Stock Count verification email rendering failed.')
    return { subject, previewText: PREVIEW_TEXT, html, text }
}
