/**
 * Return Product module — shared status flow constants.
 *
 * Warehouse/support-driven return flow (NOT an HQ approval flow):
 *
 *   return_draft -> return_submitted -> return_received
 *                -> return_processing -> return_completed
 *
 * return_cancelled is an optional terminal state reachable before completion.
 */

export const RETURN_STATUSES = [
    'return_draft',
    'return_submitted',
    'return_received',
    'return_processing',
    'return_completed',
] as const

export type ReturnStatus = (typeof RETURN_STATUSES)[number] | 'return_cancelled'

/** Ordered statuses shown in the progress stepper / timeline. */
export const RETURN_STEPPER_STATUSES: ReturnStatus[] = [...RETURN_STATUSES]

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
    return_draft: 'Return Draft',
    return_submitted: 'Return Submitted',
    return_received: 'Return Received',
    return_processing: 'Return Processing',
    return_completed: 'Return Completed',
    return_cancelled: 'Return Cancelled',
}

/** Next status for the primary action button. */
export const RETURN_NEXT_STATUS: Partial<Record<ReturnStatus, ReturnStatus>> = {
    return_draft: 'return_submitted',
    return_submitted: 'return_received',
    return_received: 'return_processing',
    return_processing: 'return_completed',
}

/** Label of the primary action button for the current status. */
export const RETURN_NEXT_ACTION_LABEL: Partial<Record<ReturnStatus, string>> = {
    return_draft: 'Submit Return',
    return_submitted: 'Mark Return Received',
    return_received: 'Start Processing',
    return_processing: 'Complete Return',
}

/** Timestamp column that records when a case entered each status. */
export const RETURN_STATUS_TIMESTAMP_COLUMN: Record<ReturnStatus, string | null> = {
    return_draft: 'created_at',
    return_submitted: 'submitted_at',
    return_received: 'received_at',
    return_processing: 'processing_started_at',
    return_completed: 'completed_at',
    return_cancelled: 'cancelled_at',
}

export function isTerminalStatus(status: ReturnStatus): boolean {
    return status === 'return_completed' || status === 'return_cancelled'
}

/**
 * Return Product source — a return may originate from a Shop or a Distributor.
 * These are the primary source-of-truth values persisted on
 * return_cases.return_source_type (shop_org_id is a legacy compat column).
 */
export const RETURN_SOURCE_TYPES = ['shop', 'distributor'] as const
export type ReturnSourceType = (typeof RETURN_SOURCE_TYPES)[number]

export const RETURN_SOURCE_LABELS: Record<ReturnSourceType, string> = {
    shop: 'Shop',
    distributor: 'Distributor',
}

/** organizations.org_type_code that a given source type must reference. */
export const RETURN_SOURCE_ORG_TYPE_CODE: Record<ReturnSourceType, string> = {
    shop: 'SHOP',
    distributor: 'DIST',
}

export function isReturnSourceType(value: unknown): value is ReturnSourceType {
    return value === 'shop' || value === 'distributor'
}

/** Normalize an untrusted value to a ReturnSourceType, defaulting to 'shop'. */
export function normalizeReturnSourceType(value: unknown): ReturnSourceType {
    return isReturnSourceType(value) ? value : 'shop'
}

/** Map an organization type code back to its return source type (or null). */
export function sourceTypeForOrgTypeCode(orgTypeCode?: string | null): ReturnSourceType | null {
    const t = (orgTypeCode || '').trim().toUpperCase()
    if (t === 'SHOP') return 'shop'
    if (t === 'DIST') return 'distributor'
    return null
}

/** Index of the status in the 5-step flow (cancelled → -1). */
export function returnStatusIndex(status: ReturnStatus): number {
    return (RETURN_STATUSES as readonly string[]).indexOf(status)
}

/**
 * Only warehouse/support/admin/HQ users may advance a case beyond
 * "Return Submitted". A shop user may only take a Draft to Submitted.
 */
export function canAdvanceStatus(
    current: ReturnStatus,
    isManager: boolean,
): boolean {
    if (!RETURN_NEXT_STATUS[current]) return false
    if (isManager) return true
    // Shop users: Draft -> Submitted only.
    return current === 'return_draft'
}

/** Warehouse Processing block is only relevant once items are physically received. */
export function showsWarehouseProcessing(status: ReturnStatus): boolean {
    return (
        status === 'return_received' ||
        status === 'return_processing' ||
        status === 'return_completed'
    )
}

export const DEFAULT_RETURN_REASONS = [
    { code: 'defective', label: 'Defective' },
    { code: 'damaged', label: 'Damaged' },
    { code: 'wrong_item', label: 'Wrong Item' },
    { code: 'expired', label: 'Expired' },
    { code: 'leaking', label: 'Leaking' },
    { code: 'customer_complaint', label: 'Customer Complaint' },
    { code: 'other', label: 'Other' },
]

export const DEFAULT_RETURN_CONDITIONS = [
    { code: 'unopened', label: 'Unopened' },
    { code: 'opened', label: 'Opened' },
    { code: 'damaged_packaging', label: 'Damaged Packaging' },
    { code: 'missing_item', label: 'Missing Item' },
    { code: 'not_sellable', label: 'Not Sellable' },
]

/**
 * Phase 1 loyalty-program to product-category mapping for Return Product.
 * Program code is preferred, while the display name supports memberships where
 * the code is absent or differs. Unknown programs deliberately remain unresolved.
 */
export function categoryNameForProgram(
    programCode?: string | null,
    programName?: string | null,
): string | null {
    const values = [programCode, programName]
        .map((value) => (value || '').trim().toLowerCase())
        .filter(Boolean)

    if (values.some((value) => value === 'cellera' || value === 'cellera loyalty')) return 'Vape'
    if (values.some((value) => value === 'ellbow')) return 'Pet Food'
    return null
}

export interface ReturnQtyResult {
    case_qty: number
    loose_piece_qty: number
    total_units: number
    units_per_case: number
}

/**
 * Compute Total Pcs from the physical Full Case + Loose Pcs breakdown WITHOUT
 * normalizing (no carry). Both values are preserved as entered:
 *
 *   Total Pcs = (Full Case × Units per Case) + Loose Pcs
 *
 * Loose Pcs may legitimately equal or exceed Units per Case and stays recorded
 * as loose — it is NOT rolled into a case. Quantities are clamped to non-negative
 * integers; a non-positive Units per Case falls back to 1.
 */
export function computeReturnTotal(
    caseQty: number,
    looseQty: number,
    unitsPerCase: number | null | undefined,
): ReturnQtyResult {
    const upc = Number(unitsPerCase)
    const perCase = Number.isFinite(upc) && upc > 0 ? Math.floor(upc) : 1
    const c = Math.max(0, Math.floor(Number(caseQty) || 0))
    const l = Math.max(0, Math.floor(Number(looseQty) || 0))
    return {
        case_qty: c,
        loose_piece_qty: l,
        total_units: c * perCase + l,
        units_per_case: perCase,
    }
}

/** Org types that manage the full return flow (everyone except plain SHOP users). */
export function isReturnManagerOrgType(orgTypeCode?: string | null): boolean {
    const t = (orgTypeCode || '').trim().toUpperCase()
    return t !== '' && t !== 'SHOP'
}
