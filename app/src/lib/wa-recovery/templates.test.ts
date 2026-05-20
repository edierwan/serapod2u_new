import { describe, expect, it } from 'vitest'

import { buildRecoveryMessage } from '@/lib/wa-recovery/templates'

describe('wa-recovery template composition', () => {
    it('builds a registration recovery message with recipient name and timestamp', () => {
        const result = buildRecoveryMessage({
            failedPurpose: 'registration_otp_send_failed',
            failedAt: '2026-05-13T12:19:00.000Z',
            recipientName: 'Ahmad Faiz',
        })

        expect(result.template.key).toBe('registration_recovery')
        expect(result.body).toContain('Hi Ahmad Faiz,')
        expect(result.body).toContain('you tried to register with Serapod2U')
        expect(result.body).toContain('The service has now been restored. You may try registering again.')
        expect(result.body).toContain('Sorry for the inconvenience caused.')
    })

    it('falls back to a safe greeting when the contact name is unknown', () => {
        const result = buildRecoveryMessage({
            failedPurpose: 'password_reset_otp_send_failed',
            failedAt: '2026-05-13T12:19:00.000Z',
            recipientName: '',
        })

        expect(result.template.key).toBe('password_reset_recovery')
        expect(result.body.startsWith('Hi there,')).toBe(true)
        expect(result.body).not.toContain('Hi ,')
    })

    it('uses the general restored template when there is no purpose match', () => {
        const result = buildRecoveryMessage({
            failedPurpose: 'some_other_failure',
            recipientName: null,
        })

        expect(result.template.key).toBe('recovery_notice')
        expect(result.body).toContain('Our WhatsApp notification service has now been restored.')
    })
})