import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import QRCode from 'qrcode'
import { ArrowRight, Check, PlayCircle, QrCode } from 'lucide-react'
import {
  CollectPointsGuideClient,
  type HelpGuide,
  type HelpVideoSource,
} from '@/components/help/CollectPointsGuideClient'

export const metadata: Metadata = {
  title: 'Serapod2U Help | Register, Collect Points & Reset Password',
  description:
    'Short Serapod2U video guides for account registration, collecting product points, and resetting a forgotten password.',
}

const VIDEO_LINKS = {
  register: process.env.NEXT_PUBLIC_GUIDE_VIDEO_REGISTER || '/videos/Register.mp4',
  login: process.env.NEXT_PUBLIC_GUIDE_VIDEO_LOGIN || '/videos/Login.mp4',
  collectPoints: process.env.NEXT_PUBLIC_GUIDE_VIDEO_COLLECT_POINTS || '/videos/Collect-Point.mp4',
  resetPassword: process.env.NEXT_PUBLIC_GUIDE_VIDEO_RESET_PASSWORD || '',
} as const

const GUIDE_PATH = '/help/collect-points'
const DEMO_PRODUCT_PATH =
  process.env.NEXT_PUBLIC_COLLECT_POINTS_DEMO_QR_PATH
  || '/track/product/PROD-CELVA9052-ZER-492299-ORD-HM-0726-03-00003-9f64d8498a07'

function resolveVideoSource(url: string): HelpVideoSource {
  if (!url) return null

  if (url.startsWith('/') || /\.(mp4|webm|ogg)(?:\?.*)?$/i.test(url)) {
    return { kind: 'video', src: url }
  }

  try {
    const parsed = new URL(url)

    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0]
      return id ? { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}` } : null
    }

    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop()
      return id ? { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}` } : null
    }

    if (parsed.hostname.includes('loom.com')) {
      return { kind: 'embed', src: url.replace('/share/', '/embed/') }
    }

    if (parsed.hostname.includes('drive.google.com')) {
      const match = parsed.pathname.match(/\/file\/d\/([^/]+)/)
      return match?.[1]
        ? { kind: 'embed', src: `https://drive.google.com/file/d/${match[1]}/preview` }
        : { kind: 'link', src: url }
    }
  } catch {
    return { kind: 'link', src: url }
  }

  return { kind: 'link', src: url }
}

const guides: HelpGuide[] = [
  {
    id: 'register',
    number: '01',
    label: 'New user',
    title: 'Register a new account',
    description: 'Create a secure Serapod2U account after scanning your first product.',
    duration: '45-60 sec',
    icon: 'register',
    source: resolveVideoSource(VIDEO_LINKS.register),
    steps: [
      'Scan a product QR and open Profile.',
      'Select Create Account.',
      'Enter your personal and shop details.',
      'Verify the OTP sent to your email and set a password.',
    ],
    voiceOver:
      'Scan the product QR code and open the Profile tab. Select Create Account, enter your details, verify the code sent to your email, and create your password. Your Serapod2U account is now ready.',
  },
  {
    id: 'collect',
    number: '02',
    label: 'Rewards',
    title: 'Collect product points',
    description: 'Claim the points on a genuine product and see your balance update instantly.',
    duration: '30-45 sec',
    icon: 'collect',
    source: resolveVideoSource(VIDEO_LINKS.collectPoints),
    steps: [
      'Scan the QR printed on your product.',
      'Confirm the genuine product details.',
      'Tap Collect Points on the Home tab.',
      'Check your new points balance.',
    ],
    voiceOver:
      'After scanning the product QR code, confirm the genuine product details and tap Collect Points. Once the collection is successful, your earned points and updated balance will appear immediately.',
  },
  {
    id: 'password',
    number: '03',
    label: 'Account help',
    title: 'Reset a forgotten password',
    description: 'Recover your account with email verification and create a new password.',
    duration: '40-50 sec',
    icon: 'password',
    source: resolveVideoSource(VIDEO_LINKS.resetPassword || VIDEO_LINKS.login),
    steps: [
      'Open Profile, Sign In, then Forgot Password.',
      'Enter your registered email.',
      'Verify the OTP sent to your inbox.',
      'Create a new password and sign in.',
    ],
    voiceOver:
      'From the Sign In screen, select Forgot Password and enter your registered email. Verify the code sent to your inbox, create and confirm your new password, then sign in to continue using Serapod2U.',
  },
]

