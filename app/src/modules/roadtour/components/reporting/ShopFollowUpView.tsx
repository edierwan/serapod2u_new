'use client'

// Shop Follow-Up — an action queue, not a dashboard. One row per shop, one
// recommended action, one due date. Unassigned high-priority shops come first.

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Flag, Search, UserX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyBlock, KpiCard, LoadingBlock } from '../analytics/shared'
import { ReportingHeader } from './ReportingHeader'
import {
    KpiDrilldownDialog,
    KpiDrilldownEmpty,
    KpiDrilldownValue,
    OutcomePill,
    PriorityPill,
    SortableHead,
    downloadCsv,
    formatDate,
    formatDateTime,
} from './ui'
import { useMonthlyReporting } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import {
    buildFollowUpSummary,
    buildShopEntries,
    isOverdueFollowUp,
    selectFollowUpKpiEntries,
    sortFollowUpQueue,
    type FollowUpKpiKey,
} from '@/modules/roadtour/lib/reporting/aggregate'
import {
    orderFollowUpQueue,
    type FollowUpSortKey,
} from '@/modules/roadtour/lib/reporting/followUpTable'
import { nextSortState, type SortState } from '@/modules/roadtour/lib/reporting/tableSort'
import { IMPACT_METHOD_NOTE } from '@/modules/roadtour/lib/reporting/impactModel'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'
import type { FollowUpPriority } from '@/modules/roadtour/lib/reporting/followUp'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 25
type QueueFilter = 'actionable' | 'all' | FollowUpPriority

const KPI_DRILLDOWN_TITLE: Record<FollowUpKpiKey, string> = {
    highPriority: 'High Priority',
    dueToday: 'Due Today',
    overdue: 'Overdue',
    unassignedShops: 'Unassigned Shops',
}

