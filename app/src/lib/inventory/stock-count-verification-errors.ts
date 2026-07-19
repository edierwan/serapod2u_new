export const STOCK_COUNT_POST_PERMISSION = 'post_stock_count'
export const STOCK_COUNT_EVENT_CODE = 'stock_count_posting_verification'
export const STOCK_COUNT_CONFIG_GUIDANCE = 'Configure this under Notifications → Notification Types → Inventory & Stock → Stock Count Posting Verification.'

export type StockCountVerificationErrorCode =
    | 'authentication_required'
    | 'stock_count_access_denied'
    | 'permission_denied'
    | 'stock_count_not_found'
    | 'already_posted'
    | 'invalid_count_data'
    | 'configuration_identity_missing'
    | 'base_cost_missing'
    | 'posting_note_required'
    | 'notification_event_missing'
    | 'notification_setting_missing'
    | 'notification_event_disabled'
    | 'no_authorized_recipients'
    | 'recipient_emails_invalid'
    | 'email_provider_missing'
    | 'email_provider_unavailable'
    | 'email_delivery_failed'
    | 'request_rate_limited'
    | 'resend_cooldown'
    | 'snapshot_changed'
    | 'invalid_code'
    | 'expired_code'
    | 'code_already_used'
    /** @deprecated Prefer invalid_code / expired_code / code_already_used */
    | 'invalid_or_expired_code'
    | 'classification_incomplete'
    | 'classification_legacy_not_cleared'
    | 'full_count_on_unclassified'
    | 'wrong_posting_function'
    | 'posting_function_unavailable'
    | 'posting_timeout'
    | 'posting_conflict'
    | 'unexpected_error'

export type StockCountVerificationErrorStage = 'preflight' | 'request' | 'verify' | 'post'

export interface StockCountVerificationFriendlyError {
    code: StockCountVerificationErrorCode
    message: string
    status: number
    guidance?: string
    recoverable: boolean
    reference?: string
    stage?: StockCountVerificationErrorStage
}

