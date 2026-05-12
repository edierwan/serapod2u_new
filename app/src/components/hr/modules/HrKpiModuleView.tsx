'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
    Target, Plus, Loader2, Activity, Layers, Database, ClipboardList,
    LineChart, FileBarChart2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle,
    Calendar, BookOpen, ListChecks,
} from 'lucide-react'
import { KPIDashboardTab } from '@/components/hr/kpi/tabs/DashboardTab'
import { KPIPeriodsTab } from '@/components/hr/kpi/tabs/PeriodsTab'
import { KPIObjectivesTab } from '@/components/hr/kpi/tabs/ObjectivesTab'
import { KPILibraryTab } from '@/components/hr/kpi/tabs/LibraryTab'

// ── Types ────────────────────────────────────────────────────────
interface Period { id: string; name: string; period_type: string; start_date: string; end_date: string; status: string }
interface Objective { id: string; objective_code: string; title: string; perspective: string | null; status: string; period_id: string; progress_percent: number }
interface Metric {
    id: string; kpi_code: string; name: string; unit: string;
    perspective: string | null; measurement_direction: string;
    calculation_type: string; data_source_status: string; status: string; is_active: boolean;
}
interface Assignment {
    id: string; period_id: string; metric_id: string; assignment_level: string;
    department_id: string | null; position_id: string | null; employee_user_id: string | null;
    status: string; hr_kpi_metrics?: { kpi_code: string; name: string; unit: string }
}
interface KpiTarget {
    id: string; period_id: string; assignment_id: string; metric_id: string;
    target_value: number; weight_percent: number; green_threshold: number;
    yellow_threshold: number; red_threshold: number; status: string;
    hr_kpi_metrics?: { kpi_code: string; name: string; unit: string }
}
interface Actual { id: string; assignment_id: string; period_id: string; actual_value: number | null; status: string }
interface DataMapping {
    id: string; metric_id: string; calculation_type: string; source_module: string | null;
    source_table: string | null; validation_status: string; last_validated_at: string | null;
    last_error: string | null;
    hr_kpi_metrics?: { kpi_code: string; name: string }
}
interface Scorecard {
    id: string; period_id: string; scorecard_level: string;
    department_id: string | null; employee_user_id: string | null;
    overall_score: number | null; grade: string | null; status: string;
}
interface Review {
    id: string; scorecard_id: string; review_stage: string; status: string;
    employee_user_id: string; manager_user_id: string | null;
}
interface DashboardSummary {
    period_id: string | null
    scorecards: { total: number; by_status?: Record<string, number>; by_level?: Record<string, number>; avg_overall_score: number | null }
    items: { total: number; by_status?: Record<string, number> }
    perspectives: Array<{ perspective: string; count: number; avg_score: number | null }>
}

// ── Helpers ──────────────────────────────────────────────────────
async function api<T = any>(path: string, init?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
    const res = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    try { return await res.json() } catch { return { success: false, error: `HTTP ${res.status}` } }
}

const STATUS_TONE: Record<string, string> = {
    on_track: 'bg-green-100 text-green-800',
    at_risk: 'bg-yellow-100 text-yellow-800',
    below_target: 'bg-red-100 text-red-800',
    no_data: 'bg-gray-100 text-gray-700',
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-blue-100 text-blue-800',
    published: 'bg-emerald-100 text-emerald-800',
    locked: 'bg-purple-100 text-purple-800',
    archived: 'bg-gray-200 text-gray-600',
    generated: 'bg-blue-100 text-blue-800',
    submitted: 'bg-indigo-100 text-indigo-800',
    completed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    valid: 'bg-green-100 text-green-800',
    invalid: 'bg-red-100 text-red-800',
    unmapped: 'bg-gray-100 text-gray-700',
    mapped: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
}

function StatusBadge({ value }: { value: string | null | undefined }) {
    if (!value) return <span className="text-muted-foreground text-xs">—</span>
    return <Badge variant="secondary" className={STATUS_TONE[value] ?? ''}>{value.replaceAll('_', ' ')}</Badge>
}