export function ShopFollowUpView({ userProfile }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null
    const reporting = useMonthlyReporting(organizationId)
    const { dataset, loading, error, month } = reporting
    const [queueFilter, setQueueFilter] = useState<QueueFilter>('actionable')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)
    const [sort, setSort] = useState<SortState<FollowUpSortKey> | null>(null)
    const [kpiDrilldown, setKpiDrilldown] = useState<FollowUpKpiKey | null>(null)

    const entries = useMemo(() => (dataset ? buildShopEntries(dataset.rows) : []), [dataset])
    const summary = useMemo(() => buildFollowUpSummary(entries), [entries])

    const queue = useMemo(() => {
        const term = search.trim().toLowerCase()
        const filtered = entries.filter((entry) => {
            if (queueFilter === 'actionable' && entry.priority !== 'high' && entry.priority !== 'medium') return false
            if (queueFilter !== 'actionable' && queueFilter !== 'all' && entry.priority !== queueFilter) return false
            if (!term) return true
            const haystack = `${entry.shopName} ${entry.shopCode ?? ''} ${entry.region ?? ''} ${entry.ownerAmName ?? UNASSIGNED_AM_LABEL}`
            return haystack.toLowerCase().includes(term)
        })
        return orderFollowUpQueue(filtered, sort)
    }, [entries, queueFilter, search, sort])

    const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE))
    const currentPage = Math.min(page, totalPages - 1)
    const pageRows = queue.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

    const handleSort = (key: FollowUpSortKey) => {
        setSort((current) => nextSortState(current, key))
        setPage(0)
    }

    // Drill-down rows come from the same predicates the KPI counts use, so the
    // number on the card and the number of rows in the dialog cannot diverge.
    const drilldownRows = useMemo(() => (
        kpiDrilldown ? sortFollowUpQueue(selectFollowUpKpiEntries(entries, kpiDrilldown)) : []
    ), [entries, kpiDrilldown])

    const exportQueue = () => {
        if (!dataset) return
        downloadCsv(
            `roadtour-shop-follow-up-${dataset.meta.monthKey}.csv`,
            ['Priority', 'Shop', 'Region', 'Responsible AM', 'Last Visit', 'Observation Status', 'Last Valid Scan', 'Recommended Action', 'Follow-Up Due'],
            queue.map((entry) => [
                entry.priority,
                entry.shopName,
                entry.region ?? '',
                entry.ownerAmName ?? UNASSIGNED_AM_LABEL,
                entry.currentRow.visit_date,
                entry.outcome,
                (entry.attributedRow ?? entry.currentRow).last_scan_after_at ?? '',
                entry.action,
                entry.dueDate,
            ]),
        )
    }

    return (
        <div className="sera-sc-page space-y-6">
            <ReportingHeader
                title="Shop Follow-Up"
                description="Shops that need an action right now, with the account manager responsible for each one."
                month={month}
                canGoForward={reporting.canGoForward}
                onPreviousMonth={reporting.goToPreviousMonth}
                onNextMonth={reporting.goToNextMonth}
                filters={reporting.filters}
                onFiltersChange={reporting.setFilters}
                onClearFilters={reporting.clearFilters}
                activeFilterCount={reporting.activeFilterCount}
                campaigns={dataset?.campaigns ?? []}
                accountManagers={dataset?.accountManagers ?? []}
                regions={dataset?.regions ?? []}
                onExport={exportQueue}
                exportDisabled={queue.length === 0}
            />

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
                </div>
            )}

            {dataset?.meta.warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{warning}</span>
                </div>
            ))}

            {loading && <Card><LoadingBlock label="Building the follow-up queue…" /></Card>}

            {!loading && dataset && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <KpiCard
                            label="High Priority" icon={Flag} accent="rose"
                            value={<KpiDrilldownValue value={summary.highPriority} label="High Priority" onOpen={() => setKpiDrilldown('highPriority')} />}
                            sub="matured, no response or steep drop"
                        />
                        <KpiCard
                            label="Due Today" icon={CalendarClock} accent="amber"
                            value={<KpiDrilldownValue value={summary.dueToday} label="Due Today" onOpen={() => setKpiDrilldown('dueToday')} />}
                            sub="actionable today"
                        />
                        <KpiCard
                            label="Overdue" icon={CalendarClock} accent="rose"
                            value={<KpiDrilldownValue value={summary.overdue} label="Overdue" onOpen={() => setKpiDrilldown('overdue')} />}
                            sub="past their due date"
                        />
                        <KpiCard
                            label="Unassigned Shops" icon={UserX} accent="slate"
                            value={<KpiDrilldownValue value={summary.unassignedShops} label="Unassigned Shops" onOpen={() => setKpiDrilldown('unassignedShops')} />}
                            sub="no responsible AM"
                        />
                    </div>

                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle className="text-base">Follow-Up Queue</CardTitle>
                                    <p className="text-xs text-[var(--sera-muted)]">
                                        {queue.length} {queue.length === 1 ? 'shop' : 'shops'} · {IMPACT_METHOD_NOTE}
                                    </p>
                                </div>
                                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                                    <div className="relative flex-1">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sera-muted)]" />
                                        <Input
                                            className="pl-9"
                                            placeholder="Search shop, region or account manager"
                                            value={search}
                                            onChange={(event) => { setSearch(event.target.value); setPage(0) }}
                                        />
                                    </div>
                                    <Select value={queueFilter} onValueChange={(value) => { setQueueFilter(value as QueueFilter); setPage(0) }}>
                                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="actionable">Needs action</SelectItem>
                                            <SelectItem value="high">High only</SelectItem>
                                            <SelectItem value="medium">Medium only</SelectItem>
                                            <SelectItem value="observing">Observing</SelectItem>
                                            <SelectItem value="all">All shops</SelectItem>
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
                                            <SortableHead label="Priority" sortKey="priority" sort={sort} onSort={handleSort} className="w-24" />
                                            <SortableHead label="Shop" sortKey="shop" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Region" sortKey="region" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Responsible AM" sortKey="am" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Last Visit" sortKey="lastVisit" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Observation Status" sortKey="observation" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Last Valid Scan" sortKey="lastScan" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Recommended Action" sortKey="action" sort={sort} onSort={handleSort} />
                                            <SortableHead label="Follow-Up Due" sortKey="due" sort={sort} onSort={handleSort} />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                                        {pageRows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={10}>
                                                    <EmptyBlock
                                                        title="Nothing in this queue"
                                                        description="No shop matches the selected month, filters and search."
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {pageRows.map((entry, index) => {
                                            const impactRow = entry.attributedRow ?? entry.currentRow
                                            const overdue = isOverdueFollowUp(entry)
                                            return (
                                                <TableRow key={entry.shopId} className="hover:bg-[var(--sera-mist)]/60">
                                                    <TableCell className="text-right tabular-nums text-[11px] text-[var(--sera-muted)]">
                                                        {currentPage * PAGE_SIZE + index + 1}
                                                    </TableCell>
                                                    <TableCell><PriorityPill priority={entry.priority} /></TableCell>
                                                    <TableCell>
                                                        <div className="min-w-[9rem] font-medium">{entry.shopNamePrimary}</div>
                                                        {entry.shopBranchLabel && (
                                                            <div className="text-[11px] text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{entry.region || '—'}</TableCell>
                                                    <TableCell className={entry.ownerAmName ? '' : 'text-amber-700'}>
                                                        {entry.ownerAmName || UNASSIGNED_AM_LABEL}
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">{formatDate(entry.currentRow.visit_date)}</TableCell>
                                                    <TableCell><OutcomePill outcome={entry.outcome} /></TableCell>
                                                    <TableCell className="whitespace-nowrap">{formatDateTime(impactRow.last_scan_after_at)}</TableCell>
                                                    <TableCell className="whitespace-nowrap">{entry.action}</TableCell>
                                                    <TableCell className={`whitespace-nowrap ${overdue ? 'font-semibold text-rose-600' : ''}`}>
                                                        {formatDate(entry.dueDate)}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                            {queue.length > PAGE_SIZE && (
                                <div className="flex items-center justify-between border-t border-[var(--sera-line)] px-3 py-2 text-xs text-[var(--sera-muted)]">
                                    <span>
                                        Showing {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + pageRows.length} of {queue.length}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Prev</Button>
                                        <span>Page {currentPage + 1} / {totalPages}</span>
                                        <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((value) => value + 1)}>Next</Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <KpiDrilldownDialog
                        open={kpiDrilldown !== null}
                        onOpenChange={(open) => { if (!open) setKpiDrilldown(null) }}
                        title={kpiDrilldown
                            ? `${KPI_DRILLDOWN_TITLE[kpiDrilldown]} — ${drilldownRows.length} ${drilldownRows.length === 1 ? 'Shop' : 'Shops'}`
                            : ''}
                        subtitle={month.label}
                    >
                        {drilldownRows.length === 0 ? (
                            <KpiDrilldownEmpty message="No records for this metric." />
                        ) : (
                            <Table className="text-xs">
                                <TableHeader>
                                    <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                        <TableHead className="w-10 text-right">#</TableHead>
                                        <TableHead>Shop</TableHead>
                                        <TableHead>Region</TableHead>
                                        <TableHead>Responsible AM</TableHead>
                                        <TableHead>Priority</TableHead>
                                        <TableHead>Observation Status</TableHead>
                                        <TableHead>Last Visit</TableHead>
                                        <TableHead>Recommended Action</TableHead>
                                        <TableHead>Follow-Up Due</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                                    {drilldownRows.map((entry, index) => (
                                        <TableRow key={entry.shopId}>
                                            <TableCell className="text-right tabular-nums text-[11px] text-[var(--sera-muted)]">{index + 1}</TableCell>
                                            <TableCell>
                                                <div className="font-medium">{entry.shopNamePrimary}</div>
                                                {entry.shopBranchLabel && (
                                                    <div className="text-[11px] text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>
                                                )}
                                            </TableCell>
                                            <TableCell>{entry.region || '—'}</TableCell>
                                            <TableCell className={entry.ownerAmName ? '' : 'text-amber-700'}>
                                                {entry.ownerAmName || UNASSIGNED_AM_LABEL}
                                            </TableCell>
                                            <TableCell><PriorityPill priority={entry.priority} /></TableCell>
                                            <TableCell><OutcomePill outcome={entry.outcome} /></TableCell>
                                            <TableCell className="whitespace-nowrap">{formatDate(entry.currentRow.visit_date)}</TableCell>
                                            <TableCell className="whitespace-nowrap">{entry.action}</TableCell>
                                            <TableCell className={`whitespace-nowrap ${isOverdueFollowUp(entry) ? 'font-semibold text-rose-600' : ''}`}>
                                                {formatDate(entry.dueDate)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </KpiDrilldownDialog>
                </>
            )}
        </div>
    )
}
