'use client'
/**
 * Periods tab — Performance period management with stat cards,
 * compact table, and right-side detail panel with summary metrics.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Calendar, FileEdit, Lock, Clock, Plus, Filter, MoreHorizontal, ChevronRight,
    LayoutDashboard, Target, BarChart3, GitBranch, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
    KPIStatCard, KPIStatusBadge, KPIEmptyState, KPICenteredLoader,
    KPIDetailPanel, KPIDetailRow, KPIProgressBar,
} from '../shared'
import { kpiFetch, Period, Objective, formatDate, formatDateRange } from '../types'

export function KPIPeriodsTab({
    periods, reload, onPeriodSelect, currentPeriodId,
}: {
    periods: Period[]
    reload: () => Promise<void> | void
    onPeriodSelect?: (id: string) => void
    currentPeriodId?: string | null
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [filter, setFilter] = useState<string>('all')
    const [openCreate, setOpenCreate] = useState(false)

    useEffect(() => {
        if (!selectedId && periods.length) {
            const active = periods.find(p => p.status === 'active') ?? periods[0]
            setSelectedId(active?.id ?? null)
        }
    }, [periods, selectedId])

    const counts = useMemo(() => ({
        active: periods.filter(p => p.status === 'active').length,
        draft: periods.filter(p => p.status === 'draft').length,
        locked: periods.filter(p => p.status === 'locked' || p.status === 'completed').length,
        upcoming: periods.filter(p => p.status === 'upcoming').length,
    }), [periods])

    const filtered = useMemo(() => {
        if (filter === 'all') return periods
        return periods.filter(p => p.status === filter || (filter === 'locked' && p.status === 'completed'))
    }, [periods, filter])

    const selected = useMemo(() => periods.find(p => p.id === selectedId) ?? null, [periods, selectedId])

    return (
        <div className="space-y-4 mt-4">
            {/* Top stat cards + toolbar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="lg:col-span-1 col-span-2 sm:col-span-1"><KPIStatCard
                    label="Active Periods" value={counts.active} hint="In progress"
                    icon={<Calendar className="h-4 w-4" />} tone="blue"
                /></div>
                <div className="lg:col-span-1 col-span-2 sm:col-span-1"><KPIStatCard
                    label="Draft" value={counts.draft} hint="Not started"
                    icon={<FileEdit className="h-4 w-4" />} tone="amber"
                /></div>
                <div className="lg:col-span-1 col-span-1"><KPIStatCard
                    label="Locked" value={counts.locked} hint="Completed"
                    icon={<Lock className="h-4 w-4" />} tone="slate"
                /></div>
                <div className="lg:col-span-1 col-span-1"><KPIStatCard
                    label="Upcoming" value={counts.upcoming} hint="Future periods"
                    icon={<Clock className="h-4 w-4" />} tone="emerald"
                /></div>
                <div className="lg:col-span-2 col-span-2 sm:col-span-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                    <Button onClick={() => setOpenCreate(true)} className="bg-slate-900 hover:bg-slate-800 text-white w-full sm:w-auto">
                        <Plus className="h-4 w-4 mr-1.5" />New Period
                    </Button>
                    <Select value={filter} onValueChange={setFilter}>
                        <SelectTrigger className="w-full sm:w-[120px]">
                            <Filter className="h-3.5 w-3.5 mr-1.5" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="locked">Locked</SelectItem>
                            <SelectItem value="upcoming">Upcoming</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Main: table + detail panel */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <h3 className="text-sm font-semibold text-slate-900">Performance Periods</h3>
                    </div>
                    {filtered.length === 0 ? (
                        <KPIEmptyState
                            title="No performance periods yet"
                            description="Create a period to define the KPI measurement window for scorecards, targets, and actuals."
                            actions={
                                <Button size="sm" onClick={() => setOpenCreate(true)}>
                                    <Plus className="h-3.5 w-3.5 mr-1.5" />New Period
                                </Button>
                            }
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table className="min-w-[720px]">
                                <TableHeader>
                                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Name</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Type</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Start</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">End</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Owner</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Status</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Lock State</TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map(p => {
                                        const isSelected = p.id === selectedId
                                        return (
                                            <TableRow
                                                key={p.id}
                                                onClick={() => setSelectedId(p.id)}
                                                className={cn(
                                                    'cursor-pointer transition-colors relative border-slate-100',
                                                    isSelected ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                                )}
                                            >
                                                <TableCell className="font-medium text-slate-900 relative">
                                                    {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-500" />}
                                                    <span className="inline-flex items-center gap-2">
                                                        {p.name}
                                                        {p.status === 'active' && <KPIStatusBadge value="active" />}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="capitalize text-slate-700">{p.period_type.replaceAll('_', ' ')}</TableCell>
                                                <TableCell className="text-slate-700 tabular-nums text-xs">{p.start_date ?? '—'}</TableCell>
                                                <TableCell className="text-slate-700 tabular-nums text-xs">{p.end_date ?? '—'}</TableCell>
                                                <TableCell>
                                                    <OwnerCell userId={p.owner_user_id ?? p.created_by ?? null} />
                                                </TableCell>
                                                <TableCell><KPIStatusBadge value={p.status} /></TableCell>
                                                <TableCell>
                                                    <LockIndicator status={p.status} />
                                                </TableCell>
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
                    <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                        Showing {filtered.length} of {periods.length} periods
                    </div>
                </div>

                {/* Detail panel */}
                <div>
                    {selected ? (
                        <PeriodDetailPanel
                            period={selected}
                            onUseAsCurrent={() => onPeriodSelect?.(selected.id)}
                            isCurrent={selected.id === currentPeriodId}
                        />
                    ) : (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                            Select a period to see details
                        </div>
                    )}
                </div>
            </div>

            <CreatePeriodDialog open={openCreate} onOpenChange={setOpenCreate} onSaved={reload} />
        </div>
    )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function LockIndicator({ status }: { status: string }) {
    const isLocked = status === 'locked' || status === 'completed'
    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            isLocked ? 'text-slate-700' : 'text-emerald-700',
        )}>
            {isLocked
                ? <Lock className="h-3.5 w-3.5" />
                : <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            {isLocked ? 'Locked' : 'Unlocked'}
        </span>
    )
}

function OwnerCell({ userId }: { userId: string | null }) {
    if (!userId) return <span className="text-xs text-slate-400">—</span>
    const initials = userId.slice(0, 2).toUpperCase()
    return (
        <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                {initials}
            </span>
            <span className="text-xs text-slate-600 font-mono truncate max-w-[120px]">{userId.slice(0, 8)}…</span>
        </div>
    )
}

function PeriodDetailPanel({
    period, onUseAsCurrent, isCurrent,
}: {
    period: Period
    onUseAsCurrent: () => void
    isCurrent: boolean
}) {
    const [stats, setStats] = useState<{
        scorecards: number
        objectives: Objective[]
        metricsTotal: number
        completedItems: number
        totalItems: number
        overdue: number
        avgScore: number | null
    } | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            const [scR, objR, dashR] = await Promise.all([
                kpiFetch<any[]>(`/api/hr/kpi/scorecards?period_id=${period.id}`),
                kpiFetch<Objective[]>(`/api/hr/kpi/objectives?period_id=${period.id}`),
                kpiFetch<any>(`/api/hr/kpi/dashboard?period_id=${period.id}`),
            ])
            if (cancelled) return
            const scorecards = (scR.success && scR.data) ? scR.data.length : 0
            const objectives = (objR.success && objR.data) ? objR.data : []
            const itemsByStatus = dashR.data?.items?.by_status ?? {}
            const totalItems = dashR.data?.items?.total ?? 0
            const completedItems = (itemsByStatus.on_track ?? 0) + (itemsByStatus.completed ?? 0)
            setStats({
                scorecards,
                objectives,
                metricsTotal: totalItems,
                completedItems,
                totalItems,
                overdue: (itemsByStatus.below_target ?? 0) + (itemsByStatus.off_track ?? 0),
                avgScore: dashR.data?.scorecards?.avg_overall_score ?? null,
            })
            setLoading(false)
        }
        load()
        return () => { cancelled = true }
    }, [period.id])

    const overallProgress = stats && stats.totalItems > 0
        ? Math.round((stats.completedItems / stats.totalItems) * 100)
        : (stats?.avgScore != null ? Math.round(Number(stats.avgScore)) : 0)

    return (
        <KPIDetailPanel
            title={period.name}
            status={<KPIStatusBadge value={period.status} />}
            subtitle={formatDateRange(period.start_date, period.end_date)}
            footer={
                <Button
                    variant="outline"
                    className="w-full"
                    onClick={onUseAsCurrent}
                    disabled={isCurrent}
                >
                    {isCurrent ? 'Currently selected' : 'View Period Dashboard'}
                </Button>
            }
        >
            <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Period Summary</p>
                {loading ? (
                    <KPICenteredLoader label="Loading…" />
                ) : (
                    <div className="space-y-2.5">
                        <KPIDetailRow
                            icon={<Calendar className="h-3.5 w-3.5" />}
                            label="Cadence"
                            value={<span className="capitalize">{period.period_type.replaceAll('_', ' ')}</span>}
                        />
                        <KPIDetailRow
                            icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                            label="Scorecards"
                            value={stats?.scorecards ?? 0}
                        />
                        <KPIDetailRow
                            icon={<BarChart3 className="h-3.5 w-3.5" />}
                            label="Metrics"
                            value={stats?.metricsTotal ?? 0}
                        />
                        <KPIDetailRow
                            icon={<GitBranch className="h-3.5 w-3.5" />}
                            label="Linked Objectives"
                            value={stats?.objectives.length ?? 0}
                        />
                    </div>
                )}
            </div>

            <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Overall Progress</p>
                    <span className="text-sm font-semibold text-slate-900">{overallProgress}%</span>
                </div>
                <KPIProgressBar value={overallProgress} tone={overallProgress >= 70 ? 'emerald' : overallProgress >= 40 ? 'amber' : 'red'} />
                {stats && (
                    <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                                <Target className="h-3.5 w-3.5 text-slate-400" />
                                Items Completed
                            </span>
                            <span className="font-semibold text-slate-900">{stats.completedItems} / {stats.totalItems}</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                Overdue Items
                            </span>
                            <span className={cn('font-semibold', stats.overdue > 0 ? 'text-red-600' : 'text-slate-900')}>{stats.overdue}</span>
                        </div>
                    </div>
                )}
            </div>
        </KPIDetailPanel>
    )
}

