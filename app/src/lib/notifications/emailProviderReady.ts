export function emailProviderBlockedByUiTest(config: {
    last_test_status?: string | null
    last_test_error?: string | null
} | null | undefined): string | null {
    const status = String(config?.last_test_status || '').toLowerCase()
    if (status !== 'failed' && status !== 'error' && status !== 'fail') return null
    const detail = String(config?.last_test_error || '').trim()
    return detail
        ? `Email provider last test failed: ${detail}`
        : 'Email provider last test failed. Fix the provider in Notification Providers before sending.'
}

/** Include sends that happened just before the UI test was recorded as failed. */
export const EMAIL_UI_TEST_REWRITE_LOOKBACK_MS = 15 * 60 * 1000

export function emailRowShouldFailForUiTest(opts: {
    createdAt?: string | null
    sentAt?: string | null
    lastTestAt?: string | null
}): boolean {
    if (!opts.lastTestAt) return false
    const testAt = Date.parse(opts.lastTestAt)
    if (!Number.isFinite(testAt)) return false
    const rowAt = Date.parse(opts.sentAt || opts.createdAt || '')
    if (!Number.isFinite(rowAt)) return false
    return rowAt >= testAt - EMAIL_UI_TEST_REWRITE_LOOKBACK_MS
}
