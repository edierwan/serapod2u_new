'use client'

/**
 * Return Product Reports — management dashboard.
 *
 * Monthly / Quarterly reporting with previous-period comparison, management
 * KPIs, charts, breakdown tables, deterministic key insights, Excel export,
 * PDF preview/download and email delivery. All figures come from the
 * server-side aggregate at /api/returns/reporting/summary — nothing is
 * hardcoded and the browser never loads raw return items.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Loader2, RefreshCw, Download, Search, Mail, FileText, Eye, RotateCcw,
    Package, Boxes, Banknote, TrendingUp, Clock, CheckCircle2, ArrowUpRight,
    ArrowDownRight, Minus, ChevronLeft, ChevronRight, ChevronDown, Lightbulb,
} from 'lucide-react'
import {
    ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip as ChartTooltip, Legend, PieChart, Pie, Cell, BarChart, Bar, LabelList,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    RETURN_STATUS_LABELS, RETURN_SOURCE_LABELS, normalizeReturnSourceType,
    type ReturnStatus, type ReturnSourceType,
} from '@/lib/returns/constants'
import type { ReturnMeta, OrgRef } from '@/lib/returns/types'
import { normalizeReturnMeta } from '@/lib/returns/meta'
import {
    currentPeriod, previousPeriod, periodLabel, deltaText, formatRM, formatCount,
    reportFilename, MONTH_NAMES,
    type ReportMode, type ReportPeriod, type ReturnReportSummary, type ReportCaseRow, type KpiDelta,
} from '@/lib/returns/reporting'
import { buildReturnReportPdf, type ReturnReportPdf } from '@/lib/returns/report-pdf'
import { ReturnSourceCombobox } from './ReturnSourceCombobox'
import { ReturnReportEmailDialog } from './ReturnReportEmailDialog'

interface UserProfile { id: string }

interface SummaryResponse extends ReturnReportSummary {
    cases: ReportCaseRow[]
    generatedBy: string | null
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#94a3b8', '#ef4444', '#06b6d4', '#f97316']

const STATUS_BADGE: Record<string, string> = {
    return_draft: 'bg-slate-100 text-slate-700',
    return_submitted: 'bg-blue-100 text-blue-700',
    return_received: 'bg-amber-100 text-amber-700',
    return_processing: 'bg-indigo-100 text-indigo-700',
    return_completed: 'bg-emerald-100 text-emerald-700',
    return_cancelled: 'bg-red-100 text-red-700',
}

// ── KPI card ────────────────────────────────────────────────────────────────

/**
 * How a change should be coloured: 'neutral' KPIs (volume/value) are shown in
 * muted ink; for 'downIsGood' (overdue) an increase is red; for 'upIsGood'
 * (completion rate) a decrease is red.
 */
type DeltaSentiment = 'neutral' | 'downIsGood' | 'upIsGood'

function deltaColorClass(delta: KpiDelta, sentiment: DeltaSentiment): string {
    if (delta.direction === 'flat' || sentiment === 'neutral') return 'text-muted-foreground'
    const isGood = sentiment === 'downIsGood' ? delta.direction === 'down' : delta.direction === 'up'
    return isGood ? 'text-emerald-600' : 'text-red-600'
}

function DeltaLine({ delta, comparisonLabel, sentiment }: { delta: KpiDelta; comparisonLabel: string; sentiment: DeltaSentiment }) {
    const Icon = delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus
    return (
        <div className={cn('flex items-center gap-1 text-xs', deltaColorClass(delta, sentiment))}>
            <Icon className="h-3 w-3 shrink-0" />
            <span>{deltaText(delta, comparisonLabel).replace(/^[↑↓]\s*/, '')}</span>
        </div>
    )
}

function KpiCard({ icon: Icon, iconClass, label, value, delta, comparisonLabel, sentiment }: {
    icon: any
    iconClass: string
    label: string
    value: string
    delta: KpiDelta
    comparisonLabel: string
    sentiment: DeltaSentiment
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', iconClass)}>
                    <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="truncate text-xl font-semibold text-foreground">{value}</div>
                    <DeltaLine delta={delta} comparisonLabel={comparisonLabel} sentiment={sentiment} />
                </div>
            </div>
        </div>
    )
}

