import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { CollectPointsGuideClient } from '@/components/help/CollectPointsGuideClient'

export const metadata: Metadata = {
  title: 'How to use Collect Points | Serapod2U',
  description: 'Short guide for registering, signing in, collecting points, and sharing Collect Points with shop staff and customers.',
}

/**
 * Optional video URLs — paste Drive / YouTube / Loom links when ready.
 * Leave empty to show “coming soon”.
 */
const VIDEO_LINKS = {
  register: process.env.NEXT_PUBLIC_GUIDE_VIDEO_REGISTER || '',
  login: process.env.NEXT_PUBLIC_GUIDE_VIDEO_LOGIN || '',
  collectPoints: process.env.NEXT_PUBLIC_GUIDE_VIDEO_COLLECT_POINTS || '',
  resetPassword: process.env.NEXT_PUBLIC_GUIDE_VIDEO_RESET_PASSWORD || '',
  scanQr: process.env.NEXT_PUBLIC_GUIDE_VIDEO_SCAN_QR || '',
} as const

/** Demo product QR page users can open to try the flow. Override via env. */
const DEMO_PRODUCT_PATH =
  process.env.NEXT_PUBLIC_COLLECT_POINTS_DEMO_QR_PATH
  || '/track/product/PROD-CELVA9052-ZER-492299-ORD-HM-0726-03-00003-9f64d8498a07'

const GUIDE_PATH = '/help/collect-points'

function VideoRow({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--sera-line,#e8eaed)] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-[var(--sera-ink,#141210)]">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--sera-muted,#6b7280)]">{description}</p>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--sera-orange,#e85d04)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--sera-orange-deep,#c44a00)]"
        >
          Watch video
        </a>
      ) : (
        <span className="inline-flex shrink-0 items-center justify-center rounded-xl border border-dashed border-[var(--sera-line,#e8eaed)] px-4 py-2.5 text-sm font-medium text-[var(--sera-muted,#6b7280)]">
          Video coming soon
        </span>
      )}
    </div>
  )
}

