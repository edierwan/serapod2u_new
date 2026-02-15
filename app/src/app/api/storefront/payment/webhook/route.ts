import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPaymentCallback } from '@/lib/payments'

// ── POST /api/storefront/payment/webhook ─────────────────────────
// Generic webhook endpoint. The payment provider is determined from
// the payload or a query param (?provider=toyyibpay).
// Each provider adapter parses the provider-specific body.

export async function POST(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get('provider') || 'unknown'
    const body = await request.text()

    console.log(`[payment-webhook] provider=${provider}`, body.substring(0, 500))

    // Parse form-encoded or JSON body
    let payload: Record<string, string> = {}
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body)
      params.forEach((v, k) => {
        payload[k] = v
      })
    } else {
      try {
        payload = JSON.parse(body)
      } catch {
        payload = { raw: body }
      }
    }

    // Verify with provider adapter
    const result = await verifyPaymentCallback(provider, payload)

    if (!result.verified) {
      console.error(`[payment-webhook] verification failed for ${provider}:`, result.error)
      return NextResponse.json({ status: 'error', message: result.error }, { status: 400 })
    }

    // Update order status
    const supabase: any = createAdminClient()
    const { error } = await supabase
      .from('storefront_orders')
      .update({
        status: result.paid ? 'paid' : 'payment_failed',
        payment_ref: result.transactionId || undefined,
        paid_at: result.paid ? new Date().toISOString() : undefined,
      })
      .eq('id', result.orderId)

    if (error) {
      console.error('[payment-webhook] DB update failed:', error)
      return NextResponse.json({ status: 'error' }, { status: 500 })
    }

    console.log(`[payment-webhook] order ${result.orderId} → ${result.paid ? 'paid' : 'failed'}`)

    // Return OK — most gateways expect 200 response
    return NextResponse.json({ status: 'ok' })
  } catch (err: any) {
    console.error('[payment-webhook] unexpected error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}

// Some gateways use GET for return URL callback
export async function GET(request: NextRequest) {
  return POST(request)
}
