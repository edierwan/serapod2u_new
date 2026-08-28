'use client'

// Presentation primitives shared by the four RoadTour Reporting sections.
// Colour discipline: orange is the Serapod accent only, green means healthy,
// amber means attention, red is reserved for genuinely high-priority or overdue.

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TableHead } from '@/components/ui/table'
import { OUTCOME_LABEL, type ShopOutcome } from '@/modules/roadtour/lib/reporting/impactModel'
import { FOLLOW_UP_PRIORITY_LABEL, type FollowUpPriority } from '@/modules/roadtour/lib/reporting/followUp'
import type { SortState } from '@/modules/roadtour/lib/reporting/tableSort'

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

/**
 * A clickable table header. Only sortable columns get one, so an unsorted
 * header never advertises an interaction it does not have.
 */
export function SortableHead<Key extends string>({
    label, sortKey, sort, onSort, className,
}: {
    label: string
    sortKey: Key
    sort: SortState<Key> | null
    onSort: (key: Key) => void
    className?: string
}) {
    const active = sort?.key === sortKey
    const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'
    const Icon = active ? (sort!.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown

    return (
        <TableHead className={className} aria-sort={ariaSort}>
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={`group inline-flex items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/40 ${active ? 'text-[var(--sera-ink)]' : ''}`}
            >
                <span>{label}</span>
                <Icon className={`h-3 w-3 shrink-0 ${active ? 'text-[var(--sera-orange)]' : 'text-[var(--sera-muted)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'}`} />
            </button>
        </TableHead>
    )
}

/**
 * The numeric value of a KPI card, made into a drill-down affordance. A zero
 * KPI has nothing to show, so it stays a plain number.
 */
export function KpiDrilldownValue({ value, label, onOpen }: {
    value: number
    label: string
    onOpen: () => void
}) {
    if (value <= 0) return <>{value}</>

    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`${label}: show the ${value} matching records`}
            className="cursor-pointer rounded-sm underline decoration-dotted decoration-[var(--sera-muted)] underline-offset-4 transition-colors hover:text-[var(--sera-orange-deep)] hover:decoration-[var(--sera-orange)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/40"
        >
            {value}
        </button>
    )
}

/** Compact, scrollable dialog used by every KPI drill-down. */
export function KpiDrilldownDialog({ open, onOpenChange, title, subtitle, children }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    subtitle?: string
    children: React.ReactNode
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden p-0">
                <DialogHeader className="border-b border-[var(--sera-line)] px-5 py-4">
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    {subtitle && <p className="text-xs text-[var(--sera-muted)]">{subtitle}</p>}
                </DialogHeader>
                <div className="max-h-[62vh] overflow-auto px-1 pb-3">
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** Consistent empty state inside a drill-down dialog. */
export function KpiDrilldownEmpty({ message = 'No records' }: { message?: string }) {
    return <p className="px-5 py-10 text-center text-sm text-[var(--sera-muted)]">{message}</p>
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
