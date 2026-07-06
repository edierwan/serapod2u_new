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
    KPI_STATUS_LABEL, deriveKpiMonthPeriod, formatKpiMonthLabel,
    type KpiPerformanceStatus,
} from '@/lib/roadtour/kpi'
import type { KpiReportData } from '@/modules/roadtour/types/kpi'
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

function buildMonthOptions(): string[] {
    const now = new Date()
    const options: string[] = []
    for (let offset = 1; offset >= -12; offset--) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return options
}

/** Illustrative dataset shown only when no KPI cycle/data exists for the selection. */
function buildDemoReport(kpiMonth: string): KpiReportData {
    const period = deriveKpiMonthPeriod(kpiMonth)
    const teams = [
        { team_id: 'demo-1', team_name: 'North Penang Team', leader_user_id: null, leader_name: 'Yusri', member_count: 5, team_target: 7000, actual_scans: 6350, achievement_percent: 90.7, incentive_budget: 1600, estimated_payout: 1600, status: 'on_track' as const },
        { team_id: 'demo-2', team_name: 'Central Penang Team', leader_user_id: null, leader_name: 'Safwan', member_count: 7, team_target: 8000, actual_scans: 7320, achievement_percent: 91.5, incentive_budget: 1500, estimated_payout: 1300, status: 'on_track' as const },
        { team_id: 'demo-3', team_name: 'Seberang Team', leader_user_id: null, leader_name: 'Aravin', member_count: 9, team_target: 6000, actual_scans: 4790, achievement_percent: 79.8, incentive_budget: 1000, estimated_payout: 500, status: 'at_risk' as const },
    ]
    return {
        cycle: {
            id: 'demo', kpi_month: kpiMonth, status: 'active', period_label: period.label,
            period_start: period.periodStart, period_end: period.periodEnd,
            freeze_members_targets: true, lock_campaign_qr_attribution: true,
        },
        summary: {
            total_team_target: 21000, actual_scans: 18460, overall_achievement_percent: 87.9,
            ams_achieved: 14, ams_total: 21, incentive_estimated_payout: 3400,
            teams_on_track: 2, teams_total: 3, unassigned_scans: 0,
        },
        teams,
        ams: [
            { am_user_id: 'd1', am_name: 'Yusri', team_id: 'demo-1', team_name: 'North Penang Team', assigned_target: 2000, actual_scans: 2050, achievement_percent: 102.5, incentive_earned: 450, rank: 1, status: 'achieved' },
            { am_user_id: 'd2', am_name: 'Safwan', team_id: 'demo-2', team_name: 'Central Penang Team', assigned_target: 1500, actual_scans: 1420, achievement_percent: 94.7, incentive_earned: 300, rank: 2, status: 'on_track' },
            { am_user_id: 'd3', am_name: 'Aravin', team_id: 'demo-3', team_name: 'Seberang Team', assigned_target: 1200, actual_scans: 920, achievement_percent: 76.7, incentive_earned: 150, rank: 3, status: 'at_risk' },
            { am_user_id: 'd4', am_name: 'Fitri', team_id: 'demo-2', team_name: 'Central Penang Team', assigned_target: 1200, actual_scans: 1100, achievement_percent: 91.7, incentive_earned: 250, rank: 4, status: 'on_track' },
            { am_user_id: 'd5', am_name: 'Amirul', team_id: 'demo-1', team_name: 'North Penang Team', assigned_target: 1200, actual_scans: 1050, achievement_percent: 87.5, incentive_earned: 200, rank: 5, status: 'on_track' },
            { am_user_id: 'd6', am_name: 'Bob', team_id: 'demo-3', team_name: 'Seberang Team', assigned_target: 1000, actual_scans: 880, achievement_percent: 88.0, incentive_earned: 180, rank: 6, status: 'on_track' },
        ],
        top_campaigns: [
            { rank: 1, campaign_id: 'c1', campaign_name: 'Grand Opening – Gurney Plaza', team_name: 'North Penang Team', actual_scans: 3250, percent_of_total: 17.6 },
            { rank: 2, campaign_id: 'c2', campaign_name: 'Weekend Special – Queensbay Mall', team_name: 'Central Penang Team', actual_scans: 2480, percent_of_total: 13.4 },
            { rank: 3, campaign_id: 'c3', campaign_name: 'Hari Raya Promo – Penang Times Square', team_name: 'Seberang Team', actual_scans: 2120, percent_of_total: 11.5 },
            { rank: 4, campaign_id: 'c4', campaign_name: 'Back to School – Sunway Carnival', team_name: 'Central Penang Team', actual_scans: 1980, percent_of_total: 10.7 },
            { rank: 5, campaign_id: 'c5', campaign_name: 'Flash Sale Weekend – Komtar', team_name: 'North Penang Team', actual_scans: 1750, percent_of_total: 9.5 },
        ],
        chart_team_achievement: teams.map((t) => ({ team_name: t.team_name, target: t.team_target, actual: t.actual_scans, achievement_percent: t.achievement_percent })),
        chart_payout_by_team: teams.map((t) => ({ team_name: t.team_name, payout: t.estimated_payout })),
    }
}

