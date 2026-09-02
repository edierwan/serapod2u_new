import { describe, expect, it } from 'vitest'
import { emailProviderBlockedByUiTest, emailRowShouldFailForUiTest } from './emailProviderReady'

describe('emailProviderBlockedByUiTest', () => {
    it('blocks send when the Providers UI last test failed', () => {
        expect(emailProviderBlockedByUiTest({ last_test_status: 'failed', last_test_error: 'SMTP timeout' }))
            .toContain('SMTP timeout')
        expect(emailProviderBlockedByUiTest({ last_test_status: 'error' })).toContain('last test failed')
        expect(emailProviderBlockedByUiTest({ last_test_status: 'success' })).toBeNull()
        expect(emailProviderBlockedByUiTest({ last_test_status: null })).toBeNull()
    })

    it('rewrites sent rows from the same session as a failed UI test', () => {
        expect(emailRowShouldFailForUiTest({
            sentAt: '2026-08-31T03:42:01.000Z',
            lastTestAt: '2026-08-31T03:43:55.000Z',
        })).toBe(true)
        expect(emailRowShouldFailForUiTest({
            sentAt: '2026-07-14T04:40:03.000Z',
            lastTestAt: '2026-08-31T03:43:55.000Z',
        })).toBe(false)
        expect(emailRowShouldFailForUiTest({
            sentAt: '2026-08-31T03:42:01.000Z',
            lastTestAt: null,
        })).toBe(false)
    })
})
