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
    <div className="mx-auto max-w-2xl px-5 py-16 text-center">
      <h1 className="font-display text-4xl tracking-tight text-[var(--out-moss)]">Thanks for your order</h1>
      <p className="mt-4 text-[var(--out-muted)] leading-relaxed">
        We created your order. Payment shows as paid once the payment provider confirms it.
      </p>
      {ref ? (
        <div className="mt-8 rounded-xl border border-[var(--out-line)] bg-white px-5 py-4 text-left">
          <p className="text-xs text-[var(--out-muted)]">Order number</p>
          <p className="mt-1 font-mono text-lg font-semibold text-[var(--out-ink)] break-all">{ref}</p>
          <p className="mt-3 text-xs text-[var(--out-muted)]">
            Keep this number. You’ll need it with your email to track the order.
          </p>
        </div>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/outdoor/track"
          className="inline-flex h-11 items-center rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white"
        >
          Track order
        </Link>
        <Link
          href="/outdoor/account"
          className="inline-flex h-11 items-center rounded-md border border-[var(--out-line)] px-5 text-sm font-semibold"
        >
          My account
        </Link>
        <Link
          href="/outdoor/shop"
          className="inline-flex h-11 items-center rounded-md border border-[var(--out-line)] px-5 text-sm font-semibold"
        >
          Keep shopping
        </Link>
      </div>
    </div>
  )
}
