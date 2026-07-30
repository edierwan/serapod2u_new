import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, Clock3 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Serapod2U Help | Return Process',
  description: 'Return Process guide (coming next).',
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
            Return Process guide is coming next
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f6570]">
            This section will include the full step-by-step return flow, required checks, and escalation path.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[#d8dade] bg-white px-3 py-2 text-xs font-medium text-[#65615c]">
            <Clock3 className="h-4 w-4 text-[#e85d04]" />
            Planned after Collect Points module
          </div>
        </section>
      </div>
    </main>
  )
}

