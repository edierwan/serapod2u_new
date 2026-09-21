// ── Billplz Adapter ────────────────────────────────────────────────
// Docs: https://www.billplz.com/api
// Flow: Create Bill → shopper pays on Billplz → callback + redirect

import type { PaymentProviderAdapter, PaymentIntentInput, PaymentIntentResult, PaymentCallbackResult } from '../types'
import { flattenPaymentParams, verifyBillplzSignature } from './billplz-signature'

const SANDBOX_URL = 'https://www.billplz-sandbox.com'
const PRODUCTION_URL = 'https://www.billplz.com'

function baseUrl(credentials: Record<string, string>) {
  return credentials.environment === 'production' ? PRODUCTION_URL : SANDBOX_URL
}

function isPaidFlag(value: unknown) {
  return value === true || value === 'true' || value === '1'
}

export const billplz: PaymentProviderAdapter = {
  name: 'Billplz',

  async createPayment(input: PaymentIntentInput, credentials: Record<string, string>): Promise<PaymentIntentResult> {
    const apiUrl = baseUrl(credentials)
    const apiKey = credentials.api_key
    const collectionId = credentials.collection_id

    if (!apiKey || !collectionId) {
      return { success: false, provider: 'billplz', error: 'Billplz credentials missing (api_key, collection_id)' }
    }

    const body = new URLSearchParams({
      collection_id: collectionId,
      email: input.customerEmail,
      name: input.customerName || input.customerEmail.split('@')[0],
      amount: String(Math.round(input.amount * 100)),
      description: input.description.slice(0, 200),
      callback_url: `${input.callbackUrl}?provider=billplz`,
      redirect_url: input.returnUrl,
      reference_1_label: 'Order Ref',
      reference_1: input.orderRef,
    })

    if (input.customerPhone) {
      body.append('mobile', input.customerPhone)
    }

    try {
      const res = await fetch(`${apiUrl}/api/v3/bills`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      if (!res.ok) {
        const errBody = await res.text()
        console.error('[billplz] createBill error:', errBody)
        return { success: false, provider: 'billplz', error: `Billplz API ${res.status}: ${errBody}` }
      }

      const bill = await res.json()

      return {
        success: true,
        provider: 'billplz',
        paymentRef: bill.id,
        paymentUrl: bill.url,
      }
    } catch (err: any) {
      console.error('[billplz] API error:', err)
      return { success: false, provider: 'billplz', error: err.message }
    }
  },

  async verifyCallback(payload: Record<string, string>, credentials: Record<string, string>): Promise<PaymentCallbackResult> {
    const flat = flattenPaymentParams(payload)
    const billId = flat.id || flat.billplz_id || ''
    const paidRaw = flat.paid || ''
    const orderRef = flat.reference_1 || ''
    const xKey = credentials.x_signature_key || ''

    if (xKey) {
      const signed = verifyBillplzSignature(flat, xKey)
      if (!signed) {
        return { verified: false, orderId: '', paid: false, error: 'Invalid Billplz X-Signature' }
      }
    }

    let paid = isPaidFlag(paidRaw)
    const apiKey = credentials.api_key
    if (apiKey && billId && !xKey) {
      try {
        const apiUrl = baseUrl(credentials)
        const res = await fetch(`${apiUrl}/api/v3/bills/${billId}`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          },
        })
        if (res.ok) {
          const bill = await res.json()
          paid = isPaidFlag(bill.paid)
        }
      } catch {
        // keep payload paid flag
      }
    }

    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase: any = createAdminClient()
    let orderId = ''
    if (orderRef) {
      const { data: byRef } = await supabase
        .from('storefront_orders')
        .select('id')
        .eq('order_ref', orderRef)
        .maybeSingle()
      orderId = byRef?.id || ''
    }
    if (!orderId && billId) {
      const { data: byBill } = await supabase
        .from('storefront_orders')
        .select('id')
        .eq('payment_ref', billId)
        .maybeSingle()
      orderId = byBill?.id || ''
    }

    return {
      verified: true,
      orderId,
      paid,
      transactionId: billId || flat.transaction_id,
    }
  },
}
