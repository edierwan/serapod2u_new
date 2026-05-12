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
    Calendar, Image as ImageIcon, ExternalLink, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface UserProfile { id: string; organization_id?: string; role_code?: string }

interface AdjustmentItem {
    id: string
    variant_id: string | null
    adjustment_quantity: number
    product_name?: string | null
    sku?: string | null
}

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
    created_by_user: { full_name: string } | null
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
            if (i.target_manufacturer_org_id) set.set(i.target_manufacturer_org_id, shortId(i.target_manufacturer_org_id))
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
                    <Button size="sm" disabled title="Manual issue logging not available yet" className="bg-orange-600 hover:bg-orange-700 text-white">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Log Manual Issue
                    </Button>
                </div>
            </div>

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
                        <EmptyState forSA={isSA} />
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
function EmptyState({ forSA }: { forSA: boolean }) {
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
                    <Button size="sm" disabled title="Manual issue logging not available yet">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Log Manual Issue
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
                        <ul className="space-y-1.5">
                            {issue.stock_adjustment_items.map(it => (
                                <li key={it.id} className="flex items-center justify-between text-sm rounded-md border border-slate-100 bg-slate-50/40 px-2.5 py-1.5">
                                    <span className="font-mono text-xs text-slate-700 truncate max-w-[200px]">
                                        {it.product_name ?? it.sku ?? shortId(it.variant_id)}
                                    </span>
                                    <span className="tabular-nums text-sm font-medium text-slate-900">{it.adjustment_quantity}</span>
                                </li>
                            ))}
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
                    </div>
                    <div>
                        <p className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">Manufacturer</p>
                        <p className="mt-1 font-mono text-xs text-slate-700">{shortId(issue.target_manufacturer_org_id)}</p>
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
