'use client'

/**
 * Return Product Reports — one monthly report page with two tabs.
 *
 *   Overview          four management KPIs, a reason ranking, the top returned
 *                     products, a slim status bar and a single key insight.
 *   Detailed Report   the month's return cases, searchable and filterable.
 *
 * Both tabs describe exactly the same month, and every figure comes from the
 * server-side aggregate at /api/returns/reporting/summary — nothing on this
 * page is hardcoded. Excel, PDF and Email all export that same month.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Loader2, Download, Search, Mail, FileText, FileSpreadsheet, Eye, Lightbulb,
    Package, Boxes, Banknote, AlertCircle, ChevronLeft, ChevronRight, ChevronDown,
    SlidersHorizontal, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { RETURN_STATUS_LABELS, type ReturnStatus } from '@/lib/returns/constants'
import {
    periodLabel, formatRM, formatRMWhole, formatAmount, formatCount, reportFilename,
    groupReasonsForDisplay, buildKeyInsight, MONTH_NAMES,
    type ReportPeriod, type ReturnReportSummary, type ReportCaseRow,
} from '@/lib/returns/reporting'
import { buildReturnReportPdf, type ReturnReportPdf } from '@/lib/returns/report-pdf'
import { ReturnReportEmailDialog } from './ReturnReportEmailDialog'
import SupplyChainPageHeader from '@/modules/supply-chain/components/SupplyChainPageHeader'

interface UserProfile { id: string }

interface SummaryResponse extends ReturnReportSummary {
    cases: ReportCaseRow[]
    generatedBy: string | null
}

const PAGE_SIZE = 10

/** Green once completed, amber while a case still needs attention, red when cancelled. */
const STATUS_COLOR: Record<string, string> = {
    return_draft: '#cbd5e1',
    return_submitted: '#f59e0b',
    return_received: '#fbbf24',
    return_processing: '#fcd34d',
    return_completed: '#10b981',
    return_cancelled: '#f87171',
}

const STATUS_BADGE: Record<string, string> = {
    return_draft: 'bg-slate-100 text-slate-700',
    return_submitted: 'bg-amber-100 text-amber-700',
    return_received: 'bg-amber-100 text-amber-800',
    return_processing: 'bg-amber-50 text-amber-700',
    return_completed: 'bg-emerald-100 text-emerald-700',
    return_cancelled: 'bg-red-100 text-red-700',
}

interface DetailFilters {
    sourceType: string
    source: string
    warehouse: string
    reason: string
    status: string
}

const NO_FILTERS: DetailFilters = { sourceType: 'all', source: 'all', warehouse: 'all', reason: 'all', status: 'all' }

/** Columns the detailed table can be sorted by. */
type SortKey = 'return_no' | 'source_name' | 'warehouse_name' | 'status' | 'total_qty' | 'total_value' | 'created_at'

// ── Small building blocks ───────────────────────────────────────────────────

function KpiCard({ icon: Icon, iconClass, label, value, unit, note, noteClass }: {
    icon: any
    iconClass: string
    label: string
    value: string
    unit?: string
    note?: string
    noteClass?: string
}) {
    return (
        <div className="rounded-lg sera-sc-panel overflow-hidden p-5">
            <div className="flex items-start gap-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', iconClass)}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <div className="text-sm text-muted-foreground">{label}</div>
                    <div className="mt-1 truncate text-[26px] font-semibold leading-tight text-foreground">
                        {value}
                        {unit ? <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span> : null}
                    </div>
                    <div className={cn('mt-1 h-4 text-xs', noteClass || 'text-muted-foreground')}>{note || ''}</div>
                </div>
            </div>
        </div>
    )
}

function PanelHeading({ children }: { children: React.ReactNode }) {
    return <h3 className="text-base font-semibold text-foreground">{children}</h3>
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{children}</div>
}

// ── Main view ───────────────────────────────────────────────────────────────

