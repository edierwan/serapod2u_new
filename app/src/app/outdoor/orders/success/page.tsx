import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { verifyPaymentCallback } from '@/lib/payments'
import { applyStorefrontPaymentResult } from '@/lib/payments/apply-callback'
import { flattenPaymentParams } from '@/lib/payments/providers/billplz-signature'

export const metadata = { title: 'Order confirmation' }
export const dynamic = 'force-dynamic'

export default async function OutdoorOrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const ref = typeof params.ref === 'string' ? params.ref : ''
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const flat = flattenPaymentParams(params)
  const looksLikeBillplz = Boolean(flat['billplz[id]'] || (flat.id && (flat.paid || flat['billplz[paid]'])))

  if (looksLikeBillplz) {
    try {
      const result = await verifyPaymentCallback('billplz', flat)
      if (result.verified && result.orderId) {
        await applyStorefrontPaymentResult(result)
      }
    } catch (err) {
      console.error('[outdoor-success] billplz confirm failed:', err)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center sm:px-6">
      <div className="out-card px-6 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--out-bark)]/50">SeraOutdoor</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--out-bark)]">You’re all set</h1>
        <p className="mt-3 text-sm text-[var(--out-muted)] leading-relaxed">
          We received your order. Payment shows as paid after Stripe or Billplz confirms it.
        </p>
        {ref ? (
          <div className="mt-6 rounded-2xl bg-[var(--out-ivory)] px-4 py-4 text-left">
            <p className="text-xs text-[var(--out-muted)]">Order number</p>
            <p className="mt-1 break-all font-mono text-lg font-semibold text-[var(--out-bark)]">{ref}</p>
            <p className="mt-2 text-xs text-[var(--out-muted)]">This order is saved on your account.</p>
          </div>
        ) : null}
        <div className="mt-8 flex flex-col gap-2">
          {user ? (
            <Link href={ref ? `/outdoor/track?order=${encodeURIComponent(ref)}` : '/outdoor/track'} className="out-btn w-full">
              Track order
            </Link>
          ) : null}
          <Link
            href="/outdoor/shop"
            className="inline-flex h-12 items-center justify-center rounded-full border border-[var(--out-bark)]/15 text-sm font-semibold text-[var(--out-bark)]"
          >
            Keep shopping
          </Link>
        </div>
      </div>
    </div>
  )
}
