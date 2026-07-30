import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, MessageSquareText, Bug, Lightbulb, CheckCircle2 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Serapod2U Help | Improvement Feedback',
  description: 'Improvement and Feedback guide for reporting issues and submitting suggestions.',
}

export default function ImprovementFeedbackHelpPage() {
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
            <MessageSquareText className="h-5 w-5" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#e85d04]">Improvement (Feedback)</p>
          <h1 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-3xl font-semibold tracking-tight">
            Improvement and Feedback guide
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f6570]">
            Use this workflow to report bugs clearly and send actionable improvement requests.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">When reporting an issue</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Add exact page/module name.</li>
                <li>- Include screenshot/video and timestamp.</li>
                <li>- Explain expected vs actual behavior.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[#d8dade] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#65615c]">When suggesting improvement</p>
              <ul className="mt-3 space-y-2 text-sm text-[#5f6570]">
                <li>- Describe current pain point.</li>
                <li>- Suggest desired workflow.</li>
                <li>- Clarify business impact.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#d8dade] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Step-by-step</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-[#5f6570]">
            <p><strong className="text-[#141210]">1) Identify category:</strong> Choose Bug, Data issue, or Improvement request.</p>
            <p><strong className="text-[#141210]">2) Capture evidence:</strong> Add screenshots, short recordings, and user/account context.</p>
            <p><strong className="text-[#141210]">3) Reproduction steps:</strong> Write exact clicks/inputs so engineering can reproduce quickly.</p>
            <p><strong className="text-[#141210]">4) Set priority:</strong> Mark severity (blocking/high/normal) based on business impact.</p>
            <p><strong className="text-[#141210]">5) Follow up:</strong> Validate fix on staging and close with confirmation note.</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <Bug className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Bug report quality</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Good reproduction steps reduce fix time dramatically.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <Lightbulb className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Improvement value</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Tie every suggestion to a clear productivity or revenue benefit.</p>
          </div>
          <div className="rounded-xl border border-[#d8dade] bg-white p-4">
            <CheckCircle2 className="h-5 w-5 text-[#e85d04]" />
            <p className="mt-2 text-sm font-semibold">Closure rule</p>
            <p className="mt-1 text-xs leading-5 text-[#5f6570]">Close only after user/business validation on staging or production.</p>
          </div>
        </section>
      </div>
    </main>
  )
}

