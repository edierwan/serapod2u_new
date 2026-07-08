'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Download, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { RETURN_STATUS_LABELS, type ReturnStatus } from '@/lib/returns/constants'
import type { ReturnCase, ReturnMeta } from '@/lib/returns/types'

interface UserProfile { id: string }

const KPI_CARDS: { key: string; label: string; color: string }[] = [
    { key: 'return_draft', label: 'Return Draft', color: 'text-slate-600' },
    { key: 'return_submitted', label: 'Return Submitted', color: 'text-blue-600' },
    { key: 'return_received', label: 'Return Received', color: 'text-amber-600' },
    { key: 'return_processing', label: 'Return Processing', color: 'text-indigo-600' },
    { key: 'completed_this_month', label: 'Completed This Month', color: 'text-emerald-600' },
    { key: 'overdue', label: 'Overdue Returns', color: 'text-red-600' },
]

export default function ReturnReportingView({ userProfile: _userProfile }: { userProfile: UserProfile }) {
    const { toast } = useToast()
    const [meta, setMeta] = useState<ReturnMeta | null>(null)
    const [kpi, setKpi] = useState<Record<string, number>>({})
    const [cases, setCases] = useState<ReturnCase[]>([])
    const [loading, setLoading] = useState(true)
    const [exporting, setExporting] = useState(false)

    const [filters, setFilters] = useState({ from: '', to: '', status: 'all', shop: 'all', warehouse: 'all', reason: 'all', search: '' })

    const queryString = useCallback(() => {
        const p = new URLSearchParams()
        if (filters.from) p.set('from', filters.from)
        if (filters.to) p.set('to', filters.to)
        if (filters.status !== 'all') p.set('status', filters.status)
        if (filters.shop !== 'all') p.set('shop', filters.shop)
        if (filters.warehouse !== 'all') p.set('warehouse', filters.warehouse)
        if (filters.reason !== 'all') p.set('reason', filters.reason)
        if (filters.search.trim()) p.set('search', filters.search.trim())
        return p.toString()
    }, [filters])

    const loadMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/returns/meta')
            const json = await res.json()
            if (res.ok) setMeta(json)
        } catch { /* non-fatal */ }
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/returns/reporting?${queryString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setKpi(json.kpi || {})
            setCases(json.cases || [])
        } catch (e: any) {
            toast({ title: 'Failed to load report', description: e.message, variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [queryString, toast])

    useEffect(() => { loadMeta() }, [loadMeta])
    useEffect(() => { load() }, [load])

    const exportExcel = async () => {
        setExporting(true)
        try {
            const res = await fetch(`/api/returns/reporting/export?${queryString()}`)
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `return-report-${new Date().toISOString().slice(0, 10)}.xlsx`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e: any) {
            toast({ title: 'Export failed', description: e.message, variant: 'destructive' })
        } finally {
            setExporting(false)
        }
    }

    const reasonLabel = useMemo(() => {
        const map: Record<string, string> = {}
        for (const r of meta?.reasons || []) map[r.code] = r.label
        return map
    }, [meta])

    return (
        <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Return Reporting</h1>
                    <p className="text-sm text-muted-foreground">Overview and status of product returns.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
                    <Button variant="outline" onClick={exportExcel} disabled={exporting} className="gap-1.5">
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Excel
                    </Button>
                </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {KPI_CARDS.map((c) => (
                    <div key={c.key} className="rounded-lg border border-border bg-card p-3">
                        <div className={cn('text-2xl font-semibold', c.color)}>{kpi[c.key] ?? 0}</div>
                        <div className="text-xs text-muted-foreground">{c.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-4 lg:grid-cols-7">
                <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} title="From" />
                <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} title="To" />
                <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                    <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        {Object.entries(RETURN_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filters.shop} onValueChange={(v) => setFilters({ ...filters, shop: v })}>
                    <SelectTrigger><SelectValue placeholder="Shop" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Shops</SelectItem>
                        {(meta?.shops || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.org_name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filters.warehouse} onValueChange={(v) => setFilters({ ...filters, warehouse: v })}>
                    <SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Warehouses</SelectItem>
                        {(meta?.warehouses || []).map((w) => <SelectItem key={w.id} value={w.id}>{w.org_name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filters.reason} onValueChange={(v) => setFilters({ ...filters, reason: v })}>
                    <SelectTrigger><SelectValue placeholder="Reason" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Reasons</SelectItem>
                        {(meta?.reasons || []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Return no / SKU / product" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="pl-8" />
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Return No</th>
                            <th className="px-3 py-2 font-medium">Shop</th>
                            <th className="px-3 py-2 font-medium">Warehouse</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 text-right font-medium">Total Qty</th>
                            <th className="px-3 py-2 text-right font-medium">Total Value</th>
                            <th className="px-3 py-2 font-medium">Created</th>
                            <th className="px-3 py-2 font-medium">Updated</th>
                            <th className="px-3 py-2 text-right font-medium">Days Open</th>
                            <th className="px-3 py-2 font-medium">Overdue</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading ? (
                            <tr><td colSpan={10} className="px-3 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                        ) : cases.length === 0 ? (
                            <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No returns match the filters.</td></tr>
                        ) : cases.map((c) => (
                            <tr key={c.id} className="hover:bg-accent/50">
                                <td className="px-3 py-2 font-medium text-foreground">{c.return_no}</td>
                                <td className="px-3 py-2">{c.shop?.org_name || '—'}</td>
                                <td className="px-3 py-2">{c.warehouse?.org_name || '—'}</td>
                                <td className="px-3 py-2">{RETURN_STATUS_LABELS[c.status as ReturnStatus] || c.status}</td>
                                <td className="px-3 py-2 text-right">{c.total_qty ?? 0}</td>
                                <td className="px-3 py-2 text-right">RM {Number(c.total_value ?? 0).toFixed(2)}</td>
                                <td className="px-3 py-2 text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleDateString('en-MY') : '—'}</td>
                                <td className="px-3 py-2 text-muted-foreground">{c.updated_at ? new Date(c.updated_at).toLocaleDateString('en-MY') : '—'}</td>
                                <td className="px-3 py-2 text-right">{c.days_open ?? 0}</td>
                                <td className="px-3 py-2">{c.is_overdue ? <Badge variant="destructive" className="text-[10px]">Overdue</Badge> : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