export default async function CollectPointsHelpPage() {
  const siteUrl = (
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://stg.serapod2u.com'
  ).replace(/\/$/, '')
  const guideUrl = `${siteUrl}${GUIDE_PATH}`
  const demoProductUrl = DEMO_PRODUCT_PATH.startsWith('http')
    ? DEMO_PRODUCT_PATH
    : `${siteUrl}${DEMO_PRODUCT_PATH.startsWith('/') ? '' : '/'}${DEMO_PRODUCT_PATH}`
  const guideQrCode = await QRCode.toDataURL(guideUrl, {
    width: 420,
    margin: 1,
    color: { dark: '#141210', light: '#f3f3f4' },
    errorCorrectionLevel: 'M',
  })
  const whatsappText =
    `Serapod2U Rewards - Quick Guide\n\n`
    + `Watch three short videos:\n`
    + `1. Register a new account\n`
    + `2. Collect product points\n`
    + `3. Reset a forgotten password\n\n`
    + `Guide: ${guideUrl}\n`
    + `Try the demo: ${demoProductUrl}`

  return (
    <div className="min-h-screen bg-[#e9eaed] font-[family-name:var(--font-sera-body),Manrope,sans-serif] text-[#141210]">
      <header className="sticky top-0 z-40 border-b border-[#d8dade] bg-[#f3f3f4]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-3.5 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Serapod2U home" className="flex items-center gap-3">
            <Image
              src="/images/logo.png"
              alt="Serapod"
              width={248}
              height={79}
              className="h-8 w-auto object-contain"
              priority
            />
            <span className="hidden border-l border-[#d8dade] pl-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#65615c] sm:block">
              Rewards help
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/help"
              className="hidden rounded-xl border border-[#d8dade] bg-white px-3 py-2 text-sm font-medium text-[#5f6570] transition hover:border-[#e85d04]/35 hover:text-[#141210] sm:inline-flex"
            >
              Main menu
            </Link>
            <a
              href="#video-guides"
              className="hidden px-3 py-2 text-sm font-medium text-[#5f6570] transition hover:text-[#141210] sm:inline-flex"
            >
              Video guides
            </a>
            <Link
              href={demoProductUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-12px_rgba(232,93,4,0.65)] transition hover:bg-[#c44a00]"
            >
              Try demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-[#d8dade]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 60% 50% at 8% 20%, rgba(232,93,4,0.11), transparent 50%), radial-gradient(ellipse 50% 45% at 92% 0%, rgba(20,18,16,0.05), transparent 45%), linear-gradient(165deg, #f0f0f2 0%, #e9eaed 45%, #e4e5e8 100%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(20,18,16,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(20,18,16,0.55) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          />

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <div className="h-0.5 w-14 rounded-full bg-[#e85d04]" />
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.17em] text-[#e85d04]">
                Serapod2U video guide
              </p>
              <h1 className="mt-3 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-4xl font-semibold leading-[1.07] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                Everything you need to start collecting rewards.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#5f6570] sm:text-lg">
                Register, collect points, and recover your account with three short, practical videos.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#video-guides"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#e85d04] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_-12px_rgba(232,93,4,0.65)] transition hover:bg-[#c44a00]"
                >
                  Watch the guides
                  <PlayCircle className="h-4 w-4" />
                </a>
                <Link
                  href={demoProductUrl}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#d8dade] bg-[#f3f3f4] px-6 py-3 text-sm font-semibold text-[#141210] shadow-sm transition hover:border-[#e85d04]/30 hover:text-[#e85d04]"
                >
                  Open live demo
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[#d8dade] bg-[#f3f3f4] p-5 shadow-[0_22px_55px_-32px_rgba(20,18,16,0.38)] sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-[#d8dade] pb-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e85d04]">One link</p>
                  <h2 className="mt-1 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-lg font-semibold">
                    Share the complete guide
                  </h2>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e85d04]/10 text-[#e85d04]">
                  <QrCode className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 flex items-center gap-5">
                <div className="shrink-0 rounded-xl border border-[#d8dade] bg-white p-2 shadow-sm">
                  <Image
                    src={guideQrCode}
                    alt="QR code for the Serapod2U video guide"
                    width={160}
                    height={160}
                    unoptimized
                    className="h-28 w-28 rounded-md sm:h-32 sm:w-32"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Scan on any phone</p>
                  <p className="mt-1.5 text-xs leading-5 text-[#5f6570]">
                    Registration, points collection, and password recovery in one place.
                  </p>
                  <p className="mt-3 break-all text-[10px] leading-4 text-[#85898f]">{guideUrl}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="video-guides" className="scroll-mt-20 border-b border-[#d8dade] bg-[#e9eaed] py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-[#e85d04]">Video guides</p>
              <h2 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-2xl font-semibold tracking-tight sm:text-3xl">
                Start with what you need.
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#5f6570]">
                Every guide includes the exact steps and its ready-to-record English voice-over.
              </p>
            </div>

            <CollectPointsGuideClient
              guides={guides}
              guideUrl={guideUrl}
              whatsappText={whatsappText}
              demoProductUrl={demoProductUrl}
            />
          </div>
        </section>

        <section className="bg-[#f3f3f4]">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 sm:grid-cols-3 lg:px-8">
            {[
              ['01', 'Watch', 'Choose the guide that matches what you need.'],
              ['02', 'Follow', 'Complete each action directly on your phone.'],
              ['03', 'Done', 'Continue using Serapod2U with confidence.'],
            ].map(([number, title, description]) => (
              <div key={number} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e85d04]/10 text-xs font-bold text-[#e85d04]">
                  {number}
                </span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#5f6570]">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[#d8dade] bg-[#141210] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <Image
              src="/images/logo.png"
              alt="Serapod"
              width={248}
              height={79}
              className="h-7 w-auto rounded-lg bg-white px-2 py-1 object-contain"
            />
            <p className="mt-3 text-xs text-white/50">Register. Collect points. Enjoy your rewards.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/60">
            {guides.map((guide) => (
              <span key={guide.id} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-[#e85d04]" />
                {guide.title}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
