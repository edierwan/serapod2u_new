import { describe, expect, it, vi } from 'vitest'
import { refundStripeCheckout } from './stripe-refund'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const base = { sessionId: 'cs_live_abc', secretKey: 'sk_live_x', orderId: 'order-1', orderRef: 'ORD-1' }

describe('refundStripeCheckout', () => {
  it('refunds the payment intent behind a paid Checkout Session', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { payment_status: 'paid', payment_intent: 'pi_123' }))
      .mockResolvedValueOnce(json(200, { id: 're_1', amount: 200 }))
    const result = await refundStripeCheckout({ ...base, fetchImpl })
    expect(result).toEqual({ ok: true, refundId: 're_1', amountCents: 200, alreadyRefunded: false })
    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('https://api.stripe.com/v1/refunds')
    const body = new URLSearchParams(init.body)
    expect(body.get('payment_intent')).toBe('pi_123')
    expect(body.get('metadata[order_ref]')).toBe('ORD-1')
    expect(body.has('amount')).toBe(false)
  })

  it('treats an already refunded payment as done instead of failing', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { payment_status: 'paid', payment_intent: 'pi_123' }))
      .mockResolvedValueOnce(json(400, { error: { code: 'charge_already_refunded', message: 'already refunded' } }))
    const result = await refundStripeCheckout({ ...base, fetchImpl })
    expect(result).toEqual({ ok: true, refundId: null, amountCents: null, alreadyRefunded: true })
  })

  it('refuses when Stripe holds no completed payment', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, { payment_status: 'unpaid', payment_intent: null }))
    const result = await refundStripeCheckout({ ...base, fetchImpl })
    expect(result.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('passes on the reason Stripe gives for a refused refund', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { payment_status: 'paid', payment_intent: 'pi_123' }))
      .mockResolvedValueOnce(json(400, { error: { code: 'balance_insufficient', message: 'Insufficient balance' } }))
    const result = await refundStripeCheckout({ ...base, fetchImpl })
    expect(result).toEqual({ ok: false, error: 'Insufficient balance' })
  })

  it('never calls Stripe without a Checkout Session id or key', async () => {
    const fetchImpl = vi.fn()
    expect((await refundStripeCheckout({ ...base, sessionId: 'bill_1', fetchImpl })).ok).toBe(false)
    expect((await refundStripeCheckout({ ...base, secretKey: '', fetchImpl })).ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
