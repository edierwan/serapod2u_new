import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Truck, BadgeDollarSign, CheckCircle2, BarChart3 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Serapod2U Help | Distributor Incentive',
  description: 'Distributor Incentive guide for setup, qualification, and payout verification.',
}

export default function DistributorIncentiveHelpPage() {
  return (
    <main className="min-h-screen bg-[#e9eaed] text-[#141210]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/help"
          className="inline-flex items-center gap-2 rounded-xl border border-[#d8dade] bg-white px-4 py-2 text-sm font-medium text-[#141210] hover:border-[#e85d04]/40"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Help Menu
        </Link>

        <section className="mt-6 rounded-2xl border border-[#d8dade] bg-[#f3f3f4] p-6 sm:p-8">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#e85d04]/10 text-[#e85d04]">
            <Truck className="h-5 w-5" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#e85d04]">Distributor Incentive</p>
          <h1 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-3xl font-semibold tracking-tight">
            Distributor Incentive guide
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f6570]">
            Configure incentive logic clearly so distributors can track progress and qualify without confusion.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">Define program</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Target period (monthly/quarterly).</li>
                <li>- Eligible distributor groups/regions.</li>
                <li>- Reward type (cash/product/points).</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">Track readiness</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Data mapping completed.</li>
                <li>- Rule testing done with sample accounts.</li>
                <li>- Approval and communication plan ready.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#d8dade] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Step-by-step</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-[#5f6570]">
            <p><strong className="text-[#141210]">1) Create incentive campaign:</strong> Name it, assign period, and define scope (who can join).</p>
            <p><strong className="text-[#141210]">2) Set qualification rules:</strong> Use measurable targets (sales/volume/collections) with clear thresholds.</p>
            <p><strong className="text-[#141210]">3) Attach reward matrix:</strong> Map each tier to reward value and payout method.</p>
            <p><strong className="text-[#141210]">4) Publish and announce:</strong> Share eligibility conditions and timeline to distributors.</p>
            <p><strong className="text-[#141210]">5) Monitor and close:</strong> Validate final results, approve payouts, and archive campaign outcomes.</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <BadgeDollarSign className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Reward clarity</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Distributors should know exact tier-to-reward mapping from day one.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <BarChart3 className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Progress visibility</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Weekly progress review reduces payout disputes at campaign end.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <CheckCircle2 className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Final verification</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Lock final figures before payout execution and keep audit notes.</p>
          </div>
        </section>
      </div>
    </main>
  )
}

