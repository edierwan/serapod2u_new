'use client'
/**
 * Objectives tab — Strategic Objectives workspace.
 * Stat cards + searchable table + selected objective detail with linked KPIs.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Target, CheckCircle2, AlertTriangle, ArrowDownCircle, Database, Plus, Search, Filter,
    MoreHorizontal, Loader2, Calendar, User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
    KPIStatCard, KPIStatusBadge, KPIEmptyState, KPICenteredLoader,
    KPIDetailPanel, KPIDetailRow, KPIProgressBar, PerspectiveLabel,
} from '../shared'
import { kpiFetch, Objective, Metric, formatDate, PERSPECTIVE_OPTIONS } from '../types'

export function KPIObjectivesTab({ periodId }: { periodId: string | null }) {
    const [items, setItems] = useState<Objective[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [perspective, setPerspective] = useState<string>('all')
    const [status, setStatus] = useState<string>('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [openCreate, setOpenCreate] = useState(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        const url = '/api/hr/kpi/objectives' + (periodId ? `?period_id=${periodId}` : '')
        const r = await kpiFetch<Objective[]>(url)
        if (r.success && r.data) setItems(r.data)
        else setError(r.error ?? 'Failed to load objectives')
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const counts = useMemo(() => ({
        total: items.length,
        on_track: items.filter(o => o.status === 'on_track').length,
        at_risk: items.filter(o => o.status === 'at_risk').length,
        off_track: items.filter(o => o.status === 'off_track' || o.status === 'below_target').length,
        no_data: items.filter(o => o.status === 'no_data' || o.status === 'draft' || !o.status).length,
    }), [items])

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim()
        return items.filter(o => {
            if (q && !(o.title?.toLowerCase().includes(q) || o.objective_code?.toLowerCase().includes(q))) return false
            if (perspective !== 'all' && o.perspective !== perspective) return false
            if (status !== 'all' && o.status !== status) return false
            return true
        })
    }, [items, search, perspective, status])

    useEffect(() => {
        if (filtered.length && !filtered.find(o => o.id === selectedId)) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => items.find(o => o.id === selectedId) ?? null, [items, selectedId])

    return (
        <div className="space-y-4 mt-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KPIStatCard label="Total Objectives" value={counts.total} icon={<Target className="h-4 w-4" />} tone="blue" />
                <KPIStatCard label="On Track" value={counts.on_track} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" hint={pctHint(counts.on_track, counts.total)} />
                <KPIStatCard label="At Risk" value={counts.at_risk} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" hint={pctHint(counts.at_risk, counts.total)} />
                <KPIStatCard label="Off Track" value={counts.off_track} icon={<ArrowDownCircle className="h-4 w-4" />} tone="red" hint={pctHint(counts.off_track, counts.total)} />
                <KPIStatCard label="No Data" value={counts.no_data} icon={<Database className="h-4 w-4" />} tone="slate" hint={pctHint(counts.no_data, counts.total)} />
            </div>

            {/* Main */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900">Strategic Objectives</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Top-down goals for the selected period.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search objectives…"
                                className="pl-8 h-9 w-56"
                            />
                        </div>
                        <Select value={perspective} onValueChange={setPerspective}>
                            <SelectTrigger className="h-9 w-[150px]"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="Perspective" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All perspectives</SelectItem>
                                {PERSPECTIVE_OPTIONS.map(p =>
                                    <SelectItem key={p} value={p} className="capitalize">{p.replaceAll('_', ' ')}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                <SelectItem value="on_track">On Track</SelectItem>
                                <SelectItem value="at_risk">At Risk</SelectItem>
                                <SelectItem value="off_track">Off Track</SelectItem>
                                <SelectItem value="no_data">No Data</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            onClick={() => setOpenCreate(true)}
                            disabled={!periodId}
                            title={!periodId ? 'Select a period first' : ''}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            <Plus className="h-4 w-4 mr-1.5" />New Objective
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <KPICenteredLoader />
                ) : error ? (
                    <KPIEmptyState
                        title="Couldn't load objectives"
                        description={error}
                        actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                    />
                ) : items.length === 0 ? (
                    <KPIEmptyState
                        title="No strategic objectives yet"
                        description="Create top-down objectives and link them to KPI metrics for the selected period."
                        actions={
                            <Button size="sm" onClick={() => setOpenCreate(true)} disabled={!periodId}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" />New Objective
                            </Button>
                        }
                    />
                ) : filtered.length === 0 ? (
                    <KPIEmptyState
                        searchMode
                        title="No matching objectives"
                        description="Try adjusting your search or filters."
                        actions={<Button size="sm" variant="outline" onClick={() => { setSearch(''); setPerspective('all'); setStatus('all') }}>Clear filters</Button>}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Code</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Objective Title</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Perspective</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Owner</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Linked KPIs</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold w-[200px]">Progress</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Status</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(o => {
                                    const isSelected = o.id === selectedId
                                    const progress = Number(o.progress_percent ?? 0)
                                    return (
                                        <TableRow
                                            key={o.id}
                                            onClick={() => setSelectedId(o.id)}
                                            className={cn(
                                                'cursor-pointer transition-colors relative border-slate-100',
                                                isSelected ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                            )}
                                        >
                                            <TableCell className="font-mono text-xs text-slate-600 relative">
                                                {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500" />}
                                                {o.objective_code}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-slate-900 text-sm leading-tight">{o.title}</span>
                                                    {o.description && (
                                                        <span className="text-xs text-slate-500 mt-0.5 line-clamp-1">{o.description}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell><PerspectiveLabel value={o.perspective} /></TableCell>
                                            <TableCell><OwnerCell userId={o.owner_user_id ?? null} /></TableCell>
                                            <TableCell>
                                                <LinkedKpiCount objectiveId={o.id} />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <KPIProgressBar
                                                        value={progress}
                                                        tone={progress >= 70 ? 'emerald' : progress >= 40 ? 'amber' : 'red'}
                                                        className="min-w-[100px]"
                                                    />
                                                    <span className="text-xs font-semibold text-slate-700 tabular-nums w-9 text-right">{Math.round(progress)}%</span>
                                                </div>
                                            </TableCell>
                                            <TableCell><KPIStatusBadge value={o.status} /></TableCell>
                                            <TableCell className="text-right">
                                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => e.stopPropagation()} disabled title="Row menu not available yet">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>

            {/* Selected detail row */}
            {selected && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="lg:col-span-1">
                        <KPIDetailPanel
                            title={selected.title}
                            status={<KPIStatusBadge value={selected.status} />}
                            subtitle={
                                <span className="inline-flex items-center gap-2 font-mono text-xs">
                                    {selected.objective_code}
                                </span>
                            }
                        >
                            {selected.description && (
                                <p className="text-sm text-slate-600 leading-relaxed">{selected.description}</p>
                            )}
                            <div className="space-y-2.5 pt-2 border-t border-slate-100">
                                <KPIDetailRow label="Code" value={<span className="font-mono text-xs">{selected.objective_code}</span>} />
                                <KPIDetailRow label="Perspective" value={<PerspectiveLabel value={selected.perspective} />} />
                                <KPIDetailRow icon={<User className="h-3.5 w-3.5" />} label="Owner" value={<OwnerCell userId={selected.owner_user_id ?? null} />} />
                                <KPIDetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Start Date" value={formatDate(selected.start_date)} />
                                <KPIDetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Target Date" value={formatDate(selected.end_date)} />
                            </div>
                        </KPIDetailPanel>
                    </div>
                    <div className="lg:col-span-1">
                        <LinkedKpisPanel objectiveId={selected.id} />
                    </div>
                    <div className="lg:col-span-1">
                        <RecentUpdatesPanel objectiveId={selected.id} progress={Number(selected.progress_percent ?? 0)} />
                    </div>
                </div>
            )}

            <CreateObjectiveDialog
                open={openCreate}
                onOpenChange={setOpenCreate}
                onSaved={load}
                periodId={periodId}
            />
        </div>
    )
}

function pctHint(value: number, total: number): string {
    if (total === 0) return '0% of total'
    return `${Math.round((value / total) * 100)}% of total`
}

function OwnerCell({ userId }: { userId: string | null }) {
    if (!userId) return <span className="text-xs text-slate-400">—</span>
    const initials = userId.slice(0, 2).toUpperCase()
    return (
        <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                {initials}
            </span>
            <span className="text-xs text-slate-600 font-mono truncate max-w-[100px]">{userId.slice(0, 8)}…</span>
        </div>
    )
}

function LinkedKpiCount({ objectiveId }: { objectiveId: string }) {
    const [count, setCount] = useState<number | null>(null)
    useEffect(() => {
        let cancelled = false
        kpiFetch<Metric[]>(`/api/hr/kpi/objectives/${objectiveId}/metrics`).then(r => {
            if (cancelled) return
            setCount(r.success && r.data ? r.data.length : 0)
        })
        return () => { cancelled = true }
    }, [objectiveId])
    if (count == null) return <span className="text-xs text-slate-400">…</span>
    return <span className="text-sm font-semibold text-slate-700 tabular-nums">{count}</span>
}

function LinkedKpisPanel({ objectiveId }: { objectiveId: string }) {
    const [metrics, setMetrics] = useState<Metric[] | null>(null)
    useEffect(() => {
        let cancelled = false
        kpiFetch<Metric[]>(`/api/hr/kpi/objectives/${objectiveId}/metrics`).then(r => {
            if (cancelled) return
            setMetrics(r.success && r.data ? r.data : [])
        })
        return () => { cancelled = true }
    }, [objectiveId])
    return (
        <KPIDetailPanel
            title={<span className="inline-flex items-center gap-2">Linked KPIs <span className="text-xs font-normal text-slate-500">({metrics?.length ?? 0})</span></span>}
            accent={false}
        >
            {metrics === null ? (
                <KPICenteredLoader />
            ) : metrics.length === 0 ? (
                <KPIEmptyState compact title="No linked KPIs" description="Link metrics from the Library to track this objective." />
            ) : (
                <div className="space-y-2">
                    {metrics.slice(0, 6).map(m => (
                        <div key={m.id} className="flex items-center justify-between gap-2 text-sm py-1">
                            <span className="text-slate-700 truncate">{m.name}</span>
                            <span className="text-xs font-mono text-slate-400 shrink-0">{m.kpi_code}</span>
                        </div>
                    ))}
                    {metrics.length > 6 && (
                        <p className="text-xs text-slate-500 pt-1 border-t border-slate-100">+{metrics.length - 6} more</p>
                    )}
                </div>
            )}
        </KPIDetailPanel>
    )
}

function RecentUpdatesPanel({ objectiveId, progress }: { objectiveId: string; progress: number }) {
    // No backend timeline endpoint — show a single-state summary.
    return (
        <KPIDetailPanel
            title="Recent Updates"
            accent={false}
            footer={
                <Button variant="ghost" size="sm" className="w-full" disabled title="Updates timeline not available yet">
                    View all
                </Button>
            }
        >
            <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-7 w-7 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <Target className="h-3.5 w-3.5 text-blue-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                        <p className="text-slate-900 font-medium">Current progress {Math.round(progress)}%</p>
                        <p className="text-xs text-slate-500">Updated automatically from linked KPIs</p>
                    </div>
                </div>
                <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
                    Detailed update history is not available yet.
                </p>
            </div>
        </KPIDetailPanel>
    )
}

function CreateObjectiveDialog({
    open, onOpenChange, onSaved, periodId,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    onSaved: () => Promise<void> | void
    periodId: string | null
}) {
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        objective_code: '', title: '', description: '', perspective: '',
    })

    async function save() {
        if (!periodId) { toast({ title: 'Select a period first', variant: 'destructive' }); return }
        if (!form.objective_code || !form.title) { toast({ title: 'Code and title are required', variant: 'destructive' }); return }
        setSaving(true)
        const r = await kpiFetch('/api/hr/kpi/objectives', {
            method: 'POST',
            body: JSON.stringify({ ...form, period_id: periodId, perspective: form.perspective || null }),
        })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Objective created' })
            onOpenChange(false)
            setForm({ objective_code: '', title: '', description: '', perspective: '' })
            await onSaved()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New Strategic Objective</DialogTitle>
                    <DialogDescription>Create a top-down goal for the selected period.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Code</Label>
                        <Input value={form.objective_code} onChange={e => setForm({ ...form, objective_code: e.target.value })} placeholder="OBJ_OPS_2026Q3" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Perspective</Label>
                        <Select value={form.perspective} onValueChange={v => setForm({ ...form, perspective: v })}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                                {PERSPECTIVE_OPTIONS.map(p =>
                                    <SelectItem key={p} value={p} className="capitalize">{p.replaceAll('_', ' ')}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                        <Label className="text-xs">Title</Label>
                        <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Improve operational throughput" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                        <Label className="text-xs">Description</Label>
                        <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>
                        {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
