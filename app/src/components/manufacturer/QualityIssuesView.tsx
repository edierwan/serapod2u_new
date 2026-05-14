'use client'
/**
 * Quality & Return Issues — Supply Chain > Quality & Returns > Product Return.
 *
 * Header: title + visibility chip + Export / Refresh / Log Manual Issue
 * KPI cards: Open / Pending Manufacturer / Acknowledged / Resolved / Rejected / Units Affected
 * Filters: search · Type · Manufacturer · Status · Date Range · More Filters
 * Two columns: Issues table (left) + Issue Details (right) with timeline, evidence, response
 *
 * Backed by:
 *   GET  /api/manufacturer/adjustments
 *   POST /api/manufacturer/adjustments/{id}                 (acknowledge)
 *   POST /api/admin/adjustments/{id}/status                 (SA set final status)
 *
 * Disabled actions show "Not available yet" tooltips — no backend support yet:
 *   - Export
 *   - Log Manual Issue
 *   - More Filters
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
    AlertCircle, Clock, CheckCircle2, CheckCheck, XCircle, Package,
    Search, Filter, Download, Plus, RefreshCw, MoreHorizontal, Loader2,
    Calendar, Image as ImageIcon, ExternalLink, ChevronRight, Upload, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface UserProfile { id: string; organization_id?: string; role_code?: string }

interface AdjustmentItem {
    id: string
    variant_id: string | null
    adjustment_quantity: number
    unit_cost?: number | null
    system_quantity?: number | null
    physical_quantity?: number | null
    product_name?: string | null
    sku?: string | null
    variant_name?: string | null
    product_image?: string | null
}

interface OrgRef { id: string; org_name: string; org_type_code?: string | null }

interface Adjustment {
    id: string
    organization_id: string
    reason_id: string
    notes: string | null
    proof_images: string[] | null
    status: string | null
    created_at: string
    created_by: string | null
    target_manufacturer_org_id: string | null
    manufacturer_status: string | null
    manufacturer_acknowledged_at: string | null
    manufacturer_acknowledged_by: string | null
    manufacturer_notes: string | null
    manufacturer_assigned_at?: string | null
    stock_adjustment_items: AdjustmentItem[] | null
    stock_adjustment_reasons: { reason_code: string; reason_name: string } | null
    created_by_user: { full_name: string; email?: string } | null
    reporter_org?: OrgRef | null
    manufacturer_org?: OrgRef | null
}

// ── Helpers ──────────────────────────────────────────────────────
function shortId(id?: string | null) {
    if (!id) return '—'
    return id.length > 10 ? id.slice(0, 8) : id
}

function issueCode(a: Adjustment) {
    const year = new Date(a.created_at).getFullYear()
    return `QI-${year}-${a.id.slice(0, 5).toUpperCase()}`
}

function totalUnits(a: Adjustment) {
    return (a.stock_adjustment_items ?? []).reduce((sum, it) => sum + Math.abs(it.adjustment_quantity ?? 0), 0)
}

function isManufacturerScope(a: Adjustment, profile: UserProfile) {
    return profile.role_code === 'SA' || profile.organization_id === a.target_manufacturer_org_id
}

function formatDate(iso?: string | null, withTime = true) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return withTime
        ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function reasonTypeLabel(code?: string | null) {
    if (code === 'quality_issue') return { label: 'Quality Issue', tone: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200' }
    if (code === 'return_to_supplier') return { label: 'Return to Supplier', tone: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200' }
    if (code === 'damaged_goods') return { label: 'Damaged Goods', tone: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' }
    return { label: code ?? '—', tone: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200' }
}

function statusBadge(value: string | null | undefined) {
    if (!value) return null
    const tone =
        value === 'resolved' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' :
            value === 'acknowledged' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200' :
                value === 'rejected' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200' :
                    value === 'pending' ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200' :
                        'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    return (
        <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap',
            tone,
        )}>
            {value.replaceAll('_', ' ')}
        </span>
    )
}

// ── Stat card ────────────────────────────────────────────────────
function StatCard({
    label, value, tone, icon, hint,
}: {
    label: string
    value: number | string
    tone: 'orange' | 'amber' | 'blue' | 'emerald' | 'red' | 'slate'
    icon: React.ReactNode
    hint?: string
}) {
    const toneMap = {
        orange: 'bg-orange-50 text-orange-600',
        amber: 'bg-amber-50 text-amber-600',
        blue: 'bg-blue-50 text-blue-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        red: 'bg-red-50 text-red-600',
        slate: 'bg-slate-100 text-slate-600',
    }
    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
                    {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
                </div>
                <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md', toneMap[tone])}>
                    {icon}
                </span>
            </div>
        </div>
    )
}

// ── Main ─────────────────────────────────────────────────────────
export default function QualityIssuesView({ userProfile }: { userProfile: UserProfile }) {
    const [items, setItems] = useState<Adjustment[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [ackLoadingId, setAckLoadingId] = useState<string | null>(null)
    const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null)
    const [createOpen, setCreateOpen] = useState(false)

    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('all')
    const [manufacturerFilter, setManufacturerFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [rangeFilter, setRangeFilter] = useState('30d')

    const isSA = userProfile.role_code === 'SA'

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const resp = await fetch('/api/manufacturer/adjustments')
            const json = await resp.json()
            if (json.error) {
                setError(json.error)
                setItems([])
            } else {
                setItems(json.data || [])
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load issues')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const stats = useMemo(() => {
        return {
            open: items.filter(i => (i.status ?? 'pending') === 'pending').length,
            pendingMfr: items.filter(i => (i.manufacturer_status ?? 'pending') === 'pending').length,
            acknowledged: items.filter(i => i.manufacturer_status === 'acknowledged').length,
            resolved: items.filter(i => i.status === 'resolved').length,
            rejected: items.filter(i => i.status === 'rejected' || i.manufacturer_status === 'rejected').length,
            units: items.reduce((sum, i) => sum + totalUnits(i), 0),
        }
    }, [items])

    const manufacturerOptions = useMemo(() => {
        const set = new Map<string, string>()
        items.forEach(i => {
            if (i.target_manufacturer_org_id) {
                set.set(i.target_manufacturer_org_id, i.manufacturer_org?.org_name || shortId(i.target_manufacturer_org_id))
            }
        })
        return Array.from(set.entries())
    }, [items])

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase()
        const cutoff = (() => {
            if (rangeFilter === 'all') return null
            const days = rangeFilter === '7d' ? 7 : rangeFilter === '30d' ? 30 : 90
            return Date.now() - days * 86400_000
        })()
        return items.filter(it => {
            if (typeFilter !== 'all' && it.stock_adjustment_reasons?.reason_code !== typeFilter) return false
            if (manufacturerFilter !== 'all' && it.target_manufacturer_org_id !== manufacturerFilter) return false
            if (statusFilter !== 'all') {
                if (statusFilter === 'pending' && (it.status !== 'pending')) return false
                if (statusFilter === 'acknowledged' && it.manufacturer_status !== 'acknowledged') return false
                if (statusFilter === 'resolved' && it.status !== 'resolved') return false
                if (statusFilter === 'rejected' && it.status !== 'rejected' && it.manufacturer_status !== 'rejected') return false
            }
            if (cutoff != null) {
                const t = new Date(it.created_at).getTime()
                if (isNaN(t) || t < cutoff) return false
            }
            if (!s) return true
            const hay = [
                issueCode(it),
                it.id,
                it.notes,
                it.stock_adjustment_reasons?.reason_name,
                it.created_by_user?.full_name,
                it.target_manufacturer_org_id,
                it.reporter_org?.org_name,
                it.manufacturer_org?.org_name,
                ...(it.stock_adjustment_items || []).flatMap(item => [item.product_name, item.variant_name, item.sku]),
            ].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(s)
        })
    }, [items, search, typeFilter, manufacturerFilter, statusFilter, rangeFilter])

    useEffect(() => {
        if (!selectedId && filtered.length) setSelectedId(filtered[0].id)
        if (selectedId && !filtered.some(it => it.id === selectedId) && filtered.length) {
            setSelectedId(filtered[0].id)
        }
    }, [filtered, selectedId])

    const selected = useMemo(() => items.find(it => it.id === selectedId) ?? null, [items, selectedId])

    async function ack(id: string) {
        setAckLoadingId(id)
        try {
            const resp = await fetch(`/api/manufacturer/adjustments/${id}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ notes: 'Acknowledged from manufacturer portal' }),
            })
            const json = await resp.json()
            if (json.error) {
                alert('Failed to acknowledge: ' + json.error)
            } else {
                await load()
            }
        } finally {
            setAckLoadingId(null)
        }
    }

    async function setFinalStatus(id: string) {
        const res = prompt('Set status (resolved/rejected)')
        if (!res) return
        setStatusLoadingId(id)
        try {
            const resp = await fetch(`/api/admin/adjustments/${id}/status`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: res }),
            })
            const json = await resp.json()
            if (json.error) alert('Failed: ' + json.error)
            await load()
        } finally {
            setStatusLoadingId(null)
        }
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-slate-900">Quality &amp; Return Issues</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Track product defects, damaged inventory, and return-to-supplier cases.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 hidden sm:block">Visible to Manufacturer members &amp; Super Admin</span>
                    <Button variant="outline" size="sm" disabled title="Export not available yet">
                        <Download className="h-3.5 w-3.5 mr-1.5" />Export
                    </Button>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                        Refresh
                    </Button>
                    <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Create Issue
                    </Button>
                </div>
            </div>

            {/* Create Issue Modal */}
            <CreateIssueModal
                open={createOpen}
                onOpenChange={setCreateOpen}
                userProfile={userProfile}
                onCreated={() => { setCreateOpen(false); load() }}
            />

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Open Issues" value={stats.open} tone="orange" icon={<AlertCircle className="h-4 w-4" />} hint="Status pending" />
                <StatCard label="Pending Manufacturer" value={stats.pendingMfr} tone="amber" icon={<Clock className="h-4 w-4" />} hint="Awaiting ack" />
                <StatCard label="Acknowledged" value={stats.acknowledged} tone="blue" icon={<CheckCircle2 className="h-4 w-4" />} hint="By manufacturer" />
                <StatCard label="Resolved" value={stats.resolved} tone="emerald" icon={<CheckCheck className="h-4 w-4" />} hint="Final status" />
                <StatCard label="Rejected" value={stats.rejected} tone="red" icon={<XCircle className="h-4 w-4" />} hint="Not accepted" />
                <StatCard label="Units Affected" value={stats.units} tone="slate" icon={<Package className="h-4 w-4" />} hint="Across all issues" />
            </div>

            {/* Filters */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search issues, reporters, manufacturers…"
                            className="pl-8 h-9 w-[260px]"
                        />
                    </div>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="quality_issue">Quality Issue</SelectItem>
                            <SelectItem value="return_to_supplier">Return to Supplier</SelectItem>
                            <SelectItem value="damaged_goods">Damaged Goods</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={manufacturerFilter} onValueChange={setManufacturerFilter}>
                        <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Manufacturer" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Manufacturers</SelectItem>
                            {manufacturerOptions.map(([id, label]) => (
                                <SelectItem key={id} value={id} className="font-mono text-xs">{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="acknowledged">Acknowledged</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={rangeFilter} onValueChange={setRangeFilter}>
                        <SelectTrigger className="w-[150px] h-9">
                            <Calendar className="h-3.5 w-3.5 mr-1 text-slate-400" />
                            <SelectValue placeholder="Date range" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7d">Last 7 days</SelectItem>
                            <SelectItem value="30d">Last 30 days</SelectItem>
                            <SelectItem value="90d">Last 90 days</SelectItem>
                            <SelectItem value="all">All time</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled title="More filters not available yet">
                        <Filter className="h-3.5 w-3.5 mr-1.5" />More Filters
                    </Button>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4">
                {/* Issues table */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-900">Issues</h2>
                        <span className="text-xs text-slate-500">{filtered.length} of {items.length}</span>
                    </div>
                    {loading ? (
                        <div className="py-12 flex items-center justify-center text-sm text-slate-500 gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />Loading…
                        </div>
                    ) : error ? (
                        <div className="py-12 px-6 text-center">
                            <div className="text-sm text-red-600">Failed to load: {error}</div>
                            <Button variant="outline" size="sm" className="mt-3" onClick={load}>Retry</Button>
                        </div>
                    ) : items.length === 0 ? (
                        <EmptyState forSA={isSA} onCreate={() => setCreateOpen(true)} />
                    ) : filtered.length === 0 ? (
                        <div className="py-12 px-6 text-center">
                            <h3 className="text-sm font-semibold text-slate-900">No matching issues</h3>
                            <p className="text-sm text-slate-500 mt-1">Try adjusting filters or search.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60 border-slate-100">
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Issue ID</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Type</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Product</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Reported By</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Manufacturer</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide text-right">Qty</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Status</TableHead>
                                        <TableHead className="h-9 text-[11px] font-semibold uppercase text-slate-500 tracking-wide">Created</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map(r => {
                                        const isSel = selectedId === r.id
                                        const type = reasonTypeLabel(r.stock_adjustment_reasons?.reason_code)
                                        const firstItem = r.stock_adjustment_items?.[0]
                                        const productLabel = firstItem
                                            ? (firstItem.product_name ?? firstItem.sku ?? shortId(firstItem.variant_id))
                                            : '—'
                                        const extraCount = (r.stock_adjustment_items?.length ?? 0) - 1
                                        const finalStatus = r.status === 'resolved' ? 'resolved'
                                            : r.status === 'rejected' || r.manufacturer_status === 'rejected' ? 'rejected'
                                                : r.manufacturer_status === 'acknowledged' ? 'acknowledged'
                                                    : 'pending'
                                        return (
                                            <TableRow
                                                key={r.id}
                                                onClick={() => setSelectedId(r.id)}
                                                className={cn(
                                                    'cursor-pointer border-slate-100 transition-colors',
                                                    isSel ? 'bg-orange-50/50 hover:bg-orange-50/70 border-l-[3px] border-l-orange-500' : 'hover:bg-slate-50/60',
                                                )}
                                            >
                                                <TableCell className="py-2.5 font-mono text-xs text-slate-700">{issueCode(r)}</TableCell>
                                                <TableCell className="py-2.5">
                                                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', type.tone)}>
                                                        {type.label}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2.5 text-sm text-slate-700">
                                                    <div className="font-medium text-slate-900 truncate max-w-[160px]">{productLabel}</div>
                                                    {extraCount > 0 && (
                                                        <div className="text-[11px] text-slate-500">+{extraCount} more item{extraCount > 1 ? 's' : ''}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="py-2.5 text-sm text-slate-700">{r.created_by_user?.full_name ?? '—'}</TableCell>
                                                <TableCell className="py-2.5 font-mono text-xs text-slate-600">{shortId(r.target_manufacturer_org_id)}</TableCell>
                                                <TableCell className="py-2.5 text-right tabular-nums text-sm text-slate-700">{totalUnits(r)}</TableCell>
                                                <TableCell className="py-2.5">{statusBadge(finalStatus)}</TableCell>
                                                <TableCell className="py-2.5 text-xs text-slate-500">{formatDate(r.created_at, false)}</TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>

                {/* Detail panel */}
                <IssueDetailPanel
                    issue={selected}
                    profile={userProfile}
                    onAck={ack}
                    ackLoadingId={ackLoadingId}
                    onSetStatus={setFinalStatus}
                    statusLoadingId={statusLoadingId}
                />
            </div>
        </div>
    )
}

// ── Empty state ──────────────────────────────────────────────────
function EmptyState({ forSA, onCreate }: { forSA: boolean; onCreate: () => void }) {
    if (forSA) {
        return (
            <div className="py-14 px-6 flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600 mb-3">
                    <AlertCircle className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">No quality or return issues yet</h3>
                <p className="mt-1 text-sm text-slate-500 max-w-md">
                    Issues will appear here when inventory movements are reported as Quality Issue or Return to Supplier.
                </p>
                <div className="mt-4 flex items-center gap-2">
                    <Button size="sm" onClick={onCreate}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Create Issue
                    </Button>
                    <a
                        href="/inventory/stock-movements"
                        className="inline-flex items-center text-xs text-blue-600 hover:underline"
                    >
                        View Stock Movements <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                </div>
            </div>
        )
    }
    return (
        <div className="py-14 px-6 flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 mb-3">
                <Package className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">No assigned issues</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-md">
                When HQ assigns a quality or return case to your organization, it will appear here for acknowledgement and resolution.
            </p>
        </div>
    )
}

// ── Detail panel ─────────────────────────────────────────────────
function IssueDetailPanel({
    issue, profile, onAck, ackLoadingId, onSetStatus, statusLoadingId,
}: {
    issue: Adjustment | null
    profile: UserProfile
    onAck: (id: string) => void
    ackLoadingId: string | null
    onSetStatus: (id: string) => void
    statusLoadingId: string | null
}) {
    if (!issue) {
        return (
            <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-6 flex flex-col items-center text-center min-h-[300px] justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-3">
                    <ChevronRight className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Select an issue</h3>
                <p className="mt-1 text-sm text-slate-500">Choose a row to view details, evidence, and timeline.</p>
            </div>
        )
    }

    const type = reasonTypeLabel(issue.stock_adjustment_reasons?.reason_code)
    const finalStatus = issue.status === 'resolved' ? 'resolved'
        : issue.status === 'rejected' || issue.manufacturer_status === 'rejected' ? 'rejected'
            : issue.manufacturer_status === 'acknowledged' ? 'acknowledged'
                : 'pending'
    const canAck = isManufacturerScope(issue, profile) && issue.manufacturer_status === 'pending'

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-500">{issueCode(issue)}</div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                        {issue.stock_adjustment_reasons?.reason_name ?? 'Issue Details'}
                    </h3>
                </div>
                <div className="flex items-center gap-2">
                    {statusBadge(finalStatus)}
                    <Button variant="ghost" size="icon" disabled className="h-7 w-7" title="More actions not available yet">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Type */}
                <div className="flex items-center gap-2">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', type.tone)}>
                        {type.label}
                    </span>
                </div>

                {/* Inventory impact */}
                <div>
                    <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide mb-1.5">Inventory Impact</p>
                    {issue.stock_adjustment_items && issue.stock_adjustment_items.length > 0 ? (
                        <ul className="space-y-2">
                            {issue.stock_adjustment_items.map(it => {
                                const affected = Math.abs(it.adjustment_quantity ?? 0)
                                const cost = it.unit_cost ?? null
                                const estImpact = cost != null ? cost * affected : null
                                return (
                                    <li key={it.id} className="flex items-start gap-3 rounded-md border border-slate-100 bg-slate-50/40 p-2.5">
                                        <div className="flex-shrink-0 h-14 w-14 rounded-md overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
                                            {it.product_image ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={it.product_image} alt={it.product_name ?? 'product'} className="h-full w-full object-cover" />
                                            ) : (
                                                <Package className="h-5 w-5 text-slate-300" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-900 truncate">{it.product_name ?? it.sku ?? shortId(it.variant_id)}</p>
                                            {it.variant_name && <p className="text-[11px] text-slate-500 truncate">{it.variant_name}</p>}
                                            <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                                                <div><span className="text-slate-400">Affected</span><div className="text-slate-900 font-medium tabular-nums">{affected}</div></div>
                                                <div><span className="text-slate-400">Unit Cost</span><div className="text-slate-900 tabular-nums">{cost != null ? cost.toFixed(2) : '—'}</div></div>
                                                <div><span className="text-slate-400">Est. Impact</span><div className="text-slate-900 font-semibold tabular-nums">{estImpact != null ? estImpact.toFixed(2) : '—'}</div></div>
                                            </div>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    ) : (
                        <p className="text-xs text-slate-400">No item lines recorded.</p>
                    )}
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Reported By</p>
                        <p className="mt-1 text-slate-800">{issue.created_by_user?.full_name ?? '—'}</p>
                        {issue.reporter_org?.org_name && <p className="text-[11px] text-slate-500">{issue.reporter_org.org_name}</p>}
                    </div>
                    <div>
                        <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Manufacturer</p>
                        <p className="mt-1 text-slate-800">{issue.manufacturer_org?.org_name ?? <span className="font-mono text-xs text-slate-700">{shortId(issue.target_manufacturer_org_id)}</span>}</p>
                    </div>
                </div>

                {/* Reason / notes */}
                <div>
                    <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Reason / Notes</p>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{issue.notes || <span className="text-slate-400 italic">No notes provided.</span>}</p>
                </div>

                {/* Evidence */}
                <div>
                    <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide mb-1.5">Evidence</p>
                    {issue.proof_images && issue.proof_images.length > 0 ? (
                        <div className="grid grid-cols-4 gap-2">
                            {issue.proof_images.map(url => (
                                <Dialog key={url}>
                                    <DialogTrigger asChild>
                                        <button className="relative rounded-md overflow-hidden border border-slate-200 aspect-square bg-slate-50 hover:opacity-90 transition-opacity">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={url} alt="evidence" className="w-full h-full object-cover" />
                                        </button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-black/80 border-none">
                                        <DialogTitle className="sr-only">Evidence image</DialogTitle>
                                        <div className="flex items-center justify-center w-full h-full">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={url} alt="evidence full" className="max-w-full max-h-[90vh] object-contain" />
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <ImageIcon className="h-3.5 w-3.5" />No attachments
                        </div>
                    )}
                </div>

                {/* Manufacturer response */}
                <div>
                    <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Manufacturer Response</p>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                        {issue.manufacturer_notes || <span className="text-slate-400 italic">No response yet.</span>}
                    </p>
                </div>

                {/* Timeline */}
                <div>
                    <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide mb-2">Timeline</p>
                    <ol className="relative border-l border-slate-200 ml-2 space-y-3">
                        <TimelineEvent label="Reported" date={issue.created_at} tone="blue" />
                        {issue.manufacturer_assigned_at && (
                            <TimelineEvent label="Assigned to Manufacturer" date={issue.manufacturer_assigned_at} tone="amber" />
                        )}
                        {issue.manufacturer_acknowledged_at && (
                            <TimelineEvent label="Acknowledged" date={issue.manufacturer_acknowledged_at} tone="emerald" />
                        )}
                        {issue.status === 'resolved' && (
                            <TimelineEvent label="Resolved" date={issue.manufacturer_acknowledged_at ?? issue.created_at} tone="emerald" />
                        )}
                        {(issue.status === 'rejected' || issue.manufacturer_status === 'rejected') && (
                            <TimelineEvent label="Rejected" date={issue.manufacturer_acknowledged_at ?? issue.created_at} tone="red" />
                        )}
                    </ol>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
                    {canAck && (
                        <Button
                            size="sm"
                            onClick={() => onAck(issue.id)}
                            disabled={ackLoadingId === issue.id}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            {ackLoadingId === issue.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                            Acknowledge
                        </Button>
                    )}
                    {profile.role_code === 'SA' && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSetStatus(issue.id)}
                            disabled={statusLoadingId === issue.id}
                        >
                            {statusLoadingId === issue.id && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                            Set Final Status
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

function TimelineEvent({ label, date, tone }: { label: string; date: string | null; tone: 'blue' | 'amber' | 'emerald' | 'red' }) {
    const dot = {
        blue: 'bg-blue-500',
        amber: 'bg-amber-500',
        emerald: 'bg-emerald-500',
        red: 'bg-red-500',
    }[tone]
    return (
        <li className="ml-3">
            <span className={cn('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', dot)} />
            <p className="text-sm font-medium text-slate-800">{label}</p>
            <p className="text-[11px] text-slate-500">{formatDate(date)}</p>
        </li>
    )
}

// ─────────────────────── Create Issue Modal ───────────────────────
interface VariantOption {
    id: string
    product_id: string
    product_name: string
    product_code: string | null
    variant_name: string | null
    variant_code: string | null
    manufacturer_sku: string | null
    barcode: string | null
    manufacturer_id: string | null
    manufacturer_name?: string | null
    image_url: string | null
    base_cost: number | null
    attributes?: Record<string, any> | null
}

function formatCurrency(amount?: number | null) {
    const numeric = Number(amount || 0)
    return numeric.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function collectAttributeValues(value: unknown): string[] {
    if (value == null) return []
    if (Array.isArray(value)) return value.flatMap(collectAttributeValues)
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(collectAttributeValues)
    return [String(value)]
}

function getAttributeSummary(attributes?: Record<string, any> | null) {
    const values = Array.from(new Set(collectAttributeValues(attributes).map(v => v.trim()).filter(Boolean)))
    return values.slice(0, 3).join(' • ')
}

function getVariantSkuLabel(variant: VariantOption) {
    return variant.manufacturer_sku || variant.variant_code || variant.product_code || variant.barcode || '—'
}

function buildVariantSearchText(variant: VariantOption) {
    return [
        variant.product_name,
        variant.product_code,
        variant.variant_name,
        variant.variant_code,
        variant.manufacturer_sku,
        variant.barcode,
        variant.manufacturer_name,
        ...collectAttributeValues(variant.attributes),
    ].filter(Boolean).join(' ').toLowerCase()
}

function CreateIssueModal({
    open, onOpenChange, userProfile, onCreated,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    userProfile: UserProfile
    onCreated: () => void
}) {
    const supabase = useMemo(() => createClient(), [])
    const [reasonCode, setReasonCode] = useState<'quality_issue' | 'return_to_supplier' | 'damaged_goods'>('quality_issue')
    const [allVariants, setAllVariants] = useState<VariantOption[]>([])
    const [selectedProductFilter, setSelectedProductFilter] = useState('all')
    const [variantSearch, setVariantSearch] = useState('')
    const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null)
    const [quantity, setQuantity] = useState<string>('1')
    const [unitCost, setUnitCost] = useState<string>('')
    const [notes, setNotes] = useState('')
    const [files, setFiles] = useState<File[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [variantLoading, setVariantLoading] = useState(false)
    const [variantLoadError, setVariantLoadError] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Reset on close
    useEffect(() => {
        if (!open) {
            setReasonCode('quality_issue'); setVariantSearch(''); setAllVariants([]); setSelectedProductFilter('all')
            setSelectedVariant(null); setQuantity('1'); setUnitCost(''); setNotes('')
            setFiles([]); setError(null); setSubmitting(false)
            setVariantLoading(false); setVariantLoadError(null)
        }
    }, [open])

    // Load active variants once when the modal opens, then filter in memory.
    useEffect(() => {
        if (!open) return
        let cancelled = false
        async function loadVariants() {
            setVariantLoading(true)
            setVariantLoadError(null)
            try {
                const { data, error } = await (supabase as any)
                    .from('product_variants')
                    .select('id, product_id, variant_name, variant_code, manufacturer_sku, barcode, base_cost, image_url, attributes, is_active, products!inner(id, product_name, product_code, manufacturer_id)')
                    .eq('is_active', true)
                    .order('variant_name', { ascending: true })

                if (cancelled) return
                if (error) throw error

                const manufacturerIds = Array.from(new Set((data || []).map((variant: any) => variant.products?.manufacturer_id).filter(Boolean))) as string[]
                let manufacturerNames: Record<string, string> = {}
                if (manufacturerIds.length > 0) {
                    const { data: manufacturers, error: manufacturersError } = await (supabase as any)
                        .from('organizations')
                        .select('id, org_name')
                        .in('id', manufacturerIds)
                    if (manufacturersError) throw manufacturersError
                    manufacturerNames = Object.fromEntries((manufacturers || []).map((manufacturer: any) => [manufacturer.id, manufacturer.org_name]))
                }

                const variants: VariantOption[] = (data || []).map((variant: any) => ({
                    id: variant.id,
                    product_id: variant.products.id,
                    product_name: variant.products.product_name,
                    product_code: variant.products.product_code || null,
                    variant_name: variant.variant_name,
                    variant_code: variant.variant_code || null,
                    manufacturer_sku: variant.manufacturer_sku || null,
                    barcode: variant.barcode || null,
                    manufacturer_id: variant.products.manufacturer_id || null,
                    manufacturer_name: variant.products.manufacturer_id ? manufacturerNames[variant.products.manufacturer_id] || null : null,
                    image_url: variant.image_url || null,
                    base_cost: variant.base_cost != null ? Number(variant.base_cost) : null,
                    attributes: variant.attributes || null,
                })).sort((left, right) => {
                    const productCompare = left.product_name.localeCompare(right.product_name)
                    if (productCompare !== 0) return productCompare
                    return (left.variant_name || '').localeCompare(right.variant_name || '')
                })

                setAllVariants(variants)
            } catch (loadError) {
                console.error('Failed to load issue variants', loadError)
                if (!cancelled) {
                    setAllVariants([])
                    setVariantLoadError('Unable to load products right now. Please try again.')
                }
            } finally {
                if (!cancelled) setVariantLoading(false)
            }
        }

        loadVariants()
        return () => { cancelled = true }
    }, [open, supabase])

    const productOptions = useMemo(() => {
        const counts = new Map<string, { id: string; name: string; count: number }>()
        allVariants.forEach((variant) => {
            const current = counts.get(variant.product_id)
            if (current) {
                current.count += 1
            } else {
                counts.set(variant.product_id, {
                    id: variant.product_id,
                    name: variant.product_name,
                    count: 1,
                })
            }
        })
        return Array.from(counts.values()).sort((left, right) => left.name.localeCompare(right.name))
    }, [allVariants])

    const filteredVariantOptions = useMemo(() => {
        const searchLower = variantSearch.trim().toLowerCase()
        return allVariants.filter((variant) => {
            if (selectedProductFilter !== 'all' && variant.product_id !== selectedProductFilter) return false
            if (!searchLower) return true
            return buildVariantSearchText(variant).includes(searchLower)
        })
    }, [allVariants, selectedProductFilter, variantSearch])

    function addFiles(list: FileList | null) {
        if (!list) return
        const arr: File[] = []
        for (let i = 0; i < list.length; i++) arr.push(list.item(i)!)
        setFiles(prev => [...prev, ...arr])
    }
    function removeFile(idx: number) { setFiles(prev => prev.filter((_, i) => i !== idx)) }

    async function uploadEvidence(): Promise<string[]> {
        if (files.length === 0) return []
        const urls: string[] = []
        for (const f of files) {
            const ext = f.name.split('.').pop() || 'bin'
            const fileName = `${userProfile.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
            const path = `quality_issues/${fileName}`
            const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { cacheControl: '3600', upsert: false })
            if (upErr) throw upErr
            const { data } = supabase.storage.from('documents').getPublicUrl(path)
            urls.push(data.publicUrl)
        }
        return urls
    }

    async function submit() {
        setError(null)
        if (!selectedVariant) { setError('Please select a product variant'); return }
        const qty = Number(quantity)
        if (!qty || qty <= 0) { setError('Quantity affected must be greater than 0'); return }
        if (!notes.trim()) { setError('Please describe the issue'); return }
        setSubmitting(true)
        try {
            const proofImages = await uploadEvidence()
            const resp = await fetch('/api/manufacturer/adjustments/create', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    reason_code: reasonCode,
                    variant_id: selectedVariant.id,
                    target_manufacturer_org_id: selectedVariant.manufacturer_id,
                    quantity_affected: qty,
                    unit_cost: unitCost ? Number(unitCost) : null,
                    notes: notes.trim(),
                    proof_images: proofImages,
                }),
            })
            const json = await resp.json()
            if (!resp.ok) { setError(json.error || 'Unable to create the issue right now'); return }
            onCreated()
        } catch (e: any) {
            setError(e?.message || 'Unable to create the issue right now')
        } finally { setSubmitting(false) }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Issue</DialogTitle>
                    <DialogDescription>
                        Log a new quality or return-to-supplier case. The manufacturer will be notified to acknowledge.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Issue type */}
                    <div>
                        <label className="text-xs font-medium text-slate-700">Issue Type</label>
                        <Select value={reasonCode} onValueChange={(v: any) => setReasonCode(v)}>
                            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="quality_issue">Quality Issue</SelectItem>
                                <SelectItem value="return_to_supplier">Return to Supplier</SelectItem>
                                <SelectItem value="damaged_goods">Damaged Goods</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Product picker */}
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-slate-700">Filter by Product</label>
                            <Select value={selectedProductFilter} onValueChange={setSelectedProductFilter}>
                                <SelectTrigger className="mt-1 h-9">
                                    <SelectValue placeholder="Choose a product" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Products ({allVariants.length})</SelectItem>
                                    {productOptions.map((product) => (
                                        <SelectItem key={product.id} value={product.id}>
                                            {product.name} ({product.count})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <label className="text-xs font-medium text-slate-700">Search Variant</label>
                            <div className="relative mt-1">
                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                    placeholder="Search by product, variant, SKU, or attributes…"
                                    value={variantSearch}
                                    onChange={(event) => setVariantSearch(event.target.value)}
                                    className="h-9 pl-8"
                                />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">
                                {filteredVariantOptions.length} of {allVariants.length} active variants available
                            </p>
                        </div>

                        <div>
                            <label className="text-xs font-medium text-slate-700">Select Variant *</label>
                            <div className="mt-1 overflow-hidden rounded-md border border-slate-200 bg-white">
                                {variantLoading ? (
                                    <div className="flex items-center gap-2 p-3 text-xs text-slate-500">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading active variants…
                                    </div>
                                ) : variantLoadError ? (
                                    <div className="flex items-start gap-2 p-3 text-xs text-red-700 bg-red-50/70">
                                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{variantLoadError}
                                    </div>
                                ) : filteredVariantOptions.length === 0 ? (
                                    <div className="p-3 text-xs text-slate-500">
                                        No variants match the current product filter or search.
                                    </div>
                                ) : (
                                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                                        {filteredVariantOptions.map((variant) => {
                                            const attributeSummary = getAttributeSummary(variant.attributes)
                                            const isSelected = selectedVariant?.id === variant.id
                                            return (
                                                <button
                                                    key={variant.id}
                                                    type="button"
                                                    onClick={() => { setSelectedVariant(variant); setError(null) }}
                                                    className={cn(
                                                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                                                        isSelected ? 'bg-orange-50' : 'hover:bg-slate-50',
                                                    )}
                                                >
                                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                                                        {variant.image_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={variant.image_url} alt="" className="h-full w-full object-cover" />
                                                        ) : (
                                                            <Package className="h-4 w-4 text-slate-300" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium text-slate-900">{variant.product_name}</p>
                                                        <p className="truncate text-xs text-slate-600">
                                                            {variant.variant_name || 'Standard variant'}
                                                            {attributeSummary ? ` · ${attributeSummary}` : ''}
                                                        </p>
                                                        <p className="truncate text-[11px] text-slate-500">
                                                            SKU {getVariantSkuLabel(variant)}
                                                            {variant.manufacturer_name ? ` · ${variant.manufacturer_name}` : ''}
                                                        </p>
                                                    </div>
                                                    <div className="flex-shrink-0 text-right">
                                                        {variant.base_cost != null && (
                                                            <p className="text-xs font-semibold text-slate-900">RM {formatCurrency(variant.base_cost)}</p>
                                                        )}
                                                        <p className={cn('text-[11px] font-medium', isSelected ? 'text-orange-700' : 'text-slate-400')}>
                                                            {isSelected ? 'Selected' : 'Select'}
                                                        </p>
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {selectedVariant && (
                            <div className="rounded-md border border-orange-200 bg-orange-50/70 p-3">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-orange-200 bg-white">
                                        {selectedVariant.image_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={selectedVariant.image_url} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <Package className="h-5 w-5 text-slate-300" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Selected Product</p>
                                        <p className="truncate text-sm font-semibold text-slate-900">{selectedVariant.product_name}</p>
                                        <p className="truncate text-xs text-slate-600">
                                            {selectedVariant.variant_name || 'Standard variant'}
                                            {getAttributeSummary(selectedVariant.attributes) ? ` · ${getAttributeSummary(selectedVariant.attributes)}` : ''}
                                        </p>
                                        <p className="truncate text-[11px] text-slate-500">
                                            SKU {getVariantSkuLabel(selectedVariant)}
                                            {selectedVariant.manufacturer_name ? ` • Manufacturer: ${selectedVariant.manufacturer_name}` : ''}
                                        </p>
                                        {selectedVariant.base_cost != null && (
                                            <p className="mt-1 text-[11px] text-slate-500">Base cost: RM {formatCurrency(selectedVariant.base_cost)}</p>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedVariant(null)}>
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-700">Quantity Affected *</label>
                            <Input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 h-9" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-700">Unit Cost (optional)</label>
                            <Input type="number" step="0.01" min={0} value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.00" className="mt-1 h-9" />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-slate-700">Description / Notes *</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Describe the defect or reason for return…"
                            className="mt-1 w-full h-24 rounded-md border border-slate-200 p-2 text-sm"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-slate-700">Evidence Attachments</label>
                        <div className="mt-1 flex items-center gap-2">
                            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-700">
                                <Upload className="h-3.5 w-3.5" />Upload
                                <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={e => addFiles(e.target.files)} />
                            </label>
                            <span className="text-[11px] text-slate-500">{files.length} file{files.length === 1 ? '' : 's'} attached</span>
                        </div>
                        {files.length > 0 && (
                            <ul className="mt-2 grid grid-cols-3 gap-2">
                                {files.map((f, i) => (
                                    <li key={i} className="relative rounded-md border border-slate-200 p-1.5 text-[10px] text-slate-700 truncate">
                                        <button onClick={() => removeFile(i)} className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/70 text-white h-4 w-4 flex items-center justify-center">
                                            <X className="h-2.5 w-2.5" />
                                        </button>
                                        <div className="truncate pr-4">{f.name}</div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {error && (
                        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{error}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting} className="bg-orange-600 hover:bg-orange-700 text-white">
                        {submitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                        Create Issue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