// ── Main view ───────────────────────────────────────────────────────────────

export default function ReturnReportingView({ userProfile: _userProfile, onViewChange }: {
    userProfile: UserProfile
    onViewChange?: (view: string) => void
}) {
    const { toast } = useToast()
    const now = useMemo(() => new Date(), [])

    // Report period
    const [mode, setMode] = useState<ReportMode>('monthly')
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)
    const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1)
    /** null = default (immediately preceding period). */
    const [cmpOverride, setCmpOverride] = useState<ReportPeriod | null>(null)

    const period: ReportPeriod = useMemo(() => ({ mode, year, month, quarter }), [mode, year, month, quarter])
    const comparison: ReportPeriod = useMemo(
        () => cmpOverride ? { ...cmpOverride, mode } : previousPeriod(period),
        [cmpOverride, period, mode],
    )

    // Filters
    const [filters, setFilters] = useState({ sourceType: 'all', source: 'all', warehouse: 'all', reason: 'all', status: 'all' })
    const [sourceFilterOrg, setSourceFilterOrg] = useState<OrgRef | null>(null)

    // Data
    const [meta, setMeta] = useState<ReturnMeta | null>(null)
    const [data, setData] = useState<SummaryResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    // Action states
    const [exporting, setExporting] = useState(false)
    const [pdfBusy, setPdfBusy] = useState(false)
    const [emailOpen, setEmailOpen] = useState(false)
    const [showAllReasons, setShowAllReasons] = useState(false)
    const [showAllSources, setShowAllSources] = useState(false)

    // Detailed table state
    const [search, setSearch] = useState('')
    const [sortKey, setSortKey] = useState<keyof ReportCaseRow>('created_at')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [page, setPage] = useState(1)
    const PAGE_SIZE = 10
    const detailRef = useRef<HTMLDivElement>(null)

    const queryString = useCallback(() => {
        const p = new URLSearchParams()
        p.set('mode', mode)
        p.set('year', String(year))
        if (mode === 'monthly') p.set('month', String(month))
        else p.set('quarter', String(quarter))
        p.set('cmp_year', String(comparison.year))
        if (mode === 'monthly') p.set('cmp_month', String(comparison.month))
        else p.set('cmp_quarter', String(comparison.quarter))
        if (filters.sourceType !== 'all') p.set('source_type', filters.sourceType)
        if (filters.source !== 'all') p.set('source', filters.source)
        if (filters.warehouse !== 'all') p.set('warehouse', filters.warehouse)
        if (filters.reason !== 'all') p.set('reason', filters.reason)
        if (filters.status !== 'all') p.set('status', filters.status)
        return p.toString()
    }, [mode, year, month, quarter, comparison, filters])

    const loadMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/returns/meta')
            const json = await res.json()
            if (res.ok) setMeta(normalizeReturnMeta(json))
        } catch { /* non-fatal */ }
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const res = await fetch(`/api/returns/reporting/summary?${queryString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load the report')
            setData(json)
            setPage(1)
        } catch (e: any) {
            setLoadError(e.message)
        } finally {
            setLoading(false)
        }
    }, [queryString])

    useEffect(() => { loadMeta() }, [loadMeta])
    useEffect(() => { load() }, [load])

    const resetFilters = () => {
        setFilters({ sourceType: 'all', source: 'all', warehouse: 'all', reason: 'all', status: 'all' })
        setSourceFilterOrg(null)
        setCmpOverride(null)
        setSearch('')
    }

    // ── Period / comparison selectors ───────────────────────────────────────

    const availableYears = data?.availableYears?.length
        ? data.availableYears
        : [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

    /** Comparison candidates: the 12 periods immediately before the selected one, plus the same period last year. */
    const comparisonOptions = useMemo(() => {
        const options: ReportPeriod[] = []
        let cursor = previousPeriod(period)
        for (let i = 0; i < 12; i++) {
            options.push(cursor)
            cursor = previousPeriod(cursor)
        }
        const lastYear = { ...period, year: period.year - 1 }
        if (!options.some((o) => periodLabel(o) === periodLabel(lastYear))) options.push(lastYear)
        return options
    }, [period])

    const comparisonValue = periodLabel(comparison)

    // ── Exports ─────────────────────────────────────────────────────────────

    const exportExcel = async () => {
        setExporting(true)
        try {
            const res = await fetch(`/api/returns/reporting/export?${queryString()}`)
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = reportFilename(period, 'xlsx')
            a.click()
            URL.revokeObjectURL(url)
        } catch (e: any) {
            toast({ title: 'Export failed', description: e.message, variant: 'destructive' })
        } finally {
            setExporting(false)
        }
    }

    const buildPdf = useCallback(async (): Promise<ReturnReportPdf> => {
        if (!data) throw new Error('The report has not loaded yet')
        return buildReturnReportPdf({ summary: data, cases: data.cases, generatedBy: data.generatedBy })
    }, [data])

    const handlePdf = async (action: 'preview' | 'download') => {
        if (!data || pdfBusy) return
        setPdfBusy(true)
        try {
            const pdf = await buildPdf()
            const url = URL.createObjectURL(pdf.blob)
            if (action === 'preview') {
                window.open(url, '_blank')
                setTimeout(() => URL.revokeObjectURL(url), 60_000)
            } else {
                const a = document.createElement('a')
                a.href = url
                a.download = pdf.filename
                a.click()
                URL.revokeObjectURL(url)
            }
        } catch (e: any) {
            toast({ title: 'PDF failed', description: e.message, variant: 'destructive' })
        } finally {
            setPdfBusy(false)
        }
    }

    const emailDefaults = useMemo(() => {
        const pl = data?.periodLabel || periodLabel(period)
        const k = data?.kpis
        const generatedDate = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'long', year: 'numeric' })
        return {
            subject: `Return Product Report for ${pl}`,
            message: [
                'Dear Management,',
                '',
                `Please find attached the Return Product Report for ${pl}.`,
                '',
                'Report summary:',
                `- Total Returns: ${formatCount(k?.totalReturns || 0)}`,
                `- Total Quantity: ${formatCount(k?.totalQty || 0)}`,
                `- Total Return Value: ${formatRM(k?.totalValue || 0)}`,
                `- Completed Returns: ${formatCount(k?.completed || 0)}`,
                `- Overdue Returns: ${formatCount(k?.overdue || 0)}`,
                '',
                `This report was generated from Serapod2U on ${generatedDate}.`,
                '',
                'Regards,',
                'Serapod2U Reporting',
            ].join('\n'),
        }
    }, [data, period])

    // ── Detailed table derivation ───────────────────────────────────────────

    const detailedRows = useMemo(() => {
        let rows = data?.cases || []
        const q = search.trim().toLowerCase()
        if (q) {
            rows = rows.filter((r) =>
                r.return_no.toLowerCase().includes(q)
                || (r.source_name || '').toLowerCase().includes(q)
                || (r.source_code || '').toLowerCase().includes(q)
                || (r.warehouse_name || '').toLowerCase().includes(q)
                || (RETURN_STATUS_LABELS[r.status] || '').toLowerCase().includes(q),
            )
        }
        const dir = sortDir === 'asc' ? 1 : -1
        return [...rows].sort((a, b) => {
            const av = a[sortKey]
            const bv = b[sortKey]
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
            return String(av ?? '').localeCompare(String(bv ?? '')) * dir
        })
    }, [data, search, sortKey, sortDir])

    const pageCount = Math.max(1, Math.ceil(detailedRows.length / PAGE_SIZE))
    const pageRows = detailedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    useEffect(() => { setPage(1) }, [search, sortKey, sortDir])

    const toggleSort = (key: keyof ReportCaseRow) => {
        if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
        else { setSortKey(key); setSortDir('desc') }
    }

    const openCase = (id: string) => {
        if (!onViewChange) return
        sessionStorage.setItem('openReturnCaseId', id)
        onViewChange('return-product')
    }

    const scrollToDetail = () => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // ── Render helpers ──────────────────────────────────────────────────────

    const comparisonLabel = data?.comparisonLabel || periodLabel(comparison)
    const noData = !loading && !loadError && (data?.kpis.totalReturns || 0) === 0
    const busy = loading || !data

    const SortHeader = ({ label, k, align = 'left' }: { label: string; k: keyof ReportCaseRow; align?: 'left' | 'right' }) => (
        <th
            className={cn('cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground', align === 'right' && 'text-right')}
            onClick={() => toggleSort(k)}
        >
            {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
        </th>
    )

    return (
        <div className="w-full space-y-4">
            {/* Header */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Return Product Reports</h1>
                    <p className="text-sm text-muted-foreground">
                        {mode === 'monthly' ? 'Monthly' : 'Quarterly'} overview of return product performance and trends.
                        <span className="ml-2 font-medium text-foreground">Period: {periodLabel(period)}</span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Tabs value={mode} onValueChange={(v) => { setMode(v as ReportMode); setCmpOverride(null) }}>
                        <TabsList className="h-9">
                            <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                            <TabsTrigger value="quarterly" className="text-xs">Quarterly</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    {mode === 'monthly' ? (
                        <Select value={String(month)} onValueChange={(v) => { setMonth(Number(v)); setCmpOverride(null) }}>
                            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Select value={String(quarter)} onValueChange={(v) => { setQuarter(Number(v)); setCmpOverride(null) }}>
                            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">Q1 (Jan–Mar)</SelectItem>
                                <SelectItem value="2">Q2 (Apr–Jun)</SelectItem>
                                <SelectItem value="3">Q3 (Jul–Sep)</SelectItem>
                                <SelectItem value="4">Q4 (Oct–Dec)</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setCmpOverride(null) }}>
                        <SelectTrigger className="h-9 w-[92px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {availableYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} disabled={loading} title="Refresh">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </Button>
                    <Button variant="outline" className="h-9 gap-1.5" onClick={exportExcel} disabled={exporting || busy}>
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Excel
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="h-9 gap-1.5" disabled={pdfBusy || busy}>
                                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                PDF <ChevronDown className="h-3 w-3" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handlePdf('preview')} className="gap-2"><Eye className="h-4 w-4" /> Preview PDF</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePdf('download')} className="gap-2"><Download className="h-4 w-4" /> Download PDF</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button className="h-9 gap-1.5" onClick={() => setEmailOpen(true)} disabled={busy}>
                        <Mail className="h-4 w-4" /> Email Report
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="rounded-lg border border-border bg-card p-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Source Type</div>
                        <Select
                            value={filters.sourceType}
                            onValueChange={(v) => { setSourceFilterOrg(null); setFilters({ ...filters, sourceType: v, source: 'all' }) }}
                        >
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="shop">Shop</SelectItem>
                                <SelectItem value="distributor">Distributor</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Return From</div>
                        {filters.sourceType === 'shop' || filters.sourceType === 'distributor' ? (
                            <ReturnSourceCombobox
                                sourceType={filters.sourceType as ReturnSourceType}
                                value={filters.source !== 'all' ? filters.source : null}
                                selectedOrg={sourceFilterOrg}
                                onSelect={(org) => { setSourceFilterOrg(org); setFilters((f) => ({ ...f, source: org.id })) }}
                            />
                        ) : (
                            <Input className="h-9" value="All sources" readOnly disabled title="Choose a source type to filter by organization" />
                        )}
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Warehouse</div>
                        <Select value={filters.warehouse} onValueChange={(v) => setFilters({ ...filters, warehouse: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Warehouses</SelectItem>
                                {(meta?.warehouses || []).map((w) => <SelectItem key={w.id} value={w.id}>{w.org_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Return Reason</div>
                        <Select value={filters.reason} onValueChange={(v) => setFilters({ ...filters, reason: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Reasons</SelectItem>
                                {(meta?.reasons || []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Return Status</div>
                        <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                {Object.entries(RETURN_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Compare With</div>
                        <div className="flex gap-2">
                            <Select
                                value={comparisonValue}
                                onValueChange={(v) => {
                                    const match = comparisonOptions.find((o) => periodLabel(o) === v)
                                    setCmpOverride(match || null)
                                }}
                            >
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {comparisonOptions.map((o) => (
                                        <SelectItem key={periodLabel(o)} value={periodLabel(o)}>{periodLabel(o)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button variant="outline" className="h-9 shrink-0 gap-1.5" onClick={resetFilters} title="Reset filters">
                                <RotateCcw className="h-3.5 w-3.5" /> Reset
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Error / loading */}
            {loadError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
                    <p className="text-sm text-destructive">{loadError}</p>
                    <Button variant="outline" className="mt-3" onClick={load}>Try again</Button>
                </div>
            ) : busy ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />)}
                    </div>
                    <div className="h-72 animate-pulse rounded-lg border border-border bg-muted/40" />
                </div>
            ) : data && (
                <>
                    {noData && (
                        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                            No Return Product activity was recorded for {data.periodLabel}. KPIs are shown as zero; exports will state that no activity was recorded.
                        </div>
                    )}

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <KpiCard icon={Package} iconClass="bg-violet-100 text-violet-600" label="Total Returns"
                            value={formatCount(data.kpis.totalReturns)} delta={data.deltas.totalReturns} comparisonLabel={comparisonLabel} sentiment="neutral" />
                        <KpiCard icon={Boxes} iconClass="bg-blue-100 text-blue-600" label="Total Quantity"
                            value={formatCount(data.kpis.totalQty)} delta={data.deltas.totalQty} comparisonLabel={comparisonLabel} sentiment="neutral" />
                        <KpiCard icon={Banknote} iconClass="bg-emerald-100 text-emerald-600" label="Total Value"
                            value={formatRM(data.kpis.totalValue)} delta={data.deltas.totalValue} comparisonLabel={comparisonLabel} sentiment="neutral" />
                        <KpiCard icon={TrendingUp} iconClass="bg-orange-100 text-orange-600" label="Average Return Value"
                            value={formatRM(data.kpis.avgValue)} delta={data.deltas.avgValue} comparisonLabel={comparisonLabel} sentiment="neutral" />
                        <KpiCard icon={Clock} iconClass="bg-red-100 text-red-600" label="Overdue Returns"
                            value={formatCount(data.kpis.overdue)} delta={data.deltas.overdue} comparisonLabel={comparisonLabel} sentiment="downIsGood" />
                        <KpiCard icon={CheckCircle2} iconClass="bg-teal-100 text-teal-600" label="Completion Rate"
                            value={`${data.kpis.completionRate.toFixed(1)}%`} delta={data.deltas.completionRate} comparisonLabel={comparisonLabel} sentiment="upIsGood" />
                    </div>

                    {/* Charts row */}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                        {/* Trend */}
                        <div className="rounded-lg border border-border bg-card p-4 xl:col-span-1">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Returns Trend</h3>
                                <span className="text-xs text-muted-foreground">{mode === 'monthly' ? `Monthly · ${year}` : 'Last 8 quarters'}</span>
                            </div>
                            <div className="h-60">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={data.trend} margin={{ top: 5, right: 0, bottom: 0, left: -14 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                                        <YAxis yAxisId="qty" tick={{ fontSize: 10 }} allowDecimals={false} />
                                        <YAxis yAxisId="value" orientation="right" tick={{ fontSize: 10 }} width={44} />
                                        <ChartTooltip
                                            formatter={(v: any, name: any) => name === 'Value (RM)' ? [formatRM(Number(v)), name] : [formatCount(Number(v)), name]}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Area yAxisId="qty" type="monotone" dataKey="qty" name="Quantity" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} strokeWidth={2} />
                                        <Line yAxisId="value" type="monotone" dataKey="value" name="Value (RM)" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Reasons donut */}
                        <div className="rounded-lg border border-border bg-card p-4 xl:col-span-1">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Returns by Reason</h3>
                                {data.byReason.length > 5 && (
                                    <button className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAllReasons((s) => !s)}>
                                        {showAllReasons ? 'Show top 5' : 'View all'}
                                    </button>
                                )}
                            </div>
                            {data.byReason.length === 0 ? (
                                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">No data for this period.</div>
                            ) : (
                                <div className="flex h-60 items-center gap-2">
                                    <div className="h-full w-1/2 min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={data.byReason.slice(0, showAllReasons ? undefined : 5) as any[]}
                                                    dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={2}
                                                >
                                                    {data.byReason.slice(0, showAllReasons ? undefined : 5).map((_, i) => (
                                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <ChartTooltip formatter={(v: any, name: any) => [formatRM(Number(v)), name]} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="max-h-full w-1/2 space-y-1.5 overflow-y-auto pr-1 text-xs">
                                        {data.byReason.slice(0, showAllReasons ? undefined : 5).map((r, i) => (
                                            <div key={r.reason} className="flex items-start gap-1.5">
                                                <span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                                <div className="min-w-0">
                                                    <div className="truncate font-medium text-foreground">{r.label}</div>
                                                    <div className="text-muted-foreground">{r.pct.toFixed(1)}% ({formatRM(r.value)})</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sources top 5 */}
                        <div className="rounded-lg border border-border bg-card p-4 xl:col-span-1">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Returns by Source (Top 5)</h3>
                                {data.bySource.length > 5 && (
                                    <button className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAllSources((s) => !s)}>
                                        {showAllSources ? 'Show top 5' : 'View all'}
                                    </button>
                                )}
                            </div>
                            {data.bySource.length === 0 ? (
                                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">No data for this period.</div>
                            ) : (
                                <div className="h-60 overflow-y-auto">
                                    <ResponsiveContainer width="100%" height={Math.max(230, (showAllSources ? data.bySource.length : Math.min(5, data.bySource.length)) * 44)}>
                                        <BarChart
                                            layout="vertical"
                                            data={data.bySource.slice(0, showAllSources ? undefined : 5).map((s) => ({
                                                ...s,
                                                display: `${s.name}${s.sourceType === 'distributor' ? ' (Dist)' : ''}`,
                                                pctLabel: `${s.cases} (${s.pct.toFixed(1)}%)`,
                                            }))}
                                            margin={{ top: 0, right: 56, bottom: 0, left: 8 }}
                                        >
                                            <XAxis type="number" hide domain={[0, 'dataMax']} allowDecimals={false} />
                                            <YAxis type="category" dataKey="display" width={118} tick={{ fontSize: 10 }} />
                                            <ChartTooltip formatter={(v: any) => [formatCount(Number(v)), 'Returns']} />
                                            <Bar dataKey="cases" fill="#3b82f6" radius={[0, 3, 3, 0]} barSize={16}>
                                                <LabelList dataKey="pctLabel" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Status breakdown strip */}
                    <div className="rounded-lg border border-border bg-card p-4">
                        <h3 className="mb-3 text-sm font-semibold text-foreground">Status Breakdown</h3>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                            {data.byStatus.map((s) => {
                                const pct = data.kpis.totalReturns > 0 ? (s.cases / data.kpis.totalReturns) * 100 : 0
                                return (
                                    <div key={s.status}>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">{s.label}</span>
                                            <span className="font-semibold text-foreground">{s.cases}</span>
                                        </div>
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Tables row */}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                        {/* Warehouses */}
                        <div className="rounded-lg border border-border bg-card">
                            <div className="border-b border-border px-4 py-3">
                                <h3 className="text-sm font-semibold text-foreground">Returns by Warehouse</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-[11px] uppercase text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Warehouse</th>
                                            <th className="px-2 py-2 text-right font-medium">Cases</th>
                                            <th className="px-2 py-2 text-right font-medium">Qty</th>
                                            <th className="px-2 py-2 text-right font-medium">Value</th>
                                            <th className="px-4 py-2 text-right font-medium">%</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {data.byWarehouse.length === 0 ? (
                                            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No data for this period.</td></tr>
                                        ) : data.byWarehouse.map((w) => (
                                            <tr key={w.id}>
                                                <td className="max-w-[180px] truncate px-4 py-2" title={w.name}>{w.name}</td>
                                                <td className="px-2 py-2 text-right">{formatCount(w.cases)}</td>
                                                <td className="px-2 py-2 text-right">{formatCount(w.qty)}</td>
                                                <td className="whitespace-nowrap px-2 py-2 text-right">{formatRM(w.value)}</td>
                                                <td className="px-4 py-2 text-right text-muted-foreground">{w.pct.toFixed(1)}%</td>
                                            </tr>
                                        ))}
                                        {data.byWarehouse.length > 0 && (
                                            <tr className="font-semibold">
                                                <td className="px-4 py-2">Total</td>
                                                <td className="px-2 py-2 text-right">{formatCount(data.kpis.totalReturns)}</td>
                                                <td className="px-2 py-2 text-right">{formatCount(data.kpis.totalQty)}</td>
                                                <td className="whitespace-nowrap px-2 py-2 text-right">{formatRM(data.kpis.totalValue)}</td>
                                                <td className="px-4 py-2" />
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Products top 5 */}
                        <div className="rounded-lg border border-border bg-card">
                            <div className="border-b border-border px-4 py-3">
                                <h3 className="text-sm font-semibold text-foreground">Returns by Product (Top 5)</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-[11px] uppercase text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Product</th>
                                            <th className="px-2 py-2 text-right font-medium">Qty</th>
                                            <th className="px-2 py-2 text-right font-medium">Value</th>
                                            <th className="px-4 py-2 font-medium">Main Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {data.byProduct.length === 0 ? (
                                            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No data for this period.</td></tr>
                                        ) : data.byProduct.slice(0, 5).map((p) => (
                                            <tr key={p.key}>
                                                <td className="max-w-[200px] truncate px-4 py-2" title={p.name}>{p.name}</td>
                                                <td className="px-2 py-2 text-right">{formatCount(p.qty)}</td>
                                                <td className="whitespace-nowrap px-2 py-2 text-right">{formatRM(p.value)}</td>
                                                <td className="max-w-[110px] truncate px-4 py-2 text-muted-foreground" title={p.topReason || undefined}>{p.topReason || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Recent returns */}
                        <div className="rounded-lg border border-border bg-card">
                            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                                <h3 className="text-sm font-semibold text-foreground">Recent Returns</h3>
                                <button className="text-xs font-medium text-primary hover:underline" onClick={scrollToDetail}>View all returns</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-[11px] uppercase text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Return No</th>
                                            <th className="px-2 py-2 font-medium">From</th>
                                            <th className="px-2 py-2 text-right font-medium">Qty</th>
                                            <th className="px-2 py-2 text-right font-medium">Value</th>
                                            <th className="px-4 py-2 font-medium">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {data.recent.length === 0 ? (
                                            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No data for this period.</td></tr>
                                        ) : data.recent.slice(0, 6).map((r) => (
                                            <tr key={r.id} className={cn(onViewChange && 'cursor-pointer hover:bg-accent/50')} onClick={() => openCase(r.id)}>
                                                <td className="px-4 py-2 font-medium text-foreground">{r.return_no}</td>
                                                <td className="max-w-[130px] truncate px-2 py-2" title={r.source_name || undefined}>{r.source_name || '—'}</td>
                                                <td className="px-2 py-2 text-right">{formatCount(r.total_qty)}</td>
                                                <td className="whitespace-nowrap px-2 py-2 text-right">{formatRM(r.total_value)}</td>
                                                <td className="px-4 py-2">
                                                    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_BADGE[r.status] || STATUS_BADGE.return_draft)}>
                                                        {(RETURN_STATUS_LABELS[r.status] || r.status).replace('Return ', '')}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Key insights */}
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <Lightbulb className="h-4 w-4 text-amber-500" />
                            <h3 className="text-sm font-semibold text-foreground">Key Insights</h3>
                            <span className="text-xs text-muted-foreground">· {data.periodLabel} vs {comparisonLabel}</span>
                        </div>
                        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm text-muted-foreground md:grid-cols-2">
                            {data.insights.map((insight, i) => (
                                <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{insight}</span></li>
                            ))}
                        </ul>
                    </div>

                    {/* Detailed report */}
                    <div ref={detailRef} className="scroll-mt-4 rounded-lg border border-border bg-card">
                        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Detailed Report</h3>
                                <p className="text-xs text-muted-foreground">{detailedRows.length} return case(s) in {data.periodLabel} matching the current filters.</p>
                            </div>
                            <div className="relative md:w-72">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search return no / source / warehouse" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8" />
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                                    <tr>
                                        <SortHeader label="Return No" k="return_no" />
                                        <th className="px-3 py-2 font-medium">Source Type</th>
                                        <SortHeader label="Return From" k="source_name" />
                                        <SortHeader label="Warehouse" k="warehouse_name" />
                                        <SortHeader label="Status" k="status" />
                                        <SortHeader label="Total Qty" k="total_qty" align="right" />
                                        <SortHeader label="Total Value" k="total_value" align="right" />
                                        <SortHeader label="Created" k="created_at" />
                                        <SortHeader label="Updated" k="updated_at" />
                                        <SortHeader label="Days Open" k="days_open" align="right" />
                                        <th className="px-3 py-2 font-medium">Overdue</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {pageRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                                                {search ? 'No returns match the search.' : `No Return Product activity was recorded for ${data.periodLabel}.`}
                                            </td>
                                        </tr>
                                    ) : pageRows.map((r) => (
                                        <tr key={r.id} className={cn(onViewChange && 'cursor-pointer', 'hover:bg-accent/50')} onClick={() => openCase(r.id)}>
                                            <td className="px-3 py-2 font-medium text-foreground">{r.return_no}</td>
                                            <td className="px-3 py-2">
                                                <Badge variant="outline" className="text-[10px]">{RETURN_SOURCE_LABELS[normalizeReturnSourceType(r.return_source_type)]}</Badge>
                                            </td>
                                            <td className="px-3 py-2">{r.source_name || '—'}{r.source_code ? <span className="ml-1 text-xs text-muted-foreground">({r.source_code})</span> : null}</td>
                                            <td className="px-3 py-2">{r.warehouse_name || '—'}</td>
                                            <td className="px-3 py-2">{RETURN_STATUS_LABELS[r.status] || r.status}</td>
                                            <td className="px-3 py-2 text-right">{formatCount(r.total_qty)}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right">{formatRM(r.total_value)}</td>
                                            <td className="px-3 py-2 text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-MY') : '—'}</td>
                                            <td className="px-3 py-2 text-muted-foreground">{r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-MY') : '—'}</td>
                                            <td className="px-3 py-2 text-right">{r.days_open}</td>
                                            <td className="px-3 py-2">{r.is_overdue ? <Badge variant="destructive" className="text-[10px]">Overdue</Badge> : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {pageCount > 1 && (
                            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
                                <span className="text-xs text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, detailedRows.length)} of {detailedRows.length}
                                </span>
                                <div className="flex items-center gap-1">
                                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="px-2 text-xs text-muted-foreground">Page {page} of {pageCount}</span>
                                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Email dialog */}
            <ReturnReportEmailDialog
                open={emailOpen}
                onOpenChange={setEmailOpen}
                buildPdf={buildPdf}
                reportMode={mode}
                periodLabel={data?.periodLabel || periodLabel(period)}
                defaultSubject={emailDefaults.subject}
                defaultMessage={emailDefaults.message}
            />
        </div>
    )
}
