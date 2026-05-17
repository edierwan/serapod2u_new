'use client'
/**
 * Reports tab — Performance summaries, perspective breakdown, recent + scheduled reports.
 *
 * Top filter row: Report Type, Perspective, View By, Date Range + Export PDF / Share / More
 * Stat cards: Overall Score / On Track / At Risk / Coverage
 * Main content:
 *   - Score Trend chart (current period only — historical not available)
 *   - Performance by Perspective (bars)
 *   - Summary by Department (table)
 *   - Recent Reports (disabled placeholder list)
 *   - Scheduled Reports (disabled placeholder list)
 *
 * Backed by:
 *   GET /api/hr/kpi/reports/summary?period_id=…
 *   GET /api/hr/kpi/dashboard?period_id=…
 *   GET /api/hr/kpi/scorecards?period_id=…
 *
 * Generate Report / Schedule Report / Export / Share / Manage Schedules are disabled
 * with "Not available yet" tooltips — no backend endpoints exist for them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity, CheckCircle2, AlertTriangle, PieChart, FileDown, Share2, MoreHorizontal,
    Calendar, ChevronDown, FileText, Download, Loader2, CalendarClock, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    KPIStatCard, KPIEmptyState, KPICenteredLoader, KPIChartCard,
    KPILineChart, KPIProgressBar, PERSPECTIVE_TONE, KPIStatusBadge,
} from '../shared'
import { kpiFetch, DashboardSummary, Period, formatDate, formatDateRange, PERSPECTIVE_OPTIONS } from '../types'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────
interface ReportSummaryRow {
    id: string
    scorecard_level: string
    department_id?: string | null
    overall_score: number | null
    grade?: string | null
    item_status_counts?: {
        on_track?: number
        at_risk?: number
        below_target?: number
        no_data?: number
    }
}

// ── Helpers ──────────────────────────────────────────────────────
function shortId(id?: string | null) {
    if (!id) return 'Unassigned'
    return id.length > 10 ? id.slice(0, 8) + '…' : id
}

// ── Main ─────────────────────────────────────────────────────────
export function KPIReportsTab({
    periodId, periods, periodName,
}: {
    periodId: string | null
    periods: Period[]
    periodName?: string | null
}) {
    const [summary, setSummary] = useState<ReportSummaryRow[]>([])
    const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [reportType, setReportType] = useState('performance_summary')
    const [perspective, setPerspective] = useState('all')
    const [viewBy, setViewBy] = useState('department')

    const load = useCallback(async () => {
        if (!periodId) { setSummary([]); setDashboard(null); setLoading(false); return }
        setLoading(true)
        setError(null)
        const [s, d] = await Promise.all([
            kpiFetch<ReportSummaryRow[]>(`/api/hr/kpi/reports/summary?period_id=${periodId}`),
            kpiFetch<DashboardSummary>(`/api/hr/kpi/dashboard?period_id=${periodId}`),
        ])
        if (!s.success) setError(s.error ?? 'Failed to load report data')
        if (s.success && s.data) setSummary(s.data)
        if (d.success && d.data) setDashboard(d.data)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const stats = useMemo(() => {
        const totals = summary.reduce((acc, r) => {
            acc.onTrack += r.item_status_counts?.on_track ?? 0
            acc.atRisk += (r.item_status_counts?.at_risk ?? 0) + (r.item_status_counts?.below_target ?? 0)
            acc.noData += r.item_status_counts?.no_data ?? 0
            return acc
        }, { onTrack: 0, atRisk: 0, noData: 0 })
        const allItems = totals.onTrack + totals.atRisk + totals.noData
        const scoredItems = allItems - totals.noData
        const coverage = allItems > 0 ? Math.round((scoredItems / allItems) * 100) : 0
        const avgScore = dashboard?.scorecards?.avg_overall_score ?? null
        return {
            overallScore: avgScore != null ? Number(avgScore) : null,
            onTrack: totals.onTrack,
            atRisk: totals.atRisk,
            noData: totals.noData,
            allItems,
            coverage,
        }
    }, [summary, dashboard])

    const perspectiveData = useMemo(() => {
        if (!dashboard?.perspectives) return []
        return dashboard.perspectives.map(p => ({
            perspective: p.perspective,
            avgScore: p.avg_score != null ? Number(p.avg_score) : null,
        }))
    }, [dashboard])

    // Filter summary by perspective if a specific one is chosen — but reports/summary
    // does not carry perspective. Filter perspectiveData instead.
    const filteredPerspectives = useMemo(() => {
        if (perspective === 'all') return perspectiveData
        return perspectiveData.filter(p => p.perspective === perspective)
    }, [perspectiveData, perspective])

    const trendPoints = useMemo(() => {
        if (stats.overallScore == null) return []
        return [stats.overallScore]
    }, [stats.overallScore])

    const trendLabels = useMemo(() => [periodName ?? 'Current'], [periodName])

    const departmentRows = useMemo(() => {
        if (viewBy !== 'department') return []
        const byDept: Record<string, {
            id: string
            onTrack: number
            atRisk: number
            noData: number
            scores: number[]
        }> = {}
        for (const r of summary) {
            const key = r.department_id ?? 'unassigned'
            if (!byDept[key]) byDept[key] = { id: key, onTrack: 0, atRisk: 0, noData: 0, scores: [] }
            byDept[key].onTrack += r.item_status_counts?.on_track ?? 0
            byDept[key].atRisk += (r.item_status_counts?.at_risk ?? 0) + (r.item_status_counts?.below_target ?? 0)
            byDept[key].noData += r.item_status_counts?.no_data ?? 0
            if (r.overall_score != null) byDept[key].scores.push(Number(r.overall_score))
        }
        return Object.values(byDept).map(d => {
            const total = d.onTrack + d.atRisk + d.noData
            const coverage = total > 0 ? Math.round(((total - d.noData) / total) * 100) : 0
            const avgScore = d.scores.length ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : null
            return {
                ...d,
                total,
                coverage,
                avgScore,
            }
        })
    }, [summary, viewBy])

    return (
        <div className="space-y-4 mt-4">
            {/* Filter bar */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <Label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Report Type</Label>
                        <Select value={reportType} onValueChange={setReportType}>
                            <SelectTrigger className="w-[180px] h-9 mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="performance_summary">Performance Summary</SelectItem>
                                <SelectItem value="scorecard_detail" disabled>Scorecard Detail · Not available yet</SelectItem>
                                <SelectItem value="at_risk_report" disabled>At-Risk Report · Not available yet</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Perspective</Label>
                        <Select value={perspective} onValueChange={setPerspective}>
                            <SelectTrigger className="w-[160px] h-9 mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Perspectives</SelectItem>
                                {PERSPECTIVE_OPTIONS.map(p => (
                                    <SelectItem key={p} value={p} className="capitalize">{p.replaceAll('_', ' ')}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">View By</Label>
                        <Select value={viewBy} onValueChange={setViewBy}>
                            <SelectTrigger className="w-[140px] h-9 mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="department">Department</SelectItem>
                                <SelectItem value="employee" disabled>Employee · Not available yet</SelectItem>
                                <SelectItem value="role" disabled>Role · Not available yet</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Date Range</Label>
                        <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 h-9 text-xs text-slate-600">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            <span>{periodName ?? 'Select a period'}</span>
                            <ChevronDown className="h-3 w-3 text-slate-400" />
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled title="PDF export not available yet">
                        <FileDown className="h-3.5 w-3.5 mr-1.5" />Export PDF
                    </Button>
                    <Button variant="outline" size="sm" disabled title="Sharing not available yet">
                        <Share2 className="h-3.5 w-3.5 mr-1.5" />Share
                    </Button>
                    <Button variant="ghost" size="icon" disabled title="More actions not available yet" className="h-9 w-9">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPIStatCard
                    label="Overall Score"
                    value={stats.overallScore != null ? `${stats.overallScore.toFixed(1)}%` : '—'}
                    hint={periodName ? `Period: ${periodName}` : 'Select a period'}
                    icon={<Activity className="h-4 w-4" />} tone="blue"
                />
                <KPIStatCard
                    label="On Track" value={stats.onTrack}
                    hint={stats.allItems > 0 ? `${Math.round((stats.onTrack / stats.allItems) * 100)}% of total` : '—'}
                    icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald"
                />
                <KPIStatCard
                    label="At Risk" value={stats.atRisk}
                    hint={stats.allItems > 0 ? `${Math.round((stats.atRisk / stats.allItems) * 100)}% of total` : '—'}
                    icon={<AlertTriangle className="h-4 w-4" />} tone={stats.atRisk > 0 ? 'amber' : 'slate'}
                />
                <KPIStatCard
                    label="Coverage"
                    value={`${stats.coverage}%`}
                    hint={`${stats.allItems - stats.noData} of ${stats.allItems} items`}
                    icon={<PieChart className="h-4 w-4" />} tone="orange"
                />
            </div>

            {/* Charts row */}
            {loading ? (
                <div className="rounded-lg border border-slate-200 bg-white"><KPICenteredLoader /></div>
            ) : !periodId ? (
                <KPIEmptyState
                    title="Select a period"
                    description="Choose a performance period to generate the report."
                />
            ) : error ? (
                <KPIEmptyState
                    title="Unable to load report"
                    description={error}
                    actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <KPIChartCard
                            className="lg:col-span-1"
                            title="Score Trend"
                            description="Average overall score"
                            action={
                                <Select value="current" onValueChange={() => { }}>
                                    <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="current">Current Period</SelectItem>
                                        <SelectItem value="last_6" disabled>Last 6 Periods · Not available yet</SelectItem>
                                    </SelectContent>
                                </Select>
                            }
                        >
                            {trendPoints.length === 0 ? (
                                <p className="text-xs text-slate-400 py-8 text-center">No score data yet.</p>
                            ) : (
                                <>
                                    <KPILineChart points={trendPoints} xLabels={trendLabels} height={200} />
                                    <p className="text-[11px] text-slate-500 mt-2">
                                        Historical trend across multiple periods is not yet available — only the current period is plotted.
                                    </p>
                                </>
                            )}
                        </KPIChartCard>

                        <KPIChartCard
                            className="lg:col-span-1"
                            title="Performance by Perspective"
                            description="Average score by perspective"
                        >
                            {filteredPerspectives.length === 0 ? (
                                <p className="text-xs text-slate-400 py-8 text-center">No perspective data yet.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {filteredPerspectives.map(p => {
                                        const dot = PERSPECTIVE_TONE[p.perspective] ?? PERSPECTIVE_TONE.unspecified
                                        const pct = p.avgScore != null ? Math.max(0, Math.min(100, p.avgScore)) : 0
                                        return (
                                            <li key={p.perspective} className="text-sm">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="inline-flex items-center gap-2 text-slate-700 capitalize">
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
                                                        {p.perspective.replaceAll('_', ' ')}
                                                    </span>
                                                    <span className="font-medium tabular-nums text-slate-900">
                                                        {p.avgScore != null ? `${p.avgScore.toFixed(1)}%` : '—'}
                                                    </span>
                                                </div>
                                                <KPIProgressBar value={pct} tone={pct >= 70 ? 'emerald' : pct >= 40 ? 'amber' : 'red'} />
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </KPIChartCard>

                        <KPIChartCard
                            className="lg:col-span-1"
                            title={viewBy === 'department' ? 'Summary by Department' : 'Summary'}
                            description="Average score and status distribution"
                        >
                            {departmentRows.length === 0 ? (
                                <p className="text-xs text-slate-400 py-8 text-center">No grouped data yet.</p>
                            ) : (
                                <div className="overflow-x-auto -mx-2">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-slate-100 hover:bg-transparent">
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide px-2">Department</TableHead>
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide text-right px-2">Score</TableHead>
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide text-right px-2">On Track</TableHead>
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide text-right px-2">At Risk</TableHead>
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide text-right px-2">No Data</TableHead>
                                                <TableHead className="h-8 text-[10px] font-semibold uppercase text-slate-500 tracking-wide text-right px-2">Coverage</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {departmentRows.map(d => (
                                                <TableRow key={d.id} className="border-slate-100 hover:bg-slate-50/60">
                                                    <TableCell className="px-2 py-1.5 text-xs text-slate-700 font-mono">{shortId(d.id)}</TableCell>
                                                    <TableCell className="px-2 py-1.5 text-right text-xs font-medium tabular-nums">{d.avgScore != null ? `${d.avgScore.toFixed(1)}%` : '—'}</TableCell>
                                                    <TableCell className="px-2 py-1.5 text-right text-xs tabular-nums text-emerald-700">{d.onTrack}</TableCell>
                                                    <TableCell className="px-2 py-1.5 text-right text-xs tabular-nums text-amber-700">{d.atRisk}</TableCell>
                                                    <TableCell className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-500">{d.noData}</TableCell>
                                                    <TableCell className="px-2 py-1.5 text-right text-xs tabular-nums">
                                                        <span className={cn(
                                                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                                                            d.coverage >= 80 ? 'bg-emerald-50 text-emerald-700' :
                                                                d.coverage >= 50 ? 'bg-amber-50 text-amber-700' :
                                                                    'bg-red-50 text-red-700',
                                                        )}>{d.coverage}%</span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow className="border-slate-200 bg-slate-50/40 hover:bg-slate-50/40">
                                                <TableCell className="px-2 py-1.5 text-xs font-semibold text-slate-700">Overall</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums">
                                                    {stats.overallScore != null ? `${stats.overallScore.toFixed(1)}%` : '—'}
                                                </TableCell>
                                                <TableCell className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums">{stats.onTrack}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums">{stats.atRisk}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums">{stats.noData}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums">{stats.coverage}%</TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </KPIChartCard>
                    </div>

                    {/* Recent + Scheduled reports */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <KPIChartCard
                            title="Recent Reports"
                            description="Recently generated performance reports"
                            action={<button className="text-xs text-blue-600 hover:underline" disabled title="Not available yet">View All Reports</button>}
                        >
                            <KPIEmptyState
                                compact
                                title="No reports generated yet"
                                description="Generate performance summaries after scorecards are available."
                                icon={<FileText className="h-5 w-5" />}
                                actions={
                                    <Button size="sm" disabled title="Report generation not available yet">
                                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Report
                                    </Button>
                                }
                            />
                        </KPIChartCard>

                        <KPIChartCard
                            title="Scheduled Reports"
                            description="Upcoming scheduled reports"
                            action={<button className="text-xs text-blue-600 hover:underline" disabled title="Not available yet">Manage Schedules</button>}
                        >
                            <KPIEmptyState
                                compact
                                title="No scheduled reports"
                                description="Schedule recurring KPI reports to be delivered automatically."
                                icon={<CalendarClock className="h-5 w-5" />}
                                actions={
                                    <Button size="sm" disabled title="Report scheduling not available yet">
                                        <CalendarClock className="h-3.5 w-3.5 mr-1.5" />Schedule Report
                                    </Button>
                                }
                            />
                        </KPIChartCard>
                    </div>
                </>
            )}
        </div>
    )
}
