import { createAdminClient } from '@/lib/supabase/admin'
import type { PaymentCallbackResult } from './types'

export async function applyStorefrontPaymentResult(result: PaymentCallbackResult) {
  if (!result.verified || !result.orderId) return { updated: false }
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
    console.error('[payments] DB update failed:', error)
    throw error
  }
  return { updated: true, paid: result.paid }
}
