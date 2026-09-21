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
  const session = event?.data?.object || {}
  const sessionId = String(session.id || '')
  const paymentStatus = String(session.payment_status || '')
  const orderRef = String(session.client_reference_id || session.metadata?.order_ref || '')
  const orderIdFromMeta = String(session.metadata?.order_id || '')

  if (type && type !== 'checkout.session.completed') {
    return { verified: true, orderId: '', paid: false, transactionId: sessionId }
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase: any = createAdminClient()
  let orderId = orderIdFromMeta
  if (!orderId && orderRef) {
    const { data: order } = await supabase
      .from('storefront_orders')
      .select('id')
      .eq('order_ref', orderRef)
      .maybeSingle()
    orderId = order?.id || ''
  }

  return {
    verified: true,
    orderId,
    paid: paymentStatus === 'paid',
    transactionId: sessionId,
  }
}
