import { describe, expect, it } from 'vitest'
import { passwordResetEventAlreadyLogged } from '@/lib/notifications/emailActivity'

const event = {
  event_type: 'password_reset_otp_sent',
  recipient_email: 'Buyer@Example.com',
  created_at: '2026-10-02T03:00:00.000Z',
}

const log = {
  event_code: 'password_reset_otp',
  recipient_value: 'buyer@example.com',
  created_at: '2026-10-02T03:00:01.200Z',
}

describe('passwordResetEventAlreadyLogged', () => {
  it('hides the audit copy of a reset email that has a delivery log row', () => {
    expect(passwordResetEventAlreadyLogged(event, [log])).toBe(true)
    expect(passwordResetEventAlreadyLogged({ ...event, event_type: 'password_reset_otp_resend_sent' }, [log])).toBe(true)
  })

  it('keeps older reset emails that were never written to the delivery log', () => {
    expect(passwordResetEventAlreadyLogged(event, [])).toBe(false)
    expect(passwordResetEventAlreadyLogged(event, [{ ...log, created_at: '2026-10-02T03:10:00.000Z' }])).toBe(false)
  })

  it('does not match a different recipient or event', () => {
    expect(passwordResetEventAlreadyLogged(event, [{ ...log, recipient_value: 'other@example.com' }])).toBe(false)
    expect(passwordResetEventAlreadyLogged(event, [{ ...log, event_code: 'order_confirmed' }])).toBe(false)
  })

  it('never hides other OTP emails', () => {
    expect(passwordResetEventAlreadyLogged({ ...event, event_type: 'registration_otp_sent' }, [log])).toBe(false)
    expect(passwordResetEventAlreadyLogged({ ...event, event_type: 'shop_contact_otp_sent' }, [log])).toBe(false)
  })
})
