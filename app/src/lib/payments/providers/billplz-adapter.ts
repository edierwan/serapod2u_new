// ── Billplz Adapter ────────────────────────────────────────────────
// Docs: https://www.billplz.com/api
// Flow: Create Bill → redirect → callback/return

import type { PaymentProviderAdapter, PaymentIntentInput, PaymentIntentResult, PaymentCallbackResult } from '../types'

const SANDBOX_URL = 'https://www.billplz-sandbox.com'
const PRODUCTION_URL = 'https://www.billplz.com'

function baseUrl(credentials: Record<string, string>) {
  return credentials.environment === 'production' ? PRODUCTION_URL : SANDBOX_URL
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
      amount: String(Math.round(input.amount * 100)), // Billplz expects cents (sen)
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
    // Billplz callback/redirect fields: id, collection_id, paid, state, amount,
    // paid_amount, due_at, email, mobile, name, url, reference_1, reference_2, ...
    const billId = payload.id || payload.billplz_id || ''
    const paidRaw = payload.paid || payload.billplz_paid || ''
    const orderRef = payload.reference_1 || ''

    // Optionally verify by fetching the bill from API
    let apiVerified = true
    const apiKey = credentials.api_key
    if (apiKey && billId) {
      try {
        const apiUrl = baseUrl(credentials)
        const res = await fetch(`${apiUrl}/api/v3/bills/${billId}`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          },
        })
        if (res.ok) {
          const bill = await res.json()
          apiVerified = bill.paid === true || bill.paid === 'true'
        }
      } catch {
        apiVerified = paidRaw === 'true'
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
      paid: (paidRaw === 'true' || paidRaw === '1') && apiVerified,
      transactionId: billId,
    }
  },
}
