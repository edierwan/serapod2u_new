export type StripeRefundResult =
  | { ok: true; refundId: string | null; amountCents: number | null; alreadyRefunded: boolean }
  | { ok: false; error: string }

async function stripeError(res: Response) {
  const body = await res.json().catch(() => null)
  return {
    code: String(body?.error?.code || ''),
    message: String(body?.error?.message || `Stripe answered ${res.status}`),
  }
}

/**
 * Returns the full payment of a Checkout Session to the customer. Stripe never refunds
 * more than was charged, so a repeated call reports `alreadyRefunded` instead of paying twice.
 */
export async function refundStripeCheckout(input: {
  sessionId: string
  secretKey: string
  orderId: string
  orderRef: string
  fetchImpl?: typeof fetch
}): Promise<StripeRefundResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  if (!/^cs_[A-Za-z0-9_]+$/.test(input.sessionId)) return { ok: false, error: 'This order has no Stripe payment reference' }
  if (!input.secretKey) return { ok: false, error: 'Stripe is not configured' }
  const auth = { Authorization: `Bearer ${input.secretKey}` }

  try {
    const sessionRes = await fetchImpl(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(input.sessionId)}`,
      { headers: auth, cache: 'no-store' },
    )
    if (!sessionRes.ok) return { ok: false, error: (await stripeError(sessionRes)).message }
    const session = await sessionRes.json()
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    if (session.payment_status !== 'paid' || !paymentIntent) {
      return { ok: false, error: 'Stripe has no completed payment for this order' }
    }

    const refundRes = await fetchImpl('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        payment_intent: paymentIntent,
        reason: 'requested_by_customer',
        'metadata[order_id]': input.orderId,
        'metadata[order_ref]': input.orderRef,
      }).toString(),
      cache: 'no-store',
    })
    if (!refundRes.ok) {
      const err = await stripeError(refundRes)
      if (err.code === 'charge_already_refunded') return { ok: true, refundId: null, amountCents: null, alreadyRefunded: true }
      return { ok: false, error: err.message }
    }
    const refund = await refundRes.json()
    return {
      ok: true,
      refundId: typeof refund.id === 'string' ? refund.id : null,
      amountCents: typeof refund.amount === 'number' ? refund.amount : null,
      alreadyRefunded: false,
    }
  } catch (err) {
    console.error('[stripe-refund] failed for', input.orderRef, err)
    return { ok: false, error: 'Could not reach Stripe' }
  }
}