// ── Main ─────────────────────────────────────────────────────────
export default function HrKpiModuleView() {
    const [tab, setTab] = useState('dashboard')
    const [periods, setPeriods] = useState<Period[]>([])
    const [periodId, setPeriodId] = useState<string | null>(null)

    const loadPeriods = useCallback(async () => {
        const r = await api<Period[]>('/api/hr/kpi/periods')
        if (r.success && r.data) {
            setPeriods(r.data)
            if (!periodId) {
                const active = r.data.find(p => p.status === 'active') ?? r.data[0]
                setPeriodId(active?.id ?? null)
            }
        }
    }, [periodId])

    useEffect(() => { loadPeriods() }, [loadPeriods])

    const selectedPeriod = useMemo(() => periods.find(p => p.id === periodId) ?? null, [periods, periodId])

    return (
        <div className="space-y-5 p-4 md:p-6 bg-slate-50/30 min-h-full">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-slate-900 text-white shadow-sm">
                        <Target className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">
                            KPI &amp; Performance Management
                        </h1>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Plan, cascade, measure and review organisational KPIs.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Period</Label>
                    <Select value={periodId ?? ''} onValueChange={setPeriodId}>
                        <SelectTrigger className="w-[240px] h-9 bg-white border-slate-200 shadow-sm">
                            <Calendar className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                            <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                            {periods.length === 0 && (
                                <div className="px-2 py-3 text-xs text-slate-500">No periods yet</div>
                            )}
                            {periods.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                    <span className="inline-flex items-center gap-2">
                                        <span>{p.name}</span>
                                        <span className="text-[10px] text-slate-400 capitalize">· {p.status}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="w-full">
                <div className="border-b border-slate-200">
                    <TabsList className="bg-transparent p-0 h-auto gap-1 w-full justify-start overflow-x-auto flex-nowrap rounded-none">
                        <KpiTabTrigger value="dashboard" icon={<Activity className="h-3.5 w-3.5" />} label="Dashboard" />
                        <KpiTabTrigger value="periods" icon={<Calendar className="h-3.5 w-3.5" />} label="Periods" />
                        <KpiTabTrigger value="objectives" icon={<Target className="h-3.5 w-3.5" />} label="Objectives" />
                        <KpiTabTrigger value="library" icon={<BookOpen className="h-3.5 w-3.5" />} label="Library" />
                        <KpiTabTrigger value="cascading" icon={<Layers className="h-3.5 w-3.5" />} label="Cascade" />
                        <KpiTabTrigger value="targets" icon={<ListChecks className="h-3.5 w-3.5" />} label="Targets" />
                        <KpiTabTrigger value="data" icon={<Database className="h-3.5 w-3.5" />} label="Data" />
                        <KpiTabTrigger value="scorecards" icon={<ClipboardList className="h-3.5 w-3.5" />} label="Scorecards" />
                        <KpiTabTrigger value="reports" icon={<FileBarChart2 className="h-3.5 w-3.5" />} label="Reports" />
                    </TabsList>
                </div>

                <TabsContent value="dashboard" className="mt-0">
                    <KPIDashboardTab periodId={periodId} periods={periods} onSwitchTab={setTab} />
                </TabsContent>
                <TabsContent value="periods" className="mt-0">
                    <KPIPeriodsTab
                        periods={periods}
                        reload={loadPeriods}
                        onPeriodSelect={setPeriodId}
                        currentPeriodId={periodId}
                    />
                </TabsContent>
                <TabsContent value="objectives" className="mt-0">
                    <KPIObjectivesTab periodId={periodId} />
                </TabsContent>
                <TabsContent value="library" className="mt-0">
                    <KPILibraryTab />
                </TabsContent>

                {/* Legacy tabs (untouched in this redesign) */}
                <TabsContent value="cascading"><CascadingTab periodId={periodId} /></TabsContent>
                <TabsContent value="targets"><TargetsTab periodId={periodId} /></TabsContent>
                <TabsContent value="data"><DataMappingsTab /></TabsContent>
                <TabsContent value="scorecards"><ScorecardsTab periodId={periodId} /></TabsContent>
                <TabsContent value="reports"><ReportsTab periodId={periodId} /></TabsContent>
            </Tabs>
        </div>
    )
}

function KpiTabTrigger({ value, icon, label }: { value: string; icon: React.ReactNode; label: string }) {
    return (
        <TabsTrigger
            value={value}
            className="
                relative rounded-none border-b-2 border-transparent
                data-[state=active]:border-blue-600 data-[state=active]:text-blue-600
                data-[state=active]:bg-transparent data-[state=active]:shadow-none
                text-slate-600 hover:text-slate-900 px-3 py-2.5 text-sm font-medium
                bg-transparent shadow-none transition-colors whitespace-nowrap
            "
        >
            <span className="inline-flex items-center gap-1.5">{icon}{label}</span>
        </TabsTrigger>
    )
}

// ── Dashboard tab ────────────────────────────────────────────────
function DashboardTab({ periodId }: { periodId: string | null }) {
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        const url = '/api/hr/kpi/dashboard' + (periodId ? `?period_id=${periodId}` : '')
        const r = await api<DashboardSummary>(url)
        if (r.success) setSummary(r.data ?? null)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    if (loading) return <CenteredLoader />
    if (!summary) return <EmptyState text="No data" />

    const sBy = summary.scorecards.by_status ?? {}
    const iBy = summary.items.by_status ?? {}

    return (
        <div className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiTile label="Active Scorecards" value={summary.scorecards.total} icon={<ClipboardList className="h-5 w-5" />} />
                <KpiTile label="Avg Overall Score" value={summary.scorecards.avg_overall_score ?? '—'} suffix={summary.scorecards.avg_overall_score != null ? '%' : ''} icon={<LineChart className="h-5 w-5" />} />
                <KpiTile label="On Track Items" value={iBy.on_track ?? 0} icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} />
                <KpiTile label="At Risk / Below" value={(iBy.at_risk ?? 0) + (iBy.below_target ?? 0)} icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Scorecard Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {Object.entries(sBy).length === 0 && <EmptyState text="No scorecards yet" small />}
                            {Object.entries(sBy).map(([k, v]) => (
                                <div key={k} className="flex items-center justify-between text-sm">
                                    <StatusBadge value={k} />
                                    <span className="font-medium">{v}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Per-Perspective Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {summary.perspectives.length === 0 && <EmptyState text="No perspective data yet" small />}
                        <div className="space-y-2">
                            {summary.perspectives.map(p => (
                                <div key={p.perspective} className="flex items-center justify-between text-sm">
                                    <span className="capitalize">{p.perspective.replaceAll('_', ' ')}</span>
                                    <span className="text-muted-foreground">
                                        {p.count} items · avg {p.avg_score ?? '—'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

// ── Periods tab ──────────────────────────────────────────────────
function PeriodsTab({ periods, reload }: { periods: Period[]; reload: () => void }) {
    const [open, setOpen] = useState(false)
    const [form, setForm] = useState({
        name: '', period_type: 'quarterly', start_date: '', end_date: '', status: 'draft',
    })
    const [saving, setSaving] = useState(false)

    async function save() {
        setSaving(true)
        const r = await api('/api/hr/kpi/periods', { method: 'POST', body: JSON.stringify(form) })
        setSaving(false)
        if (r.success) {
            toast({ title: 'Period created' })
            setOpen(false)
            reload()
        } else {
            toast({ title: 'Failed', description: r.error, variant: 'destructive' })
        }
    }

    async function setStatus(id: string, status: string) {
        const r = await api(`/api/hr/kpi/periods/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
        if (r.success) { toast({ title: `Period ${status}` }); reload() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Performance Periods</CardTitle></div>
                <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Period</Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead><TableHead>Type</TableHead>
                            <TableHead>Start</TableHead><TableHead>End</TableHead>
                            <TableHead>Status</TableHead><TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {periods.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState text="No periods yet" small /></TableCell></TableRow>}
                        {periods.map(p => (
                            <TableRow key={p.id}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell className="capitalize">{p.period_type}</TableCell>
                                <TableCell>{p.start_date}</TableCell>
                                <TableCell>{p.end_date}</TableCell>
                                <TableCell><StatusBadge value={p.status} /></TableCell>
                                <TableCell className="text-right space-x-1">
                                    {p.status === 'draft' && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, 'active')}>Activate</Button>}
                                    {p.status === 'active' && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, 'locked')}>Lock</Button>}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New Performance Period</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Name" className="col-span-2">
                            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Q3 2026" />
                        </Field>
                        <Field label="Period type">
                            <Select value={form.period_type} onValueChange={v => setForm({ ...form, period_type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['monthly', 'quarterly', 'semi_annual', 'yearly', 'custom'].map(v =>
                                        <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Status">
                            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['draft', 'active'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Start date">
                            <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                        </Field>
                        <Field label="End date">
                            <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Objectives tab ───────────────────────────────────────────────
function ObjectivesTab({ periodId }: { periodId: string | null }) {
    const [items, setItems] = useState<Objective[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [form, setForm] = useState({
        objective_code: '', title: '', description: '', perspective: '',
    })
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const url = '/api/hr/kpi/objectives' + (periodId ? `?period_id=${periodId}` : '')
        const r = await api<Objective[]>(url)
        if (r.success && r.data) setItems(r.data)
        setLoading(false)
    }, [periodId])

    useEffect(() => { load() }, [load])

    async function save() {
        if (!periodId) { toast({ title: 'Select a period first', variant: 'destructive' }); return }
        setSaving(true)
        const r = await api('/api/hr/kpi/objectives', {
            method: 'POST',
            body: JSON.stringify({ ...form, period_id: periodId }),
        })
        setSaving(false)
        if (r.success) { toast({ title: 'Objective created' }); setOpen(false); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Strategic Objectives</CardTitle><CardDescription>Top-down goals for the selected period.</CardDescription></div>
                <Button onClick={() => setOpen(true)} disabled={!periodId}><Plus className="h-4 w-4 mr-1" />New Objective</Button>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead><TableHead>Title</TableHead>
                                <TableHead>Perspective</TableHead><TableHead>Progress</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState text="No objectives yet" small /></TableCell></TableRow>}
                            {items.map(o => (
                                <TableRow key={o.id}>
                                    <TableCell className="font-mono text-xs">{o.objective_code}</TableCell>
                                    <TableCell className="font-medium">{o.title}</TableCell>
                                    <TableCell className="capitalize">{o.perspective?.replaceAll('_', ' ') ?? '—'}</TableCell>
                                    <TableCell>{Number(o.progress_percent).toFixed(1)}%</TableCell>
                                    <TableCell><StatusBadge value={o.status} /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New Objective</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Code">
                            <Input value={form.objective_code} onChange={e => setForm({ ...form, objective_code: e.target.value })} placeholder="OBJ_OPS_2026Q3" />
                        </Field>
                        <Field label="Perspective">
                            <Select value={form.perspective} onValueChange={v => setForm({ ...form, perspective: v })}>
                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                    {['financial', 'customer', 'process', 'learning_growth', 'people', 'quality'].map(v =>
                                        <SelectItem key={v} value={v}>{v.replaceAll('_', ' ')}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Title" className="col-span-2">
                            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                        </Field>
                        <Field label="Description" className="col-span-2">
                            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Library tab (metrics) ────────────────────────────────────────
function LibraryTab() {
    const [items, setItems] = useState<Metric[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [form, setForm] = useState({
        kpi_code: '', name: '', description: '', perspective: 'process', unit: '%',
        measurement_direction: 'higher_is_better', calculation_type: 'manual',
    })
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const r = await api<Metric[]>('/api/hr/kpi/metrics')
        if (r.success && r.data) setItems(r.data)
        setLoading(false)
    }, [])
    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => items.filter(m =>
        !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.kpi_code.toLowerCase().includes(search.toLowerCase())
    ), [items, search])

    async function save() {
        setSaving(true)
        const r = await api('/api/hr/kpi/metrics', { method: 'POST', body: JSON.stringify(form) })
        setSaving(false)
        if (r.success) { toast({ title: 'Metric created' }); setOpen(false); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <div><CardTitle>KPI Library</CardTitle><CardDescription>Reusable metric definitions.</CardDescription></div>
                <div className="flex items-center gap-2">
                    <Input placeholder="Search" className="w-48" value={search} onChange={e => setSearch(e.target.value)} />
                    <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Metric</Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead><TableHead>Name</TableHead>
                                <TableHead>Perspective</TableHead><TableHead>Unit</TableHead>
                                <TableHead>Direction</TableHead><TableHead>Source</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 && <TableRow><TableCell colSpan={7}><EmptyState text="No metrics" small /></TableCell></TableRow>}
                            {filtered.map(m => (
                                <TableRow key={m.id}>
                                    <TableCell className="font-mono text-xs">{m.kpi_code}</TableCell>
                                    <TableCell className="font-medium">{m.name}</TableCell>
                                    <TableCell className="capitalize">{m.perspective?.replaceAll('_', ' ') ?? '—'}</TableCell>
                                    <TableCell>{m.unit}</TableCell>
                                    <TableCell className="text-xs">{m.measurement_direction.replaceAll('_', ' ')}</TableCell>
                                    <TableCell><StatusBadge value={m.data_source_status} /></TableCell>
                                    <TableCell><StatusBadge value={m.status} /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>New KPI Metric</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Code"><Input value={form.kpi_code} onChange={e => setForm({ ...form, kpi_code: e.target.value })} placeholder="OPS_DELIVERY_PCT" /></Field>
                        <Field label="Unit"><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="%" /></Field>
                        <Field label="Name" className="col-span-2"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
                        <Field label="Description" className="col-span-2"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
                        <Field label="Perspective">
                            <Select value={form.perspective} onValueChange={v => setForm({ ...form, perspective: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['financial', 'customer', 'process', 'learning_growth', 'people', 'quality'].map(v =>
                                        <SelectItem key={v} value={v}>{v.replaceAll('_', ' ')}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Direction">
                            <Select value={form.measurement_direction} onValueChange={v => setForm({ ...form, measurement_direction: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['higher_is_better', 'lower_is_better', 'target_band'].map(v =>
                                        <SelectItem key={v} value={v}>{v.replaceAll('_', ' ')}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Calculation type">
                            <Select value={form.calculation_type} onValueChange={v => setForm({ ...form, calculation_type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['manual', 'auto', 'hybrid'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Cascading tab (assignments) ──────────────────────────────────
function CascadingTab({ periodId }: { periodId: string | null }) {
    const [items, setItems] = useState<Assignment[]>([])
    const [metrics, setMetrics] = useState<Metric[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [form, setForm] = useState<{ metric_id: string; assignment_level: 'company' | 'department' | 'role' | 'employee'; department_id: string; position_id: string; employee_user_id: string; status: string }>({
        metric_id: '', assignment_level: 'company', department_id: '', position_id: '', employee_user_id: '', status: 'draft',
    })
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!periodId) { setItems([]); setLoading(false); return }
        setLoading(true)
        const [a, m] = await Promise.all([
            api<Assignment[]>(`/api/hr/kpi/assignments?period_id=${periodId}`),
            api<Metric[]>('/api/hr/kpi/metrics?status=active'),
        ])
        if (a.success && a.data) setItems(a.data)
        if (m.success && m.data) setMetrics(m.data)
        setLoading(false)
    }, [periodId])
    useEffect(() => { load() }, [load])

    async function save() {
        if (!periodId) return
        const payload: any = {
            period_id: periodId,
            metric_id: form.metric_id,
            assignment_level: form.assignment_level,
            status: form.status,
        }
        if (form.assignment_level === 'department') payload.department_id = form.department_id || null
        if (form.assignment_level === 'role') payload.position_id = form.position_id || null
        if (form.assignment_level === 'employee') payload.employee_user_id = form.employee_user_id || null
        setSaving(true)
        const r = await api('/api/hr/kpi/assignments', { method: 'POST', body: JSON.stringify(payload) })
        setSaving(false)
        if (r.success) { toast({ title: 'Assignment created' }); setOpen(false); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    async function publish(id: string) {
        const r = await api(`/api/hr/kpi/assignments/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) })
        if (r.success) { toast({ title: 'Published' }); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>KPI Cascading &amp; Assignments</CardTitle><CardDescription>Assign metrics to company, department, role or employee scope.</CardDescription></div>
                <Button onClick={() => setOpen(true)} disabled={!periodId}><Plus className="h-4 w-4 mr-1" />New Assignment</Button>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Level</TableHead><TableHead>Metric</TableHead>
                                <TableHead>Scope</TableHead><TableHead>Status</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState text="No assignments" small /></TableCell></TableRow>}
                            {items.map(a => (
                                <TableRow key={a.id}>
                                    <TableCell className="capitalize">{a.assignment_level}</TableCell>
                                    <TableCell className="font-medium">{a.hr_kpi_metrics?.name ?? a.metric_id}</TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">
                                        {a.department_id ?? a.position_id ?? a.employee_user_id ?? 'company-wide'}
                                    </TableCell>
                                    <TableCell><StatusBadge value={a.status} /></TableCell>
                                    <TableCell>
                                        {a.status === 'draft' &&
                                            <Button size="sm" variant="outline" onClick={() => publish(a.id)}>Publish</Button>}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New Assignment</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Metric" className="col-span-2">
                            <Select value={form.metric_id} onValueChange={v => setForm({ ...form, metric_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Select metric" /></SelectTrigger>
                                <SelectContent>
                                    {metrics.map(m => <SelectItem key={m.id} value={m.id}>{m.kpi_code} — {m.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Level">
                            <Select value={form.assignment_level} onValueChange={v => setForm({ ...form, assignment_level: v as any })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['company', 'department', 'role', 'employee'].map(v =>
                                        <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        {form.assignment_level === 'department' && <Field label="Department ID">
                            <Input value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} placeholder="uuid" />
                        </Field>}
                        {form.assignment_level === 'role' && <Field label="Position ID">
                            <Input value={form.position_id} onChange={e => setForm({ ...form, position_id: e.target.value })} placeholder="uuid" />
                        </Field>}
                        {form.assignment_level === 'employee' && <Field label="Employee user ID">
                            <Input value={form.employee_user_id} onChange={e => setForm({ ...form, employee_user_id: e.target.value })} placeholder="uuid" />
                        </Field>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving || !form.metric_id}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Targets tab ──────────────────────────────────────────────────
function TargetsTab({ periodId }: { periodId: string | null }) {
    const [items, setItems] = useState<KpiTarget[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [form, setForm] = useState({ assignment_id: '', target_value: '', weight_percent: '', green_threshold: '90', yellow_threshold: '70' })
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!periodId) { setItems([]); setAssignments([]); setLoading(false); return }
        setLoading(true)
        const [t, a] = await Promise.all([
            api<KpiTarget[]>(`/api/hr/kpi/targets?period_id=${periodId}`),
            api<Assignment[]>(`/api/hr/kpi/assignments?period_id=${periodId}`),
        ])
        if (t.success && t.data) setItems(t.data)
        if (a.success && a.data) setAssignments(a.data)
        setLoading(false)
    }, [periodId])
    useEffect(() => { load() }, [load])

    async function save() {
        if (!periodId) return
        const a = assignments.find(x => x.id === form.assignment_id)
        if (!a) return
        setSaving(true)
        const r = await api('/api/hr/kpi/targets', {
            method: 'POST',
            body: JSON.stringify({
                period_id: periodId,
                assignment_id: a.id,
                metric_id: a.metric_id,
                target_value: Number(form.target_value),
                weight_percent: Number(form.weight_percent || 0),
                green_threshold: Number(form.green_threshold),
                yellow_threshold: Number(form.yellow_threshold),
            }),
        })
        setSaving(false)
        if (r.success) { toast({ title: 'Target saved' }); setOpen(false); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    async function publishAll() {
        if (!periodId) return
        const r = await api('/api/hr/kpi/targets/publish', { method: 'POST', body: JSON.stringify({ period_id: periodId }) })
        if (r.success) { toast({ title: `Published ${r.data?.published_count ?? 0} targets` }); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Targets &amp; Weights</CardTitle><CardDescription>Set thresholds and weight per assignment.</CardDescription></div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={publishAll} disabled={!periodId}>Publish All</Button>
                    <Button onClick={() => setOpen(true)} disabled={!periodId}><Plus className="h-4 w-4 mr-1" />New Target</Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Metric</TableHead><TableHead>Target</TableHead>
                                <TableHead>Weight %</TableHead><TableHead>Green ≥</TableHead>
                                <TableHead>Yellow ≥</TableHead><TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState text="No targets" small /></TableCell></TableRow>}
                            {items.map(t => (
                                <TableRow key={t.id}>
                                    <TableCell className="font-medium">{t.hr_kpi_metrics?.name ?? t.metric_id}</TableCell>
                                    <TableCell>{t.target_value} {t.hr_kpi_metrics?.unit ?? ''}</TableCell>
                                    <TableCell>{t.weight_percent}</TableCell>
                                    <TableCell>{t.green_threshold}</TableCell>
                                    <TableCell>{t.yellow_threshold}</TableCell>
                                    <TableCell><StatusBadge value={t.status} /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Set Target</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Assignment" className="col-span-2">
                            <Select value={form.assignment_id} onValueChange={v => setForm({ ...form, assignment_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Select assignment" /></SelectTrigger>
                                <SelectContent>
                                    {assignments.map(a => <SelectItem key={a.id} value={a.id}>
                                        {a.assignment_level} — {a.hr_kpi_metrics?.name ?? a.metric_id}
                                    </SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Target value"><Input type="number" value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })} /></Field>
                        <Field label="Weight %"><Input type="number" value={form.weight_percent} onChange={e => setForm({ ...form, weight_percent: e.target.value })} /></Field>
                        <Field label="Green ≥"><Input type="number" value={form.green_threshold} onChange={e => setForm({ ...form, green_threshold: e.target.value })} /></Field>
                        <Field label="Yellow ≥"><Input type="number" value={form.yellow_threshold} onChange={e => setForm({ ...form, yellow_threshold: e.target.value })} /></Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving || !form.assignment_id || !form.target_value}>
                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Data mappings tab ────────────────────────────────────────────
function DataMappingsTab() {
    const [items, setItems] = useState<DataMapping[]>([])
    const [metrics, setMetrics] = useState<Metric[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [form, setForm] = useState({ metric_id: '', calculation_type: 'manual', source_module: '', source_table: '' })
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const [m, ms] = await Promise.all([
            api<DataMapping[]>('/api/hr/kpi/data-mappings'),
            api<Metric[]>('/api/hr/kpi/metrics'),
        ])
        if (m.success && m.data) setItems(m.data)
        if (ms.success && ms.data) setMetrics(ms.data)
        setLoading(false)
    }, [])
    useEffect(() => { load() }, [load])

    async function save() {
        setSaving(true)
        const r = await api('/api/hr/kpi/data-mappings', { method: 'POST', body: JSON.stringify(form) })
        setSaving(false)
        if (r.success) { toast({ title: 'Mapping saved' }); setOpen(false); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    async function validate(id: string) {
        const r = await api(`/api/hr/kpi/data-mappings/${id}/validate`, { method: 'POST' })
        if (r.success) { toast({ title: 'Validated' }); load() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Data Source Mappings</CardTitle><CardDescription>Link metrics to operational tables for auto-calculation.</CardDescription></div>
                <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Mapping</Button>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Metric</TableHead><TableHead>Type</TableHead>
                                <TableHead>Module</TableHead><TableHead>Table</TableHead>
                                <TableHead>Validation</TableHead><TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState text="No mappings" small /></TableCell></TableRow>}
                            {items.map(m => (
                                <TableRow key={m.id}>
                                    <TableCell className="font-medium">{m.hr_kpi_metrics?.name ?? m.metric_id}</TableCell>
                                    <TableCell>{m.calculation_type}</TableCell>
                                    <TableCell>{m.source_module ?? '—'}</TableCell>
                                    <TableCell className="font-mono text-xs">{m.source_table ?? '—'}</TableCell>
                                    <TableCell><StatusBadge value={m.validation_status} /></TableCell>
                                    <TableCell>
                                        <Button size="sm" variant="outline" onClick={() => validate(m.id)}>
                                            <RefreshCw className="h-3 w-3 mr-1" />Validate
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>New Data Mapping</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Metric" className="col-span-2">
                            <Select value={form.metric_id} onValueChange={v => setForm({ ...form, metric_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                    {metrics.map(m => <SelectItem key={m.id} value={m.id}>{m.kpi_code}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Calculation type">
                            <Select value={form.calculation_type} onValueChange={v => setForm({ ...form, calculation_type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {['manual', 'auto', 'hybrid'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Source module"><Input value={form.source_module} onChange={e => setForm({ ...form, source_module: e.target.value })} placeholder="orders" /></Field>
                        <Field label="Source table" className="col-span-2"><Input value={form.source_table} onChange={e => setForm({ ...form, source_table: e.target.value })} placeholder="public table name" /></Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving || !form.metric_id}>
                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// ── Scorecards tab ───────────────────────────────────────────────
function ScorecardsTab({ periodId }: { periodId: string | null }) {
    const [items, setItems] = useState<Scorecard[]>([])
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [openId, setOpenId] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!periodId) { setItems([]); setLoading(false); return }
        setLoading(true)
        const r = await api<Scorecard[]>(`/api/hr/kpi/scorecards?period_id=${periodId}`)
        if (r.success && r.data) setItems(r.data)
        setLoading(false)
    }, [periodId])
    useEffect(() => { load() }, [load])

    async function generate() {
        if (!periodId) return
        setGenerating(true)
        const r = await api('/api/hr/kpi/scorecards/generate', { method: 'POST', body: JSON.stringify({ period_id: periodId }) })
        setGenerating(false)
        if (r.success) {
            toast({ title: `Generated ${r.data?.scorecards_created ?? 0} scorecards (${r.data?.items_created ?? 0} items)` })
            load()
        } else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Scorecards</CardTitle><CardDescription>Generated from published targets and recorded actuals.</CardDescription></div>
                <Button onClick={generate} disabled={!periodId || generating}>
                    {generating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Generate
                </Button>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Level</TableHead><TableHead>Scope</TableHead>
                                <TableHead>Score</TableHead><TableHead>Grade</TableHead>
                                <TableHead>Status</TableHead><TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState text="No scorecards yet" small /></TableCell></TableRow>}
                            {items.map(s => (
                                <TableRow key={s.id}>
                                    <TableCell className="capitalize">{s.scorecard_level}</TableCell>
                                    <TableCell className="font-mono text-xs">{s.department_id ?? s.employee_user_id ?? 'company'}</TableCell>
                                    <TableCell>{s.overall_score != null ? Number(s.overall_score).toFixed(2) : '—'}</TableCell>
                                    <TableCell><Badge variant="outline">{s.grade ?? '—'}</Badge></TableCell>
                                    <TableCell><StatusBadge value={s.status} /></TableCell>
                                    <TableCell><Button size="sm" variant="outline" onClick={() => setOpenId(s.id)}>View</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
            {openId && <ScorecardDetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
        </Card>
    )
}

function ScorecardDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
    const [data, setData] = useState<{ scorecard: Scorecard; items: any[]; reviews: any[] } | null>(null)
    const [loading, setLoading] = useState(true)
    const [recalcing, setRecalcing] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const r = await api<{ scorecard: Scorecard; items: any[]; reviews: any[] }>(`/api/hr/kpi/scorecards/${id}`)
        if (r.success && r.data) setData(r.data)
        setLoading(false)
    }, [id])
    useEffect(() => { load() }, [load])

    async function recalc() {
        setRecalcing(true)
        const r = await api(`/api/hr/kpi/scorecards/${id}/recalculate`, { method: 'POST' })
        setRecalcing(false)
        if (r.success) { toast({ title: 'Recalculated' }); load(); onChanged() }
        else toast({ title: 'Failed', description: r.error, variant: 'destructive' })
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-3xl">
                <DialogHeader><DialogTitle>Scorecard detail</DialogTitle></DialogHeader>
                {loading ? <CenteredLoader /> : data ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Badge variant="outline">{data.scorecard.scorecard_level}</Badge>
                            <StatusBadge value={data.scorecard.status} />
                            <span className="text-sm">Score: <strong>{data.scorecard.overall_score != null ? Number(data.scorecard.overall_score).toFixed(2) : '—'}</strong></span>
                            <span className="text-sm">Grade: <strong>{data.scorecard.grade ?? '—'}</strong></span>
                            <Button size="sm" variant="outline" className="ml-auto" onClick={recalc} disabled={recalcing}>
                                {recalcing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}Recalculate
                            </Button>
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Metric</TableHead><TableHead>Target</TableHead>
                                    <TableHead>Actual</TableHead><TableHead>Achievement %</TableHead>
                                    <TableHead>Weight %</TableHead><TableHead>Score</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.items.map((it: any) => (
                                    <TableRow key={it.id}>
                                        <TableCell className="font-medium">{it.hr_kpi_metrics?.name ?? it.metric_id}</TableCell>
                                        <TableCell>{it.target_value ?? '—'}</TableCell>
                                        <TableCell>{it.actual_value ?? '—'}</TableCell>
                                        <TableCell>{it.achievement_percent ?? '—'}</TableCell>
                                        <TableCell>{it.weight_percent}</TableCell>
                                        <TableCell>{it.weighted_score ?? '—'}</TableCell>
                                        <TableCell><StatusBadge value={it.status} /></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : <EmptyState text="Not found" />}
                <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Reports tab ──────────────────────────────────────────────────
function ReportsTab({ periodId }: { periodId: string | null }) {
    const [rows, setRows] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        if (!periodId) { setRows([]); setLoading(false); return }
        setLoading(true)
        const r = await api<any[]>(`/api/hr/kpi/reports/summary?period_id=${periodId}`)
        if (r.success && r.data) setRows(r.data)
        setLoading(false)
    }, [periodId])
    useEffect(() => { load() }, [load])

    return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle>Performance Summary</CardTitle>
                <CardDescription>Per-scorecard summary for the selected period.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? <CenteredLoader /> :
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Level</TableHead><TableHead>Score</TableHead>
                                <TableHead>Grade</TableHead>
                                <TableHead>On Track</TableHead><TableHead>At Risk</TableHead>
                                <TableHead>Below</TableHead><TableHead>No Data</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 && <TableRow><TableCell colSpan={7}><EmptyState text="No data" small /></TableCell></TableRow>}
                            {rows.map(r => (
                                <TableRow key={r.id}>
                                    <TableCell className="capitalize">{r.scorecard_level}</TableCell>
                                    <TableCell>{r.overall_score != null ? Number(r.overall_score).toFixed(2) : '—'}</TableCell>
                                    <TableCell><Badge variant="outline">{r.grade ?? '—'}</Badge></TableCell>
                                    <TableCell><span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />{r.item_status_counts?.on_track ?? 0}</span></TableCell>
                                    <TableCell><span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-600" />{r.item_status_counts?.at_risk ?? 0}</span></TableCell>
                                    <TableCell><span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3 text-red-600" />{r.item_status_counts?.below_target ?? 0}</span></TableCell>
                                    <TableCell><span className="inline-flex items-center gap-1"><MinusCircle className="h-3 w-3 text-gray-500" />{r.item_status_counts?.no_data ?? 0}</span></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                }
            </CardContent>
        </Card>
    )
}

// ── Small shared bits ────────────────────────────────────────────
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`flex flex-col gap-1 ${className ?? ''}`}>
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    )
}

function CenteredLoader() {
    return (
        <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
    )
}

function EmptyState({ text, small }: { text: string; small?: boolean }) {
    return (
        <div className={`text-center text-muted-foreground ${small ? 'py-3 text-xs' : 'py-12 text-sm'}`}>
            {text}
        </div>
    )
}

function KpiTile({ label, value, suffix, icon }: { label: string; value: number | string; suffix?: string; icon: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
                        <p className="text-2xl font-semibold mt-1">{value}{suffix ?? ''}</p>
                    </div>
                    <div className="text-muted-foreground">{icon}</div>
                </div>
            </CardContent>
        </Card>
    )
}
