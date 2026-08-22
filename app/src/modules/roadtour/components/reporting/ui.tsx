'use client'

// Presentation primitives shared by the four RoadTour Reporting sections.
// Colour discipline: orange is the Serapod accent only, green means healthy,
// amber means attention, red is reserved for genuinely high-priority or overdue.

import { OUTCOME_LABEL, type ShopOutcome } from '@/modules/roadtour/lib/reporting/impactModel'
import { FOLLOW_UP_PRIORITY_LABEL, type FollowUpPriority } from '@/modules/roadtour/lib/reporting/followUp'

const OUTCOME_STYLE: Record<ShopOutcome, string> = {
    improved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    newly_activated: 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)] border-[var(--sera-orange)]/25',
    maintained: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border-[var(--sera-line)]',
    dropped: 'bg-amber-50 text-amber-800 border-amber-200',
    no_response: 'bg-rose-50 text-rose-700 border-rose-200',
    pending_observation: 'bg-[var(--sera-mist)] text-[var(--sera-muted)] border-[var(--sera-line)]',
}

export const OUTCOME_BAR_COLOR: Record<ShopOutcome, string> = {
    improved: 'bg-emerald-500',
    newly_activated: 'bg-[var(--sera-orange)]',
    maintained: 'bg-[var(--sera-ink-soft)]',
    dropped: 'bg-amber-500',
    no_response: 'bg-rose-500',
    pending_observation: 'bg-[var(--sera-line)]',
}

export const OUTCOME_ORDER: ShopOutcome[] = [
    'improved', 'newly_activated', 'maintained', 'dropped', 'no_response', 'pending_observation',
]

export function OutcomePill({ outcome }: { outcome: ShopOutcome }) {
    return (
        <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[outcome]}`}>
            {OUTCOME_LABEL[outcome]}
        </span>
    )
}

const PRIORITY_STYLE: Record<FollowUpPriority, string> = {
    high: 'bg-rose-50 text-rose-700 border-rose-200',
    medium: 'bg-amber-50 text-amber-800 border-amber-200',
    low: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border-[var(--sera-line)]',
    healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    observing: 'bg-[var(--sera-mist)] text-[var(--sera-muted)] border-[var(--sera-line)]',
}

export function PriorityPill({ priority }: { priority: FollowUpPriority }) {
    return (
        <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[priority]}`}>
            {FOLLOW_UP_PRIORITY_LABEL[priority]}
        </span>
    )
}

export function SegmentedOutcomeBar({ counts, total }: { counts: Record<ShopOutcome, number>; total: number }) {
    if (total <= 0) {
        return <p className="py-6 text-center text-sm text-[var(--sera-muted)]">No shops visited in this month.</p>
    }

    return (
        <div className="space-y-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--sera-mist)]">
                {OUTCOME_ORDER.map((outcome) => (
                    counts[outcome] > 0 ? (
                        <div
                            key={outcome}
                            className={OUTCOME_BAR_COLOR[outcome]}
                            style={{ width: `${(counts[outcome] / total) * 100}%` }}
                            title={`${OUTCOME_LABEL[outcome]}: ${counts[outcome]}`}
                        />
                    ) : null
                ))}
            </div>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {OUTCOME_ORDER.map((outcome) => (
                    <li key={outcome} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-[var(--sera-ink-soft)]">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_BAR_COLOR[outcome]}`} />
                            <span className="truncate">{OUTCOME_LABEL[outcome]}</span>
                        </span>
                        <span className="shrink-0 font-medium text-[var(--sera-ink)]">
                            {counts[outcome]}
                            <span className="ml-1 text-[11px] font-normal text-[var(--sera-muted)]">
                                {((counts[outcome] / total) * 100).toFixed(0)}%
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export function formatPercent(rate: number | null, fractionDigits = 1): string {
    if (rate === null || !Number.isFinite(rate)) return '—'
    return `${(rate * 100).toFixed(fractionDigits)}%`
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return '—'
    const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur',
    }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kuala_Lumpur',
    }).format(date)
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
    const escape = (cell: string | number) => `"${String(cell ?? '').replace(/"/g, '""')}"`
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
}
