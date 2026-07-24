'use client'

import { Card } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import type { ImpactStatus, FollowUpPriority } from '@/modules/roadtour/types/analytics'

export function KpiCard({ label, value, sub, icon: Icon, accent, onClick }: {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    icon?: any
    accent?: 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'cyan' | 'slate' | 'orange'
    onClick?: () => void
}) {
    // Map legacy blue/violet/cyan accents onto Serapod orange/charcoal family.
    // Keep semantic green/amber/rose for status meaning.
    const accentMap: Record<string, string> = {
        orange: 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)]',
        blue: 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)]',
        cyan: 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)]',
        violet: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)]',
        green: 'bg-emerald-50 text-emerald-700',
        amber: 'bg-amber-50 text-amber-700',
        rose: 'bg-rose-50 text-rose-700',
        slate: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)]',
    }
    const accentClass = accent ? accentMap[accent] : 'bg-[var(--sera-mist)] text-[var(--sera-ink)]'
    const isInteractive = typeof onClick === 'function'
    return (
        <Card
            className={`sera-sc-kpi flex items-start gap-3 border-[var(--sera-line)] p-4 shadow-none ${isInteractive ? 'cursor-pointer transition-colors hover:border-[var(--sera-orange)]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/30 focus-visible:ring-offset-2' : ''}`}
            onClick={onClick}
            onKeyDown={isInteractive ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onClick?.()
                }
            } : undefined}
            role={isInteractive ? 'button' : undefined}
            tabIndex={isInteractive ? 0 : undefined}
        >
            {Icon && (
                <div className={`rounded-lg p-2 ${accentClass}`}>
                    <Icon className="h-5 w-5" />
                </div>
            )}
            <div className="min-w-0">
                <div className="sera-sc-kpi__label truncate">{label}</div>
                <div className="font-display text-xl font-semibold tracking-tight text-[var(--sera-ink)] truncate sm:text-2xl">{value}</div>
                {sub && <div className="mt-0.5 text-[11px] text-[var(--sera-muted)]">{sub}</div>}
            </div>
        </Card>
    )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-2 py-16 text-[var(--sera-muted)]">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--sera-orange)]" />
            <span className="text-sm">{label}</span>
        </div>
    )
}

export function EmptyBlock({ title, description }: { title: string; description?: string }) {
    return (
        <div className="px-6 py-12 text-center text-[var(--sera-muted)]">
            <div className="font-display text-base font-semibold text-[var(--sera-ink)]">{title}</div>
            {description && <p className="mx-auto mt-1 max-w-md text-sm">{description}</p>}
        </div>
    )
}

const STATUS_STYLE: Record<ImpactStatus, string> = {
    improved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    maintained: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border border-[var(--sera-line)]',
    dropped: 'bg-rose-100 text-rose-700 border border-rose-200',
    newly_activated: 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)] border border-[var(--sera-orange)]/25',
    no_response: 'bg-amber-100 text-amber-800 border border-amber-200',
}

const STATUS_LABEL: Record<ImpactStatus, string> = {
    improved: 'Improved',
    maintained: 'Maintained',
    dropped: 'Dropped',
    newly_activated: 'Newly Activated',
    no_response: 'No Response',
}

export function StatusPill({ status }: { status: ImpactStatus }) {
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
            {STATUS_LABEL[status]}
        </span>
    )
}

const PRIORITY_STYLE: Record<FollowUpPriority, string> = {
    high: 'bg-rose-100 text-rose-700 border border-rose-200',
    medium: 'bg-amber-100 text-amber-700 border border-amber-200',
    low: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border border-[var(--sera-line)]',
    healthy: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
}

const PRIORITY_LABEL: Record<FollowUpPriority, string> = {
    high: 'High', medium: 'Medium', low: 'Low', healthy: 'Healthy',
}

export function PriorityPill({ priority }: { priority: FollowUpPriority }) {
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[priority]}`}>
            {PRIORITY_LABEL[priority]}
        </span>
    )
}

export function formatLiftPercent(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—'
    const sign = v > 0 ? '+' : ''
    return `${sign}${v.toFixed(1)}%`
}

export function formatNumber(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—'
    return new Intl.NumberFormat().format(v)
}

export function PageHeader({ overline, title, description }: { overline?: string; title: string; description?: string }) {
    return (
        <header className="min-w-0">
            <div className="sera-sc-header__bar mb-4 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
            {overline && (
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--sera-muted)]">
                    {overline}
                </p>
            )}
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--sera-ink)] sm:text-3xl">
                {title}
            </h1>
            {description && (
                <p className="mt-1.5 max-w-3xl text-sm text-[var(--sera-muted)] sm:text-base">{description}</p>
            )}
        </header>
    )
}
