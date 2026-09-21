import { NextRequest, NextResponse } from 'next/server'
import { getGatewayByProvider, verifyPaymentCallback } from '@/lib/payments'
import { applyStorefrontPaymentResult } from '@/lib/payments/apply-callback'
import { flattenPaymentParams } from '@/lib/payments/providers/billplz-signature'
import { handleStripeCheckoutWebhook } from '@/lib/payments/providers/stripe-webhook'

async function handleWebhook(request: NextRequest, fromGet = false) {
  const provider = request.nextUrl.searchParams.get('provider') || 'unknown'
  const body = fromGet ? '' : await request.text()

  console.log(`[payment-webhook] provider=${provider} method=${request.method}`)

  let result
  if (provider === 'stripe') {
    const gateway = await getGatewayByProvider('stripe')
    const credentials = (gateway?.credentials as Record<string, string>) || {}
    result = await handleStripeCheckoutWebhook(
      body,
      request.headers.get('stripe-signature'),
      credentials,
    )
  } else {
    let payload: Record<string, string> = flattenPaymentParams(request.nextUrl.searchParams)
    if (!fromGet) {
      const contentType = request.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body)
        payload = { ...payload, ...flattenPaymentParams(params) }
      } else if (body) {
        try {
          payload = { ...payload, ...flattenPaymentParams(JSON.parse(body)) }
        } catch {
          payload = { ...payload, raw: body }
        }
      }
    }
    result = await verifyPaymentCallback(provider, payload)
  }

  if (!result.verified) {
    console.error(`[payment-webhook] verification failed for ${provider}:`, result.error)
    return NextResponse.json({ status: 'error', message: result.error }, { status: 400 })
  }

  if (!result.orderId) {
    return NextResponse.json({ status: 'ignored' })
  }

  await applyStorefrontPaymentResult(result)
  console.log(`[payment-webhook] order ${result.orderId} → ${result.paid ? 'paid' : 'failed'}`)
  return NextResponse.json({ status: 'ok' })
}

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request, false)
  } catch (err: any) {
    console.error('[payment-webhook] unexpected error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    return await handleWebhook(request, true)
  } catch (err: any) {
    console.error('[payment-webhook] unexpected error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
