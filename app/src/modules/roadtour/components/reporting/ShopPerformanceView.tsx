'use client'

// Shop Performance — the continuous monthly view of every shop RoadTour has
// visited, independent of whether a visit happened this month.
//
// This is deliberately not a second 7D report. AM Performance measures one
// intervention; this measures the shop's own trend, month against month. A month
// with no RoadTour visit at all still has shop performance, which is why July
// 2026 is populated here while AM Performance is correctly empty.
//
// The page presents the trend and never decides the response: management chooses
// Monitor, Contact, Revisit or No Action.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Store, TrendingDown, TrendingUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyBlock, KpiCard, LoadingBlock } from '../analytics/shared'
import { downloadCsv } from './ui'
import {
    SHOP_PERFORMANCE_METHOD_NOTE,
    SHOP_PERFORMANCE_METRIC_LABEL,
    SHOP_PERFORMANCE_STATE_LABEL,
    type ShopPerformanceRow,
    type ShopPerformanceState,
} from '@/modules/roadtour/lib/reporting/shopPerformance'
import {
    MONTH_TO_DATE_LABEL,
    canSelectNextMonth,
    currentMonthKey,
    normalizeMonthKey,
    resolveReportingMonth,
    shiftMonthKey,
} from '@/modules/roadtour/lib/reporting/month'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 25
const ALL = '__all__'
type StateFilter = 'all' | 'attention' | ShopPerformanceState

const STATE_PILL: Record<ShopPerformanceState, string> = {
    improved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    newly_active: 'bg-sky-50 text-sky-700 border-sky-200',
    maintained: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border-[var(--sera-line)]',
    declined: 'bg-amber-50 text-amber-700 border-amber-200',
    no_activity: 'bg-rose-50 text-rose-700 border-rose-200',
}

