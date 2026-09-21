// ── Stripe Adapter ─────────────────────────────────────────────────
// Docs: https://stripe.com/docs/api
// Flow: Create Checkout Session → redirect → webhook callback

import type { PaymentProviderAdapter, PaymentIntentInput, PaymentIntentResult, PaymentCallbackResult } from '../types'

export const stripe: PaymentProviderAdapter = {
  name: 'Stripe',

  async createPayment(input: PaymentIntentInput, credentials: Record<string, string>): Promise<PaymentIntentResult> {
    const secretKey = credentials.secret_key
    if (!secretKey) {
      return { success: false, provider: 'stripe', error: 'Stripe credentials missing (secret_key)' }
    }

    const params = new URLSearchParams()
    params.append('mode', 'payment')
    params.append('ui_mode', 'hosted_page')
    params.append('billing_address_collection', 'auto')
    params.append('phone_number_collection[enabled]', 'false')
    params.append('automatic_tax[enabled]', 'false')
    params.append('allow_promotion_codes', 'false')
    params.append('submit_type', 'auto')
    params.append('integration_identifier', 'hosted_web_0001')
    params.append('origin_context', 'web')
    params.append('success_url', `${input.returnUrl}?session_id={CHECKOUT_SESSION_ID}`)
    params.append('cancel_url', `${input.returnUrl}?cancelled=true`)
    params.append('client_reference_id', input.orderRef)
    params.append('customer_email', input.customerEmail)
    params.append('line_items[0][price_data][currency]', (input.currency ?? 'myr').toLowerCase())
    params.append('line_items[0][price_data][unit_amount]', String(Math.round(input.amount * 100)))
    params.append('line_items[0][price_data][product_data][name]', input.description.slice(0, 200))
    params.append('line_items[0][quantity]', '1')
    params.append('metadata[order_ref]', input.orderRef)
    params.append('metadata[order_id]', input.orderId)
    params.append('payment_intent_data[metadata][order_ref]', input.orderRef)
    params.append('payment_intent_data[metadata][order_id]', input.orderId)

    try {
      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      if (!res.ok) {
        const errBody = await res.text()
        console.error('[stripe] checkout session error:', errBody)
        return { success: false, provider: 'stripe', error: `Stripe API ${res.status}: ${errBody}` }
      }

      const session = await res.json()

      return {
        success: true,
        provider: 'stripe',
        paymentRef: session.id,
        paymentUrl: session.url,
      }
    } catch (err: any) {
      console.error('[stripe] API error:', err)
      return { success: false, provider: 'stripe', error: err.message }
    }
  },

  async verifyCallback(payload: Record<string, string>, credentials: Record<string, string>): Promise<PaymentCallbackResult> {
    // Stripe sends webhook events — the payload is flattened from the parsed event body
    // Expected fields: type, session_id, payment_status, client_reference_id, metadata.order_ref, etc.
    const eventType = payload.type || ''
    const sessionId = payload.session_id || payload.id || ''
    const paymentStatus = payload.payment_status || ''
    const orderRef = payload.client_reference_id || payload['metadata.order_ref'] || ''

    if (eventType && eventType !== 'checkout.session.completed') {
      return {
        verified: true,
        orderId: '',
        paid: false,
        transactionId: sessionId,
      }
    }

    // Resolve orderId from the external reference
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase: any = createAdminClient()
    const { data: order } = await supabase
      .from('storefront_orders')
      .select('id')
      .eq('order_ref', orderRef)
      .maybeSingle()

    return {
      verified: true,
      orderId: order?.id || '',
      paid: paymentStatus === 'paid',
      transactionId: sessionId,
    }
  },
}