export default function ReturnReportingView({ userProfile: _userProfile, onViewChange }: {
    userProfile: UserProfile
    onViewChange?: (view: string) => void
}) {
    const { toast } = useToast()
    const now = useMemo(() => new Date(), [])
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth() + 1

    const [tab, setTab] = useState('overview')

    // ── Selected month (the one boundary both tabs report on) ───────────────
    const [year, setYear] = useState(thisYear)
    const [month, setMonth] = useState(thisMonth)
    const period: ReportPeriod = useMemo(
        () => ({ mode: 'monthly', year, month, quarter: Math.floor((month - 1) / 3) + 1 }),
        [year, month],
    )
    /** The current month is the newest reportable one — the future holds no returns. */
    const atCurrentMonth = year === thisYear && month === thisMonth

    const stepMonth = (delta: number) => {
        const next = new Date(year, month - 1 + delta, 1)
        if (next.getFullYear() > thisYear || (next.getFullYear() === thisYear && next.getMonth() + 1 > thisMonth)) return
        setYear(next.getFullYear())
        setMonth(next.getMonth() + 1)
    }

    // ── Data ────────────────────────────────────────────────────────────────
    const [data, setData] = useState<SummaryResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    // ── Export / email state ────────────────────────────────────────────────
    const [exporting, setExporting] = useState(false)
    const [pdfBusy, setPdfBusy] = useState(false)
    const [emailOpen, setEmailOpen] = useState(false)

    // ── Detailed Report state ───────────────────────────────────────────────
    const [search, setSearch] = useState('')
    const [filters, setFilters] = useState<DetailFilters>(NO_FILTERS)
    const [draftFilters, setDraftFilters] = useState<DetailFilters>(NO_FILTERS)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [sortKey, setSortKey] = useState<SortKey>('created_at')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [page, setPage] = useState(1)

    const queryString = useCallback(() => {
        const p = new URLSearchParams()
        p.set('mode', 'monthly')
        p.set('year', String(year))
        p.set('month', String(month))
        return p.toString()
    }, [year, month])

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

    useEffect(() => { load() }, [load])

    // A new month brings a different set of sources, warehouses and reasons, so
    // the detailed filters start clean rather than pointing at options that are
    // no longer on offer.
    useEffect(() => {
        setSearch('')
        setFilters(NO_FILTERS)
        setDraftFilters(NO_FILTERS)
        setFiltersOpen(false)
    }, [year, month])

    // ── Exports (always the selected month, matching what is on screen) ─────

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
                `- Total Units: ${formatCount(k?.totalQty || 0)} pcs`,
                `- Return Value: ${formatRM(k?.totalValue || 0)}`,
                `- Open Cases: ${formatCount(k?.open || 0)}`,
                '',
                `This report was generated from Serapod2U on ${generatedDate}.`,
                '',
                'Regards,',
                'Serapod2U Reporting',
            ].join('\n'),
        }
    }, [data, period])

    // ── Overview derivations ────────────────────────────────────────────────

    const reasonGroups = useMemo(() => groupReasonsForDisplay(data?.byReason || [], 4), [data])
    const maxReasonPct = reasonGroups.reduce((m, r) => Math.max(m, r.pct), 0)
    const topProducts = useMemo(() => (data?.byProduct || []).slice(0, 5), [data])
    const keyInsight = useMemo(
        () => data ? buildKeyInsight(data.kpis, reasonGroups, MONTH_NAMES[period.month - 1]) : null,
        [data, reasonGroups, period.month],
    )
    const statusSlices = data?.byStatus || []
    const activeStatuses = statusSlices.filter((s) => s.cases > 0)
    const quietStatuses = statusSlices.filter((s) => s.cases === 0)

    // ── Detailed Report derivations ─────────────────────────────────────────

    /** Filter options come from the month on screen, so nothing offered returns nothing. */
    const sourceOptions = useMemo(() => {
        const map = new Map<string, string>()
        for (const r of data?.cases || []) {
            if (r.source_id && r.source_name) map.set(r.source_id, r.source_name)
        }
        return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }, [data])

    const warehouseOptions = useMemo(() => {
        const map = new Map<string, string>()
        for (const r of data?.cases || []) {
            map.set(r.warehouse_id || 'unassigned', r.warehouse_name || 'Unassigned')
        }
        return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }, [data])

    const reasonOptions = useMemo(
        () => (data?.byReason || []).filter((r) => r.reason !== 'unspecified').map((r) => ({ code: r.reason, label: r.label })),
        [data],
    )

    const statusOptions = useMemo(() => statusSlices.map((s) => ({ status: s.status, label: s.label })), [statusSlices])

    const detailedRows = useMemo(() => {
        let rows = data?.cases || []
        if (filters.sourceType !== 'all') rows = rows.filter((r) => r.return_source_type === filters.sourceType)
        if (filters.source !== 'all') rows = rows.filter((r) => r.source_id === filters.source)
        if (filters.warehouse !== 'all') rows = rows.filter((r) => (r.warehouse_id || 'unassigned') === filters.warehouse)
        if (filters.reason !== 'all') rows = rows.filter((r) => (r.reason_codes || []).includes(filters.reason))
        if (filters.status !== 'all') rows = rows.filter((r) => r.status === filters.status)

        const q = search.trim().toLowerCase()
        if (q) {
            rows = rows.filter((r) =>
                r.return_no.toLowerCase().includes(q)
                || (r.source_name || '').toLowerCase().includes(q)
                || (r.source_code || '').toLowerCase().includes(q)
                || (r.warehouse_name || '').toLowerCase().includes(q),
            )
        }

        const dir = sortDir === 'asc' ? 1 : -1
        return [...rows].sort((a, b) => {
            const av = a[sortKey]
            const bv = b[sortKey]
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
            return String(av ?? '').localeCompare(String(bv ?? '')) * dir
        })
    }, [data, filters, search, sortKey, sortDir])

    const activeFilterCount = Object.values(filters).filter((v) => v !== 'all').length
    const pageCount = Math.max(1, Math.ceil(detailedRows.length / PAGE_SIZE))
    const pageRows = detailedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    /** At most five numbered buttons, centred on the current page. */
    const pageWindow = useMemo(() => {
        const first = Math.max(1, Math.min(page - 2, pageCount - 4))
        const last = Math.min(pageCount, first + 4)
        return Array.from({ length: last - first + 1 }, (_, i) => first + i)
    }, [page, pageCount])
    useEffect(() => { setPage(1) }, [search, filters, sortKey, sortDir])

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
        else { setSortKey(key); setSortDir('desc') }
    }

    const openCase = (id: string) => {
        if (!onViewChange) return
        sessionStorage.setItem('openReturnCaseId', id)
        onViewChange('return-product')
    }

    const openFilters = () => {
        setDraftFilters(filters)
        setFiltersOpen((o) => !o)
    }

    const applyFilters = () => {
        setFilters(draftFilters)
        setFiltersOpen(false)
    }

    const clearFilters = () => {
        setFilters(NO_FILTERS)
        setDraftFilters(NO_FILTERS)
    }

    /** The always-visible status dropdown edits the applied filter directly. */
    const setStatusFilter = (status: string) => {
        setFilters((f) => ({ ...f, status }))
        setDraftFilters((f) => ({ ...f, status }))
    }

    // ── Render ──────────────────────────────────────────────────────────────

    const busy = loading || !data
    const monthLabel = periodLabel(period)

    /** Months the picker can jump to: every month up to and including this one. */
    const monthOptions = useMemo(() => {
        const out: { year: number; month: number; label: string }[] = []
        for (let i = 0; i < 24; i++) {
            const d = new Date(thisYear, thisMonth - 1 - i, 1)
            out.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: periodLabel({ mode: 'monthly', year: d.getFullYear(), month: d.getMonth() + 1, quarter: 1 }) })
        }
        return out
    }, [thisYear, thisMonth])

    const SortHeader = ({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => (
        <th
            className={cn('cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground', align === 'right' && 'text-right')}
            onClick={() => toggleSort(k)}
        >
            {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
        </th>
    )

    return (
        <div className="sera-sc-page space-y-5">
            <SupplyChainPageHeader
                eyebrow="Quality · Returns"
                title="Return Product Reports"
                description="Monthly overview of product returns"
            />

            {/* Month selector + the single export entry point — shared by both tabs */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => stepMonth(-1)} title="Previous month">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="h-10 w-[170px] justify-center font-medium">{monthLabel}</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                            {monthOptions.map((o) => (
                                <DropdownMenuItem
                                    key={o.label}
                                    onClick={() => { setYear(o.year); setMonth(o.month) }}
                                    className={cn(o.year === year && o.month === month && 'font-semibold text-[var(--sera-orange)]')}
                                >
                                    {o.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="outline" size="icon" className="h-10 w-10"
                        onClick={() => stepMonth(1)} disabled={atCurrentMonth}
                        title={atCurrentMonth ? 'The current month is the latest report' : 'Next month'}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-10 gap-2" disabled={busy || exporting || pdfBusy}>
                            {exporting || pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Export Report <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={exportExcel} className="gap-2">
                            <FileSpreadsheet className="h-4 w-4" /> Export to Excel
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handlePdf('preview')} className="gap-2">
                            <Eye className="h-4 w-4" /> Preview PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handlePdf('download')} className="gap-2">
                            <FileText className="h-4 w-4" /> Download PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setEmailOpen(true)} className="gap-2">
                            <Mail className="h-4 w-4" /> Email Report
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
                    <TabsTrigger
                        value="overview"
                        className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-[var(--sera-orange)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--sera-orange)] data-[state=active]:shadow-none"
                    >
                        Overview
                    </TabsTrigger>
                    <TabsTrigger
                        value="detailed"
                        className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-[var(--sera-orange)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--sera-orange)] data-[state=active]:shadow-none"
                    >
                        Detailed Report
                    </TabsTrigger>
                </TabsList>

                {loadError ? (
                    <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
                        <p className="text-sm text-destructive">{loadError}</p>
                        <Button variant="outline" className="mt-3" onClick={load}>Try again</Button>
                    </div>
                ) : busy ? (
                    <div className="mt-5 space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />)}
                        </div>
                        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/40" />
                    </div>
                ) : data && (
                    <>
                        {/* ── Overview ───────────────────────────────────── */}
                        <TabsContent value="overview" className="mt-5 space-y-5">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                <KpiCard
                                    icon={Package} iconClass="bg-violet-100 text-violet-600"
                                    label="Total Returns" value={formatCount(data.kpis.totalReturns)}
                                    note="return cases"
                                />
                                <KpiCard
                                    icon={Boxes} iconClass="bg-blue-100 text-blue-600"
                                    label="Total Units" value={formatCount(data.kpis.totalQty)} unit="pcs"
                                />
                                <KpiCard
                                    icon={Banknote} iconClass="bg-emerald-100 text-emerald-600"
                                    label="Return Value" value={formatRMWhole(data.kpis.totalValue)}
                                />
                                <KpiCard
                                    icon={AlertCircle} iconClass="bg-amber-100 text-amber-600"
                                    label="Open Cases" value={formatCount(data.kpis.open)}
                                    note={data.kpis.open > 0 ? 'Requires attention' : undefined}
                                    noteClass="text-amber-600"
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                {/* Returns by Reason */}
                                <div className="rounded-lg sera-sc-panel overflow-hidden p-5">
                                    <PanelHeading>Returns by Reason</PanelHeading>
                                    {reasonGroups.length === 0 ? (
                                        <EmptyPanel>No returns recorded for {data.periodLabel}.</EmptyPanel>
                                    ) : (
                                        <div className="mt-5 space-y-4">
                                            {reasonGroups.map((r) => (
                                                <div key={r.reason} className="flex items-center gap-4">
                                                    <div className="w-[132px] shrink-0 truncate text-sm text-foreground" title={r.label}>{r.label}</div>
                                                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                                                        <div
                                                            className="h-full rounded-full bg-[var(--sera-orange)]"
                                                            style={{ width: `${maxReasonPct > 0 ? Math.max(2, (r.pct / maxReasonPct) * 100) : 0}%` }}
                                                        />
                                                    </div>
                                                    <div className="w-12 shrink-0 text-right text-sm tabular-nums text-foreground">{Math.round(r.pct)}%</div>
                                                </div>
                                            ))}
                                            <p className="pt-1 text-xs text-muted-foreground">Share of {data.periodLabel} return value.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Top Returned Products */}
                                <div className="rounded-lg sera-sc-panel overflow-hidden p-5">
                                    <PanelHeading>Top Returned Products</PanelHeading>
                                    {topProducts.length === 0 ? (
                                        <EmptyPanel>No returns recorded for {data.periodLabel}.</EmptyPanel>
                                    ) : (
                                        <table className="mt-4 w-full table-fixed text-sm">
                                            <thead className="text-left text-xs text-muted-foreground">
                                                <tr className="border-b border-border">
                                                    <th className="py-2 font-medium">Product</th>
                                                    <th className="w-20 py-2 text-right font-medium">Units</th>
                                                    <th className="w-28 py-2 text-right font-medium">Value</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {topProducts.map((p) => (
                                                    <tr key={p.key}>
                                                        <td className="truncate py-2.5 pr-3 text-foreground" title={p.name}>{p.name}</td>
                                                        <td className="py-2.5 text-right tabular-nums">{formatCount(p.qty)}</td>
                                                        <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{formatRMWhole(p.value)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            {/* Status Breakdown */}
                            <div className="rounded-lg sera-sc-panel overflow-hidden p-5">
                                <PanelHeading>Status Breakdown</PanelHeading>
                                {activeStatuses.length === 0 ? (
                                    <p className="mt-4 text-sm text-muted-foreground">No returns recorded for {data.periodLabel}.</p>
                                ) : (
                                    <>
                                        <div className="mt-5 flex h-2.5 w-full gap-1">
                                            {activeStatuses.map((s) => (
                                                <div
                                                    key={s.status}
                                                    className="h-full rounded-full"
                                                    style={{ flexGrow: s.cases, flexBasis: 0, background: STATUS_COLOR[s.status] || STATUS_COLOR.return_draft }}
                                                    title={`${s.label}: ${formatCount(s.cases)}`}
                                                />
                                            ))}
                                        </div>
                                        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
                                            {activeStatuses.map((s) => (
                                                <div key={s.status} className="flex items-start gap-2">
                                                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[s.status] || STATUS_COLOR.return_draft }} />
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm text-muted-foreground">{s.label.replace('Return ', '')}</div>
                                                        <div className="text-lg font-semibold leading-tight text-foreground">{formatCount(s.cases)}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {quietStatuses.length > 0 && (
                                            <p className="mt-3 text-xs text-muted-foreground">
                                                No cases: {quietStatuses.map((s) => s.label.replace('Return ', '')).join(', ')}.
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* One calculated insight, or nothing at all */}
                            {keyInsight && (
                                <div className="flex items-start gap-3 rounded-lg sera-sc-panel overflow-hidden p-5">
                                    <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                                    <p className="text-sm text-foreground">
                                        <span className="font-semibold">Key insight:</span> {keyInsight}
                                    </p>
                                </div>
                            )}
                        </TabsContent>

                        {/* ── Detailed Report ────────────────────────────── */}
                        <TabsContent value="detailed" className="mt-5 space-y-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Search return no., shop or distributor"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="h-11 pl-10"
                                    />
                                </div>
                                <Button variant="outline" className="h-11 gap-2" onClick={openFilters}>
                                    <SlidersHorizontal className="h-4 w-4" /> More Filters
                                    <span className={cn(
                                        'ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium',
                                        activeFilterCount > 0 ? 'bg-[var(--sera-orange)] text-white' : 'bg-muted text-muted-foreground',
                                    )}>
                                        {activeFilterCount}
                                    </span>
                                </Button>
                                <Select value={filters.status} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="h-11 lg:w-[190px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        {statusOptions.map((s) => <SelectItem key={s.status} value={s.status}>{s.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            {filtersOpen && (
                                <div className="rounded-lg sera-sc-panel overflow-hidden p-4">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                        <div className="space-y-1.5">
                                            <div className="text-xs font-medium text-muted-foreground">Source Type</div>
                                            <Select value={draftFilters.sourceType} onValueChange={(v) => setDraftFilters((f) => ({ ...f, sourceType: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Types</SelectItem>
                                                    <SelectItem value="shop">Shop</SelectItem>
                                                    <SelectItem value="distributor">Distributor</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs font-medium text-muted-foreground">Return From</div>
                                            <Select value={draftFilters.source} onValueChange={(v) => setDraftFilters((f) => ({ ...f, source: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Sources</SelectItem>
                                                    {sourceOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs font-medium text-muted-foreground">Warehouse</div>
                                            <Select value={draftFilters.warehouse} onValueChange={(v) => setDraftFilters((f) => ({ ...f, warehouse: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Warehouses</SelectItem>
                                                    {warehouseOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs font-medium text-muted-foreground">Return Reason</div>
                                            <Select value={draftFilters.reason} onValueChange={(v) => setDraftFilters((f) => ({ ...f, reason: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Reasons</SelectItem>
                                                    {reasonOptions.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="text-xs font-medium text-muted-foreground">Status</div>
                                            <Select value={draftFilters.status} onValueChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Statuses</SelectItem>
                                                    {statusOptions.map((s) => <SelectItem key={s.status} value={s.status}>{s.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="mt-4 flex items-center justify-end gap-2">
                                        <Button variant="ghost" className="h-9 gap-1.5" onClick={clearFilters}>
                                            <X className="h-3.5 w-3.5" /> Clear Filters
                                        </Button>
                                        <Button
                                            className="h-9 bg-[var(--sera-orange)] text-white hover:bg-[var(--sera-orange-deep)]"
                                            onClick={applyFilters}
                                        >
                                            Apply Filters
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <p className="text-sm text-muted-foreground">
                                {formatCount(detailedRows.length)} return case{detailedRows.length === 1 ? '' : 's'} in {data.periodLabel}
                                {activeFilterCount > 0 || search.trim() ? ' matching the current filters' : ''}
                            </p>

                            <div className="rounded-lg sera-sc-panel overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <SortHeader label="Return No." k="return_no" />
                                                <SortHeader label="Return From" k="source_name" />
                                                <SortHeader label="Warehouse" k="warehouse_name" />
                                                <SortHeader label="Status" k="status" />
                                                <SortHeader label="Units" k="total_qty" align="right" />
                                                <SortHeader label="Value (RM)" k="total_value" align="right" />
                                                <SortHeader label="Created" k="created_at" />
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {pageRows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="px-4 py-14 text-center text-muted-foreground">
                                                        {search.trim() || activeFilterCount > 0
                                                            ? 'No returns match the current search and filters.'
                                                            : `No Return Product activity was recorded for ${data.periodLabel}.`}
                                                    </td>
                                                </tr>
                                            ) : pageRows.map((r) => (
                                                <tr
                                                    key={r.id}
                                                    className={cn('hover:bg-accent/50', onViewChange && 'cursor-pointer')}
                                                    onClick={() => openCase(r.id)}
                                                >
                                                    <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{r.return_no}</td>
                                                    <td className="max-w-[220px] truncate px-4 py-3" title={r.source_name || undefined}>
                                                        {r.source_name || '—'}
                                                    </td>
                                                    <td className="max-w-[220px] truncate px-4 py-3" title={r.warehouse_name || undefined}>
                                                        {r.warehouse_name || '—'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn(
                                                            'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
                                                            STATUS_BADGE[r.status] || STATUS_BADGE.return_draft,
                                                        )}>
                                                            {RETURN_STATUS_LABELS[r.status as ReturnStatus] || r.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums">{formatCount(r.total_qty)}</td>
                                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(r.total_value)}</td>
                                                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                        {r.created_at ? new Date(r.created_at).toLocaleDateString('en-MY') : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {detailedRows.length > 0 && (
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
                                        <span className="text-xs text-muted-foreground">
                                            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, detailedRows.length)} of {detailedRows.length}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>
                                            {pageWindow.map((n) => (
                                                <Button
                                                    key={n}
                                                    variant={n === page ? 'default' : 'outline'}
                                                    size="icon"
                                                    className={cn('h-8 w-8 text-xs', n === page && 'bg-[var(--sera-orange)] text-white hover:bg-[var(--sera-orange-deep)]')}
                                                    onClick={() => setPage(n)}
                                                >
                                                    {n}
                                                </Button>
                                            ))}
                                            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    </>
                )}
            </Tabs>

            <ReturnReportEmailDialog
                open={emailOpen}
                onOpenChange={setEmailOpen}
                buildPdf={buildPdf}
                reportMode="monthly"
                periodLabel={data?.periodLabel || monthLabel}
                defaultSubject={emailDefaults.subject}
                defaultMessage={emailDefaults.message}
            />
        </div>
    )
}
