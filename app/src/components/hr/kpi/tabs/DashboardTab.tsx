'use client'
/**
 * Dashboard tab — Executive overview for HR > Performance > KPIs.
 * Uses /api/hr/kpi/dashboard for stats, and /api/hr/kpi/periods for the period name.
 * Real activity feed/action-items come from on-track/at-risk/no_data counts;
 * any feature without a backend is shown as polished hints (no broken buttons).
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
    ClipboardList, Gauge, CheckCircle2, AlertTriangle, Database, TrendingUp,
    Activity, ArrowRight, Plus, Upload, Zap,
} from 'lucide-react'
import {
    KPIStatCard, KPIChartCard, KPIEmptyState, KPICenteredLoader,
    KPIDonut, KPILineChart, KPIProgressBar, PerspectiveLabel,
} from '../shared'
import { kpiFetch, DashboardSummary, Period } from '../types'

export function KPIDashboardTab({
    periodId, periods, onSwitchTab,
}: {
    periodId: string | null
    periods: Period[]
    onSwitchTab?: (tab: string) => void
}) {
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        const url = '/api/hr/kpi/dashboard' + (periodId ? `?period_id=${periodId}` : '')
        const r = await kpiFetch<DashboardSummary>(url)
        if (r.success) setSummary(r.data ?? null)
        else setError(r.error ?? 'Failed to load dashboard')
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const period = useMemo(() => periods.find(p => p.id === periodId) ?? null, [periods, periodId])

    if (loading) return <KPICenteredLoader label="Loading executive overview…" />
    if (error) {
        return (
            <KPIEmptyState
                title="Couldn't load dashboard"
                description={error}
                actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
            />
        )
    }

    const sc = summary?.scorecards
    const totalSc = sc?.total ?? 0

    // Derived KPIs (use scorecards.by_status which is the canonical source)
    const byStatus = sc?.by_status ?? {}
    const onTrack = byStatus.on_track ?? 0
    const atRisk = byStatus.at_risk ?? 0
    const noData = (byStatus.no_data ?? 0) + (totalSc - onTrack - atRisk - (byStatus.off_track ?? 0) - (byStatus.below_target ?? 0) > 0
        ? Math.max(0, totalSc - onTrack - atRisk - (byStatus.off_track ?? 0) - (byStatus.below_target ?? 0) - (byStatus.no_data ?? 0))
        : 0)
    const offTrack = (byStatus.off_track ?? 0) + (byStatus.below_target ?? 0)

    const pct = (n: number) => totalSc > 0 ? ((n / totalSc) * 100) : 0

    const noPeriod = !periodId
    const hasNoData = totalSc === 0 && (summary?.items?.total ?? 0) === 0

    if (noPeriod || hasNoData) {
        return (
            <div className="space-y-4 mt-4">
                <KPIEmptyState
                    title="No KPI performance data yet"
                    description="Create targets, import actuals, and generate scorecards to start tracking organisational performance."
                    icon={<TrendingUp className="h-5 w-5" />}
                    actions={
                        <>
                            <Button size="sm" onClick={() => onSwitchTab?.('targets')}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" />Create Target
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onSwitchTab?.('data')}>
                                <Upload className="h-3.5 w-3.5 mr-1.5" />Import Data
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onSwitchTab?.('scorecards')}>
                                <Zap className="h-3.5 w-3.5 mr-1.5" />Generate Scorecards
                            </Button>
                        </>
                    }
                />
            </div>
        )
    }

    return (
        <div className="space-y-4 mt-4">
            {/* Top KPI stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <KPIStatCard
                    label="Active Scorecards"
                    value={totalSc}
                    icon={<ClipboardList className="h-4 w-4" />}
                    tone="blue"
                    hint={period ? `${period.name}` : 'Selected period'}
                />
                <KPIStatCard
                    label="Avg Overall Score"
                    value={sc?.avg_overall_score != null ? `${Number(sc.avg_overall_score).toFixed(1)}%` : '—'}
                    icon={<Gauge className="h-4 w-4" />}
                    tone="orange"
                    hint="Across all scorecards"
                />
                <KPIStatCard
                    label="On Track"
                    value={onTrack}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone="emerald"
                    hint={`${pct(onTrack).toFixed(1)}% of total`}
                />
                <KPIStatCard
                    label="At Risk"
                    value={atRisk + offTrack}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="amber"
                    hint={`${pct(atRisk + offTrack).toFixed(1)}% of total`}
                />
                <KPIStatCard
                    label="No Data"
                    value={noData}
                    icon={<Database className="h-4 w-4" />}
                    tone="slate"
                    hint={`${pct(noData).toFixed(1)}% of total`}
                />
            </div>

            {/* Main charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <KPIChartCard
                    title="Performance Trend"
                    description="Average overall score over time"
                    className="lg:col-span-1"
                >
                    <TrendChart current={sc?.avg_overall_score ?? null} />
                </KPIChartCard>

                <KPIChartCard
                    title="Scorecard Status"
                    description="Distribution of scorecards by status"
                >
                    <div className="flex items-center gap-4">
                        <KPIDonut
                            total={totalSc}
                            centerLabel={totalSc}
                            centerSub="Total"
                            segments={[
                                { value: onTrack, color: '#10b981' },
                                { value: atRisk + offTrack, color: '#f59e0b' },
                                { value: noData, color: '#cbd5e1' },
                            ]}
                        />
                        <div className="flex-1 space-y-2 text-sm">
                            <Legend dot="bg-emerald-500" label="On Track" value={onTrack} total={totalSc} />
                            <Legend dot="bg-amber-500" label="At Risk" value={atRisk + offTrack} total={totalSc} />
                            <Legend dot="bg-slate-300" label="No Data" value={noData} total={totalSc} />
                        </div>
                    </div>
                </KPIChartCard>

                <KPIChartCard
                    title="Perspective Distribution"
                    description="Score by Balanced Scorecard perspective"
                >
                    {(summary?.perspectives ?? []).length === 0 ? (
                        <KPIEmptyState compact title="No perspective data" description="Data appears once scorecard items are calculated." />
                    ) : (
                        <div className="space-y-3">
                            {(summary?.perspectives ?? []).map(p => (
                                <div key={p.perspective}>
                                    <div className="flex items-center justify-between mb-1">
                                        <PerspectiveLabel value={p.perspective} />
                                        <span className="text-xs font-semibold text-slate-700 tabular-nums">
                                            {p.avg_score != null ? `${Number(p.avg_score).toFixed(1)}%` : '—'}
                                        </span>
                                    </div>
                                    <KPIProgressBar value={Number(p.avg_score ?? 0)} tone="blue" />
                                </div>
                            ))}
                        </div>
                    )}
                </KPIChartCard>
            </div>

            {/* Lower row: recent activity + action items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <KPIChartCard
                    title="Recent Activity"
                    description="Latest KPI performance activities"
                    action={<Button size="sm" variant="ghost" disabled title="Activity feed not available yet">View All Activity</Button>}
                >
                    <RecentActivity period={period} summary={summary} />
                </KPIChartCard>

                <KPIChartCard
                    title="Action Items"
                    description="Items requiring attention"
                    action={<Button size="sm" variant="ghost" disabled title="Action items inbox not available yet">View All</Button>}
                >
                    <ActionItems
                        atRisk={atRisk + offTrack}
                        noData={noData}
                        onSwitchTab={onSwitchTab}
                    />
                </KPIChartCard>
            </div>
        </div>
    )
}

function Legend({ dot, label, value, total }: { dot: string; label: string; value: number; total: number }) {
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
    return (
        <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-slate-600">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {label}
            </span>
            <span className="text-slate-900 font-medium tabular-nums">
                {value} <span className="text-slate-400">({pct}%)</span>
            </span>
        </div>
    )
}

function TrendChart({ current }: { current: number | null }) {
    // We do not have historical period scores in a single endpoint.
    // Plot the single current period score so the card is informative,
    // not fabricated. Empty state if no score.
    if (current == null) {
        return (
            <KPIEmptyState
                compact
                title="No trend data yet"
                description="Trend appears after multiple periods have scorecards."
            />
        )
    }
    return (
        <div>
            <KPILineChart
                points={[current]}
                xLabels={['Current']}
                height={200}
            />
            <p className="text-[11px] text-slate-400 mt-2 text-center">
                Multi-period trend will appear once additional periods have completed scorecards.
            </p>
        </div>
    )
}

function RecentActivity({ period, summary }: { period: Period | null; summary: DashboardSummary | null }) {
    // Derive activity from currently available data — no fabrication.
    const items: { icon: React.ReactNode; title: string; subtitle: string; time: string }[] = []

    if (period) {
        items.push({
            icon: <Activity className="h-4 w-4 text-blue-600" />,
            title: `${period.name} period is ${period.status}`,
            subtitle: `Period type: ${period.period_type.replaceAll('_', ' ')}`,
            time: '—',
        })
    }
    if ((summary?.scorecards.total ?? 0) > 0) {
        items.push({
            icon: <ClipboardList className="h-4 w-4 text-blue-600" />,
            title: `${summary?.scorecards.total} scorecards in this period`,
            subtitle: summary?.scorecards.avg_overall_score != null
                ? `Average score ${Number(summary.scorecards.avg_overall_score).toFixed(1)}%`
                : 'Awaiting actuals',
            time: '—',
        })
    }
    if ((summary?.items?.total ?? 0) > 0) {
        items.push({
            icon: <Gauge className="h-4 w-4 text-blue-600" />,
            title: `${summary?.items?.total} KPI items tracked`,
            subtitle: 'Across all scorecards',
            time: '—',
        })
    }
    if (items.length === 0) {
        return <KPIEmptyState compact title="No recent activity" description="Activity will appear once data is recorded." />
    }
    return (
        <div className="divide-y divide-slate-100 -mx-2">
            {items.map((it, i) => (
                <div key={i} className="flex items-start gap-3 px-2 py-3">
                    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 shrink-0">{it.icon}</div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{it.title}</p>
                        <p className="text-xs text-slate-500 truncate">{it.subtitle}</p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{it.time}</span>
                </div>
            ))}
        </div>
    )
}

function ActionItems({
    atRisk, noData, onSwitchTab,
}: { atRisk: number; noData: number; onSwitchTab?: (tab: string) => void }) {
    const items: { icon: React.ReactNode; title: string; subtitle: string; action: string; tab: string }[] = []
    if (atRisk > 0) {
        items.push({
            icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
            title: `${atRisk} scorecards are at risk`,
            subtitle: 'Immediate attention recommended',
            action: 'Review Scorecards',
            tab: 'scorecards',
        })
    }
    if (noData > 0) {
        items.push({
            icon: <Database className="h-4 w-4 text-slate-500" />,
            title: `${noData} scorecards have no data`,
            subtitle: 'Data update required',
            action: 'Update Data',
            tab: 'data',
        })
    }
    if (items.length === 0) {
        return <KPIEmptyState compact title="All clear" description="No items currently need attention." />
    }
    return (
        <div className="divide-y divide-slate-100 -mx-2">
            {items.map((it, i) => (
                <div key={i} className="flex items-start gap-3 px-2 py-3">
                    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 shrink-0">{it.icon}</div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{it.title}</p>
                        <p className="text-xs text-slate-500 truncate">{it.subtitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => onSwitchTab?.(it.tab)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 shrink-0"
                    >
                        {it.action}<ArrowRight className="h-3 w-3" />
                    </button>
                </div>
            ))}
        </div>
    )
}
