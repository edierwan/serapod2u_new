'use client'
/**
 * Targets tab — Define target values, thresholds, weights, and publish state.
 *
 * Top stat cards: Draft / Published / Weighted Metrics (sum of weight) / Approval Needed (pending)
 * Toolbar: Search, Filter, Status dropdown, Publish All, New Target
 * Table: Metric / Target / Weight / Green / Yellow / Red / Owner / Status / Updated
 * Bottom detail panel: target summary + thresholds + formula + history
 *
 * Backed by:
 *   GET  /api/hr/kpi/targets?period_id=…
 *   POST /api/hr/kpi/targets
 *   POST /api/hr/kpi/targets/publish    body { period_id }
 *   PATCH /api/hr/kpi/targets/{id}
 *   GET  /api/hr/kpi/assignments?period_id=…  (for assignment dropdown)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    FileText, CheckCircle2, Scale, AlertTriangle, Plus, Filter, Search,
    Send, Loader2, MoreHorizontal, Pencil, ChevronUp, ChevronDown, Copy,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    KPIStatCard, KPIStatusBadge, KPIEmptyState, KPICenteredLoader,
    KPIDetailRow, PerspectiveLabel,
} from '../shared'
import { kpiFetch, formatDate } from '../types'

// ── Types ────────────────────────────────────────────────────────
interface Target {
    id: string
    period_id: string
    assignment_id: string
    metric_id: string
    target_value: number
    target_unit?: string | null
    weight_percent: number
    green_threshold: number
    yellow_threshold: number
    red_threshold: number
    benchmark_type?: string | null
    benchmark_value?: number | null
    review_frequency?: string | null
    status: string
    notes?: string | null
    description?: string | null
    formula?: string | null
    created_at?: string | null
    updated_at?: string | null
    created_by?: string | null
    published_at?: string | null
    published_by?: string | null
    reviewed_at?: string | null
    reviewed_by?: string | null
    hr_kpi_metrics?: {
        kpi_code: string
        name: string
        unit: string
        perspective?: string | null
        description?: string | null
        formula_description?: string | null
    }
    hr_kpi_assignments?: {
        owner_user_id?: string | null
        assignment_level?: string
    }
}

interface Assignment {
    id: string
    metric_id: string
    assignment_level: string
    owner_user_id?: string | null
    hr_kpi_metrics?: { kpi_code: string; name: string; unit: string }
}

function ownerInitials(id?: string | null) {
    if (!id) return '—'
    return id.slice(0, 2).toUpperCase()
}

function shortId(id?: string | null) {
    if (!id) return '—'
    return id.length > 10 ? id.slice(0, 8) + '…' : id
}

// ── Main ─────────────────────────────────────────────────────────
export function KPITargetsTab({ periodId, periodName }: { periodId: string | null; periodName?: string | null }) {
    const [targets, setTargets] = useState<Target[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [openCreate, setOpenCreate] = useState(false)
    const [publishing, setPublishing] = useState(false)

    const load = useCallback(async () => {
        if (!periodId) { setTargets([]); setLoading(false); return }
        setLoading(true)
        setError(null)
        const [t, a] = await Promise.all([
            kpiFetch<Target[]>(`/api/hr/kpi/targets?period_id=${periodId}`),
            kpiFetch<Assignment[]>(`/api/hr/kpi/assignments?period_id=${periodId}`),
        ])
        if (!t.success) setError(t.error ?? 'Failed to load targets')
        if (t.success && t.data) setTargets(t.data)
        if (a.success && a.data) setAssignments(a.data)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const stats = useMemo(() => {
        const draft = targets.filter(t => t.status === 'draft').length
        const published = targets.filter(t => t.status === 'published').length
        const pending = targets.filter(t => t.status === 'pending' || t.status === 'submitted').length
        const totalWeight = targets.reduce((acc, t) => acc + (Number(t.weight_percent) || 0), 0)
        return {
            draft,
            published,
            pending,
            weighted: targets.length,
            totalWeight,
        }
    }, [targets])

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase()
        return targets.filter(t => {
            if (statusFilter !== 'all' && t.status !== statusFilter) return false
            if (!s) return true
            const hay = [
                t.hr_kpi_metrics?.name,
                t.hr_kpi_metrics?.kpi_code,
                t.notes,
                t.description,
            ].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(s)
        })
    }, [targets, search, statusFilter])

    useEffect(() => {
        if (!selectedId && filtered.length) setSelectedId(filtered[0].id)
        if (selectedId && !filtered.some(t => t.id === selectedId) && filtered.length) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => targets.find(t => t.id === selectedId) ?? null, [targets, selectedId])

    async function publishAll() {
        if (!periodId) return
        setPublishing(true)
        const r = await kpiFetch<{ published_count: number }>('/api/hr/kpi/targets/publish', {
            method: 'POST', body: JSON.stringify({ period_id: periodId }),
        })
        setPublishing(false)
        if (r.success) {
            toast({ title: `Published ${r.data?.published_count ?? 0} targets` })
            load()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    const hasDrafts = stats.draft > 0

    return (
        <div className="space-y-4 mt-4">
            {/* Toolbar (top, like image) */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-[260px] max-w-full">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search metrics…"
                            className="pl-8 h-9 bg-white"
                        />
                    </div>
                    <Button variant="outline" size="sm" disabled title="Filter not available yet">
                        <Filter className="h-3.5 w-3.5 mr-1.5" />Filter
                    </Button>
                    <div className="flex items-center gap-1.5">
                        <Label className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Status</Label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[140px] h-9 bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="published">Published</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={publishAll} disabled={!hasDrafts || publishing} title={hasDrafts ? 'Publish all draft targets' : 'No drafts to publish'}>
                        {publishing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                        Publish All
                    </Button>
                    <Button onClick={() => setOpenCreate(true)} disabled={!periodId} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Plus className="h-4 w-4 mr-1.5" />New Target
                    </Button>
                </div>
            </div>

            {/* Top stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPIStatCard
                    label="Draft Targets" value={stats.draft}
                    hint="Awaiting publish"
                    icon={<FileText className="h-4 w-4" />} tone="amber"
                />
                <KPIStatCard
                    label="Published Targets" value={stats.published}
                    hint="Active for scoring"
                    icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald"
                />
                <KPIStatCard
                    label="Weighted Metrics" value={stats.weighted}
                    hint={stats.weighted > 0 ? `${stats.totalWeight}% total weight` : 'No targets yet'}
                    icon={<Scale className="h-4 w-4" />} tone="blue"
                />
                <KPIStatCard
                    label="Approval Needed" value={stats.pending}
                    hint={stats.pending > 0 ? 'Requires review' : 'All reviewed'}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone={stats.pending > 0 ? 'orange' : 'slate'}
                />
            </div>

            {/* Table */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                {loading ? (
                    <KPICenteredLoader />
                ) : !periodId ? (
                    <KPIEmptyState
                        title="Select a period"
                        description="Choose a performance period to define KPI targets."
                    />
                ) : error ? (
                    <KPIEmptyState
                        title="Unable to load targets"
                        description={error}
                        actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                    />
                ) : targets.length === 0 ? (
                    <KPIEmptyState
                        title="No KPI targets yet"
                        description="Set target values, weights, and thresholds for the selected performance period."
                        actions={<Button size="sm" onClick={() => setOpenCreate(true)}><Plus className="h-3.5 w-3.5 mr-1.5" />New Target</Button>}
                    />
                ) : filtered.length === 0 ? (
                    <KPIEmptyState
                        title="No matching targets"
                        description="Try adjusting your search or filter."
                        searchMode
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide w-8"></TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Metric</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">Target Value</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">Weight %</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Green ≥</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Yellow ≥</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Red / Baseline (&lt;)</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Owner</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Status</TableHead>
                                    <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Updated</TableHead>
                                    <TableHead className="h-9 w-10"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(t => {
                                    const isSel = selectedId === t.id
                                    const unit = t.hr_kpi_metrics?.unit ?? t.target_unit ?? ''
                                    return (
                                        <TableRow
                                            key={t.id}
                                            onClick={() => setSelectedId(t.id)}
                                            className={cn(
                                                'cursor-pointer border-slate-100 transition-colors',
                                                isSel ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                            )}
                                        >
                                            <TableCell className="py-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={isSel}
                                                    onChange={() => setSelectedId(t.id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
                                                />
                                            </TableCell>
                                            <TableCell className="py-2.5">
                                                <div className="font-medium text-slate-900 text-sm truncate max-w-[200px]">
                                                    {t.hr_kpi_metrics?.name ?? 'Unknown metric'}
                                                </div>
                                                {t.hr_kpi_metrics?.perspective && (
                                                    <div className="mt-0.5"><PerspectiveLabel value={t.hr_kpi_metrics.perspective} /></div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-right tabular-nums text-sm text-slate-900 font-medium">
                                                {Number(t.target_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit && <span className="text-slate-500 text-xs"> {unit}</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5 text-right tabular-nums text-sm text-slate-700">{t.weight_percent}%</TableCell>
                                            <TableCell className="py-2.5">
                                                <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-700">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                                    {Number(t.green_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}
                                                </span>
                                            </TableCell>
                                            <TableCell className="py-2.5">
                                                <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-700">
                                                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                                                    {Number(t.yellow_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}
                                                </span>
                                            </TableCell>
                                            <TableCell className="py-2.5">
                                                <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-700">
                                                    <span className="h-2 w-2 rounded-full bg-red-500" />
                                                    {Number(t.red_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}
                                                </span>
                                            </TableCell>
                                            <TableCell className="py-2.5">
                                                {t.hr_kpi_assignments?.owner_user_id ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                                            {ownerInitials(t.hr_kpi_assignments.owner_user_id)}
                                                        </span>
                                                        <span className="text-xs text-slate-700 font-mono">{shortId(t.hr_kpi_assignments.owner_user_id)}</span>
                                                    </span>
                                                ) : <span className="text-xs text-slate-400">—</span>}
                                            </TableCell>
                                            <TableCell className="py-2.5"><KPIStatusBadge value={t.status} /></TableCell>
                                            <TableCell className="py-2.5 text-xs text-slate-500">
                                                {formatDate(t.updated_at ?? t.created_at)}
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
                        <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
                            <span>Showing 1 to {filtered.length} of {targets.length} entries</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail panel (below) */}
            {selected && <TargetDetailPanel target={selected} />}

            {openCreate && (
                <CreateTargetDialog
                    open={openCreate}
                    onClose={() => setOpenCreate(false)}
                    assignments={assignments}
                    periodId={periodId}
                    onCreated={load}
                />
            )}
        </div>
    )
}

// ── Detail panel ─────────────────────────────────────────────────
function TargetDetailPanel({ target }: { target: Target }) {
    const [collapsed, setCollapsed] = useState(false)
    const unit = target.hr_kpi_metrics?.unit ?? target.target_unit ?? ''
    const name = target.hr_kpi_metrics?.name ?? 'Selected target'
    const description = target.description ?? target.hr_kpi_metrics?.description ?? null
    const formula = target.formula ?? target.hr_kpi_metrics?.formula_description ?? null

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
            {/* Header */}
            <button
                onClick={() => setCollapsed(c => !c)}
                className="w-full px-4 py-3 border-b border-slate-100 flex items-center justify-between text-left"
            >
                <div className="flex items-center gap-2 min-w-0">
                    {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" />}
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{name}</h3>
                    <KPIStatusBadge value={target.status} />
                </div>
                <span className="text-xs text-slate-500">Target details</span>
            </button>

            {!collapsed && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Description column */}
                    <div className="space-y-3">
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Description</p>
                            <p className="text-sm text-slate-700 leading-relaxed">
                                {description ?? <span className="text-slate-400 italic">No description provided.</span>}
                            </p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 pt-1">
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Owner</p>
                                <div className="mt-1.5 inline-flex items-center gap-1.5">
                                    {target.hr_kpi_assignments?.owner_user_id ? (
                                        <>
                                            <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                                {ownerInitials(target.hr_kpi_assignments.owner_user_id)}
                                            </span>
                                            <span className="text-xs text-slate-700 font-mono">{shortId(target.hr_kpi_assignments.owner_user_id)}</span>
                                        </>
                                    ) : <span className="text-xs text-slate-400">—</span>}
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Weight</p>
                                <p className="mt-1.5 text-sm text-slate-900 font-medium">{target.weight_percent}% of total</p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Status</p>
                                <div className="mt-1.5"><KPIStatusBadge value={target.status} /></div>
                            </div>
                        </div>
                    </div>

                    {/* Thresholds column */}
                    <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Thresholds</p>
                        <ul className="space-y-2 text-sm">
                            <li className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-2 text-slate-700">
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Green (≥)
                                </span>
                                <span className="font-medium tabular-nums">{Number(target.green_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}</span>
                            </li>
                            <li className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-2 text-slate-700">
                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Yellow (≥)
                                </span>
                                <span className="font-medium tabular-nums">{Number(target.yellow_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}</span>
                            </li>
                            <li className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-2 text-slate-700">
                                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" />Red / Baseline (&lt;)
                                </span>
                                <span className="font-medium tabular-nums">{Number(target.red_threshold).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}</span>
                            </li>
                            <li className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                                <span className="text-slate-700">Target Value</span>
                                <span className="font-semibold tabular-nums text-slate-900">{Number(target.target_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}</span>
                            </li>
                        </ul>
                    </div>

                    {/* Formula + Notes */}
                    <div className="space-y-3">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Formula / Reference</p>
                                {formula && (
                                    <button
                                        className="text-slate-400 hover:text-slate-600"
                                        title="Copy formula"
                                        onClick={() => {
                                            navigator.clipboard?.writeText(formula).then(
                                                () => toast({ title: 'Formula copied' }),
                                            ).catch(() => { })
                                        }}
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                            {formula ? (
                                <code className="block text-xs bg-slate-50 border border-slate-200 rounded px-2 py-2 font-mono text-slate-700 whitespace-pre-wrap break-words">
                                    {formula}
                                </code>
                            ) : (
                                <p className="text-xs text-slate-400 italic">No formula recorded for this metric.</p>
                            )}
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Notes</p>
                            <p className="text-sm text-slate-700">
                                {target.notes ?? <span className="text-slate-400 italic">No notes recorded.</span>}
                            </p>
                        </div>
                    </div>

                    {/* History timeline – spans full width */}
                    <div className="md:col-span-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-3">History</p>
                        <ul className="space-y-2.5">
                            {target.published_at && (
                                <TimelineRow label="Published" who={target.published_by} when={target.published_at} dot="bg-emerald-500" />
                            )}
                            {target.reviewed_at && (
                                <TimelineRow label="Reviewed" who={target.reviewed_by} when={target.reviewed_at} dot="bg-blue-500" />
                            )}
                            <TimelineRow
                                label="Created"
                                who={target.created_by}
                                when={target.created_at}
                                dot="bg-slate-400"
                            />
                            {!target.published_at && !target.reviewed_at && (
                                <li className="text-xs text-slate-400 italic">Review and publish events will appear here as the target progresses.</li>
                            )}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    )
}

function TimelineRow({ label, who, when, dot }: { label: string; who?: string | null; when?: string | null; dot: string }) {
    return (
        <li className="flex items-start gap-3 text-sm">
            <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', dot)} />
            <div className="min-w-0">
                <div className="font-medium text-slate-900">{label}</div>
                <div className="text-xs text-slate-500">
                    {who ? <span className="font-mono">by {shortId(who)}</span> : 'by system'}
                    {when && <span className="mx-1.5">·</span>}
                    {when && <span>{formatDate(when)}</span>}
                </div>
            </div>
        </li>
    )
}

// ── Create dialog ────────────────────────────────────────────────
function CreateTargetDialog({
    open, onClose, assignments, periodId, onCreated,
}: {
    open: boolean
    onClose: () => void
    assignments: Assignment[]
    periodId: string | null
    onCreated: () => void
}) {
    const [form, setForm] = useState({
        assignment_id: '',
        target_value: '',
        weight_percent: '10',
        green_threshold: '90',
        yellow_threshold: '70',
        red_threshold: '0',
        notes: '',
        status: 'draft',
    })
    const [saving, setSaving] = useState(false)

    async function save() {
        if (!periodId) return
        const a = assignments.find(x => x.id === form.assignment_id)
        if (!a) {
            toast({ title: 'Select an assignment', variant: 'destructive' })
            return
        }
        if (!form.target_value) {
            toast({ title: 'Target value required', variant: 'destructive' })
            return
        }
        setSaving(true)
        const r = await kpiFetch('/api/hr/kpi/targets', {
            method: 'POST',
            body: JSON.stringify({
                period_id: periodId,
                assignment_id: a.id,
                metric_id: a.metric_id,
                target_value: Number(form.target_value),
                weight_percent: Number(form.weight_percent || 0),
                green_threshold: Number(form.green_threshold),
                yellow_threshold: Number(form.yellow_threshold),
                red_threshold: Number(form.red_threshold),
                status: form.status,
                notes: form.notes || null,
            }),
        })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Target saved' })
            onCreated()
            onClose()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>New Target</DialogTitle>
                    <DialogDescription>Set the target value, weight, and thresholds for an assignment.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <Label>Assignment *</Label>
                        <Select value={form.assignment_id} onValueChange={v => setForm(f => ({ ...f, assignment_id: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select an assignment" /></SelectTrigger>
                            <SelectContent>
                                {assignments.length === 0 ? (
                                    <div className="px-2 py-3 text-xs text-slate-500">No assignments. Create one in Cascade.</div>
                                ) : assignments.map(a => (
                                    <SelectItem key={a.id} value={a.id}>
                                        <span className="capitalize">{a.assignment_level}</span> · {a.hr_kpi_metrics?.name ?? a.metric_id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Target Value *</Label>
                            <Input type="number" value={form.target_value} onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Weight %</Label>
                            <Input type="number" value={form.weight_percent} onChange={e => setForm(f => ({ ...f, weight_percent: e.target.value }))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <Label>Green ≥</Label>
                            <Input type="number" value={form.green_threshold} onChange={e => setForm(f => ({ ...f, green_threshold: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Yellow ≥</Label>
                            <Input type="number" value={form.yellow_threshold} onChange={e => setForm(f => ({ ...f, yellow_threshold: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Red &lt;</Label>
                            <Input type="number" value={form.red_threshold} onChange={e => setForm(f => ({ ...f, red_threshold: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <Label>Notes</Label>
                        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional rationale or assumptions" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving || !form.assignment_id || !form.target_value}>
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
