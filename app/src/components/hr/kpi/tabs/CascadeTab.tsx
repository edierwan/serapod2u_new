'use client'
/**
 * Cascade tab — Assign metrics to company, department, role, or employee scope.
 *
 * Top stat cards: Company / Department / Employee assignments + Unassigned metrics
 * Main: assignments table (left) + Assignment Details panel (right)
 *
 * Backed by:
 *   GET  /api/hr/kpi/assignments?period_id=…
 *   POST /api/hr/kpi/assignments
 *   PATCH /api/hr/kpi/assignments/{id}
 *   GET  /api/hr/kpi/targets?assignment_id=…   (for Linked Targets in detail panel)
 *   GET  /api/hr/kpi/metrics?status=active     (for the New Assignment dropdown)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Building2, Users2, User, AlertTriangle, Plus, Filter, Search,
    MoreHorizontal, ChevronRight, Loader2, Pencil,
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
    KPIDetailPanel, KPIDetailRow, PerspectiveLabel, KPIUnavailableButton,
} from '../shared'
import { kpiFetch, Metric, formatDate } from '../types'

// ── Local types ──────────────────────────────────────────────────
interface Assignment {
    id: string
    period_id: string
    metric_id: string
    assignment_level: 'company' | 'department' | 'role' | 'employee'
    department_id: string | null
    position_id: string | null
    employee_user_id: string | null
    owner_user_id?: string | null
    status: string
    weight_percent?: number | null
    notes?: string | null
    created_at?: string | null
    updated_at?: string | null
    hr_kpi_metrics?: {
        kpi_code: string
        name: string
        unit: string
        perspective?: string | null
    }
    hr_kpi_periods?: { name: string }
}

interface LinkedTarget {
    id: string
    target_value: number
    status: string
    weight_percent?: number | null
    hr_kpi_metrics?: { kpi_code: string; name: string; unit: string }
}

// ── Helpers ──────────────────────────────────────────────────────
const LEVEL_ICON = {
    company: <Building2 className="h-3.5 w-3.5 text-slate-500" />,
    department: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    role: <Users2 className="h-3.5 w-3.5 text-slate-500" />,
    employee: <User className="h-3.5 w-3.5 text-slate-500" />,
} as const

function shortId(id?: string | null) {
    if (!id) return '—'
    return id.length > 10 ? id.slice(0, 8) + '…' : id
}

function scopeLabel(a: Assignment) {
    switch (a.assignment_level) {
        case 'company': return 'Organisation'
        case 'department': return a.department_id ? `Dept · ${shortId(a.department_id)}` : 'Department'
        case 'role': return a.position_id ? `Role · ${shortId(a.position_id)}` : 'Role'
        case 'employee': return a.employee_user_id ? `Employee · ${shortId(a.employee_user_id)}` : 'Employee'
        default: return '—'
    }
}

function ownerInitials(id?: string | null) {
    if (!id) return '—'
    return id.slice(0, 2).toUpperCase()
}

// ── Main component ───────────────────────────────────────────────
export function KPICascadeTab({
    periodId, periodName,
}: { periodId: string | null; periodName?: string | null }) {
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [metrics, setMetrics] = useState<Metric[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [levelFilter, setLevelFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [openCreate, setOpenCreate] = useState(false)

    const load = useCallback(async () => {
        if (!periodId) { setAssignments([]); setLoading(false); return }
        setLoading(true)
        setError(null)
        const [a, m] = await Promise.all([
            kpiFetch<Assignment[]>(`/api/hr/kpi/assignments?period_id=${periodId}`),
            kpiFetch<Metric[]>('/api/hr/kpi/metrics?status=active'),
        ])
        if (!a.success) setError(a.error ?? 'Failed to load assignments')
        if (a.success && a.data) setAssignments(a.data)
        if (m.success && m.data) setMetrics(m.data)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    const stats = useMemo(() => {
        const assignedMetricIds = new Set(assignments.map(a => a.metric_id))
        return {
            company: assignments.filter(a => a.assignment_level === 'company').length,
            department: assignments.filter(a => a.assignment_level === 'department').length,
            employee: assignments.filter(a => a.assignment_level === 'employee' || a.assignment_level === 'role').length,
            unassigned: Math.max(0, metrics.length - assignedMetricIds.size),
        }
    }, [assignments, metrics])

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase()
        return assignments.filter(a => {
            if (levelFilter !== 'all' && a.assignment_level !== levelFilter) return false
            if (statusFilter !== 'all' && a.status !== statusFilter) return false
            if (!s) return true
            const hay = [
                a.hr_kpi_metrics?.name,
                a.hr_kpi_metrics?.kpi_code,
                a.department_id,
                a.position_id,
                a.employee_user_id,
                a.owner_user_id,
            ].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(s)
        })
    }, [assignments, search, levelFilter, statusFilter])

    useEffect(() => {
        if (!selectedId && filtered.length) setSelectedId(filtered[0].id)
        if (selectedId && !filtered.some(a => a.id === selectedId) && filtered.length) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => assignments.find(a => a.id === selectedId) ?? null, [assignments, selectedId])

    return (
        <div className="space-y-4 mt-4">
            {/* Top stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPIStatCard
                    label="Company Assignments" value={stats.company}
                    hint={periodName ? `for ${periodName}` : 'Organisation-wide'}
                    icon={<Building2 className="h-4 w-4" />} tone="blue"
                />
                <KPIStatCard
                    label="Department Assignments" value={stats.department}
                    hint="Across departments"
                    icon={<Users2 className="h-4 w-4" />} tone="emerald"
                />
                <KPIStatCard
                    label="Employee Assignments" value={stats.employee}
                    hint="Role + individual scope"
                    icon={<User className="h-4 w-4" />} tone="orange"
                />
                <KPIStatCard
                    label="Unassigned Metrics" value={stats.unassigned}
                    hint={stats.unassigned > 0 ? 'Needs cascade' : 'All metrics cascaded'}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone={stats.unassigned > 0 ? 'red' : 'slate'}
                />
            </div>

            {/* Main: table + detail */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
                <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                    {/* Toolbar */}
                    <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">KPI Cascading &amp; Assignments</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Assign metrics to company, department, role or employee scope.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={() => setOpenCreate(true)} disabled={!periodId} className="bg-blue-600 hover:bg-blue-700 text-white">
                                <Plus className="h-4 w-4 mr-1.5" />New Assignment
                            </Button>
                            <Button variant="outline" size="icon" title="Filter">
                                <Filter className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Filter row */}
                    <div className="px-4 py-2.5 border-b border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search by metric, scope, or owner"
                                className="pl-8 h-9"
                            />
                        </div>
                        <Select value={levelFilter} onValueChange={setLevelFilter}>
                            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Level" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Levels</SelectItem>
                                <SelectItem value="company">Company</SelectItem>
                                <SelectItem value="department">Department</SelectItem>
                                <SelectItem value="role">Role</SelectItem>
                                <SelectItem value="employee">Employee</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="published">Published</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {loading ? (
                        <KPICenteredLoader />
                    ) : !periodId ? (
                        <KPIEmptyState
                            title="Select a period"
                            description="Choose a performance period to view and manage KPI assignments."
                        />
                    ) : error ? (
                        <KPIEmptyState
                            title="Unable to load assignments"
                            description={error}
                            actions={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}
                        />
                    ) : assignments.length === 0 ? (
                        <KPIEmptyState
                            title="No KPI assignments yet"
                            description="Cascade metrics to company, department, role, or employee level to make ownership clear."
                            actions={<Button size="sm" onClick={() => setOpenCreate(true)}><Plus className="h-3.5 w-3.5 mr-1.5" />New Assignment</Button>}
                        />
                    ) : filtered.length === 0 ? (
                        <KPIEmptyState
                            title="No matching assignments"
                            description="Try adjusting your search or filter."
                            searchMode
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Level</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Metric</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Scope</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Owner</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">Weight</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Effective Period</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Status</TableHead>
                                        <TableHead className="h-9 w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map(a => {
                                        const isSel = selectedId === a.id
                                        return (
                                            <TableRow
                                                key={a.id}
                                                onClick={() => setSelectedId(a.id)}
                                                className={cn(
                                                    'cursor-pointer border-slate-100 transition-colors',
                                                    isSel ? 'bg-blue-50/50 hover:bg-blue-50/70' : 'hover:bg-slate-50/60',
                                                )}
                                            >
                                                <TableCell className="py-2.5">
                                                    <span className="inline-flex items-center gap-1.5 text-xs capitalize text-slate-700">
                                                        {LEVEL_ICON[a.assignment_level] ?? null}
                                                        {a.assignment_level}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2.5">
                                                    <div className="font-medium text-slate-900 text-sm truncate max-w-[220px]">
                                                        {a.hr_kpi_metrics?.name ?? 'Unknown metric'}
                                                    </div>
                                                    {a.hr_kpi_metrics?.kpi_code && (
                                                        <div className="text-[11px] text-slate-500 font-mono">{a.hr_kpi_metrics.kpi_code}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-sm text-slate-700">{scopeLabel(a)}</TableCell>
                                                <TableCell className="py-2.5">
                                                    {a.owner_user_id ? (
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                                                {ownerInitials(a.owner_user_id)}
                                                            </span>
                                                            <span className="text-xs text-slate-700 font-mono">{shortId(a.owner_user_id)}</span>
                                                        </span>
                                                    ) : <span className="text-xs text-slate-400">—</span>}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-right text-sm tabular-nums text-slate-700">
                                                    {a.weight_percent != null ? `${a.weight_percent}%` : '—'}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-xs text-slate-500">
                                                    {a.hr_kpi_periods?.name ?? periodName ?? '—'}
                                                </TableCell>
                                                <TableCell className="py-2.5"><KPIStatusBadge value={a.status} /></TableCell>
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
                                <span>Showing 1 to {filtered.length} of {filtered.length} assignments</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Detail panel */}
                <AssignmentDetailPanel
                    assignment={selected}
                    onChanged={load}
                />
            </div>

            {openCreate && (
                <CreateAssignmentDialog
                    open={openCreate}
                    onClose={() => setOpenCreate(false)}
                    metrics={metrics}
                    periodId={periodId}
                    onCreated={load}
                />
            )}
        </div>
    )
}

// ── Detail panel ─────────────────────────────────────────────────
function AssignmentDetailPanel({
    assignment, onChanged,
}: { assignment: Assignment | null; onChanged: () => void }) {
    const [targets, setTargets] = useState<LinkedTarget[]>([])
    const [loadingTargets, setLoadingTargets] = useState(false)

    useEffect(() => {
        if (!assignment) { setTargets([]); return }
        let alive = true
        ;(async () => {
            setLoadingTargets(true)
            const r = await kpiFetch<LinkedTarget[]>(`/api/hr/kpi/targets?assignment_id=${assignment.id}`)
            if (alive && r.success && r.data) setTargets(r.data)
            if (alive) setLoadingTargets(false)
        })()
        return () => { alive = false }
    }, [assignment?.id])

    if (!assignment) {
        return (
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-6">
                <KPIEmptyState
                    title="No assignment selected"
                    description="Pick an assignment from the list to view its details."
                    compact
                />
            </div>
        )
    }

    const metricName = assignment.hr_kpi_metrics?.name ?? 'Unknown metric'
    const perspective = assignment.hr_kpi_metrics?.perspective ?? null

    return (
        <KPIDetailPanel
            title={(
                <span className="inline-flex items-center gap-2">
                    Assignment Details
                    <KPIStatusBadge value={assignment.status} />
                </span>
            )}
            status={
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" disabled title="Inline edit not available yet" className="h-7 w-7">
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled title="Row menu not available yet" className="h-7 w-7">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                </div>
            }
        >
            {/* Hierarchy breadcrumb */}
            <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Hierarchy</p>
                <div className="flex items-center gap-1 flex-wrap text-xs text-slate-700">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100">
                        <Building2 className="h-3 w-3" />Company
                    </span>
                    {assignment.assignment_level !== 'company' && (
                        <>
                            <ChevronRight className="h-3 w-3 text-slate-400" />
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100">
                                <Users2 className="h-3 w-3" />
                                {assignment.department_id ? shortId(assignment.department_id) : 'Department'}
                            </span>
                        </>
                    )}
                    {(assignment.assignment_level === 'role' || assignment.assignment_level === 'employee') && (
                        <>
                            <ChevronRight className="h-3 w-3 text-slate-400" />
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100">
                                <User className="h-3 w-3" />
                                {shortId(assignment.position_id ?? assignment.employee_user_id)}
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Metric summary */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/40 p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-slate-900 truncate">{metricName}</h4>
                        {assignment.hr_kpi_metrics?.kpi_code && (
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5">{assignment.hr_kpi_metrics.kpi_code}</p>
                        )}
                    </div>
                    {perspective && <PerspectiveLabel value={perspective} />}
                </div>
            </div>

            {/* Rows */}
            <div className="space-y-2">
                <KPIDetailRow label="Level" value={<span className="capitalize">{assignment.assignment_level}</span>} />
                <KPIDetailRow label="Scope" value={scopeLabel(assignment)} />
                <KPIDetailRow label="Owner" value={
                    assignment.owner_user_id ? (
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                                {ownerInitials(assignment.owner_user_id)}
                            </span>
                            <span className="font-mono text-xs">{shortId(assignment.owner_user_id)}</span>
                        </span>
                    ) : '—'
                } />
                <KPIDetailRow label="Weight" value={assignment.weight_percent != null ? `${assignment.weight_percent}%` : '—'} />
                <KPIDetailRow label="Effective Period" value={assignment.hr_kpi_periods?.name ?? '—'} />
                <KPIDetailRow label="Last Updated" value={formatDate(assignment.updated_at ?? assignment.created_at)} />
            </div>

            {/* Linked targets */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                        Linked Targets ({targets.length})
                    </p>
                </div>
                {loadingTargets ? (
                    <div className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading…</div>
                ) : targets.length === 0 ? (
                    <div className="text-xs text-slate-400">No targets defined yet.</div>
                ) : (
                    <ul className="space-y-1.5">
                        {targets.slice(0, 4).map(t => (
                            <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-slate-700 truncate">
                                    Target {t.target_value}{t.hr_kpi_metrics?.unit ? ` ${t.hr_kpi_metrics.unit}` : ''}
                                </span>
                                <KPIStatusBadge value={t.status} />
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Notes */}
            <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Assignment Notes</p>
                {assignment.notes ? (
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">{assignment.notes}</p>
                ) : (
                    <p className="text-xs text-slate-400 italic">No notes recorded.</p>
                )}
            </div>
        </KPIDetailPanel>
    )
}

// ── Create dialog ────────────────────────────────────────────────
function CreateAssignmentDialog({
    open, onClose, metrics, periodId, onCreated,
}: {
    open: boolean
    onClose: () => void
    metrics: Metric[]
    periodId: string | null
    onCreated: () => void
}) {
    const [form, setForm] = useState({
        metric_id: '',
        assignment_level: 'company' as Assignment['assignment_level'],
        department_id: '',
        position_id: '',
        employee_user_id: '',
        owner_user_id: '',
        weight_percent: '',
        status: 'draft',
        notes: '',
    })
    const [saving, setSaving] = useState(false)

    async function save() {
        if (!periodId || !form.metric_id) {
            toast({ title: 'Metric and period required', variant: 'destructive' })
            return
        }
        const payload: any = {
            period_id: periodId,
            metric_id: form.metric_id,
            assignment_level: form.assignment_level,
            status: form.status,
        }
        if (form.assignment_level === 'department') payload.department_id = form.department_id || null
        if (form.assignment_level === 'role') payload.position_id = form.position_id || null
        if (form.assignment_level === 'employee') payload.employee_user_id = form.employee_user_id || null
        if (form.owner_user_id) payload.owner_user_id = form.owner_user_id
        if (form.weight_percent) payload.weight_percent = Number(form.weight_percent)
        if (form.notes) payload.notes = form.notes

        setSaving(true)
        const r = await kpiFetch('/api/hr/kpi/assignments', { method: 'POST', body: JSON.stringify(payload) })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Assignment created' })
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
                    <DialogTitle>New Assignment</DialogTitle>
                    <DialogDescription>Cascade a metric to a level and scope.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <Label>Metric *</Label>
                        <Select value={form.metric_id} onValueChange={v => setForm(f => ({ ...f, metric_id: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select a metric" /></SelectTrigger>
                            <SelectContent>
                                {metrics.length === 0 ? (
                                    <div className="px-2 py-3 text-xs text-slate-500">No active metrics. Create one in Library.</div>
                                ) : metrics.map(m => (
                                    <SelectItem key={m.id} value={m.id}>{m.name} <span className="font-mono text-[10px] text-slate-500 ml-1">{m.kpi_code}</span></SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Level</Label>
                            <Select value={form.assignment_level} onValueChange={v => setForm(f => ({ ...f, assignment_level: v as any }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="company">Company</SelectItem>
                                    <SelectItem value="department">Department</SelectItem>
                                    <SelectItem value="role">Role</SelectItem>
                                    <SelectItem value="employee">Employee</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Status</Label>
                            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {form.assignment_level === 'department' && (
                        <div>
                            <Label>Department ID</Label>
                            <Input value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))} placeholder="department UUID" />
                        </div>
                    )}
                    {form.assignment_level === 'role' && (
                        <div>
                            <Label>Position ID</Label>
                            <Input value={form.position_id} onChange={e => setForm(f => ({ ...f, position_id: e.target.value }))} placeholder="position UUID" />
                        </div>
                    )}
                    {form.assignment_level === 'employee' && (
                        <div>
                            <Label>Employee User ID</Label>
                            <Input value={form.employee_user_id} onChange={e => setForm(f => ({ ...f, employee_user_id: e.target.value }))} placeholder="user UUID" />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Owner User ID</Label>
                            <Input value={form.owner_user_id} onChange={e => setForm(f => ({ ...f, owner_user_id: e.target.value }))} placeholder="optional" />
                        </div>
                        <div>
                            <Label>Weight %</Label>
                            <Input type="number" value={form.weight_percent} onChange={e => setForm(f => ({ ...f, weight_percent: e.target.value }))} placeholder="optional" />
                        </div>
                    </div>
                    <div>
                        <Label>Notes</Label>
                        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional context for this assignment" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving || !form.metric_id}>
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