function CreatePeriodDialog({
    open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => Promise<void> | void }) {
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        name: '', period_type: 'quarterly', start_date: '', end_date: '', status: 'draft',
    })

    async function save() {
        if (!form.name || !form.start_date || !form.end_date) {
            toast({ title: 'Name, start, end are required', variant: 'destructive' })
            return
        }
        setSaving(true)
        const r = await kpiFetch('/api/hr/kpi/periods', { method: 'POST', body: JSON.stringify(form) })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Period created' })
            onOpenChange(false)
            setForm({ name: '', period_type: 'quarterly', start_date: '', end_date: '', status: 'draft' })
            await onSaved()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New Performance Period</DialogTitle>
                    <DialogDescription>Define a measurement window for scorecards, targets and actuals.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 flex flex-col gap-1">
                        <Label className="text-xs">Name</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Q3 2026" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Cadence</Label>
                        <Select value={form.period_type} onValueChange={v => setForm({ ...form, period_type: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {['monthly', 'quarterly', 'semi_annual', 'yearly', 'custom'].map(v =>
                                    <SelectItem key={v} value={v} className="capitalize">{v.replaceAll('_', ' ')}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Status</Label>
                        <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {['draft', 'active'].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Start date</Label>
                        <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">End date</Label>
                        <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
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