export default function CollectPointsHelpPage() {
  const siteUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://stg.serapod2u.com').replace(/\/$/, '')
  const guideUrl = `${siteUrl}${GUIDE_PATH}`
  const demoProductUrl = DEMO_PRODUCT_PATH.startsWith('http')
    ? DEMO_PRODUCT_PATH
    : `${siteUrl}${DEMO_PRODUCT_PATH.startsWith('/') ? '' : '/'}${DEMO_PRODUCT_PATH}`

  const whatsappText =
    `Scan this product QR → Register / Sign in → Collect points → Redeem rewards.\n\n` +
    `Try here: ${demoProductUrl}\n` +
    `Full guide: ${guideUrl}`

  return (
    <div className="min-h-screen bg-[var(--sera-paper,#fafbfc)] text-[var(--sera-ink,#141210)]">
      <header className="border-b border-[var(--sera-line,#e8eaed)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 md:px-8 md:py-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image
              src="/images/seralogo-optimized.png"
              alt="Serapod"
              width={240}
              height={56}
              className="h-11 w-auto max-w-[13rem] object-contain object-left mix-blend-multiply md:h-14 md:max-w-[16rem]"
              priority
            />
            <span className="hidden border-l border-[var(--sera-line,#e8eaed)] pl-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sera-orange,#e85d04)] sm:inline">
              Collect Points
            </span>
          </Link>
          <Link
            href={demoProductUrl}
            className="shrink-0 rounded-xl bg-[var(--sera-orange,#e85d04)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--sera-orange-deep,#c44a00)]"
          >
            Open demo QR
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-12">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14 lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--sera-orange,#e85d04)]">
              Collect Points
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-3xl font-bold tracking-tight text-[var(--sera-ink,#141210)] md:text-4xl lg:text-5xl">
              How to use Collect Points
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--sera-muted,#6b7280)] md:text-lg">
              Short guide for shop staff, Account Managers, and customers. Share this page or the WhatsApp message below.
            </p>

            <section className="mt-8 rounded-2xl border border-[var(--sera-line,#e8eaed)] bg-white p-6 md:p-7">
              <h2 className="text-lg font-bold text-[var(--sera-ink,#141210)]">Quick flow</h2>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-[var(--sera-ink-soft,#2a2622)] md:text-base">
                <li>Scan the product QR (or open the product link).</li>
                <li>Register as a new user, or Sign In if you already have an account.</li>
                <li>
                  Tap <strong>Collect Points</strong> on the home screen.
                </li>
                <li>Redeem rewards when you have enough points.</li>
              </ol>
            </section>

            <section className="mt-8 space-y-4">
              <h2 className="text-lg font-bold text-[var(--sera-ink,#141210)]">Videos</h2>
              <VideoRow
                title="1) Register (new user)"
                description="Create account with email, name, phone, shop & password."
                href={VIDEO_LINKS.register}
              />
              <VideoRow
                title="2) Login"
                description="Sign in with email and password."
                href={VIDEO_LINKS.login}
              />
              <VideoRow
                title="3) Collect Points"
                description="After scan / open QR, collect points for the product."
                href={VIDEO_LINKS.collectPoints}
              />
              <VideoRow
                title="4) Reset Password"
                description="Forgot Password → email OTP → new password."
                href={VIDEO_LINKS.resetPassword}
              />
              <VideoRow
                title="5) Scan QR / open product link"
                description="Start from camera scan or a shared product URL."
                href={VIDEO_LINKS.scanQr}
              />
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6">
            <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--sera-orange,#e85d04)] to-[var(--sera-orange-deep,#c44a00)] p-6 text-white md:p-7">
              <Image
                src="/brand/serapod-wordmark-light.png"
                alt="Serapod"
                width={280}
                height={64}
                className="mb-5 h-10 w-auto max-w-[14rem] object-contain mix-blend-screen md:h-12"
              />
              <h2 className="text-xl font-bold">Try it now</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/85">
                Open this demo product page — same Collect Points experience as scanning a QR.
              </p>
              <a
                href={demoProductUrl}
                className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[var(--sera-orange-deep,#c44a00)] hover:bg-white/95"
              >
                Open demo product
              </a>
              <p className="mt-3 break-all text-[11px] leading-relaxed text-white/70">{demoProductUrl}</p>
            </section>

            <section className="rounded-2xl border border-[var(--sera-line,#e8eaed)] bg-white p-6 md:p-7">
              <h2 className="text-lg font-bold text-[var(--sera-ink,#141210)]">Share with WhatsApp</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--sera-muted,#6b7280)]">
                For shop staff or Account Managers — copy and send to customers:
              </p>
              <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--sera-mist,#f2f3f5)] p-4 text-sm leading-relaxed text-[var(--sera-ink,#141210)]">
                {whatsappText}
              </pre>
              <div className="mt-5">
                <CollectPointsGuideClient
                  guideUrl={guideUrl}
                  demoProductUrl={demoProductUrl}
                  whatsappText={whatsappText}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--sera-line,#e8eaed)] bg-[var(--sera-mist,#f2f3f5)] p-6">
              <h2 className="text-base font-bold text-[var(--sera-ink,#141210)]">Where each action is in the app</h2>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[var(--sera-ink-soft,#2a2622)]">
                <li>
                  <strong>Register:</strong> Product QR page → Profile → Create Account (WhatsApp OTP).
                </li>
                <li>
                  <strong>Login:</strong> Profile → Sign In with email + password (or Forgot Password).
                </li>
                <li>
                  <strong>Collect Points:</strong> Home tab after opening a product QR → Collect button.
                </li>
              </ul>
            </section>
          </aside>
        </div>

        <p className="mt-12 text-center text-xs text-[var(--sera-muted,#6b7280)]">
          Guide URL: <span className="font-medium text-[var(--sera-ink,#141210)]">{guideUrl}</span>
        </p>
      </main>
    </div>
  )
}
