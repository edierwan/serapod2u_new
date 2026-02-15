// ── Payment Gateway Adapter Layer ──────────────────────────────────
// Central entry point for all payment providers.
// The active provider is read from the `payment_gateway_settings` table.
// Provider adapters live in ./providers/ folder.

import { createAdminClient } from '@/lib/supabase/admin'
import { toyyibPay } from './providers/toyyibpay'
import { billplz } from './providers/billplz-adapter'
import { stripe } from './providers/stripe-adapter'

// Re-export shared types so external consumers keep importing from here
export type {
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentCallbackResult,
  PaymentProviderAdapter,
} from './types'

import type { PaymentIntentInput, PaymentIntentResult, PaymentCallbackResult, PaymentProviderAdapter } from './types'

// ── Provider Registry ─────────────────────────────────────────────

const providers: Record<string, PaymentProviderAdapter> = {
  toyyibpay: toyyibPay,
  billplz: billplz,
  stripe: stripe,
}

// ── Gateway Settings Cache (60s) ─────────────────────────────────

let gatewayCache: { data: any; ts: number } | null = null
const CACHE_TTL = 60_000

async function getActiveGateway() {
  if (gatewayCache && Date.now() - gatewayCache.ts < CACHE_TTL) {
    return gatewayCache.data
  }

  const supabase: any = createAdminClient()
  const { data, error } = await supabase
    .from('payment_gateway_settings')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[payments] failed to load gateway settings:', error)
    return null
  }

  gatewayCache = { data, ts: Date.now() }
  return data
}

// ── Public API ────────────────────────────────────────────────────

export async function createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
  const gateway = await getActiveGateway()

  if (!gateway) {
    // No gateway configured — fallback: mark as "manual payment"
    return {
      success: true,
      provider: 'manual',
      paymentRef: `MANUAL-${input.orderRef}`,
      // No paymentUrl → checkout page goes to success directly
    }
  }

  const adapter = providers[gateway.provider]
  if (!adapter) {
    return {
      success: false,
      provider: gateway.provider,
      error: `Unknown payment provider: ${gateway.provider}`,
    }
  }

  const credentials = (gateway.credentials as Record<string, string>) || {}
  return adapter.createPayment(input, credentials)
}

export async function verifyPaymentCallback(
  providerHint: string,
  payload: Record<string, string>,
): Promise<PaymentCallbackResult> {
  // Try the hinted provider first, then look up from DB
  let gateway = await getActiveGateway()

  const providerKey = providerHint || gateway?.provider || 'unknown'
  const adapter = providers[providerKey]

  if (!adapter) {
    return { verified: false, orderId: '', paid: false, error: `Unknown provider: ${providerKey}` }
  }

  const credentials = (gateway?.credentials as Record<string, string>) || {}
  return adapter.verifyCallback(payload, credentials)
}