const ERRORS: Record<StockCountVerificationErrorCode, Omit<StockCountVerificationFriendlyError, 'code'>> = {
    authentication_required: { message: 'Your session has expired. Please sign in again.', status: 401, recoverable: false },
    stock_count_access_denied: { message: 'You do not have access to this Stock Count organization.', status: 403, recoverable: false },
    permission_denied: { message: 'You do not have permission to request or post this Stock Count. Please contact your administrator.', status: 403, recoverable: false },
    stock_count_not_found: { message: 'This Stock Count could not be found.', status: 404, recoverable: false },
    already_posted: { message: 'This Stock Count has already been posted.', status: 409, recoverable: false },
    invalid_count_data: { message: 'This Stock Count does not contain valid counted quantities.', status: 400, recoverable: true },
    configuration_identity_missing: { message: 'This Stock Count uses a legacy variant-only draft and cannot be posted safely. Start a new configuration-aware Stock Count.', status: 409, recoverable: true },
    base_cost_missing: { message: 'Every variance item must have a Variant Base Cost before this Stock Count can be posted.', status: 409, recoverable: true },
    posting_note_required: { message: 'A Posting Note is required when the Stock Count contains variance.', status: 400, recoverable: true },
    notification_event_missing: { message: 'Stock Count verification is not available because its notification configuration has not been installed. Please contact your system administrator.', status: 503, guidance: STOCK_COUNT_CONFIG_GUIDANCE, recoverable: true },
    notification_setting_missing: { message: 'Stock Count verification has not been configured for this organization. Please contact your system administrator.', status: 503, guidance: STOCK_COUNT_CONFIG_GUIDANCE, recoverable: true },
    notification_event_disabled: { message: 'Stock Count Posting Verification is disabled. Enable it under Notification Types → Inventory & Stock.', status: 409, guidance: STOCK_COUNT_CONFIG_GUIDANCE, recoverable: true },
    no_authorized_recipients: { message: 'No authorized email recipients are configured. Add Specific Users or Manual Email Addresses under Stock Count Posting Verification.', status: 409, guidance: STOCK_COUNT_CONFIG_GUIDANCE, recoverable: true },
    recipient_emails_invalid: { message: 'The configured recipients do not have valid email addresses. Update their email details or add a Manual Email Address.', status: 409, guidance: STOCK_COUNT_CONFIG_GUIDANCE, recoverable: true },
    email_provider_missing: { message: 'No active email provider is configured. Configure and enable an email provider before requesting a verification code.', status: 409, recoverable: true },
    email_provider_unavailable: { message: 'The configured email provider is unavailable. Check its configuration and try again.', status: 409, recoverable: true },
    email_delivery_failed: { message: 'Verification code was generated, but the email could not be sent. Please resend or contact your administrator.', status: 502, recoverable: true },
    request_rate_limited: { message: 'Too many verification requests. Please try again later.', status: 429, recoverable: true },
    resend_cooldown: { message: 'Please wait 60 seconds before requesting another code.', status: 429, recoverable: true },
    snapshot_changed: { message: 'This Stock Count changed after the verification code was requested. Review it and request a new code.', status: 409, recoverable: true },
    invalid_code: { message: 'The verification code is incorrect. Please check the code and try again.', status: 400, recoverable: true },
    expired_code: { message: 'The verification code has expired. Please request a new code.', status: 400, recoverable: true },
    code_already_used: { message: 'This verification code has already been used. Please request a new code.', status: 409, recoverable: true },
    invalid_or_expired_code: { message: 'The verification code is incorrect. Please check the code and try again.', status: 400, recoverable: true },
    classification_incomplete: { message: 'Enter a physical count for all three target configurations (20ml New Box, 50ml New Box, 50ml Old Box) before posting this Initial Configuration Classification.', status: 409, recoverable: true },
    classification_legacy_not_cleared: { message: 'The Legacy/Unclassified balance must be fully cleared (counted at 0) before this classification can post.', status: 409, recoverable: true },
    full_count_on_unclassified: { message: 'This variant still has a Legacy/Unclassified balance. Use the “Initial Configuration Classification” count type to move it into 20ml/50ml boxes — an ordinary count would add phantom stock on top of the unclassified balance.', status: 409, recoverable: true },
    wrong_posting_function: { message: 'This Stock Count was posted with the wrong posting function for its count type. Please refresh and try again.', status: 409, recoverable: true },
    posting_function_unavailable: { message: 'Stock Count posting is temporarily unavailable because the classification posting function is not executable. Please contact your administrator (migration 14 grant may be missing).', status: 503, recoverable: true },
    posting_timeout: { message: 'Posting took too long and was safely cancelled — no inventory was changed and your verification code is still valid. Please try posting again. If this keeps happening on a very large count, contact your administrator.', status: 503, recoverable: true },
    posting_conflict: { message: 'This Stock Count could not be posted because its inventory rows are being updated by another operation. No inventory was changed and your verification code is still valid. Please try again in a moment.', status: 409, recoverable: true },
    unexpected_error: { message: 'We couldn’t complete this Stock Count verification step due to an unexpected error. Please try again or contact your administrator.', status: 500, recoverable: true },
}

const STAGE_UNEXPECTED_MESSAGES: Record<StockCountVerificationErrorStage, string> = {
    preflight: 'We couldn’t check Stock Count verification readiness due to an unexpected error. Please try again or contact your administrator.',
    request: 'We couldn’t request the verification code due to an unexpected error. Please try again or contact your administrator.',
    verify: 'We couldn’t verify the code due to an unexpected error. Please try again or contact your administrator.',
    post: 'We couldn’t post the Stock Count due to an unexpected error. Inventory was not changed. Please try again or contact your administrator.',
}

export function createStockCountErrorReference(): string {
    const stamp = Date.now().toString(36).toUpperCase()
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    return `SC-${stamp}-${rand}`
}

