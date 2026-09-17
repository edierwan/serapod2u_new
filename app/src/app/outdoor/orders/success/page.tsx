import Link from 'next/link'

export const metadata = { title: 'Order confirmation' }

export default async function OutdoorOrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const ref = typeof params.ref === 'string' ? params.ref : ''

  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center sm:px-6">
      <div className="out-card px-6 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--out-bark)]/50">SeraOutdoor</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--out-bark)]">You’re all set</h1>
        <p className="mt-3 text-sm text-[var(--out-muted)] leading-relaxed">
          We received your order. Payment shows as paid after Stripe confirms it.
        </p>
        {ref ? (
          <div className="mt-6 rounded-2xl bg-[var(--out-ivory)] px-4 py-4 text-left">
            <p className="text-xs text-[var(--out-muted)]">Order number</p>
            <p className="mt-1 break-all font-mono text-lg font-semibold text-[var(--out-bark)]">{ref}</p>
            <p className="mt-2 text-xs text-[var(--out-muted)]">Keep this with your email to track the order.</p>
          </div>
        ) : null}
        <div className="mt-8 flex flex-col gap-2">
          <Link href="/outdoor/track" className="out-btn w-full">
            Track order
          </Link>
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
