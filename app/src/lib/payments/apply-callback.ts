import { createAdminClient } from '@/lib/supabase/admin'
import type { PaymentCallbackResult } from './types'

/**
 * Order statuses a payment result may move from. Replayed or late callbacks
 * (a reloaded return page, gateway retries) must never pull a shipped order back
 * to paid, or turn a paid order into failed.
 */
export function paymentResultFromStatuses(paid: boolean) {
  return paid ? ['pending_payment', 'payment_failed'] : ['pending_payment']
}

export async function applyStorefrontPaymentResult(result: PaymentCallbackResult) {
  if (!result.verified || !result.orderId) return { updated: false }
  const supabase: any = createAdminClient()
  const { data, error } = await supabase
    .from('storefront_orders')
    .update({
      status: result.paid ? 'paid' : 'payment_failed',
      payment_ref: result.transactionId || undefined,
      paid_at: result.paid ? new Date().toISOString() : undefined,
    })
    .eq('id', result.orderId)
    .in('status', paymentResultFromStatuses(result.paid))
    .select('id')

  if (error) {
    console.error('[payments] DB update failed:', error)
    throw error
  }
  const updated = Array.isArray(data) && data.length > 0
  if (updated && result.paid) {
    try {
      const { notifyOutdoorOrderPaid } = await import('@/lib/outdoor/order-paid-email')
      await notifyOutdoorOrderPaid(result.orderId)
    } catch (err) {
      console.error('[payments] order paid email failed:', err)
    }
  }
  if (!updated && result.paid) {
    const { data: current } = await supabase
      .from('storefront_orders')
      .select('status')
      .eq('id', result.orderId)
      .maybeSingle()
    if (current?.status === 'cancelled') {
      console.error(`[payments] order ${result.orderId} was cancelled but a payment arrived — refund or restore it manually`)
    }
  }
  return { updated, paid: result.paid }
}
