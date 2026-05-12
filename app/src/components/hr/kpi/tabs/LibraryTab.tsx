'use client'
/**
 * Library tab — KPI metric library.
 * Stat cards + searchable, filterable table + selected metric detail panel.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
    LayoutGrid, Database, FileEdit, Search, Filter, Plus, MoreHorizontal,
    Loader2, Tag, Hash, Calendar, User, Clock,
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
    KPIDetailPanel, KPIDetailRow, KPIDirection, PerspectiveLabel,
} from '../shared'
import { kpiFetch, Metric, KpiTarget, PERSPECTIVE_OPTIONS, formatDate } from '../types'

export function KPILibraryTab() {
    const [items, setItems] = useState<Metric[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [perspective, setPerspective] = useState<string>('all')
    const [status, setStatus] = useState<string>('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [openCreate, setOpenCreate] = useState(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        const r = await kpiFetch<Metric[]>('/api/hr/kpi/metrics')
        if (r.success && r.data) setItems(r.data)
        else setError(r.error ?? 'Failed to load metrics')
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    const counts = useMemo(() => ({
        total: items.length,
        mapped: items.filter(m => m.data_source_status === 'mapped').length,
        draft: items.filter(m => m.status === 'draft').length,
    }), [items])

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim()
        return items.filter(m => {
            if (q && !(m.name?.toLowerCase().includes(q) || m.kpi_code?.toLowerCase().includes(q))) return false
            if (perspective !== 'all' && m.perspective !== perspective) return false
            if (status !== 'all' && m.status !== status) return false
            return true
        })
    }, [items, search, perspective, status])

    useEffect(() => {
        if (filtered.length && !filtered.find(m => m.id === selectedId)) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => items.find(m => m.id === selectedId) ?? null, [items, selectedId])

    return (
        <div className="space-y-4 mt-4">
            {/* Summary cards + toolbar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="lg:col-span-1 sm:col-span-1"><KPIStatCard
                    label="Total Metrics" value={counts.total}
                    icon={<LayoutGrid className="h-4 w-4" />} tone="blue"
                    hint="All published & draft metrics"
                /></div>
                <div className="lg:col-span-1 sm:col-span-1"><KPIStatCard
                    label="Mapped Sources" value={counts.mapped}
                    icon={<Database className="h-4 w-4" />} tone="emerald"
                    hint={`${counts.total > 0 ? Math.round((counts.mapped / counts.total) * 100) : 0}% of total metrics`}
                /></div>
                <div className="lg:col-span-1 sm:col-span-1"><KPIStatCard
                    label="Draft Metrics" value={counts.draft}
                    icon={<FileEdit className="h-4 w-4" />} tone="amber"
                    hint="Pending review & activation"
                /></div>
                <div className="lg:col-span-3 sm:col-span-3 flex items-center justify-end gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search metrics…"
                            className="pl-8 h-9 w-56"
                        />
                    </div>
                    <Select value={perspective} onValueChange={setPerspective}>
                        <SelectTrigger className="h-9 w-[150px]"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="Perspective" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            {PERSPECTIVE_OPTIONS.map(p =>
                                <SelectItem key={p} value={p} className="capitalize">{p.replaceAll('_', ' ')}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger className="h-9 w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={() => setOpenCreate(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Plus className="h-4 w-4 mr-1.5" />New Metric
                    </Button>
                </div>
            </div>

            {/* Main */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                {loading ? (
                    <KPICenteredLoader />
                ) : error ? (
                    <KPIEmptyState
                        title="Couldn't load metrics"
                        description={error}
                        actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                    />
                ) : items.length === 0 ? (
                    <KPIEmptyState
                        title="No KPI metrics in the library"
                        description="Create reusable metric definitions before assigning targets and generating scorecards."
                        actions={
                            <Button size="sm" onClick={() => setOpenCreate(true)}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" />New Metric
                            </Button>
                        }
                    />
                ) : filtered.length === 0 ? (
                    <KPIEmptyState
                        searchMode
                        title="No matching metrics"
                        description="Try adjusting your search or filters."
                        actions={<Button size="sm" variant="outline" onClick={() => { setSearch(''); setPerspective('all'); setStatus('all') }}>Clear filters</Button>}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold w-[40px]"></TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">KPI Code</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Metric Name</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Perspective</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Unit</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Direction</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Source</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Frequency</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Owner</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Status</TableHead>
                                    <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(m => {
                                    const isSelected = m.id === selectedId
                                    return (
                                        <TableRow
                                            key={m.id}
                                            onClick={() => setSelectedId(m.id)}
                                            className={cn(
                                                'cursor-pointer transition-colors relative border-slate-100',
                                                isSelected ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                            )}
                                        >
                                            <TableCell className="relative">
                                                {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500" />}
                                                <span className={cn(
                                                    'inline-flex h-4 w-4 items-center justify-center rounded-full border',
                                                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white',
                                                )}>
                                                    {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                                                </span>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-slate-600">{m.kpi_code}</TableCell>
                                            <TableCell>
                                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 text-sm">
                                                    {m.name}
                                                    {m.description && <span className="text-slate-400 cursor-help" title={m.description}>ⓘ</span>}
                                                </span>
                                            </TableCell>
                                            <TableCell><PerspectiveLabel value={m.perspective} /></TableCell>
                                            <TableCell className="text-sm text-slate-700">{m.unit}</TableCell>
                                            <TableCell><KPIDirection value={m.measurement_direction} /></TableCell>
                                            <TableCell><KPIStatusBadge value={m.data_source_status} /></TableCell>
                                            <TableCell className="text-sm text-slate-700 capitalize">
                                                {frequencyOf(m)}
                                            </TableCell>
                                            <TableCell><OwnerCell userId={m.owner_user_id ?? null} /></TableCell>
                                            <TableCell><KPIStatusBadge value={m.status} /></TableCell>
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

            {/* Selected metric detail panel */}
            {selected && <MetricDetailPanel metric={selected} onClose={() => setSelectedId(null)} />}

            <CreateMetricDialog open={openCreate} onOpenChange={setOpenCreate} onSaved={load} />
        </div>
    )
}

function frequencyOf(m: Metric): string {
    // Heuristic from calculation_type since no dedicated frequency column.
    if ((m as any).frequency) return String((m as any).frequency).replaceAll('_', ' ')
    return '—'
}

function OwnerCell({ userId }: { userId: string | null }) {
    if (!userId) return <span className="text-xs text-slate-400">—</span>
    const initials = userId.slice(0, 2).toUpperCase()
    return (
        <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                {initials}
            </span>
            <span className="text-xs text-slate-600 font-mono">{userId.slice(0, 8)}…</span>
        </div>
    )
}

function MetricDetailPanel({ metric, onClose }: { metric: Metric; onClose: () => void }) {
    const [targets, setTargets] = useState<KpiTarget[] | null>(null)
    useEffect(() => {
        let cancelled = false
        // No metric_id filter on /targets — fetch all then filter client-side.
        kpiFetch<KpiTarget[]>(`/api/hr/kpi/targets`).then(r => {
            if (cancelled) return
            const all = r.success && r.data ? r.data : []
            setTargets(all.filter(t => t.metric_id === metric.id))
        })
        return () => { cancelled = true }
    }, [metric.id])

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-slate-600">{metric.kpi_code}</span>
                    <KPIStatusBadge value={metric.status} />
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-slate-400 hover:text-slate-600"
                >
                    Close
                </button>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-900">{metric.name}</h3>
                        <p className="text-xs text-slate-500 capitalize mt-0.5">{metric.perspective?.replaceAll('_', ' ') ?? 'unspecified'}</p>
                    </div>
                    {metric.description && (
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Description</p>
                            <p className="text-sm text-slate-700 mt-1 leading-relaxed">{metric.description}</p>
                        </div>
                    )}
                    {metric.tags && metric.tags.length > 0 && (
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Tags</p>
                            <div className="flex flex-wrap gap-1.5">
                                {metric.tags.map((t, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                                        <Tag className="h-2.5 w-2.5" />{t}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Formula</p>
                        <FormulaDisplay metric={metric} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Unit</p>
                            <p className="text-sm font-medium text-slate-900 mt-1">{metric.unit || '—'}</p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Direction</p>
                            <div className="mt-1"><KPIDirection value={metric.measurement_direction} /></div>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                            Linked Targets {targets ? `(${targets.length})` : ''}
                        </p>
                        {targets === null ? (
                            <KPICenteredLoader />
                        ) : targets.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No targets linked yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {targets.slice(0, 3).map(t => (
                                    <div key={t.id} className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-slate-900 truncate">
                                                {t.hr_kpi_periods?.name ?? 'Target'}
                                            </span>
                                            <KPIStatusBadge value={t.status} />
                                        </div>
                                        <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                                            <span>Target Value</span>
                                            <span className="font-semibold tabular-nums">{t.target_value}{metric.unit}</span>
                                        </div>
                                    </div>
                                ))}
                                {targets.length > 3 && (
                                    <p className="text-xs text-blue-600 font-medium cursor-default">View all targets →</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
                <div className="flex items-center gap-4 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" />Source <span className="font-medium text-slate-700">{metric.data_source_status === 'mapped' ? 'Connected' : 'Manual'}</span></span>
                    <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />Calc <span className="font-medium text-slate-700 capitalize">{metric.calculation_type}</span></span>
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />Owner <OwnerCell userId={metric.owner_user_id ?? null} /></span>
                </div>
                <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />Last updated {formatDate(metric.updated_at)}
                </span>
            </div>
        </div>
    )
}

function FormulaDisplay({ metric }: { metric: Metric }) {
    const cfg = metric.formula_config as any
    if (cfg && typeof cfg === 'object' && (cfg.numerator || cfg.denominator)) {
        return (
            <div className="inline-flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-4 py-3">
                <div className="text-center">
                    <div className="border-b border-slate-300 pb-1 text-sm font-medium text-slate-900">{cfg.numerator}</div>
                    <div className="pt-1 text-sm text-slate-700">{cfg.denominator}</div>
                </div>
                {cfg.multiplier && (
                    <span className="text-sm text-slate-500">× {cfg.multiplier}</span>
                )}
            </div>
        )
    }
    if (cfg && typeof cfg === 'object' && cfg.expression) {
        return <code className="block rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 font-mono">{cfg.expression}</code>
    }
    return (
        <p className="text-xs text-slate-500 italic">
            {metric.calculation_type === 'manual' ? 'Manually recorded' : 'Auto-calculated · formula not defined'}
        </p>
    )
}

function CreateMetricDialog({
    open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => Promise<void> | void }) {
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        kpi_code: '', name: '', description: '', perspective: 'process', unit: '%',
        measurement_direction: 'higher_is_better', calculation_type: 'manual',
    })

    async function save() {
        if (!form.kpi_code || !form.name) {
            toast({ title: 'Code and name are required', variant: 'destructive' })
            return
        }
        setSaving(true)
        const r = await kpiFetch('/api/hr/kpi/metrics', { method: 'POST', body: JSON.stringify(form) })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Metric created' })
            onOpenChange(false)
            setForm({
                kpi_code: '', name: '', description: '', perspective: 'process', unit: '%',
                measurement_direction: 'higher_is_better', calculation_type: 'manual',
            })
            await onSaved()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>New KPI Metric</DialogTitle>
                    <DialogDescription>Define a reusable metric before assigning targets and generating scorecards.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">KPI Code</Label>
                        <Input value={form.kpi_code} onChange={e => setForm({ ...form, kpi_code: e.target.value })} placeholder="OPS_DELIVERY_PCT" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Unit</Label>
                        <Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="%" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                        <Label className="text-xs">Name</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Delivery success rate" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                        <Label className="text-xs">Description</Label>
                        <Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Perspective</Label>
                        <Select value={form.perspective} onValueChange={v => setForm({ ...form, perspective: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PERSPECTIVE_OPTIONS.map(p =>
                                    <SelectItem key={p} value={p} className="capitalize">{p.replaceAll('_', ' ')}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Direction</Label>
                        <Select value={form.measurement_direction} onValueChange={v => setForm({ ...form, measurement_direction: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="higher_is_better">Higher is better</SelectItem>
                                <SelectItem value="lower_is_better">Lower is better</SelectItem>
                                <SelectItem value="target_band">Target band</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Calculation</Label>
                        <Select value={form.calculation_type} onValueChange={v => setForm({ ...form, calculation_type: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {['manual', 'auto', 'hybrid'].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
                            </SelectContent>
                        </Select>
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
