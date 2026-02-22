'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
    CalendarClock, Plus, Pencil, Search, BarChart3,
    PlayCircle, PauseCircle, CheckCircle2, Loader2, Users,
    ClipboardList, AlertCircle, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'

// ── Types ────────────────────────────────────────────────────────

interface AppraisalCycle {
    id: string
    name: string
    cycle_type: string
    start_date: string
    end_date: string
    review_start_date: string | null
    review_end_date: string | null
    status: string
    scoring_scale: number
    created_at: string
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
    draft:       { label: 'Draft',       color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',   icon: ClipboardList },
    active:      { label: 'Active',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',   icon: PlayCircle },
    in_review:   { label: 'In Review',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', icon: Users },
    calibration: { label: 'Calibration', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300', icon: BarChart3 },
    completed:   { label: 'Completed',   color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', icon: CheckCircle2 },
}

const CYCLE_TYPES = ['annual', 'semi_annual', 'quarterly', 'probation']
const CYCLE_LABELS: Record<string, string> = {
    annual: 'Annual', semi_annual: 'Semi-Annual', quarterly: 'Quarterly', probation: 'Probation',
}

function blankCycle() {
    const today = new Date()
    const yearStart = `${today.getFullYear()}-01-01`
    const yearEnd = `${today.getFullYear()}-12-31`
    return {
        name: '',
        cycle_type: 'annual',
        start_date: yearStart,
        end_date: yearEnd,
        review_start_date: '',
        review_end_date: '',
        scoring_scale: 5,
    }
}

// ── Component ────────────────────────────────────────────────────

export default function HrPerformanceAppraisalsView() {
    const [cycles, setCycles] = useState<AppraisalCycle[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(blankCycle())
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/hr/performance/appraisals')
            const json = await res.json()
            setCycles(json.data || [])
        } catch (err) {
            console.error('Load appraisal cycles failed:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return cycles
        return cycles.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.cycle_type.toLowerCase().includes(q) ||
            c.status.toLowerCase().includes(q)
        )
    }, [cycles, search])

    const stats = useMemo(() => ({
        total: cycles.length,
        active: cycles.filter(c => c.status === 'active' || c.status === 'in_review').length,
        completed: cycles.filter(c => c.status === 'completed').length,
        draft: cycles.filter(c => c.status === 'draft').length,
    }), [cycles])

    const openCreate = () => {
        setEditingId(null)
        setForm(blankCycle())
        setDialogOpen(true)
    }

    const openEdit = (cycle: AppraisalCycle) => {
        setEditingId(cycle.id)
        setForm({
            name: cycle.name,
            cycle_type: cycle.cycle_type,
            start_date: cycle.start_date,
            end_date: cycle.end_date,
            review_start_date: cycle.review_start_date || '',
            review_end_date: cycle.review_end_date || '',
            scoring_scale: cycle.scoring_scale,
        })
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.name.trim()) {
            toast({ title: 'Validation Error', description: 'Cycle name is required', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            const payload = {
                ...form,
                review_start_date: form.review_start_date || null,
                review_end_date: form.review_end_date || null,
            }
            const res = await fetch('/api/hr/performance/appraisals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to save')
            toast({ title: editingId ? 'Cycle Updated' : 'Cycle Created', description: `${form.name} saved successfully` })
            setDialogOpen(false)
            load()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

    // ── Render ────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <CalendarClock className="h-5 w-5 text-indigo-600" />
                                Appraisal Cycles
                            </CardTitle>
                            <CardDescription>
                                Plan and manage appraisal periods. Each cycle defines the review window, scoring scale, and workflow stages.
                            </CardDescription>
                        </div>
                        <Button onClick={openCreate} className="gap-1">
                            <Plus className="h-4 w-4" /> New Cycle
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Cycles</p>
                            <p className="text-2xl font-semibold">{stats.total}</p>
                        </div>
                        <CalendarClock className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Active / In Review</p>
                            <p className="text-2xl font-semibold">{stats.active}</p>
                        </div>
                        <PlayCircle className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Completed</p>
                            <p className="text-2xl font-semibold">{stats.completed}</p>
                        </div>
                        <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Draft</p>
                            <p className="text-2xl font-semibold">{stats.draft}</p>
                        </div>
                        <ClipboardList className="h-6 w-6 text-gray-500" />
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search cycles..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            {/* Cycle List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-muted-foreground">
                            {cycles.length === 0
                                ? 'No appraisal cycles yet. Create your first cycle to start evaluating employees.'
                                : 'No cycles match your search.'}
                        </p>
                        {cycles.length === 0 && (
                            <Button onClick={openCreate} className="mt-4 gap-1">
                                <Plus className="h-4 w-4" /> Create First Cycle
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {filtered.map(cycle => {
                        const st = STATUS_MAP[cycle.status] || STATUS_MAP.draft
                        const Icon = st.icon
                        return (
                            <Card key={cycle.id} className="hover:shadow-md transition-shadow">
                                <CardContent className="py-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-sm">{cycle.name}</span>
                                                <Badge className={`text-xs ${st.color}`}>
                                                    <Icon className="h-3 w-3 mr-1" />
                                                    {st.label}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    {CYCLE_LABELS[cycle.cycle_type] || cycle.cycle_type}
                                                </Badge>
                                            </div>
                                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                                                <span>Period: <strong>{fmtDate(cycle.start_date)} — {fmtDate(cycle.end_date)}</strong></span>
                                                {cycle.review_start_date && (
                                                    <span>Review Window: <strong>{fmtDate(cycle.review_start_date)} — {fmtDate(cycle.review_end_date)}</strong></span>
                                                )}
                                                <span>Scale: <strong>1–{cycle.scoring_scale}</strong></span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <Button variant="ghost" size="sm" onClick={() => openEdit(cycle)} className="h-8 w-8 p-0">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Edit Appraisal Cycle' : 'Create Appraisal Cycle'}</DialogTitle>
                        <DialogDescription>
                            Define the review period and scoring parameters. Employees will be reviewed within the review window dates.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm font-medium">Cycle Name *</label>
                            <Input
                                placeholder="e.g. Annual Review 2026"
                                value={form.name}
                                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Cycle Type</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.cycle_type}
                                    onChange={(e) => setForm(f => ({ ...f, cycle_type: e.target.value }))}
                                >
                                    {CYCLE_TYPES.map(t => (
                                        <option key={t} value={t}>{CYCLE_LABELS[t] || t}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Scoring Scale (max)</label>
                                <Input
                                    type="number"
                                    min={3}
                                    max={10}
                                    value={form.scoring_scale}
                                    onChange={(e) => setForm(f => ({ ...f, scoring_scale: Number(e.target.value) || 5 }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Period Start *</label>
                                <Input
                                    type="date"
                                    value={form.start_date}
                                    onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Period End *</label>
                                <Input
                                    type="date"
                                    value={form.end_date}
                                    onChange={(e) => setForm(f => ({ ...f, end_date: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="border-t pt-3">
                            <p className="text-xs text-muted-foreground mb-2">
                                Optional: Set specific dates when the review form is open for submission.
                            </p>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium">Review Window Start</label>
                                    <Input
                                        type="date"
                                        value={form.review_start_date}
                                        onChange={(e) => setForm(f => ({ ...f, review_start_date: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Review Window End</label>
                                    <Input
                                        type="date"
                                        value={form.review_end_date}
                                        onChange={(e) => setForm(f => ({ ...f, review_end_date: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            {editingId ? 'Update' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
