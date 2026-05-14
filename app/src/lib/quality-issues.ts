export type QualityIssueWorkflowStatus =
    | 'draft'
    | 'pending'
    | 'pending_manufacturer'
    | 'acknowledged'
    | 'resolved'
    | 'rejected'

export interface QualityIssueStatusLike {
    status?: string | null
    manufacturer_status?: string | null
}

export const QUALITY_ISSUE_TEMPLATE_VARIABLES = [
    'manufacturer_name',
    'product_name',
    'variant_name',
    'sku',
    'variant_or_sku',
    'issue_type',
    'quantity_affected',
    'reported_by',
    'notes',
    'issue_no',
    'issue_link',
] as const

export const DEFAULT_MANUFACTURER_ISSUE_TEMPLATE = `Hello {{manufacturer_name}},

A product issue has been reported in Serapod2U.

Product: {{product_name}}
Variant/SKU: {{variant_or_sku}}
Issue Type: {{issue_type}}
Quantity Affected: {{quantity_affected}}
Reported By: {{reported_by}}
Notes: {{notes}}

Please login to Serapod2U to acknowledge and review this issue:
{{issue_link}}

Thank you.`

export function normalizeManufacturerWorkflowStatus(status?: string | null): QualityIssueWorkflowStatus {
    switch (status) {
        case 'pending':
            return 'pending_manufacturer'
        case 'draft':
        case 'pending_manufacturer':
        case 'acknowledged':
        case 'resolved':
        case 'rejected':
            return status
        default:
            return 'draft'
    }
}

export function getIssueDisplayStatus(issue: QualityIssueStatusLike): QualityIssueWorkflowStatus {
    if (issue.status === 'resolved') return 'resolved'
    if (issue.status === 'rejected' || issue.manufacturer_status === 'rejected') return 'rejected'

    const workflowStatus = normalizeManufacturerWorkflowStatus(issue.manufacturer_status)
    if (workflowStatus === 'acknowledged') return 'acknowledged'
    if (workflowStatus === 'pending_manufacturer') return 'pending_manufacturer'
    return 'draft'
}

export function getIssueTypeLabel(reasonCode?: string | null) {
    if (reasonCode === 'quality_issue') return 'Quality Issue'
    if (reasonCode === 'return_to_supplier') return 'Return to Supplier'
    if (reasonCode === 'damaged_goods') return 'Damaged Goods'
    return reasonCode || 'Issue'
}

export function getVariantOrSkuLabel(params: {
    variantName?: string | null
    sku?: string | null
}) {
    if (params.variantName && params.sku) return `${params.variantName} / ${params.sku}`
    return params.variantName || params.sku || '—'
}

export function renderQualityIssueTemplate(
    body: string,
    vars: Record<string, string | number | null | undefined>,
) {
    return body
        .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? ''))
        .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_match, key) => String(vars[key] ?? ''))
}

export function getEvidenceFileName(url: string) {
    try {
        const parsed = new URL(url)
        const last = parsed.pathname.split('/').filter(Boolean).pop()
        return decodeURIComponent(last || 'attachment')
    } catch {
        return decodeURIComponent(url.split('/').filter(Boolean).pop() || 'attachment')
    }
}

export function isImageEvidenceUrl(url: string) {
    const lower = url.split('?')[0].toLowerCase()
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)
}