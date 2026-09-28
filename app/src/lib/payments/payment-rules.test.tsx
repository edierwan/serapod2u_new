import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { paymentResultFromStatuses } from '@/lib/payments/apply-callback'
import { stripeEventOutcome } from '@/lib/payments/providers/stripe-webhook'

describe('payment result rules', () => {
  it('only marks waiting or failed orders as paid', () => {
    expect(paymentResultFromStatuses(true)).toEqual(['pending_payment', 'payment_failed'])
    expect(paymentResultFromStatuses(true)).not.toContain('shipped')
    expect(paymentResultFromStatuses(true)).not.toContain('delivered')
  })

  it('never turns a paid order into failed', () => {
    expect(paymentResultFromStatuses(false)).toEqual(['pending_payment'])
  })
})

describe('stripe checkout events', () => {
  it('treats a completed and paid session as paid', () => {
    expect(stripeEventOutcome('checkout.session.completed', 'paid')).toBe('paid')
  })

  it('keeps a completed but unpaid session (delayed method) pending', () => {
    expect(stripeEventOutcome('checkout.session.completed', 'unpaid')).toBe('ignore')
  })

  it('follows delayed payment results and expiry', () => {
    expect(stripeEventOutcome('checkout.session.async_payment_succeeded', 'paid')).toBe('paid')
    expect(stripeEventOutcome('checkout.session.async_payment_failed', 'unpaid')).toBe('failed')
    expect(stripeEventOutcome('checkout.session.expired', 'unpaid')).toBe('failed')
  })

  it('ignores unrelated events', () => {
    expect(stripeEventOutcome('payment_intent.created', '')).toBe('ignore')
  })
})