function StatePill({ state }: { state: ShopPerformanceState }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATE_PILL[state]}`}>
            {SHOP_PERFORMANCE_STATE_LABEL[state]}
        </span>
    )
}

/** Six months of totals, scaled to the shop's own peak so shape stays readable. */
function Sparkline({ trail }: { trail: Array<{ monthKey: string; scans: number }> }) {
    const peak = Math.max(1, ...trail.map((point) => point.scans))
    return (
        <span className="inline-flex h-6 items-end gap-[2px]" aria-hidden="true">
            {trail.map((point, index) => (
                <span
                    key={point.monthKey}
                    className={`w-[4px] rounded-sm ${index === trail.length - 1 ? 'bg-[var(--sera-orange)]' : 'bg-[var(--sera-line)]'}`}
                    style={{ height: `${Math.max(2, Math.round((point.scans / peak) * 24))}px` }}
                />
            ))}
        </span>
    )
}

function formatDelta(delta: number, changePercent: number | null): string {
    const sign = delta > 0 ? '+' : ''
    if (changePercent === null) return `${sign}${delta}`
    return `${sign}${delta} (${sign}${changePercent.toFixed(1)}%)`
}

export function ShopPerformanceView({ userProfile }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null

    const [monthKey, setMonthKey] = useState<string>(() => {
        if (typeof window === 'undefined') return currentMonthKey()
        return normalizeMonthKey(new URLSearchParams(window.location.search).get('month'))
    })
    const [regionStateId, setRegionStateId] = useState<string | null>(null)
    const [stateFilter, setStateFilter] = useState<StateFilter>('all')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)
    const [dataset, setDataset] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const month = useMemo(() => resolveReportingMonth(monthKey), [monthKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        params.set('month', monthKey)
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
    }, [monthKey])

    useEffect(() => {
        if (!organizationId) {
            setLoading(false)
            setError('No organization is linked to this account.')
            return
        }
        let cancelled = false
        const params = new URLSearchParams({ month: monthKey })
        if (regionStateId) params.set('regionStateId', regionStateId)

        setLoading(true)
        setError(null)
        fetch(`/api/roadtour/reporting/shop-performance?${params.toString()}`, { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json().catch(() => null)
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || `Request failed with status ${response.status}`)
                }
                if (!cancelled) setDataset(payload.data)
            })
            .catch((cause: unknown) => {
                if (cancelled) return
                console.error('[ShopPerformanceView] load failed', cause)
                setDataset(null)
                setError(cause instanceof Error ? cause.message : 'Failed to load shop performance.')
            })
            .finally(() => { if (!cancelled) setLoading(false) })

        return () => { cancelled = true }
    }, [organizationId, monthKey, regionStateId])

    const goPrevious = useCallback(() => setMonthKey((key) => shiftMonthKey(key, -1)), [])
    const goNext = useCallback(() => setMonthKey((key) => (canSelectNextMonth(key) ? shiftMonthKey(key, 1) : key)), [])

    const rows: ShopPerformanceRow[] = dataset?.rows ?? []
    const summary = dataset?.summary ?? null

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        return rows.filter((row) => {
            if (stateFilter === 'attention' && row.state !== 'declined' && row.state !== 'no_activity') return false
            if (stateFilter !== 'all' && stateFilter !== 'attention' && row.state !== stateFilter) return false
            if (!term) return true
            return `${row.shopName} ${row.shopCode ?? ''} ${row.region ?? ''}`.toLowerCase().includes(term)
        })
    }, [rows, stateFilter, search])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const currentPage = Math.min(page, totalPages - 1)
    const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const exportReport = () => {
        if (!dataset) return
        downloadCsv(
            `roadtour-shop-performance-${dataset.meta.monthKey}.csv`,
            ['Shop', 'Code', 'Region', `${dataset.meta.previousMonthLabel}`, `${dataset.meta.monthLabel}`, 'Change', 'Change %', 'Trend'],
            filtered.map((row) => [
                row.shopName, row.shopCode ?? '', row.region ?? '',
                row.previousScans, row.currentScans, row.delta,
                row.changePercent === null ? '' : row.changePercent.toFixed(1),
                SHOP_PERFORMANCE_STATE_LABEL[row.state],
            ]),
        )
    }

    return (
        <div className="sera-sc-page space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="font-display text-xl font-semibold text-[var(--sera-ink)]">Shop Performance</h1>
                    <p className="max-w-2xl text-sm text-[var(--sera-muted)]">
                        Month-to-month {SHOP_PERFORMANCE_METRIC_LABEL.toLowerCase()} for every shop RoadTour has visited,
                        whether or not a visit happened this month.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={goPrevious} aria-label="Previous month">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-[150px] text-center">
                        <div className="font-display text-sm font-semibold text-[var(--sera-ink)]">{month.label}</div>
                        {month.isCurrentMonth && <div className="text-[11px] text-[var(--sera-muted)]">{MONTH_TO_DATE_LABEL}</div>}
                    </div>
                    <Button variant="outline" size="sm" onClick={goNext} disabled={!canSelectNextMonth(monthKey)} aria-label="Next month">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportReport} disabled={filtered.length === 0}>Export</Button>
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
                </div>
            )}

            {loading && <Card><LoadingBlock label="Building shop performance…" /></Card>}

            {!loading && !error && dataset && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <KpiCard
                            label="Shops Reported" icon={Store} accent="slate"
                            value={summary?.shopsReported ?? 0}
                            sub={`Visited by RoadTour`}
                        />
                        <KpiCard
                            label={SHOP_PERFORMANCE_METRIC_LABEL} icon={TrendingUp} accent="orange"
                            value={(summary?.totalCurrentScans ?? 0).toLocaleString()}
                            sub={`${(summary?.totalPreviousScans ?? 0).toLocaleString()} in ${dataset.meta.previousMonthLabel}`}
                        />
                        <KpiCard
                            label="Improved or Newly Active" icon={TrendingUp} accent="green"
                            value={(summary?.stateCounts.improved ?? 0) + (summary?.stateCounts.newly_active ?? 0)}
                            sub="Shops trending up"
                        />
                        <KpiCard
                            label="Declined or No Activity" icon={TrendingDown} accent="rose"
                            value={(summary?.stateCounts.declined ?? 0) + (summary?.stateCounts.no_activity ?? 0)}
                            sub="For management review"
                        />
                    </div>

                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle className="text-base">Monthly Shop Trend</CardTitle>
                                    <p className="text-xs text-[var(--sera-muted)]">
                                        {filtered.length} {filtered.length === 1 ? 'shop' : 'shops'} · {SHOP_PERFORMANCE_METHOD_NOTE}
                                    </p>
                                </div>
                                <div className="flex flex-1 items-center gap-2 sm:max-w-lg">
                                    <div className="relative flex-1">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sera-muted)]" />
                                        <Input
                                            className="pl-9" placeholder="Search shop, code or region"
                                            value={search}
                                            onChange={(event) => { setSearch(event.target.value); setPage(0) }}
                                        />
                                    </div>
                                    <Select
                                        value={regionStateId ?? ALL}
                                        onValueChange={(value) => { setRegionStateId(value === ALL ? null : value); setPage(0) }}
                                    >
                                        <SelectTrigger className="w-36"><SelectValue placeholder="Region" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={ALL}>All regions</SelectItem>
                                            {(dataset.regions ?? []).map((region: any) => (
                                                <SelectItem key={region.id} value={region.id}>{region.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={stateFilter} onValueChange={(value) => { setStateFilter(value as StateFilter); setPage(0) }}>
                                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All shops</SelectItem>
                                            <SelectItem value="attention">Needs review</SelectItem>
                                            <SelectItem value="improved">Improved</SelectItem>
                                            <SelectItem value="maintained">Maintained</SelectItem>
                                            <SelectItem value="declined">Declined</SelectItem>
                                            <SelectItem value="newly_active">Newly Active</SelectItem>
                                            <SelectItem value="no_activity">No Activity</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table className="text-xs">
                                    <TableHeader>
                                        <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                            <TableHead className="w-10 text-right">#</TableHead>
                                            <TableHead>Shop</TableHead>
                                            <TableHead>Region</TableHead>
                                            <TableHead className="text-right">{dataset.meta.previousMonthLabel}</TableHead>
                                            <TableHead className="text-right">{dataset.meta.monthLabel}</TableHead>
                                            <TableHead className="text-right">Change</TableHead>
                                            <TableHead>Trend</TableHead>
                                            <TableHead>6-Month Shape</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                                        {pageRows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={8}>
                                                    <EmptyBlock
                                                        title="No shop activity to show"
                                                        description="No shop visited by RoadTour recorded successful product QR scans in this month or the one before it."
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {pageRows.map((row, index) => (
                                            <TableRow key={row.shopId} className="hover:bg-[var(--sera-mist)]/60">
                                                <TableCell className="text-right tabular-nums text-[11px] text-[var(--sera-muted)]">
                                                    {currentPage * PAGE_SIZE + index + 1}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium text-[var(--sera-ink)]">{row.shopNamePrimary}</div>
                                                    {row.shopBranchLabel && (
                                                        <div className="text-[11px] text-[var(--sera-muted)]">{row.shopBranchLabel}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-[var(--sera-muted)]">{row.region ?? '—'}</TableCell>
                                                <TableCell className="text-right tabular-nums">{row.previousScans.toLocaleString()}</TableCell>
                                                <TableCell className="text-right tabular-nums font-medium text-[var(--sera-ink)]">
                                                    {row.currentScans.toLocaleString()}
                                                </TableCell>
                                                <TableCell className={`text-right tabular-nums ${row.delta > 0 ? 'text-emerald-700' : row.delta < 0 ? 'text-rose-700' : 'text-[var(--sera-muted)]'}`}>
                                                    {formatDelta(row.delta, row.changePercent)}
                                                </TableCell>
                                                <TableCell><StatePill state={row.state} /></TableCell>
                                                <TableCell><Sparkline trail={row.trail} /></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {totalPages > 1 && (
                                <div className="flex items-center justify-between border-t border-[var(--sera-line)] px-3 py-2 text-xs text-[var(--sera-muted)]">
                                    <span>Page {currentPage + 1} of {totalPages}</span>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                                        <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <p className="text-xs text-[var(--sera-muted)]">
                        A decline is presented, not actioned. Management decides Monitor, Contact, Revisit or No Action —
                        and a Revisit opens a new campaign and a new 7-day observation rather than closing the issue.
                    </p>
                </>
            )}
        </div>
    )
}
