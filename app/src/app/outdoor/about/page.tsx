import Link from 'next/link'

export const metadata = { title: 'About Us' }

export default function OutdoorAboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 sm:py-20">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">About us</h1>
      <div className="mt-8 space-y-5 text-[var(--out-muted)] leading-relaxed text-base sm:text-lg">
        <p>
          Serapod Outdoor is our outdoor shop under Serapod. We sell gear and everyday pieces for hiking,
          camping, and time outside.
        </p>
        <p>
          You can browse, pay online, and track your order here. If something goes wrong, contact us and we’ll help.
        </p>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/outdoor/shop"
          className="inline-flex h-11 items-center rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white"
        >
          Shop now
        </Link>
        <Link
          href="/outdoor/contact"
          className="inline-flex h-11 items-center rounded-md border border-[var(--out-line)] px-5 text-sm font-semibold"
        >
          Contact
        </Link>
      </div>
    </div>
  )
}
