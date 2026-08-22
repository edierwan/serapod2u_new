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
import { OutcomePill, PriorityPill, downloadCsv, formatDate, formatDateTime } from './ui'
import { useMonthlyReporting } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import {
    buildFollowUpSummary,
    buildShopEntries,
    isOverdueFollowUp,
    sortFollowUpQueue,
} from '@/modules/roadtour/lib/reporting/aggregate'
import { IMPACT_METHOD_NOTE } from '@/modules/roadtour/lib/reporting/impactModel'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'
import type { FollowUpPriority } from '@/modules/roadtour/lib/reporting/followUp'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 25
type QueueFilter = 'actionable' | 'all' | FollowUpPriority

export function ShopFollowUpView({ userProfile }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null
    const reporting = useMonthlyReporting(organizationId)
    const { dataset, loading, error, month } = reporting
    const [queueFilter, setQueueFilter] = useState<QueueFilter>('actionable')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)

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
        return sortFollowUpQueue(filtered)
    }, [entries, queueFilter, search])

    const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE))
    const currentPage = Math.min(page, totalPages - 1)
    const pageRows = queue.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

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
                        <KpiCard label="High Priority" icon={Flag} accent="rose" value={summary.highPriority} sub="matured, no response or steep drop" />
                        <KpiCard label="Due Today" icon={CalendarClock} accent="amber" value={summary.dueToday} sub="actionable today" />
                        <KpiCard label="Overdue" icon={CalendarClock} accent="rose" value={summary.overdue} sub="past their due date" />
                        <KpiCard label="Unassigned Shops" icon={UserX} accent="slate" value={summary.unassignedShops} sub="no responsible AM" />
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
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-24">Priority</TableHead>
                                            <TableHead>Shop</TableHead>
                                            <TableHead>Region</TableHead>
                                            <TableHead>Responsible AM</TableHead>
                                            <TableHead>Last Visit</TableHead>
                                            <TableHead>Observation Status</TableHead>
                                            <TableHead>Last Valid Scan</TableHead>
                                            <TableHead>Recommended Action</TableHead>
                                            <TableHead>Follow-Up Due</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {pageRows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={9}>
                                                    <EmptyBlock
                                                        title="Nothing in this queue"
                                                        description="No shop matches the selected month, filters and search."
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {pageRows.map((entry) => {
                                            const impactRow = entry.attributedRow ?? entry.currentRow
                                            const overdue = isOverdueFollowUp(entry)
                                            return (
                                                <TableRow key={entry.shopId}>
                                                    <TableCell><PriorityPill priority={entry.priority} /></TableCell>
                                                    <TableCell>
                                                        <div className="min-w-[10rem] font-medium">{entry.shopNamePrimary}</div>
                                                        {entry.shopBranchLabel && (
                                                            <div className="text-xs text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{entry.region || '—'}</TableCell>
                                                    <TableCell className={entry.ownerAmName ? '' : 'text-amber-700'}>
                                                        {entry.ownerAmName || UNASSIGNED_AM_LABEL}
                                                    </TableCell>
                                                    <TableCell>{formatDate(entry.currentRow.visit_date)}</TableCell>
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
                </>
            )}
        </div>
    )
}
