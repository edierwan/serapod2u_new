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
    | 'invalid_or_expired_code'
    | 'unexpected_error'

export interface StockCountVerificationFriendlyError {
    code: StockCountVerificationErrorCode
    message: string
    status: number
    guidance?: string
    recoverable: boolean
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
    email_delivery_failed: { message: 'The verification email could not be sent. Please check the email provider configuration and try again.', status: 502, recoverable: true },
    request_rate_limited: { message: 'Too many verification requests. Please try again later.', status: 429, recoverable: true },
    resend_cooldown: { message: 'Please wait 60 seconds before requesting another code.', status: 429, recoverable: true },
    snapshot_changed: { message: 'This Stock Count changed after the verification code was requested. Review it and request a new code.', status: 409, recoverable: true },
    invalid_or_expired_code: { message: 'The verification code is invalid or has expired. Request a new code.', status: 400, recoverable: true },
    unexpected_error: { message: 'We couldn’t request the verification code due to an unexpected error. Please try again or contact your administrator.', status: 500, recoverable: true },
}

export function stockCountVerificationError(code: StockCountVerificationErrorCode): StockCountVerificationFriendlyError {
    return { code, ...ERRORS[code] }
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

export function mapStockCountDatabaseError(message: string): StockCountVerificationFriendlyError {
    const mappings: Array<[string, StockCountVerificationErrorCode]> = [
        ['permission_lost', 'permission_denied'],
        ['stock_count_already_posted', 'already_posted'],
        ['stock_count_snapshot_changed', 'snapshot_changed'],
        ['verification_code_expired', 'invalid_or_expired_code'],
        ['invalid_verification_code', 'invalid_or_expired_code'],
        ['resend_cooldown', 'resend_cooldown'],
        ['request_rate_limited', 'request_rate_limited'],
        ['posting_note_required', 'posting_note_required'],
        ['no_counted_variants', 'invalid_count_data'],
        ['stock_count_config_identity_missing', 'configuration_identity_missing'],
        ['stock_count_base_cost_missing', 'base_cost_missing'],
    ]
    const match = mappings.find(([needle]) => message.includes(needle))
    return stockCountVerificationError(match?.[1] || 'unexpected_error')
}
