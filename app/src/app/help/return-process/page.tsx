import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, AlertTriangle, CheckCircle2, PackageCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Serapod2U Help | Return Process',
  description: 'Step-by-step Return Process help for creating, validating, and completing returns.',
}

export default function ReturnProcessHelpPage() {
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
            <ClipboardList className="h-5 w-5" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#e85d04]">Return Process</p>
          <h1 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-3xl font-semibold tracking-tight">
            Return Process guide
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f6570]">
            Use this flow to submit returns cleanly, avoid rejected cases, and speed up approvals.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">Before you start</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Confirm the order/invoice reference.</li>
                <li>- Prepare product photos and quantities.</li>
                <li>- Select the correct return reason.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">Expected outcome</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Return ticket created successfully.</li>
                <li>- Status tracked until completed.</li>
                <li>- Correct stock/accounting reflection.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#d8dade] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Step-by-step</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-[#5f6570]">
            <p><strong className="text-[#141210]">1) Open Return module:</strong> Go to the Return section and create a new return request.</p>
            <p><strong className="text-[#141210]">2) Choose source document:</strong> Pick related order/invoice to avoid manual mismatch.</p>
            <p><strong className="text-[#141210]">3) Add lines correctly:</strong> Select products, quantities, and return reason per line.</p>
            <p><strong className="text-[#141210]">4) Upload evidence:</strong> Attach photos or proof for damaged/wrong item cases.</p>
            <p><strong className="text-[#141210]">5) Submit and monitor:</strong> Track status transitions until goods are received and finalized.</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <AlertTriangle className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Common blocker</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Wrong reference or quantity mismatch usually causes rejection.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <PackageCheck className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Best practice</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Use original order lines and avoid free-text product input.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <CheckCircle2 className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Done criteria</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Status completed, stock adjusted, and related financial entry confirmed.</p>
          </div>
        </section>
      </div>
    </main>
  )
}