export function stockCountVerificationError(
    code: StockCountVerificationErrorCode,
    options: { stage?: StockCountVerificationErrorStage; reference?: string } = {},
): StockCountVerificationFriendlyError {
    const base = { code, ...ERRORS[code] }
    if (code !== 'unexpected_error') {
        return { ...base, stage: options.stage, reference: options.reference }
    }
    const stage = options.stage || 'request'
    const reference = options.reference || createStockCountErrorReference()
    const stageMessage = STAGE_UNEXPECTED_MESSAGES[stage]
    return {
        ...base,
        stage,
        reference,
        message: `${stageMessage} Reference: ${reference}.`,
    }
}

export function stockCountPermissionGate(loading: boolean, allowed: boolean): 'checking' | 'allowed' | 'denied' {
    if (loading) return 'checking'
    return allowed ? 'allowed' : 'denied'
}

export function normalizeStockCountPostingNote(value: unknown): string {
    return String(value ?? '').trim()
}

export function isValidStockCountPostingNote(value: unknown): boolean {
    return normalizeStockCountPostingNote(value).length > 0
}

export function mapStockCountDatabaseError(
    message: string,
    stage: StockCountVerificationErrorStage = 'post',
    sqlState?: string | null,
): StockCountVerificationFriendlyError {
    const normalized = String(message || '')
    const state = String(sqlState || '').trim()

    // SQLSTATE-first: transient cancellations are safe to retry with the same
    // code (the whole post is one transaction, so it rolled back cleanly).
    //   57014 = query_canceled (statement_timeout)
    //   55P03 = lock_not_available (lock_timeout)
    //   40001 = serialization_failure, 40P01 = deadlock_detected
    if (state === '57014') return stockCountVerificationError('posting_timeout', { stage })
    if (state === '55P03' || state === '40001' || state === '40P01') {
        return stockCountVerificationError('posting_conflict', { stage })
    }

    const mappings: Array<[string | RegExp, StockCountVerificationErrorCode]> = [
        [/canceling statement due to statement timeout/i, 'posting_timeout'],
        [/canceling statement due to lock timeout/i, 'posting_conflict'],
        [/deadlock detected/i, 'posting_conflict'],
        ['permission_lost', 'permission_denied'],
        ['stock_count_already_posted', 'already_posted'],
        ['stock_count_snapshot_changed', 'snapshot_changed'],
        ['verification_code_expired', 'expired_code'],
        ['verification_code_already_used', 'code_already_used'],
        ['invalid_verification_code', 'invalid_code'],
        ['resend_cooldown', 'resend_cooldown'],
        ['request_rate_limited', 'request_rate_limited'],
        ['posting_note_required', 'posting_note_required'],
        ['no_counted_variants', 'invalid_count_data'],
        ['stock_count_config_identity_missing', 'configuration_identity_missing'],
        ['stock_count_base_cost_missing', 'base_cost_missing'],
        ['stock_count_classification_incomplete', 'classification_incomplete'],
        ['stock_count_classification_legacy_not_cleared', 'classification_legacy_not_cleared'],
        ['stock_count_full_count_on_unclassified', 'full_count_on_unclassified'],
        ['stock_count_wrong_posting_function', 'wrong_posting_function'],
        [/permission denied for function.*verify_and_post_stock_classification/i, 'posting_function_unavailable'],
        [/could not find the function.*verify_and_post_stock_classification/i, 'posting_function_unavailable'],
        [/stock_movements_reference_type_check/i, 'wrong_posting_function'],
    ]
    const match = mappings.find(([needle]) => (
        typeof needle === 'string' ? normalized.includes(needle) : needle.test(normalized)
    ))
    if (!match) return stockCountVerificationError('unexpected_error', { stage })
    return stockCountVerificationError(match[1], { stage })
}

export function formatStockCountClientError(
    error: Pick<StockCountVerificationFriendlyError, 'message' | 'guidance' | 'reference'>,
): string {
    const parts = [error.message]
    if (error.guidance) parts.push(error.guidance)
    return parts.join(' ')
}
