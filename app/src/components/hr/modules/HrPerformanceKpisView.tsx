'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
    Target, Plus, Pencil, Trash2, Search, BarChart3,
    TrendingUp, AlertCircle, CheckCircle2, Loader2,
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

interface KpiDefinition {
    id: string
    kpi_key: string
    name: string
    description: string | null
    category: string | null
    unit: string | null
    target_value: number | null
    weight: number | null
    frequency: string | null
    is_active: boolean
    created_at: string
}

const FREQUENCY_OPTIONS = ['monthly', 'quarterly', 'semi_annual', 'annual']
const CATEGORY_OPTIONS = ['Financial', 'Customer', 'Process', 'Learning & Growth', 'Quality', 'Productivity', 'Innovation']

const FREQUENCY_LABELS: Record<string, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    semi_annual: 'Semi-Annual',
    annual: 'Annual',
}

function blankKpi(): Omit<KpiDefinition, 'id' | 'created_at'> {
    return {
        kpi_key: '',
        name: '',
        description: '',
        category: 'Productivity',
        unit: '%',
        target_value: null,
        weight: 10,
        frequency: 'quarterly',
        is_active: true,
    }
}

// ── Component ────────────────────────────────────────────────────

export default function HrPerformanceKpisView() {
    const [kpis, setKpis] = useState<KpiDefinition[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(blankKpi())
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/hr/analytics/kpis')
            const json = await res.json()
            setKpis(json.data || [])
        } catch (err) {
            console.error('Load KPIs failed:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return kpis
        return kpis.filter(k =>
            k.name.toLowerCase().includes(q) ||
            k.kpi_key.toLowerCase().includes(q) ||
            (k.category?.toLowerCase().includes(q))
        )
    }, [kpis, search])

    const stats = useMemo(() => ({
        total: kpis.length,
        active: kpis.filter(k => k.is_active).length,
        categories: new Set(kpis.map(k => k.category).filter(Boolean)).size,
        totalWeight: kpis.filter(k => k.is_active).reduce((s, k) => s + (k.weight || 0), 0),
    }), [kpis])

    const openCreate = () => {
        setEditingId(null)
        setForm(blankKpi())
        setDialogOpen(true)
    }

    const openEdit = (kpi: KpiDefinition) => {
        setEditingId(kpi.id)
        setForm({
            kpi_key: kpi.kpi_key,
            name: kpi.name,
            description: kpi.description || '',
            category: kpi.category || 'Productivity',
            unit: kpi.unit || '%',
            target_value: kpi.target_value,
            weight: kpi.weight || 10,
            frequency: kpi.frequency || 'quarterly',
            is_active: kpi.is_active,
        })
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.kpi_key.trim() || !form.name.trim()) {
            toast({ title: 'Validation Error', description: 'KPI key and name are required', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            const method = editingId ? 'PATCH' : 'POST'
            const body = editingId ? { id: editingId, ...form } : form

            const res = await fetch('/api/hr/analytics/kpis', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to save')
            toast({ title: editingId ? 'KPI Updated' : 'KPI Created', description: `${form.name} saved successfully` })
            setDialogOpen(false)
            load()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        try {
            setDeletingId(id)
            const res = await fetch('/api/hr/analytics/kpis', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            })
            if (!res.ok) {
                const json = await res.json()
                throw new Error(json.error || 'Failed to delete')
            }
            toast({ title: 'KPI Deleted' })
            load()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setDeletingId(null)
        }
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
                                <Target className="h-5 w-5 text-blue-600" />
                                KPI Library
                            </CardTitle>
                            <CardDescription>
                                Define key performance indicators for roles and departments. KPIs are linked to employee scorecards during appraisals.
                            </CardDescription>
                        </div>
                        <Button onClick={openCreate} className="gap-1">
                            <Plus className="h-4 w-4" /> Add KPI
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total KPIs</p>
                            <p className="text-2xl font-semibold">{stats.total}</p>
                        </div>
                        <BarChart3 className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Active</p>
                            <p className="text-2xl font-semibold">{stats.active}</p>
                        </div>
                        <CheckCircle2 className="h-6 w-6 text-green-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Categories</p>
                            <p className="text-2xl font-semibold">{stats.categories}</p>
                        </div>
                        <TrendingUp className="h-6 w-6 text-amber-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Weight Total</p>
                            <p className="text-2xl font-semibold">{stats.totalWeight}%</p>
                        </div>
                        <Target className="h-6 w-6 text-purple-600" />
                    </CardContent>
                </Card>
            </div>

            {/* Weight warning */}
            {stats.totalWeight > 0 && stats.totalWeight !== 100 && (
                <Card className="border-amber-200 dark:border-amber-800">
                    <CardContent className="py-3">
                        <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                            <AlertCircle className="h-4 w-4" />
                            <span>Active KPI weights total <strong>{stats.totalWeight}%</strong> — ideally should sum to 100%.</span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search KPIs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            {/* KPI List */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Target className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-muted-foreground">
                            {kpis.length === 0
                                ? 'No KPIs defined yet. Create your first KPI to start building employee scorecards.'
                                : 'No KPIs match your search.'}
                        </p>
                        {kpis.length === 0 && (
                            <Button onClick={openCreate} className="mt-4 gap-1">
                                <Plus className="h-4 w-4" /> Create First KPI
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {filtered.map(kpi => (
                        <Card key={kpi.id} className={!kpi.is_active ? 'opacity-60' : ''}>
                            <CardContent className="py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium text-sm">{kpi.name}</span>
                                            <Badge variant="outline" className="text-xs font-mono">
                                                {kpi.kpi_key}
                                            </Badge>
                                            {kpi.category && (
                                                <Badge variant="secondary" className="text-xs">
                                                    {kpi.category}
                                                </Badge>
                                            )}
                                            {!kpi.is_active && (
                                                <Badge variant="destructive" className="text-xs">Inactive</Badge>
                                            )}
                                        </div>
                                        {kpi.description && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{kpi.description}</p>
                                        )}
                                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                                            {kpi.target_value != null && (
                                                <span>Target: <strong>{kpi.target_value}{kpi.unit || ''}</strong></span>
                                            )}
                                            {kpi.weight != null && (
                                                <span>Weight: <strong>{kpi.weight}%</strong></span>
                                            )}
                                            {kpi.frequency && (
                                                <span>Review: <strong>{FREQUENCY_LABELS[kpi.frequency] || kpi.frequency}</strong></span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <Button variant="ghost" size="sm" onClick={() => openEdit(kpi)} className="h-8 w-8 p-0">
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(kpi.id)}
                                            disabled={deletingId === kpi.id}
                                            className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                                        >
                                            {deletingId === kpi.id ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Edit KPI' : 'Create KPI'}</DialogTitle>
                        <DialogDescription>
                            Define a measurable performance indicator. KPIs are assigned to employees during appraisal cycles.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">KPI Key *</label>
                                <Input
                                    placeholder="e.g. SALES_TARGET"
                                    value={form.kpi_key}
                                    onChange={(e) => setForm(f => ({ ...f, kpi_key: e.target.value.toUpperCase().replace(/\s+/g, '_') }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Name *</label>
                                <Input
                                    placeholder="e.g. Monthly Sales Target"
                                    value={form.name}
                                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium">Description</label>
                            <Input
                                placeholder="Brief description of this KPI"
                                value={form.description || ''}
                                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Category</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.category || ''}
                                    onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                                >
                                    {CATEGORY_OPTIONS.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Frequency</label>
                                <select
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={form.frequency || 'quarterly'}
                                    onChange={(e) => setForm(f => ({ ...f, frequency: e.target.value }))}
                                >
                                    {FREQUENCY_OPTIONS.map(f => (
                                        <option key={f} value={f}>{FREQUENCY_LABELS[f] || f}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="text-sm font-medium">Target Value</label>
                                <Input
                                    type="number"
                                    placeholder="e.g. 100"
                                    value={form.target_value ?? ''}
                                    onChange={(e) => setForm(f => ({ ...f, target_value: e.target.value ? Number(e.target.value) : null }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Unit</label>
                                <Input
                                    placeholder="%, RM, qty"
                                    value={form.unit || ''}
                                    onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Weight (%)</label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={form.weight ?? ''}
                                    onChange={(e) => setForm(f => ({ ...f, weight: e.target.value ? Number(e.target.value) : null }))}
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="kpi-active"
                                checked={form.is_active}
                                onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))}
                                className="rounded"
                            />
                            <label htmlFor="kpi-active" className="text-sm">Active</label>
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
