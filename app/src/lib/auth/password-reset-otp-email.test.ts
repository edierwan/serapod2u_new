import { describe, expect, it } from 'vitest'
import {
    buildPasswordResetOtpEmail,
    isValidEmail,
    maskEmail,
    normalizeEmail,
} from './password-reset-otp-email'

describe('password-reset-otp-email', () => {
    it('normalizes and validates emails', () => {
        expect(normalizeEmail('  Ada@Serapod.com ')).toBe('ada@serapod.com')
        expect(isValidEmail('ada@serapod.com')).toBe(true)
        expect(isValidEmail('not-an-email')).toBe(false)
    })

    it('masks emails for UI copy', () => {
        expect(maskEmail('alice@example.com')).toBe('al***@example.com')
    })

    it('builds a 4-digit OTP email', () => {
        const email = buildPasswordResetOtpEmail({ code: '4832', fullName: 'Alice' })
        expect(email.subject).toContain('password reset code')
        expect(email.text).toContain('4832')
        expect(email.html).toContain('4832')
        expect(email.html).toContain('Hi Alice')
    })

    it('rejects non-4-digit codes', () => {
        expect(() => buildPasswordResetOtpEmail({ code: '12' })).toThrow(/4 digits/)
    })
})
