'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
    FileText, Plus, Search, Loader2, Star, User,
    CheckCircle2, Clock, Send, Eye, ChevronRight,
    ClipboardList, AlertCircle,
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

interface Review {
    id: string
    cycle_id: string | null
    template_id: string | null
    employee_id: string
    reviewer_id: string
    review_type: string
    status: string
    overall_rating: number | null
    employee_name?: string
    reviewer_name?: string
    cycle_name?: string
    template_name?: string
    submitted_at: string | null
    completed_at: string | null
    created_at: string
}

interface Cycle {
    id: string
    name: string
}

interface Template {
    id: string
    name: string
}

interface Employee {
    id: string
    full_name: string
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
    draft:       { label: 'Draft',       color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',   icon: ClipboardList },
    in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',   icon: Clock },
    submitted:   { label: 'Submitted',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', icon: Send },
    reviewed:    { label: 'Reviewed',    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300', icon: Eye },
    completed:   { label: 'Completed',   color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', icon: CheckCircle2 },
}

const REVIEW_TYPES = ['self', 'manager', 'peer', '360', 'probation']
const REVIEW_TYPE_LABELS: Record<string, string> = {
    self: 'Self Review', manager: 'Manager Review', peer: 'Peer Review', '360': '360 Feedback', probation: 'Probation Review',
}

function blankReview() {
    return {
        cycle_id: '',
        template_id: '',
        employee_id: '',
        reviewer_id: '',
        review_type: 'manager',
    }
}

// ── Component ────────────────────────────────────────────────────

export default function HrPerformanceReviewsView() {
    const [reviews, setReviews] = useState<Review[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [form, setForm] = useState(blankReview())
    const [saving, setSaving] = useState(false)

    // Lookup data
    const [cycles, setCycles] = useState<Cycle[]>([])
    const [templates, setTemplates] = useState<Template[]>([])
    const [employees, setEmployees] = useState<Employee[]>([])

    const load = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/hr/performance/reviews')
            const json = await res.json()
            setReviews(json.data || [])
        } catch (err) {
            console.error('Load reviews failed:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    const loadLookups = useCallback(async () => {
        try {
            const [cRes, tRes, eRes] = await Promise.all([
                fetch('/api/hr/performance/appraisals'),
                fetch('/api/hr/performance/templates'),
                fetch('/api/hr/employees'),
            ])
            const [cJson, tJson, eJson] = await Promise.all([cRes.json(), tRes.json(), eRes.json()])
            setCycles(cJson.data || [])
            setTemplates(tJson.data || [])
            setEmployees(
                (eJson.data || eJson.employees || []).map((e: any) => ({
                    id: e.id,
                    full_name: e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email || 'Unknown',
                }))
            )
        } catch (err) {
            console.error('Load lookups failed:', err)
        }
    }, [])

    useEffect(() => { load(); loadLookups() }, [load, loadLookups])

    const filtered = useMemo(() => {
        let list = reviews
        if (statusFilter !== 'all') {
            list = list.filter(r => r.status === statusFilter)
        }
        const q = search.trim().toLowerCase()
        if (q) {
            list = list.filter(r =>
                (r.employee_name?.toLowerCase().includes(q)) ||
                (r.reviewer_name?.toLowerCase().includes(q)) ||
                (r.cycle_name?.toLowerCase().includes(q)) ||
                r.review_type.toLowerCase().includes(q)
            )
        }
        return list
    }, [reviews, search, statusFilter])

    const stats = useMemo(() => ({
        total: reviews.length,
        pending: reviews.filter(r => r.status === 'draft' || r.status === 'in_progress').length,
        submitted: reviews.filter(r => r.status === 'submitted').length,
        completed: reviews.filter(r => r.status === 'completed' || r.status === 'reviewed').length,
    }), [reviews])

    const openCreate = () => {
        setForm(blankReview())
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.employee_id || !form.reviewer_id) {
            toast({ title: 'Validation Error', description: 'Employee and reviewer are required', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            const payload = {
                ...form,
                cycle_id: form.cycle_id || null,
                template_id: form.template_id || null,
            }
            const res = await fetch('/api/hr/performance/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to create review')
            toast({ title: 'Review Created', description: 'Performance review has been assigned.' })
            setDialogOpen(false)
            load()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

    const renderStars = (rating: number | null, scale = 5) => {
        if (rating == null) return <span className="text-xs text-muted-foreground">Not rated</span>
        return (
            <div className="flex items-center gap-0.5">
                {Array.from({ length: scale }, (_, i) => (
                    <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${i < Math.round(rating) ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`}
                    />
                ))}
                <span className="text-xs ml-1 font-medium">{rating.toFixed(1)}</span>
            </div>
        )
    }

    // ── Render ────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="h-5 w-5 text-emerald-600" />
                                Performance Reviews
                            </CardTitle>
                            <CardDescription>
                                Manage individual performance reviews. Assign reviewers, track submissions, and complete ratings.
                            </CardDescription>
                        </div>
                        <Button onClick={openCreate} className="gap-1">
                            <Plus className="h-4 w-4" /> Create Review
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Reviews</p>
                            <p className="text-2xl font-semibold">{stats.total}</p>
                        </div>
                        <FileText className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Pending</p>
                            <p className="text-2xl font-semibold">{stats.pending}</p>
                        </div>
                        <Clock className="h-6 w-6 text-amber-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Submitted</p>
                            <p className="text-2xl font-semibold">{stats.submitted}</p>
                        </div>
                        <Send className="h-6 w-6 text-blue-600" />
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
            </div>

            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by employee, reviewer, cycle..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex gap-1 flex-wrap">
                    {['all', 'draft', 'in_progress', 'submitted', 'reviewed', 'completed'].map(s => (
                        <Button
                            key={s}
                            variant={statusFilter === s ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setStatusFilter(s)}
                            className="text-xs"
                        >
                            {s === 'all' ? 'All' : (STATUS_MAP[s]?.label || s)}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Review List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-muted-foreground">
                            {reviews.length === 0
                                ? 'No performance reviews yet. Create a review to start evaluating employees.'
                                : 'No reviews match your filters.'}
                        </p>
                        {reviews.length === 0 && (
                            <Button onClick={openCreate} className="mt-4 gap-1">
                                <Plus className="h-4 w-4" /> Create First Review
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {filtered.map(review => {
                        const st = STATUS_MAP[review.status] || STATUS_MAP.draft
                        const Icon = st.icon
                        return (
                            <Card key={review.id} className="hover:shadow-md transition-shadow">
                                <CardContent className="py-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <div className="flex items-center gap-1">
                                                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                    <span className="font-medium text-sm">
                                                        {review.employee_name || 'Employee'}
                                                    </span>
                                                </div>
                                                <Badge className={`text-xs ${st.color}`}>
                                                    <Icon className="h-3 w-3 mr-1" />
                                                    {st.label}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    {REVIEW_TYPE_LABELS[review.review_type] || review.review_type}
                                                </Badge>
                                            </div>
                                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                                                <span>Reviewer: <strong>{review.reviewer_name || '—'}</strong></span>
                                                {review.cycle_name && (
                                                    <span>Cycle: <strong>{review.cycle_name}</strong></span>
                                                )}
                                                {review.template_name && (
                                                    <span>Template: <strong>{review.template_name}</strong></span>
                                                )}
                                                <span>Created: <strong>{fmtDate(review.created_at)}</strong></span>
                                            </div>
                                            {review.overall_rating != null && (
                                                <div className="mt-2">
                                                    {renderStars(review.overall_rating)}
                                                </div>
                                            )}
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Create Performance Review</DialogTitle>
                        <DialogDescription>
                            Assign a review to an employee with a designated reviewer. Optionally link it to an appraisal cycle and review template.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Employee *</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.employee_id}
                                    onChange={(e) => setForm(f => ({ ...f, employee_id: e.target.value }))}
                                >
                                    <option value="">Select employee</option>
                                    {employees.map(e => (
                                        <option key={e.id} value={e.id}>{e.full_name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Reviewer *</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.reviewer_id}
                                    onChange={(e) => setForm(f => ({ ...f, reviewer_id: e.target.value }))}
                                >
                                    <option value="">Select reviewer</option>
                                    {employees.map(e => (
                                        <option key={e.id} value={e.id}>{e.full_name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium">Review Type</label>
                            <select
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.review_type}
                                onChange={(e) => setForm(f => ({ ...f, review_type: e.target.value }))}
                            >
                                {REVIEW_TYPES.map(t => (
                                    <option key={t} value={t}>{REVIEW_TYPE_LABELS[t] || t}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Appraisal Cycle</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.cycle_id}
                                    onChange={(e) => setForm(f => ({ ...f, cycle_id: e.target.value }))}
                                >
                                    <option value="">None</option>
                                    {cycles.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Review Template</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.template_id}
                                    onChange={(e) => setForm(f => ({ ...f, template_id: e.target.value }))}
                                >
                                    <option value="">None</option>
                                    {templates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {form.employee_id && form.reviewer_id && form.employee_id === form.reviewer_id && form.review_type !== 'self' && (
                            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                                <AlertCircle className="h-4 w-4" />
                                <span>Employee and reviewer are the same person. Did you mean to select <strong>Self Review</strong>?</span>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            Create Review
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
