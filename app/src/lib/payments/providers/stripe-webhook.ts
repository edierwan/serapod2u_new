import { createHmac, timingSafeEqual } from 'crypto'
import type { PaymentCallbackResult } from '../types'

const TIMESTAMP_TOLERANCE_SEC = 300

export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const items = signatureHeader.split(',').map((part) => {
    const eq = part.indexOf('=')
    return eq === -1 ? ['', ''] : [part.slice(0, eq).trim(), part.slice(eq + 1).trim()]
  })
  const timestamp = items.find(([k]) => k === 't')?.[1]
  const v1 = items.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!timestamp || v1.length === 0) {
    throw new Error('Invalid Stripe-Signature header')
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_SEC) {
    throw new Error('Stripe webhook timestamp too old')
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const matched = v1.some((sig) => {
    const got = Buffer.from(sig, 'utf8')
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)
  })
  if (!matched) throw new Error('Stripe webhook signature mismatch')
}

/**
 * What a Checkout Session event means for the order.
 * `completed` + unpaid is a delayed method (e.g. FPX) that is still pending, not a failure.
 */
export function stripeEventOutcome(type: string, paymentStatus: string): 'paid' | 'failed' | 'ignore' {
  if (type === 'checkout.session.completed') return paymentStatus === 'paid' ? 'paid' : 'ignore'
  if (type === 'checkout.session.async_payment_succeeded') return 'paid'
  if (type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired') return 'failed'
  return 'ignore'
}

/** Reads the Checkout Session straight from Stripe, so its status can be trusted. */
export async function fetchStripeCheckoutSession(sessionId: string, secretKey: string): Promise<any | null> {
  if (!sessionId || !secretKey || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[stripe] session lookup failed:', res.status)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error('[stripe] session lookup error:', err)
    return null
  }
}

async function orderIdForSession(session: any) {
  const fromMeta = String(session?.metadata?.order_id || '')
  if (fromMeta) return fromMeta
  const orderRef = String(session?.client_reference_id || session?.metadata?.order_ref || '')
  if (!orderRef) return ''
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase: any = createAdminClient()
  const { data: order } = await supabase
    .from('storefront_orders')
    .select('id')
    .eq('order_ref', orderRef)
    .maybeSingle()
  return order?.id || ''
}

/** Payment result for a customer returning from Stripe with ?session_id=. */
export async function stripeReturnResult(
  sessionId: string,
  credentials: Record<string, string>,
): Promise<PaymentCallbackResult> {
  const session = await fetchStripeCheckoutSession(sessionId, credentials.secret_key || '')
  if (!session) return { verified: false, orderId: '', paid: false, error: 'Stripe session not found' }
  if (session.payment_status !== 'paid') return { verified: true, orderId: '', paid: false, transactionId: session.id }
  return { verified: true, orderId: await orderIdForSession(session), paid: true, transactionId: session.id }
}

export async function handleStripeCheckoutWebhook(
  rawBody: string,
  signatureHeader: string | null,
  credentials: Record<string, string>,
): Promise<PaymentCallbackResult> {
  const secret = credentials.webhook_secret
  if (secret) {
    if (!signatureHeader) {
      return { verified: false, orderId: '', paid: false, error: 'Missing Stripe-Signature header' }
    }
    try {
      verifyStripeSignature(rawBody, signatureHeader, secret)
    } catch (err: any) {
      return { verified: false, orderId: '', paid: false, error: err.message || 'Invalid Stripe signature' }
    }
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return { verified: false, orderId: '', paid: false, error: 'Invalid Stripe JSON' }
  }

  const type = String(event?.type || '')
  let session = event?.data?.object || {}
  const sessionId = String(session.id || '')

  // Without a signing secret the event body cannot be trusted: read the session from Stripe instead.
  if (!secret) {
    const fetched = await fetchStripeCheckoutSession(sessionId, credentials.secret_key || '')
    if (!fetched) {
      return { verified: false, orderId: '', paid: false, error: 'Stripe webhook not verifiable (no webhook_secret, session lookup failed)' }
    }
    session = fetched
  }

  const outcome = secret
    ? stripeEventOutcome(type, String(session.payment_status || ''))
    : session.payment_status === 'paid'
      ? 'paid'
      : session.status === 'expired'
        ? 'failed'
        : 'ignore'
  if (outcome === 'ignore') {
    return { verified: true, orderId: '', paid: false, transactionId: sessionId }
  }

  return {
    verified: true,
    orderId: await orderIdForSession(session),
    paid: outcome === 'paid',
    transactionId: sessionId,
  }
}
