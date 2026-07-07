'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
    Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
    CalendarDays, CheckCircle2, FileSpreadsheet, FileText, Flag, Info,
    Loader2, Scan, Target, TrendingUp, Users, Wallet,
} from 'lucide-react'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'
import {
    KPI_STATUS_LABEL, currentKpiMonth, deriveKpiMonthPeriod, enumeratePlanMonths,
    formatKpiMonthLabel, kpiMonthFromDate,
    type KpiPerformanceStatus,
} from '@/lib/roadtour/kpi'
import type { KpiPlanRow, KpiReportData } from '@/modules/roadtour/types/kpi'
import { EmptyBlock, KpiCard, LoadingBlock, PageHeader, formatNumber } from './shared'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const TEAM_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899']

const STATUS_PILL_STYLE: Record<KpiPerformanceStatus, string> = {
    achieved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    on_track: 'bg-sky-100 text-sky-700 border border-sky-200',
    at_risk: 'bg-amber-100 text-amber-800 border border-amber-200',
    needs_focus: 'bg-rose-100 text-rose-700 border border-rose-200',
}

function KpiStatusPill({ status }: { status: KpiPerformanceStatus }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_PILL_STYLE[status]}`}>
            {KPI_STATUS_LABEL[status]}
        </span>
    )
}

const POLICY_NOTES = [
    'KPI month uses calendar month boundaries.',
    'Scan attribution follows campaign QR / selected AM at scan time.',
    'New campaigns created mid-month are included in the same KPI month if they belong to the selected event.',
    'Historical scan attribution is not rewritten when AM changes.',
]

export function MonthlyKpiPerformanceReportView({ userProfile, onViewChange }: Props) {
    const supabase = createClient()
    const companyId = userProfile?.organizations?.id

    const [runs, setRuns] = useState<RoadtourRun[]>([])
    const [runsLoading, setRunsLoading] = useState(true)
    const [plans, setPlans] = useState<KpiPlanRow[]>([])
    const [plansLoading, setPlansLoading] = useState(false)
    const [selectedMonth, setSelectedMonth] = useState(() => currentKpiMonth())
    const [selectedRunId, setSelectedRunId] = useState('')
    const [teamFilter, setTeamFilter] = useState('all')
    const [leaderFilter, setLeaderFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')

    const [report, setReport] = useState<KpiReportData | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

    const period = useMemo(() => deriveKpiMonthPeriod(selectedMonth), [selectedMonth])

    useEffect(() => {
        if (!companyId) return
        let cancelled = false
        const load = async () => {
            try {
                setRunsLoading(true)
                const runsData = await fetchRoadtourRuns(supabase, companyId)
                if (cancelled) return
                setRuns(runsData)
                const preferred = runsData.find((r) => r.status === 'active') || runsData[0]
                setSelectedRunId((prev) => prev || preferred?.id || '')
            } catch (err: any) {
                if (!cancelled) toast({ title: 'Error', description: 'Failed to load RoadTour Events.', variant: 'destructive' })
            } finally {
                if (!cancelled) setRunsLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId])

    // Load KPI plans for the selected event so the month dropdown lists ONLY
    // months that actually have a configured plan (no long historical list).
    useEffect(() => {
        if (!companyId || !selectedRunId) { setPlans([]); return }
        let cancelled = false
        const load = async () => {
            try {
                setPlansLoading(true)
                const res = await fetch(`/api/roadtour/kpi/plans?org_id=${encodeURIComponent(companyId)}&roadtour_run_id=${encodeURIComponent(selectedRunId)}`)
                const json = await res.json().catch(() => ({}))
                if (cancelled) return
                setPlans(res.ok && json.success ? (json.data || []) : [])
            } catch {
                if (!cancelled) setPlans([])
            } finally {
                if (!cancelled) setPlansLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [companyId, selectedRunId])

    // Only non-draft plans generate monthly reports; union their effective windows.
    const reportablePlans = useMemo(() => plans.filter((p) => p.status !== 'draft'), [plans])
    const hasConfiguredPlan = reportablePlans.length > 0
    const monthOptions = useMemo(() => {
        const set = new Set<string>()
        for (const p of reportablePlans) {
            const from = kpiMonthFromDate(p.effective_from_month)
            const to = p.effective_to_month ? kpiMonthFromDate(p.effective_to_month) : null
            for (const m of enumeratePlanMonths(from, to)) set.add(m)
        }
        return [...set].sort((a, b) => (a < b ? 1 : -1))
    }, [reportablePlans])

    // Keep the selected month inside the configured set (default to newest month).
    useEffect(() => {
        if (monthOptions.length === 0) return
        if (!monthOptions.includes(selectedMonth)) setSelectedMonth(monthOptions[0])
    }, [monthOptions, selectedMonth])

    const loadReport = useCallback(async () => {
        if (!companyId || !selectedRunId) return
        // No configured plan → skip the fetch; the empty state handles it.
        if (!hasConfiguredPlan) { setReport(null); setLoadError(null); setLoading(false); return }
        try {
            setLoading(true)
            setLoadError(null)
            const params = new URLSearchParams({
                org_id: companyId,
                kpi_month: selectedMonth,
                roadtour_run_id: selectedRunId,
            })
            if (teamFilter !== 'all') params.set('team_id', teamFilter)
            if (leaderFilter !== 'all') params.set('leader_id', leaderFilter)
            if (statusFilter !== 'all') params.set('status', statusFilter)
            const res = await fetch(`/api/roadtour/kpi/report?${params.toString()}`)
            const json = await res.json()
            if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load KPI report.')
            // json.data is null when no KPI Plan covers the month/event.
            setReport(json.data ?? null)
        } catch (err: any) {
            setLoadError(err.message || 'Failed to load KPI report.')
            setReport(null)
        } finally {
            setLoading(false)
        }
    }, [companyId, hasConfiguredPlan, leaderFilter, selectedMonth, selectedRunId, statusFilter, teamFilter])

    useEffect(() => { loadReport() }, [loadReport])

    // Reset row filters when the month/event changes.
    useEffect(() => { setTeamFilter('all'); setLeaderFilter('all'); setStatusFilter('all') }, [selectedMonth, selectedRunId])

    const teamOptions = report?.teams || []
    const leaderOptions = useMemo(() => {
        const seen = new Map<string, string>()
        for (const t of report?.teams || []) {
            if (t.leader_user_id) seen.set(t.leader_user_id, t.leader_name)
        }
        return [...seen.entries()].map(([id, name]) => ({ id, name }))
    }, [report])

    const handleExportExcel = useCallback(async () => {
        if (!companyId || !selectedRunId || !report || report.teams.length === 0) return
        try {
            setExporting('excel')
            const params = new URLSearchParams({
                org_id: companyId,
                kpi_month: selectedMonth,
                roadtour_run_id: selectedRunId,
            })
            if (teamFilter !== 'all') params.set('team_id', teamFilter)
            if (leaderFilter !== 'all') params.set('leader_id', leaderFilter)
            if (statusFilter !== 'all') params.set('status', statusFilter)
            const res = await fetch(`/api/roadtour/kpi/report/excel?${params.toString()}`)
            if (!res.ok) {
                const json = await res.json().catch(() => ({}))
                throw new Error(json.error || 'Export failed.')
            }
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `roadtour-monthly-kpi-${selectedMonth}.xlsx`
            link.click()
            URL.revokeObjectURL(url)
        } catch (err: any) {
            toast({ title: 'Export failed', description: err.message, variant: 'destructive' })
        } finally {
            setExporting(null)
        }
    }, [companyId, report, leaderFilter, selectedMonth, selectedRunId, statusFilter, teamFilter])

    const handleExportPdf = useCallback(async () => {
        if (!report || report.teams.length === 0) return
        try {
            setExporting('pdf')
            const [{ default: jsPDF }, autoTableModule] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
            ])
            const autoTable = autoTableModule.default
            const doc = new jsPDF({ orientation: 'landscape' })
            const monthLabel = formatKpiMonthLabel(report.cycle.kpi_month)

            doc.setFontSize(16)
            doc.text('Monthly KPI Performance Report', 14, 16)
            doc.setFontSize(10)
            doc.setTextColor(100)
            doc.text(`KPI Month: ${monthLabel}   Period: ${report.cycle.period_label}`, 14, 23)
            doc.text('KPI attribution is based on campaign QR / selected AM at scan time.', 14, 28)

            autoTable(doc, {
                startY: 34,
                head: [['Total Team Target', 'Actual Scans', 'Overall Achievement', 'AMs Achieved KPI', 'Est. Payout', 'Teams On Track']],
                body: [[
                    report.summary.total_team_target.toLocaleString(),
                    report.summary.actual_scans.toLocaleString(),
                    `${report.summary.overall_achievement_percent.toFixed(1)}%`,
                    `${report.summary.ams_achieved} / ${report.summary.ams_total}`,
                    `RM ${report.summary.incentive_estimated_payout.toLocaleString()}`,
                    `${report.summary.teams_on_track} / ${report.summary.teams_total}`,
                ]],
                headStyles: { fillColor: [30, 64, 175] },
            })

            autoTable(doc, {
                startY: (doc as any).lastAutoTable.finalY + 8,
                head: [['Team Name', 'Leader', 'Members', 'Team Target', 'Actual Scans', 'Achievement %', 'Incentive Budget', 'Est. Payout', 'Status']],
                body: report.teams.map((t) => [
                    t.team_name, t.leader_name, t.member_count,
                    t.team_target.toLocaleString(), t.actual_scans.toLocaleString(),
                    `${t.achievement_percent.toFixed(1)}%`,
                    `RM ${t.incentive_budget.toLocaleString()}`, `RM ${t.estimated_payout.toLocaleString()}`,
                    KPI_STATUS_LABEL[t.status],
                ]),
                headStyles: { fillColor: [30, 64, 175] },
            })

            autoTable(doc, {
                startY: (doc as any).lastAutoTable.finalY + 8,
                head: [['Rank', 'AM Name', 'Team', 'Assigned Target', 'Actual Scans', 'Achievement %', 'Incentive Earned', 'Status']],
                body: report.ams.map((a) => [
                    a.rank, a.am_name, a.team_name,
                    a.assigned_target.toLocaleString(), a.actual_scans.toLocaleString(),
                    `${a.achievement_percent.toFixed(1)}%`, `RM ${a.incentive_earned.toLocaleString()}`,
                    KPI_STATUS_LABEL[a.status],
                ]),
                headStyles: { fillColor: [30, 64, 175] },
            })

            autoTable(doc, {
                startY: (doc as any).lastAutoTable.finalY + 8,
                head: [['Rank', 'Campaign / Shop', 'Team', 'Actual Scans', '% of Total']],
                body: report.top_campaigns.map((c) => [
                    c.rank, c.campaign_name, c.team_name, c.actual_scans.toLocaleString(), `${c.percent_of_total.toFixed(1)}%`,
                ]),
                headStyles: { fillColor: [30, 64, 175] },
            })

            doc.save(`roadtour-monthly-kpi-${report.cycle.kpi_month}.pdf`)
        } catch (err: any) {
            toast({ title: 'Export failed', description: err.message, variant: 'destructive' })
        } finally {
            setExporting(null)
        }
    }, [report])

    const s = report?.summary
    // A cycle with at least one team is the only case with real, exportable data.
    const hasReportData = Boolean(report && report.teams.length > 0)

    if (!companyId) {
        return <Card><EmptyBlock title="Organization required" description="Your profile is not linked to an organization." /></Card>
    }

    return (
        <div className="space-y-4">
            <PageHeader
                overline="RoadTour Analytics"
                title="Monthly KPI Performance Report"
                description="Track monthly scan achievement vs KPI targets for RoadTour teams, AMs, and incentives. KPI attribution is based on campaign QR / selected AM at scan time."
            />

            {/* Filter bar — KPI month only, no From/To date range. */}
            <Card className="p-3 sm:p-4">
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Report Month</label>
                        <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={!hasConfiguredPlan || monthOptions.length === 0}>
                            <SelectTrigger><SelectValue placeholder={hasConfiguredPlan ? 'Select month' : 'No KPI Plan'} /></SelectTrigger>
                            <SelectContent>
                                {monthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">RoadTour Event</label>
                        <Select value={selectedRunId} onValueChange={setSelectedRunId} disabled={runsLoading}>
                            <SelectTrigger><SelectValue placeholder={runsLoading ? 'Loading…' : 'Select event'} /></SelectTrigger>
                            <SelectContent>
                                {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Reporting Scope</label>
                        <Select value="all" disabled>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All campaigns under event</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Team</label>
                        <Select value={teamFilter} onValueChange={setTeamFilter}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Teams</SelectItem>
                                {teamOptions.map((t) => <SelectItem key={t.team_id} value={t.team_id}>{t.team_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Leader</label>
                        <Select value={leaderFilter} onValueChange={setLeaderFilter}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Leaders</SelectItem>
                                {leaderOptions.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="achieved">Achieved</SelectItem>
                                <SelectItem value="on_track">On Track</SelectItem>
                                <SelectItem value="at_risk">At Risk</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                    <div className="flex items-center gap-1.5 text-xs text-blue-700">
                        <Info className="h-3.5 w-3.5" />
                        Period auto: {period.label} (Calendar Month). Month options are limited to configured KPI Plan months — monthly report includes all campaigns under the selected event, including those created mid-month.
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200" onClick={handleExportExcel} disabled={exporting !== null || !hasReportData}>
                            {exporting === 'excel' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                            Export Excel
                        </Button>
                        <Button size="sm" variant="outline" className="text-rose-700 border-rose-200" onClick={handleExportPdf} disabled={exporting !== null || !hasReportData}>
                            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                            Export PDF
                        </Button>
                    </div>
                </div>
            </Card>

            {loading && <Card><LoadingBlock label="Computing monthly KPI report…" /></Card>}

            {!loading && loadError && (
                <Card>
                    <EmptyBlock title="Failed to load KPI report" description={loadError} />
                    <div className="text-center pb-6">
                        <Button variant="outline" onClick={loadReport}>Retry</Button>
                    </div>
                </Card>
            )}

            {/* No KPI Plan configured for the selected event. */}
            {!loading && !loadError && !report && selectedRunId && !hasConfiguredPlan && !plansLoading && (
                <Card>
                    <EmptyBlock
                        title="No KPI Plan configured for this RoadTour Event."
                        description="Create a KPI Plan once for this event. Monthly reports are then generated automatically for each month in the plan window."
                    />
                    <div className="text-center pb-6">
                        <Button onClick={() => onViewChange('roadtour-kpi-settings')}>Create KPI Plan</Button>
                    </div>
                </Card>
            )}

            {/* Plan exists but the selected month has no report data yet. */}
            {!loading && !loadError && !report && selectedRunId && hasConfiguredPlan && (
                <Card>
                    <EmptyBlock
                        title={`No KPI report data for ${formatKpiMonthLabel(selectedMonth)}.`}
                        description="This month has no scan activity under the active KPI Plan yet."
                    />
                </Card>
            )}

            {!loading && !loadError && report && (
                <>
                    {/* Cycle exists but no teams — nothing to report yet. */}
                    {!hasReportData && (
                        <Card>
                            <EmptyBlock
                                title="No KPI teams configured for this plan."
                                description="Add teams and assign account managers so their monthly scan achievement can be tracked."
                            />
                            <div className="text-center pb-6">
                                <Button onClick={() => onViewChange('roadtour-kpi-settings')}>Configure Teams</Button>
                            </div>
                        </Card>
                    )}
                    {hasReportData && s && s.unassigned_scans > 0 && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                            {formatNumber(s.unassigned_scans)} successful scans this month belong to AMs who are not in any KPI team; they are excluded from team totals.
                        </div>
                    )}

                    {/* Summary cards */}
                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
                        <KpiCard label="Total Team Target" value={formatNumber(s!.total_team_target)} sub="scans" icon={Target} accent="violet" />
                        <KpiCard label="Actual Scans" value={formatNumber(s!.actual_scans)} sub="scans" icon={Scan} accent="blue" />
                        <KpiCard label="Overall Achievement" value={s!.total_team_target > 0 ? `${s!.overall_achievement_percent.toFixed(1)}%` : '—'} icon={TrendingUp} accent="green" />
                        <KpiCard label="AMs Achieved KPI" value={`${s!.ams_achieved} / ${s!.ams_total}`} icon={Users} accent="cyan" />
                        <KpiCard label="Incentive Estimated Payout" value={`RM ${formatNumber(Math.round(s!.incentive_estimated_payout))}`} icon={Wallet} accent="amber" />
                        <KpiCard label="Teams On Track" value={`${s!.teams_on_track} / ${s!.teams_total}`} icon={Flag} accent="rose" />
                    </div>

                    {/* Charts */}
                    <div className="grid gap-4 lg:grid-cols-5">
                        <Card className="lg:col-span-3">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Monthly Scan Achievement by Team</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {report.chart_team_achievement.length === 0 ? (
                                    <EmptyBlock title="No teams configured" description="Add teams to the KPI Plan to see achievement." />
                                ) : (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={report.chart_team_achievement}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                <XAxis dataKey="team_name" tick={{ fontSize: 11 }} />
                                                <YAxis tick={{ fontSize: 11 }} />
                                                <Tooltip formatter={(value: any) => Number(value).toLocaleString()} />
                                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                                <Bar dataKey="target" name="Team Target (Scans)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="actual" name="Actual Scans" fill="#10b981" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        <Card className="lg:col-span-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Incentive Payout Overview (Est.)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {report.chart_payout_by_team.every((p) => p.payout === 0) ? (
                                    <EmptyBlock title="No estimated payout yet" description="Payouts appear once incentive rules and scan progress exist." />
                                ) : (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={report.chart_payout_by_team.filter((p) => p.payout > 0)}
                                                    dataKey="payout"
                                                    nameKey="team_name"
                                                    innerRadius={55}
                                                    outerRadius={85}
                                                    paddingAngle={2}
                                                >
                                                    {report.chart_payout_by_team.filter((p) => p.payout > 0).map((entry, i) => (
                                                        <Cell key={entry.team_name} fill={TEAM_COLORS[i % TEAM_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(value: any) => `RM ${Number(value).toLocaleString()}`} />
                                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Team KPI Performance */}
                    <div className="grid gap-4 lg:grid-cols-5">
                        <Card className="lg:col-span-3">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Team KPI Performance</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {report.teams.length === 0 ? (
                                    <EmptyBlock title="No teams match the selected filters" />
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Team Name</TableHead>
                                                    <TableHead>Leader</TableHead>
                                                    <TableHead className="text-right">Members</TableHead>
                                                    <TableHead className="text-right">Team Target (Scans)</TableHead>
                                                    <TableHead className="text-right">Actual Scans</TableHead>
                                                    <TableHead className="text-right">Achievement %</TableHead>
                                                    <TableHead className="text-right">Incentive Budget</TableHead>
                                                    <TableHead className="text-right">Est. Payout</TableHead>
                                                    <TableHead>Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {report.teams.map((t) => (
                                                    <TableRow key={t.team_id}>
                                                        <TableCell className="font-medium">{t.team_name}</TableCell>
                                                        <TableCell>{t.leader_name}</TableCell>
                                                        <TableCell className="text-right">{t.member_count}</TableCell>
                                                        <TableCell className="text-right">{formatNumber(t.team_target)}</TableCell>
                                                        <TableCell className="text-right">{formatNumber(t.actual_scans)}</TableCell>
                                                        <TableCell className="text-right font-medium">{t.achievement_percent.toFixed(1)}%</TableCell>
                                                        <TableCell className="text-right">RM {formatNumber(Math.round(t.incentive_budget))}</TableCell>
                                                        <TableCell className="text-right">RM {formatNumber(Math.round(t.estimated_payout))}</TableCell>
                                                        <TableCell><KpiStatusPill status={t.status} /></TableCell>
                                                    </TableRow>
                                                ))}
                                                <TableRow className="bg-muted/40 font-medium">
                                                    <TableCell>Total / Average</TableCell>
                                                    <TableCell>—</TableCell>
                                                    <TableCell className="text-right">{report.teams.reduce((sum, t) => sum + t.member_count, 0)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(s!.total_team_target)}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(s!.actual_scans)}</TableCell>
                                                    <TableCell className="text-right">{s!.overall_achievement_percent.toFixed(1)}%</TableCell>
                                                    <TableCell className="text-right">RM {formatNumber(Math.round(report.teams.reduce((sum, t) => sum + t.incentive_budget, 0)))}</TableCell>
                                                    <TableCell className="text-right">RM {formatNumber(Math.round(s!.incentive_estimated_payout))}</TableCell>
                                                    <TableCell>—</TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* AM Achievement Breakdown */}
                        <Card className="lg:col-span-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">AM Achievement Breakdown</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {report.ams.length === 0 ? (
                                    <EmptyBlock title="No AM assignments" description="Assign AMs to teams in the KPI settings." />
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>AM Name</TableHead>
                                                    <TableHead>Team</TableHead>
                                                    <TableHead className="text-right">Assigned Target</TableHead>
                                                    <TableHead className="text-right">Actual</TableHead>
                                                    <TableHead className="text-right">Achievement %</TableHead>
                                                    <TableHead className="text-right">Incentive</TableHead>
                                                    <TableHead className="text-right">Rank</TableHead>
                                                    <TableHead>Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {report.ams.map((a) => (
                                                    <TableRow key={a.am_user_id}>
                                                        <TableCell className="font-medium">{a.am_name}</TableCell>
                                                        <TableCell className="text-xs">{a.team_name}</TableCell>
                                                        <TableCell className="text-right">{formatNumber(a.assigned_target)}</TableCell>
                                                        <TableCell className="text-right">{formatNumber(a.actual_scans)}</TableCell>
                                                        <TableCell className="text-right font-medium">{a.achievement_percent.toFixed(1)}%</TableCell>
                                                        <TableCell className="text-right">RM {formatNumber(Math.round(a.incentive_earned))}</TableCell>
                                                        <TableCell className="text-right">{a.rank}</TableCell>
                                                        <TableCell><KpiStatusPill status={a.status} /></TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Top campaigns + policy notes */}
                    <div className="grid gap-4 lg:grid-cols-5">
                        <Card className="lg:col-span-3">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Top Contributing Campaigns / Shops (By Actual Scans)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {report.top_campaigns.length === 0 ? (
                                    <EmptyBlock title="No scans recorded this month" description="Successful campaign QR scans will appear here." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-14">Rank</TableHead>
                                                <TableHead>Campaign / Shop</TableHead>
                                                <TableHead>Team</TableHead>
                                                <TableHead className="text-right">Actual Scans</TableHead>
                                                <TableHead className="text-right">% of Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {report.top_campaigns.map((c) => (
                                                <TableRow key={c.campaign_id}>
                                                    <TableCell>{c.rank}</TableCell>
                                                    <TableCell className="font-medium">{c.campaign_name}</TableCell>
                                                    <TableCell>{c.team_name}</TableCell>
                                                    <TableCell className="text-right">{formatNumber(c.actual_scans)}</TableCell>
                                                    <TableCell className="text-right">{c.percent_of_total.toFixed(1)}%</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Policy &amp; Attribution Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2 text-sm">
                                    {POLICY_NOTES.map((note) => (
                                        <li key={note} className="flex items-start gap-2">
                                            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                                            <span>{note}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 flex items-center gap-2">
                                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                    Plan status: {report.cycle.status} · Period {report.cycle.period_label}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}

            {!loading && !loadError && !report && !runsLoading && runs.length === 0 && (
                <Card><EmptyBlock title="No RoadTour Events" description="Create a RoadTour Event and campaigns before configuring monthly KPIs." /></Card>
            )}
        </div>
    )
}
