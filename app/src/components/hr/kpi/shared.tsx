'use client'
/**
 * Shared KPI UI primitives used across the redesigned
 * HR > Performance > KPIs tabs (Dashboard, Periods, Objectives, Library).
 *
 * Visual language: white cards, soft borders, subtle shadow, HR blue accent,
 * compact readable tables, status badges, progress bars, selected-row highlight,
 * polished empty/loading/error states.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, ArrowUp, ArrowDown, Minus, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Inbox, FileQuestion } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Status tone map (canonical for the KPI module)
// ─────────────────────────────────────────────────────────────────────────────

export const KPI_STATUS_TONE: Record<string, string> = {
    // Period
    active: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
    draft: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    locked: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
    upcoming: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    archived: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
    // Performance
    on_track: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    at_risk: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    off_track: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    below_target: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    no_data: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
    // Workflow
    published: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    rejected: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    pending: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    submitted: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
    generated: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
    // Source
    mapped: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    unmapped: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
    valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    invalid: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    failed: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
}

export function KPIStatusBadge({ value, label }: { value?: string | null; label?: string }) {
    if (!value) return <span className="text-muted-foreground text-xs">—</span>
    const tone = KPI_STATUS_TONE[value] ?? 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    return (
        <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap',
            tone,
        )}>
            {(label ?? value).replaceAll('_', ' ')}
        </span>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIStatCard – top metric tile
// ─────────────────────────────────────────────────────────────────────────────

export type StatTone = 'blue' | 'emerald' | 'amber' | 'red' | 'slate' | 'orange'

const STAT_TONE_BG: Record<StatTone, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
    orange: 'bg-orange-50 text-orange-600',
}

export function KPIStatCard({
    label, value, hint, delta, deltaDir, tone = 'blue', icon,
}: {
    label: string
    value: React.ReactNode
    hint?: React.ReactNode
    delta?: string
    deltaDir?: 'up' | 'down' | 'flat'
    tone?: StatTone
    icon?: React.ReactNode
}) {
    return (
        <Card className="border-slate-200/80 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
            <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-1.5 text-2xl font-semibold text-slate-900 leading-none">{value}</p>
                        {delta && (
                            <p className={cn(
                                'mt-2 text-xs font-medium inline-flex items-center gap-1',
                                deltaDir === 'up' && 'text-emerald-600',
                                deltaDir === 'down' && 'text-red-600',
                                (!deltaDir || deltaDir === 'flat') && 'text-slate-500',
                            )}>
                                {deltaDir === 'up' && <ArrowUp className="h-3 w-3" />}
                                {deltaDir === 'down' && <ArrowDown className="h-3 w-3" />}
                                {deltaDir === 'flat' && <Minus className="h-3 w-3" />}
                                {delta}
                            </p>
                        )}
                        {hint && !delta && (
                            <p className="mt-2 text-xs text-slate-500">{hint}</p>
                        )}
                    </div>
                    {icon && (
                        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg shrink-0', STAT_TONE_BG[tone])}>
                            {icon}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIProgressBar
// ─────────────────────────────────────────────────────────────────────────────

export function KPIProgressBar({
    value, max = 100, tone = 'blue', showLabel = false, className,
}: {
    value: number
    max?: number
    tone?: 'blue' | 'emerald' | 'amber' | 'red'
    showLabel?: boolean
    className?: string
}) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100))
    const bar = {
        blue: 'bg-blue-500',
        emerald: 'bg-emerald-500',
        amber: 'bg-amber-500',
        red: 'bg-red-500',
    }[tone]
    return (
        <div className={cn('flex items-center gap-2 min-w-[120px]', className)}>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
            </div>
            {showLabel && (
                <span className="text-xs font-medium text-slate-700 tabular-nums w-9 text-right">{Math.round(pct)}%</span>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIEmptyState
// ─────────────────────────────────────────────────────────────────────────────

export function KPIEmptyState({
    title, description, actions, icon, compact, searchMode,
}: {
    title: string
    description?: string
    actions?: React.ReactNode
    icon?: React.ReactNode
    compact?: boolean
    searchMode?: boolean
}) {
    return (
        <div className={cn(
            'flex flex-col items-center justify-center text-center',
            compact ? 'py-8 px-4' : 'py-14 px-6',
        )}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 mb-4">
                {icon ?? (searchMode ? <FileQuestion className="h-5 w-5" /> : <Inbox className="h-5 w-5" />)}
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {description && (
                <p className="mt-1 text-sm text-slate-500 max-w-md">{description}</p>
            )}
            {actions && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPILoadingSkeleton (rows)
// ─────────────────────────────────────────────────────────────────────────────

export function KPITableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
    return (
        <div className="divide-y divide-slate-100">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                    {Array.from({ length: cols }).map((__, j) => (
                        <div key={j} className={cn(
                            'h-3 rounded bg-slate-100 animate-pulse',
                            j === 0 ? 'w-24' : j === 1 ? 'flex-1' : 'w-16',
                        )} />
                    ))}
                </div>
            ))}
        </div>
    )
}

export function KPICenteredLoader({ label }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {label ?? 'Loading…'}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIChartCard – titled white card with optional toolbar
// ─────────────────────────────────────────────────────────────────────────────

export function KPIChartCard({
    title, description, action, children, className,
}: {
    title: string
    description?: string
    action?: React.ReactNode
    children: React.ReactNode
    className?: string
}) {
    return (
        <Card className={cn('border-slate-200/80 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]', className)}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                <div>
                    <CardTitle className="text-base text-slate-900">{title}</CardTitle>
                    {description && <CardDescription className="text-xs text-slate-500 mt-0.5">{description}</CardDescription>}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </CardHeader>
            <CardContent className="pt-0">{children}</CardContent>
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIDetailPanel – right-side detail container
// ─────────────────────────────────────────────────────────────────────────────

export function KPIDetailPanel({
    title, status, subtitle, children, footer, accent = true,
}: {
    title: React.ReactNode
    status?: React.ReactNode
    subtitle?: React.ReactNode
    children: React.ReactNode
    footer?: React.ReactNode
    accent?: boolean
}) {
    return (
        <div className={cn(
            'rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden',
            accent && 'border-l-[3px] border-l-blue-500',
        )}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{title}</h3>
                    {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
                </div>
                {status && <div className="shrink-0">{status}</div>}
            </div>
            <div className="p-4 space-y-4 text-sm">{children}</div>
            {footer && <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">{footer}</div>}
        </div>
    )
}

export function KPIDetailRow({
    icon, label, value,
}: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-500 min-w-0">
                {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
                <span className="truncate">{label}</span>
            </div>
            <div className="font-medium text-slate-900 text-right truncate">{value}</div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction indicator (Higher / Lower / Band)
// ─────────────────────────────────────────────────────────────────────────────

export function KPIDirection({ value }: { value?: string | null }) {
    if (!value) return <span className="text-muted-foreground">—</span>
    if (value === 'higher_is_better') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                <ArrowUp className="h-3.5 w-3.5" />
                Higher is better
            </span>
        )
    }
    if (value === 'lower_is_better') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-rose-700">
                <ArrowDown className="h-3.5 w-3.5" />
                Lower is better
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs text-slate-700">
            <Minus className="h-3.5 w-3.5" />
            {value.replaceAll('_', ' ')}
        </span>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Perspective dot/label
// ─────────────────────────────────────────────────────────────────────────────

export const PERSPECTIVE_TONE: Record<string, string> = {
    financial: 'bg-blue-500',
    customer: 'bg-emerald-500',
    process: 'bg-violet-500',
    internal_process: 'bg-violet-500',
    learning_growth: 'bg-orange-500',
    people: 'bg-pink-500',
    quality: 'bg-cyan-500',
    operations: 'bg-indigo-500',
    unspecified: 'bg-slate-400',
}

export function PerspectiveLabel({ value }: { value?: string | null }) {
    const key = (value ?? 'unspecified').toLowerCase()
    const dot = PERSPECTIVE_TONE[key] ?? PERSPECTIVE_TONE.unspecified
    return (
        <span className="inline-flex items-center gap-2 text-sm text-slate-700">
            <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
            <span className="capitalize">{(value ?? 'unspecified').replaceAll('_', ' ')}</span>
        </span>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status icons (for inline lists like Recent Activity / Action Items)
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_ICON = {
    on_track: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    at_risk: <AlertTriangle className="h-4 w-4 text-amber-600" />,
    off_track: <XCircle className="h-4 w-4 text-red-600" />,
    below_target: <XCircle className="h-4 w-4 text-red-600" />,
    no_data: <MinusCircle className="h-4 w-4 text-slate-400" />,
}

// ─────────────────────────────────────────────────────────────────────────────
// Action button helper – disabled w/ tooltip-style hint when not available
// ─────────────────────────────────────────────────────────────────────────────

export function KPIUnavailableButton({
    children, reason = 'Not available yet', ...rest
}: React.ComponentProps<typeof Button> & { reason?: string }) {
    return (
        <Button {...rest} disabled title={reason}>
            {children}
        </Button>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Donut chart (SVG, no deps)
// ─────────────────────────────────────────────────────────────────────────────

export function KPIDonut({
    segments, total, centerLabel, centerSub, size = 180,
}: {
    segments: { value: number; color: string; label?: string }[]
    total: number
    centerLabel?: React.ReactNode
    centerSub?: React.ReactNode
    size?: number
}) {
    const radius = (size - 20) / 2
    const cx = size / 2
    const cy = size / 2
    const circumference = 2 * Math.PI * radius
    const sum = segments.reduce((a, s) => a + s.value, 0) || 1
    let offset = 0
    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={14} />
                {segments.map((s, i) => {
                    const len = (s.value / sum) * circumference
                    const dash = `${len} ${circumference - len}`
                    const seg = (
                        <circle
                            key={i}
                            cx={cx} cy={cy} r={radius}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={14}
                            strokeDasharray={dash}
                            strokeDashoffset={-offset}
                            strokeLinecap="butt"
                        />
                    )
                    offset += len
                    return seg
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-2xl font-semibold text-slate-900 leading-none">{centerLabel ?? total}</div>
                {centerSub && <div className="text-xs text-slate-500 mt-1">{centerSub}</div>}
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline / line chart (SVG, no deps)
// ─────────────────────────────────────────────────────────────────────────────

export function KPILineChart({
    points, height = 200, color = '#3b82f6', xLabels,
}: {
    points: number[]
    height?: number
    color?: string
    xLabels?: string[]
}) {
    if (!points.length) return null
    const width = 600
    const padding = { top: 16, right: 12, bottom: 28, left: 28 }
    const innerW = width - padding.left - padding.right
    const innerH = height - padding.top - padding.bottom
    const max = Math.max(100, ...points)
    const min = 0
    const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW
    const toX = (i: number) => padding.left + i * stepX
    const toY = (v: number) => padding.top + innerH - ((v - min) / (max - min || 1)) * innerH
    const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ')
    const gridLines = [0, 25, 50, 75, 100]
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
            {gridLines.map(g => (
                <g key={g}>
                    <line x1={padding.left} x2={width - padding.right} y1={toY(g)} y2={toY(g)} stroke="#f1f5f9" strokeWidth={1} />
                    <text x={4} y={toY(g) + 3} fontSize={10} fill="#94a3b8">{g}%</text>
                </g>
            ))}
            <path d={path} fill="none" stroke={color} strokeWidth={2} />
            {points.map((v, i) => (
                <g key={i}>
                    <circle cx={toX(i)} cy={toY(v)} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
                    <text x={toX(i)} y={toY(v) - 8} fontSize={10} textAnchor="middle" fill="#475569">
                        {v.toFixed(1)}%
                    </text>
                </g>
            ))}
            {xLabels && xLabels.map((lbl, i) => (
                <text key={i} x={toX(i)} y={height - 8} fontSize={10} textAnchor="middle" fill="#64748b">{lbl}</text>
            ))}
        </svg>
    )
}
