import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Gift, RefreshCw, Truck, MessageSquareText } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Serapod2U Help Center',
  description: 'Help center for Collect Points, Return Process, Distributor Incentive, and Improvement Feedback.',
}

const helpSections = [
  {
    id: 'collect-points',
    title: 'Collect Points',
    description: 'Register, sign in, collect points, and reset password with video guides.',
    href: '/help/collect-points',
    icon: Gift,
    state: 'Live',
  },
  {
    id: 'return-process',
    title: 'Return Process',
    description: 'Step-by-step product return and claim process for field teams and partners.',
    href: '/help/return-process',
    icon: RefreshCw,
    state: 'Live guide',
  },
  {
    id: 'distributor-incentive',
    title: 'Distributor Incentive',
    description: 'Guide for incentive setup, qualification, and reward redemption flow.',
    href: '/help/distributor-incentive',
    icon: Truck,
    state: 'Live guide',
  },
  {
    id: 'improvement-feedback',
    title: 'Improvement (Feedback)',
    description: 'Share feedback, report issues, and suggest improvements to the team.',
    href: '/help/improvement-feedback',
    icon: MessageSquareText,
    state: 'Live guide',
  },
]

export default function HelpCenterPage() {
  return (
    <main className="min-h-screen bg-[#e9eaed] text-[#141210]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-2xl border border-[#d8dade] bg-[#f3f3f4] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Image
              src="/images/logo.png"
              alt="Serapod"
              width={248}
              height={79}
              className="h-8 w-auto object-contain"
              priority
            />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#65615c]">
              Help Center
            </span>
          </div>
          <h1 className="mt-4 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-3xl font-semibold tracking-tight sm:text-4xl">
            Main Help Menu
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5f6570] sm:text-base">
            Choose the module you need. We will keep expanding this page with full practical guides and videos.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {helpSections.map((section) => {
            const Icon = section.icon
            return (
              <Link
                key={section.id}
                href={section.href}
                className="group rounded-2xl border border-[#d8dade] bg-[#f3f3f4] p-5 transition hover:border-[#e85d04]/30 hover:shadow-[0_16px_36px_-24px_rgba(20,18,16,0.4)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#e85d04]/10 text-[#e85d04]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full border border-[#d8dade] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#65615c]">
                    {section.state}
                  </span>
                </div>
                <h2 className="mt-4 text-lg font-semibold">{section.title}</h2>
                <p className="mt-1.5 text-sm leading-6 text-[#5f6570]">{section.description}</p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#e85d04]">
                  Open guide
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </Link>
            )
          })}
        </section>
      </div>
    </main>
  )
}

