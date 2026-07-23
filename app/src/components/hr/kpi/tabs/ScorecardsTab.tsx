'use client'
/**
 * Scorecards tab — Generate / review scorecards across levels.
 *
 * Top stat cards: Generated / On Track / At Risk / Needs Data
 * Toolbar: Search / Level / Scope / Status / More filters + Refresh + Generate
 * Table: Level / Scope / Score / Grade / On-Track % / At-Risk Count / Owner / Last Generated / Status / Actions
 * Bottom detail: scorecard summary + Score Distribution donut + Score Trend
 *
 * Backed by:
 *   GET  /api/hr/kpi/scorecards?period_id=…
 *   GET  /api/hr/kpi/scorecards/{id}      => { scorecard, items, reviews }
 *   POST /api/hr/kpi/scorecards/generate  body { period_id }
 *   POST /api/hr/kpi/scorecards/{id}/recalculate
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ClipboardList, CheckCircle2, AlertTriangle, Database, Search, Filter,
    Sparkles, RefreshCw, MoreHorizontal, Loader2, Building2, Users2, User, Eye, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    KPIStatCard, KPIStatusBadge, KPIEmptyState, KPICenteredLoader, KPIChartCard,
    KPIDonut, KPILineChart, KPIProgressBar,
} from '../shared'
import { kpiFetch, formatDate } from '../types'

// ── Types ────────────────────────────────────────────────────────
interface Scorecard {
    id: string
    period_id: string
    scorecard_level: string
    department_id: string | null
    position_id?: string | null
    employee_user_id: string | null
    overall_score: number | null
    grade: string | null
    status: string
    generated_at?: string | null
    owner_user_id?: string | null
    created_at?: string | null
    updated_at?: string | null
    items_count?: number | null
    on_track_count?: number | null
    at_risk_count?: number | null
    no_data_count?: number | null
    data_coverage?: number | null
    item_status_counts?: { on_track?: number; at_risk?: number; below_target?: number; no_data?: number }
    targets_count?: number | null
}

interface ScorecardDetail {
    scorecard: Scorecard
    items: Array<{
        id: string
        metric_id: string
        target_value: number | null
        actual_value: number | null
        achievement_percent: number | null
        weighted_score: number | null
        weight_percent: number
        status: string
        hr_kpi_metrics?: { kpi_code: string; name: string; unit: string }
    }>
    reviews: any[]
}

// ── Helpers ──────────────────────────────────────────────────────
const LEVEL_ICON = {
    organisation: <Building2 className="h-3.5 w-3.5 text-slate-500" />,
    company: <Building2 className="h-3.5 w-3.5 text-slate-500" />,
    bu: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    department: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    team: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    role: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    employee: <User className="h-3.5 w-3.5 text-slate-500" />,
}

function shortId(id?: string | null) {
    if (!id) return '—'
    return id.length > 10 ? id.slice(0, 8) + '…' : id
}

function ownerInitials(id?: string | null) {
    if (!id) return '—'
    return id.slice(0, 2).toUpperCase()
}

function scopeLabel(s: Scorecard) {
    if (s.scorecard_level === 'company' || s.scorecard_level === 'organisation') return 'Organisation'
    if (s.department_id) return `Dept · ${shortId(s.department_id)}`
    if (s.position_id) return `Role · ${shortId(s.position_id)}`
    if (s.employee_user_id) return `Employee · ${shortId(s.employee_user_id)}`
    return '—'
}

function gradeBadge(grade?: string | null) {
    if (!grade) return <span className="inline-flex items-center justify-center rounded-md bg-slate-100 text-slate-500 px-2 py-0.5 text-xs font-semibold">—</span>
    const tone = grade === 'A' ? 'bg-emerald-100 text-emerald-700' :
        grade === 'B' ? 'bg-blue-100 text-blue-700' :
            grade === 'C' ? 'bg-amber-100 text-amber-700' :
                grade === 'D' ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700'
    return <span className={cn('inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold', tone)}>{grade}</span>
}

function scoreStatus(score: number | null): 'on_track' | 'at_risk' | 'off_track' | 'no_data' {
    if (score == null) return 'no_data'
    if (score >= 80) return 'on_track'
    if (score >= 60) return 'at_risk'
    return 'off_track'
}

// ── Main ─────────────────────────────────────────────────────────
export function KPIScorecardsTab({ periodId, periodName }: { periodId: string | null; periodName?: string | null }) {
    const [items, setItems] = useState<Scorecard[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [generating, setGenerating] = useState(false)
    const [search, setSearch] = useState('')
    const [levelFilter, setLevelFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!periodId) { setItems([]); setLoading(false); return }
        setLoading(true)
        setError(null)
        const r = await kpiFetch<Scorecard[]>(`/api/hr/kpi/scorecards?period_id=${periodId}`)
        if (!r.success) setError(r.error ?? 'Failed to load scorecards')
        if (r.success && r.data) setItems(r.data)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const stats = useMemo(() => {
        const total = items.length
        const byStatus = (k: string) => items.filter(s => s.status === k).length
        const onTrack = items.filter(s => scoreStatus(s.overall_score) === 'on_track').length
        const atRisk = items.filter(s => scoreStatus(s.overall_score) === 'at_risk').length
        const noData = items.filter(s => s.overall_score == null).length
        return {
            total,
            onTrack,
            atRisk,
            noData,
            generated: byStatus('generated') + byStatus('submitted') + byStatus('approved'),
        }
    }, [items])

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase()
        return items.filter(it => {
            if (levelFilter !== 'all' && it.scorecard_level !== levelFilter) return false
            if (statusFilter !== 'all' && it.status !== statusFilter) return false
            if (!s) return true
            const hay = [
                it.scorecard_level,
                it.department_id,
                it.employee_user_id,
                it.owner_user_id,
            ].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(s)
        })
    }, [items, search, levelFilter, statusFilter])

    useEffect(() => {
        if (!selectedId && filtered.length) setSelectedId(filtered[0].id)
        if (selectedId && !filtered.some(it => it.id === selectedId) && filtered.length) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => items.find(it => it.id === selectedId) ?? null, [items, selectedId])

    async function generate() {
        if (!periodId) return
        setGenerating(true)
        const r = await kpiFetch<{ scorecards_created: number; items_created: number }>('/api/hr/kpi/scorecards/generate', {
            method: 'POST', body: JSON.stringify({ period_id: periodId }),
        })
        setGenerating(false)
        if (r.success) {
            toast({ title: `Generated ${r.data?.scorecards_created ?? 0} scorecards (${r.data?.items_created ?? 0} items)` })
            load()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    const levels = useMemo(() => Array.from(new Set(items.map(i => i.scorecard_level))).filter(Boolean), [items])

    return (
        <div className="space-y-4 mt-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPIStatCard
                    label="Generated Scorecards" value={stats.total}
                    hint={stats.total > 0 ? '100% of published targets' : 'None yet'}
                    icon={<ClipboardList className="h-4 w-4" />} tone="blue"
                />
                <KPIStatCard
                    label="On Track" value={stats.onTrack}
                    hint={stats.total > 0 ? `${Math.round((stats.onTrack / stats.total) * 100)}% of scorecards` : '—'}
                    icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald"
                />
                <KPIStatCard
                    label="At Risk" value={stats.atRisk}
                    hint={stats.total > 0 ? `${Math.round((stats.atRisk / stats.total) * 100)}% of scorecards` : '—'}
                    icon={<AlertTriangle className="h-4 w-4" />} tone="amber"
                />
                <KPIStatCard
                    label="Needs Data" value={stats.noData}
                    hint={stats.total > 0 ? `${Math.round((stats.noData / stats.total) * 100)}% of scorecards` : '—'}
                    icon={<Database className="h-4 w-4" />} tone="slate"
                />
            </div>

            {/* Toolbar */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
                        <div className="relative w-full sm:w-auto">
                            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search scorecards…"
                                className="pl-8 h-9 w-full sm:w-[220px]"
                            />
                        </div>
                        <Select value={levelFilter} onValueChange={setLevelFilter}>
                            <SelectTrigger className="w-full sm:w-[120px] h-9"><SelectValue placeholder="Level" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Levels</SelectItem>
                                {levels.map(l => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-full sm:w-[120px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="generated">Generated</SelectItem>
                                <SelectItem value="submitted">Submitted</SelectItem>
                                <SelectItem value="approved">Approved</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" disabled title="More filters not available yet">
                            <Filter className="h-3.5 w-3.5 mr-1.5" />More filters
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                            Refresh
                        </Button>
                        <Button onClick={generate} disabled={!periodId || generating} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {generating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                            Generate
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <KPICenteredLoader />
                ) : !periodId ? (
                    <KPIEmptyState title="Select a period" description="Choose a performance period to view scorecards." />
                ) : error ? (
                    <KPIEmptyState
                        title="Unable to load scorecards"
                        description={error}
                        actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                    />
                ) : items.length === 0 ? (
                    <KPIEmptyState
                        title="No scorecards generated yet"
                        description="Generate scorecards from published targets and validated actual values."
                        actions={
                            <Button size="sm" onClick={generate} disabled={generating}>
                                <Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Scorecards
                            </Button>
                        }
                    />
                ) : filtered.length === 0 ? (
                    <KPIEmptyState title="No matching scorecards" description="Try adjusting filters." searchMode />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide w-8"></TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Level</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Scope</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">Score</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Grade</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">On-Track %</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">At-Risk Count</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Owner</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Last Generated</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Status</TableHead>
                                    <TableHead className="h-9 w-10"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(s => {
                                    const isSel = selectedId === s.id
                                    const counts = s.item_status_counts ?? {}
                                    const totalItems = (counts.on_track ?? 0) + (counts.at_risk ?? 0) + (counts.below_target ?? 0) + (counts.no_data ?? 0) || (s.items_count ?? 0)
                                    const onTrackPct = totalItems > 0 ? Math.round(((counts.on_track ?? 0) / totalItems) * 100) : 0
                                    const atRiskCount = (counts.at_risk ?? 0) + (counts.below_target ?? 0)
                                    const levelKey = (s.scorecard_level || '').toLowerCase() as keyof typeof LEVEL_ICON
                                    const overall = s.overall_score
                                    const status = scoreStatus(overall)
                                    return (
                                        <TableRow
                                            key={s.id}
                                            onClick={() => setSelectedId(s.id)}
                                            className={cn(
                                                'cursor-pointer border-slate-100 transition-colors',
                                                isSel ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                            )}
                                        >
                                            <TableCell className="py-2.5">
                                                <input
                                                    type="checkbox" checked={isSel}
                                                    onChange={() => setSelectedId(s.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
                                                />
                                            </TableCell>
                                            <TableCell className="py-2.5">
                                                <span className="inline-flex items-center gap-1.5 text-xs capitalize text-slate-700">
                                                    {LEVEL_ICON[levelKey] ?? <Building2 className="h-3.5 w-3.5 text-slate-500" />}
                                                    {s.scorecard_level}
                                                </span>
                                            </TableCell>
                                            <TableCell className="py-2.5 text-sm text-slate-700">{scopeLabel(s)}</TableCell>
                                            <TableCell className="py-2.5 text-right">
                                                {overall != null ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="font-semibold text-sm text-slate-900 tabular-nums">{Number(overall).toFixed(1)}%</span>
                                                    </span>
                                                ) : <span className="text-xs text-slate-400">— No data</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5">{gradeBadge(s.grade)}</TableCell>
                                            <TableCell className="py-2.5">
                                                <div className="flex items-center gap-2 min-w-[120px]">
                                                    <span className="text-xs tabular-nums w-9 text-slate-700">{onTrackPct}%</span>
                                                    <KPIProgressBar
                                                        value={onTrackPct}
                                                        tone={onTrackPct >= 70 ? 'emerald' : onTrackPct >= 40 ? 'amber' : 'red'}
                                                    />
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-2.5 text-right tabular-nums text-sm text-slate-700">{atRiskCount}</TableCell>
                                            <TableCell className="py-2.5">
                                                {s.owner_user_id ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                                            {ownerInitials(s.owner_user_id)}
                                                        </span>
                                                        <span className="text-xs text-slate-700 font-mono">{shortId(s.owner_user_id)}</span>
                                                    </span>
                                                ) : <span className="text-xs text-slate-400">—</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-xs text-slate-500">{formatDate(s.generated_at ?? s.updated_at)}</TableCell>
                                            <TableCell className="py-2.5">
                                                <KPIStatusBadge value={overall == null ? 'no_data' : status} />
                                            </TableCell>
                                            <TableCell className="py-2.5 text-right">
                                                <Button variant="ghost" size="icon" disabled title="Row menu not available yet" className="h-7 w-7">
                                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                        <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                            Showing 1 to {filtered.length} of {items.length} scorecards
                        </div>
                    </div>
                )}
            </div>

            {/* Detail panel (bottom) */}
            {selected && <ScorecardDetailPanel scorecard={selected} onRecalc={load} />}
        </div>
    )
}

// ── Detail Panel ─────────────────────────────────────────────────
function ScorecardDetailPanel({ scorecard, onRecalc }: { scorecard: Scorecard; onRecalc: () => void }) {
    const [detail, setDetail] = useState<ScorecardDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [recalc, setRecalc] = useState(false)
    const [collapsed, setCollapsed] = useState(false)

    useEffect(() => {
        let alive = true
            ; (async () => {
                setLoading(true)
                const r = await kpiFetch<ScorecardDetail>(`/api/hr/kpi/scorecards/${scorecard.id}`)
                if (alive && r.success && r.data) setDetail(r.data)
                if (alive) setLoading(false)
            })()
        return () => { alive = false }
    }, [scorecard.id])

    async function recalculate() {
        setRecalc(true)
        const r = await kpiFetch(`/api/hr/kpi/scorecards/${scorecard.id}/recalculate`, { method: 'POST' })
        setRecalc(false)
        if (r.success) {
            toast({ title: 'Recalculated' })
            onRecalc()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    const sc = detail?.scorecard ?? scorecard
    const items = detail?.items ?? []
    const counts = useMemo(() => {
        const map = { on_track: 0, at_risk: 0, no_data: 0, off_track: 0 }
        for (const it of items) {
            if (it.status === 'on_track') map.on_track++
            else if (it.status === 'at_risk') map.at_risk++
            else if (it.status === 'below_target' || it.status === 'off_track') map.off_track++
            else map.no_data++
        }
        return map
    }, [items])
    const totalItems = items.length || (sc.items_count ?? 0)
    const dataCoverage = totalItems > 0 ? Math.round(((totalItems - counts.no_data) / totalItems) * 100) : 0

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_1fr] gap-4">
            {/* Summary */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
                <button
                    onClick={() => setCollapsed(c => !c)}
                    className="w-full px-4 py-3 border-b border-slate-100 flex items-center justify-between text-left"
                >
                    <div className="flex items-center gap-2">
                        {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
                        <h3 className="text-sm font-semibold text-slate-900 capitalize">{sc.scorecard_level}</h3>
                        <KPIStatusBadge value={sc.overall_score == null ? 'no_data' : scoreStatus(sc.overall_score)} />
                    </div>
                    <Button size="sm" variant="outline" disabled={recalc} onClick={(e) => { e.stopPropagation(); recalculate() }}>
                        {recalc ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                        Recalculate
                    </Button>
                </button>
                {!collapsed && (
                    <div className="p-4 space-y-3">
                        <p className="text-sm text-slate-700">{scopeLabel(sc)}</p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Last Generated</p>
                                <p className="mt-1 font-medium text-slate-900">{formatDate(sc.generated_at ?? sc.updated_at)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Targets</p>
                                <p className="mt-1 font-medium text-slate-900">{totalItems} <span className="text-xs text-slate-500">total targets</span></p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Data Coverage</p>
                                <p className="mt-1 font-medium text-slate-900">{dataCoverage}% <span className="text-xs text-slate-500">{dataCoverage >= 80 ? 'High coverage' : dataCoverage >= 50 ? 'Medium' : 'Low'}</span></p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Owner</p>
                                <div className="mt-1 inline-flex items-center gap-1.5">
                                    {sc.owner_user_id ? (
                                        <>
                                            <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                                {ownerInitials(sc.owner_user_id)}
                                            </span>
                                            <span className="text-xs text-slate-700 font-mono">{shortId(sc.owner_user_id)}</span>
                                        </>
                                    ) : <span className="text-xs text-slate-400">—</span>}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Score distribution donut */}
            <KPIChartCard title="Score Distribution">
                {loading ? (
                    <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                ) : totalItems === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No items to chart yet.</p>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <KPIDonut
                            segments={[
                                { value: counts.on_track, color: '#10b981', label: 'On Track' },
                                { value: counts.at_risk, color: '#f59e0b', label: 'At Risk' },
                                { value: counts.off_track, color: '#ef4444', label: 'Off Track' },
                                { value: counts.no_data, color: '#cbd5e1', label: 'Needs Data' },
                            ]}
                            total={totalItems}
                            centerLabel={totalItems}
                            centerSub="Total"
                            size={140}
                        />
                        <ul className="text-xs space-y-1 w-full">
                            <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />On Track</span><span className="tabular-nums">{counts.on_track} ({totalItems > 0 ? Math.round((counts.on_track / totalItems) * 100) : 0}%)</span></li>
                            <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />At Risk</span><span className="tabular-nums">{counts.at_risk} ({totalItems > 0 ? Math.round((counts.at_risk / totalItems) * 100) : 0}%)</span></li>
                            <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Off Track</span><span className="tabular-nums">{counts.off_track} ({totalItems > 0 ? Math.round((counts.off_track / totalItems) * 100) : 0}%)</span></li>
                            <li className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" />Needs Data</span><span className="tabular-nums">{counts.no_data} ({totalItems > 0 ? Math.round((counts.no_data / totalItems) * 100) : 0}%)</span></li>
                        </ul>
                    </div>
                )}
            </KPIChartCard>

            {/* Score trend */}
            <KPIChartCard title="Score Trend" description="Current period score">
                {sc.overall_score == null ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No score available yet.</p>
                ) : (
                    <>
                        <KPILineChart
                            points={[Number(sc.overall_score)]}
                            xLabels={[scorecard.period_id?.slice(0, 8) ?? 'Current']}
                            height={180}
                        />
                        <p className="text-[11px] text-slate-500 mt-1">Historical trend across periods is not yet available — only the current period score is shown.</p>
                    </>
                )}
            </KPIChartCard>
        </div>
    )
}
