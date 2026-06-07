'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import type { ImpactStatus, FollowUpPriority } from '@/modules/roadtour/types/analytics'

export function KpiCard({ label, value, sub, icon: Icon, accent, onClick }: {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    icon?: any
    accent?: 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'cyan' | 'slate'
    onClick?: () => void
}) {
    const accentMap: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700',
        green: 'bg-emerald-50 text-emerald-700',
        violet: 'bg-violet-50 text-violet-700',
        amber: 'bg-amber-50 text-amber-700',
        rose: 'bg-rose-50 text-rose-700',
        cyan: 'bg-cyan-50 text-cyan-700',
        slate: 'bg-slate-50 text-slate-700',
    }
    const accentClass = accent ? accentMap[accent] : 'bg-muted text-foreground'
    const isInteractive = typeof onClick === 'function'
    return (
        <Card
            className={`p-4 flex items-start gap-3 ${isInteractive ? 'cursor-pointer transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : ''}`}
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
                <div className="text-xs font-medium text-muted-foreground truncate">{label}</div>
                <div className="text-xl sm:text-2xl font-bold text-foreground truncate">{value}</div>
                {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
            </div>
        </Card>
    )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{label}</span>
        </div>
    )
}

export function EmptyBlock({ title, description }: { title: string; description?: string }) {
    return (
        <div className="text-center py-12 px-6 text-muted-foreground">
            <div className="text-base font-medium text-foreground">{title}</div>
            {description && <p className="text-sm mt-1 max-w-md mx-auto">{description}</p>}
        </div>
    )
}

const STATUS_STYLE: Record<ImpactStatus, string> = {
    improved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    maintained: 'bg-sky-100 text-sky-700 border border-sky-200',
    dropped: 'bg-rose-100 text-rose-700 border border-rose-200',
    newly_activated: 'bg-violet-100 text-violet-700 border border-violet-200',
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
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status]}`}>
            {STATUS_LABEL[status]}
        </span>
    )
}

const PRIORITY_STYLE: Record<FollowUpPriority, string> = {
    high: 'bg-rose-100 text-rose-700 border border-rose-200',
    medium: 'bg-amber-100 text-amber-700 border border-amber-200',
    low: 'bg-slate-100 text-slate-700 border border-slate-200',
    healthy: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
}

const PRIORITY_LABEL: Record<FollowUpPriority, string> = {
    high: 'High', medium: 'Medium', low: 'Low', healthy: 'Healthy',
}

export function PriorityPill({ priority }: { priority: FollowUpPriority }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLE[priority]}`}>
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
        <div>
            {overline && <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">{overline}</div>}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            {description && <p className="text-sm sm:text-base text-muted-foreground mt-1 max-w-3xl">{description}</p>}
        </div>
    )
}
