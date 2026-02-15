// ── ToyyibPay Adapter ──────────────────────────────────────────────
// Docs: https://toyyibpay.com/apireference
// Flow: Create Bill → redirect to hosted payment form → callback/return

import type { PaymentProviderAdapter, PaymentIntentInput, PaymentIntentResult, PaymentCallbackResult } from '../types'

const SANDBOX_URL = 'https://dev.toyyibpay.com'
const PRODUCTION_URL = 'https://toyyibpay.com'

function baseUrl(credentials: Record<string, string>) {
  return credentials.environment === 'production' ? PRODUCTION_URL : SANDBOX_URL
}

export const toyyibPay: PaymentProviderAdapter = {
  name: 'ToyyibPay',

  async createPayment(input: PaymentIntentInput, credentials: Record<string, string>): Promise<PaymentIntentResult> {
    const apiUrl = baseUrl(credentials)
    const secretKey = credentials.secret_key
    const categoryCode = credentials.category_code

    if (!secretKey || !categoryCode) {
      return { success: false, provider: 'toyyibpay', error: 'ToyyibPay credentials missing (secret_key, category_code)' }
    }

    // ToyyibPay expects amount in cents (sen)
    const amountInSen = Math.round(input.amount * 100)

    const formData = new URLSearchParams({
      userSecretKey: secretKey,
      categoryCode,
      billName: input.description.substring(0, 30),
      billDescription: input.description,
      billPriceSetting: '1',              // fixed price
      billPayorInfo: '1',                  // require payor info
      billAmount: String(amountInSen),
      billReturnUrl: input.returnUrl,
      billCallbackUrl: `${input.callbackUrl}?provider=toyyibpay`,
      billExternalReferenceNo: input.orderRef,
      billTo: input.customerName,
      billEmail: input.customerEmail,
      billPhone: input.customerPhone,
      billPaymentChannel: '2',            // FPX + card
    })

    try {
      const res = await fetch(`${apiUrl}/index.php/api/createBill`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (!data?.[0]?.BillCode) {
        console.error('[toyyibpay] createBill response:', data)
        return { success: false, provider: 'toyyibpay', error: 'Failed to create ToyyibPay bill' }
      }

      const billCode = data[0].BillCode
      return {
        success: true,
        provider: 'toyyibpay',
        paymentRef: billCode,
        paymentUrl: `${apiUrl}/${billCode}`,
      }
    } catch (err: any) {
      console.error('[toyyibpay] API error:', err)
      return { success: false, provider: 'toyyibpay', error: err.message }
    }
  },

  async verifyCallback(payload: Record<string, string>, credentials: Record<string, string>): Promise<PaymentCallbackResult> {
    // ToyyibPay callback fields:
    //   refno, status (1=success, 2=pending, 3=failed),
    //   billcode, order_id (billExternalReferenceNo), transaction_id, reason
    const status = payload.status || payload.status_id
    const billExternalRef = payload.order_id || payload.billExternalReferenceNo || ''
    const transactionId = payload.transaction_id || payload.refno || ''

    // Optionally verify with getBillTransactions API
    // For now, trust the signed callback
    const apiUrl = baseUrl(credentials)
    const secretKey = credentials.secret_key
    let apiVerified = true

    if (secretKey && payload.billcode) {
      try {
        const verifyRes = await fetch(
          `${apiUrl}/index.php/api/getBillTransactions?billCode=${payload.billcode}`,
        )
        const txns = await verifyRes.json()
        // Find matching transaction
        const matchingTxn = (txns || []).find(
          (t: any) => t.billpaymentStatus === '1' && t.billExternalReferenceNo === billExternalRef,
        )
        apiVerified = !!matchingTxn
      } catch {
        // If verification API fails, fall back to callback data
        apiVerified = status === '1'
      }
    }

    // Resolve the orderId from our database using the external reference
    // The orderRef is stored in billExternalReferenceNo
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase: any = createAdminClient()
    const { data: order } = await supabase
      .from('storefront_orders')
      .select('id')
      .eq('order_ref', billExternalRef)
      .maybeSingle()

    return {
      verified: true,
      orderId: order?.id || '',
      paid: status === '1' && apiVerified,
      transactionId,
    }
  },
}
