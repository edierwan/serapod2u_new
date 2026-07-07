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

/** Org types that manage the full return flow (everyone except plain SHOP users). */
export function isReturnManagerOrgType(orgTypeCode?: string | null): boolean {
    const t = (orgTypeCode || '').trim().toUpperCase()
    return t !== '' && t !== 'SHOP'
}