export function MonthlyKpiPerformanceReportView({ userProfile }: Props) {
    const supabase = createClient()
    const companyId = userProfile?.organizations?.id

    const monthOptions = useMemo(buildMonthOptions, [])
    const [runs, setRuns] = useState<RoadtourRun[]>([])
    const [runsLoading, setRunsLoading] = useState(true)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [selectedRunId, setSelectedRunId] = useState('')
    const [teamFilter, setTeamFilter] = useState('all')
    const [leaderFilter, setLeaderFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')

    const [report, setReport] = useState<KpiReportData | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [isDemo, setIsDemo] = useState(false)
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

    const loadReport = useCallback(async () => {
        if (!companyId || !selectedRunId) return
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
            if (json.data) {
                setReport(json.data)
                setIsDemo(false)
            } else {
                // No cycle configured for this month/event: show an illustrative demo.
                setReport(buildDemoReport(selectedMonth))
                setIsDemo(true)
            }
        } catch (err: any) {
            setLoadError(err.message || 'Failed to load KPI report.')
            setReport(null)
        } finally {
            setLoading(false)
        }
    }, [companyId, leaderFilter, selectedMonth, selectedRunId, statusFilter, teamFilter])

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
        if (!companyId || !selectedRunId || isDemo) return
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
    }, [companyId, isDemo, leaderFilter, selectedMonth, selectedRunId, statusFilter, teamFilter])

    const handleExportPdf = useCallback(async () => {
        if (!report) return
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
            doc.text(`KPI Month: ${monthLabel}   Period: ${report.cycle.period_label}${isDemo ? '   (DEMO DATA)' : ''}`, 14, 23)
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
    }, [isDemo, report])

    const s = report?.summary

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
                        <label className="text-xs font-medium text-muted-foreground">KPI Month</label>
                        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
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
                        Period auto: {period.label} (Calendar Month) — monthly report includes all campaigns under the selected event, including those created mid-month.
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200" onClick={handleExportExcel} disabled={exporting !== null || isDemo || !report}>
                            {exporting === 'excel' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                            Export Excel
                        </Button>
                        <Button size="sm" variant="outline" className="text-rose-700 border-rose-200" onClick={handleExportPdf} disabled={exporting !== null || !report}>
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

            {!loading && !loadError && report && (
                <>
                    {isDemo && (
                        <div className="border border-violet-200 bg-violet-50 text-violet-800 text-sm rounded-md px-3 py-2">
                            Demo preview — no KPI cycle is configured for {formatKpiMonthLabel(selectedMonth)} and this event yet.
                            Configure one under RoadTour → Settings → KPI &amp; Incentive Settings to see live data.
                        </div>
                    )}
                    {!isDemo && s && s.unassigned_scans > 0 && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                            {formatNumber(s.unassigned_scans)} successful scans this month belong to AMs who are not in any KPI team; they are excluded from team totals.
                        </div>
                    )}

                    {/* Summary cards */}
                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
                        <KpiCard label="Total Team Target" value={formatNumber(s!.total_team_target)} sub="scans" icon={Target} accent="violet" />
                        <KpiCard label="Actual Scans" value={formatNumber(s!.actual_scans)} sub="scans" icon={Scan} accent="blue" />
                        <KpiCard label="Overall Achievement" value={`${s!.overall_achievement_percent.toFixed(1)}%`} icon={TrendingUp} accent="green" />
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
                                    <EmptyBlock title="No teams configured" description="Add teams to the KPI cycle to see achievement." />
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
                                    Cycle status: {report.cycle.status} · Period {report.cycle.period_label}
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
