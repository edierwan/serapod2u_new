'use client'

// AM Performance — which account managers produce shop response, and which need
// operational support. Ranked on the 7D response rate, but only among AMs with a
// reasonable matured sample; every rate is shown with its denominator.

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, TrendingUp, Users } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyBlock, KpiCard, LoadingBlock } from '../analytics/shared'
import { ReportingHeader } from './ReportingHeader'
import { OutcomePill, downloadCsv, formatDate, formatPercent } from './ui'
import { useMonthlyReporting } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import {
    buildAmPerformance,
    buildShopEntries,
    MIN_MATURED_SAMPLE_FOR_RANKING,
    type AmPerformanceRow,
} from '@/modules/roadtour/lib/reporting/aggregate'
import { IMPACT_METHOD_NOTE } from '@/modules/roadtour/lib/reporting/impactModel'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

export function AmPerformanceView({ userProfile }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null
    const reporting = useMonthlyReporting(organizationId)
    const { dataset, loading, error, month } = reporting
    const [drilldownAmId, setDrilldownAmId] = useState<string | null>(null)

    const model = useMemo(() => {
        if (!dataset) return null
        const entries = buildShopEntries(dataset.rows)
        return { entries, performance: buildAmPerformance(entries, dataset.rows) }
    }, [dataset])

    const drilldownAm: AmPerformanceRow | null = model?.performance.rows.find((row) => row.amId === drilldownAmId) ?? null
    const drilldownShops = useMemo(
        () => (model && drilldownAmId ? model.entries.filter((entry) => entry.creditedAmId === drilldownAmId) : []),
        [model, drilldownAmId],
    )

    const exportReport = () => {
        if (!model || !dataset) return
        downloadCsv(
            `roadtour-am-performance-${dataset.meta.monthKey}.csv`,
            ['Rank', 'Account Manager', 'Unique Shops Visited', 'Matured Shops', '7D Response Rate', 'Responded', 'Newly Activated / Improved', 'No Response', 'Follow-Ups Overdue'],
            model.performance.rows.map((row) => [
                row.rank ?? 'Low sample',
                row.amName,
                row.shopsVisited,
                row.maturedShops,
                row.responseRate === null ? '' : formatPercent(row.responseRate),
                row.respondedShops,
                row.improvedOrActivatedShops,
                row.noResponseShops,
                row.followUpsOverdue,
            ]),
        )
    }

    return (
        <div className="sera-sc-page space-y-6">
            <ReportingHeader
                title="AM Performance"
                description="Account manager results measured by shop response, not by visit count."
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
                onExport={exportReport}
                exportDisabled={!model || model.performance.rows.length === 0}
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

            {loading && <Card><LoadingBlock label="Loading account manager performance…" /></Card>}

            {!loading && model && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <KpiCard label="Active AMs" icon={Users} accent="orange" value={model.performance.activeAms} sub={`in ${month.label}`} />
                        <KpiCard label="Shops Visited" icon={Users} accent="slate" value={model.performance.teamShopsVisited} sub="unique shops" />
                        <KpiCard
                            label="7D Response Rate" icon={TrendingUp} accent="green"
                            value={formatPercent(model.performance.teamResponseRate)}
                            sub={model.performance.teamMaturedShops > 0
                                ? `${model.performance.teamRespondedShops} of ${model.performance.teamMaturedShops} matured shops`
                                : 'No matured shops yet'}
                        />
                        <KpiCard
                            label="Follow-Ups Overdue" icon={CalendarClock} accent="rose"
                            value={model.performance.teamFollowUpsOverdue} sub="past their due date"
                        />
                    </div>

                    {model.performance.unassignedVisits > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            <span className="font-semibold">Unassigned Visits: {model.performance.unassignedVisits}</span>
                            {' '}across {model.performance.unassignedShops} shops — no resolvable account manager, so they are reported as an exception and never ranked.
                        </div>
                    )}

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Leaderboard</CardTitle>
                            <p className="text-xs text-[var(--sera-muted)]">
                                Ranked by 7D response rate among AMs with at least {MIN_MATURED_SAMPLE_FOR_RANKING} matured shops.
                                Ties break on matured shops, then improved/newly activated, then overdue follow-ups. {IMPACT_METHOD_NOTE}
                            </p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-14">Rank</TableHead>
                                            <TableHead>Account Manager</TableHead>
                                            <TableHead className="text-right">Unique Shops</TableHead>
                                            <TableHead className="text-right">Matured Shops</TableHead>
                                            <TableHead className="text-right">7D Response Rate</TableHead>
                                            <TableHead className="text-right">Newly Activated / Improved</TableHead>
                                            <TableHead className="text-right">No Response</TableHead>
                                            <TableHead className="text-right">Follow-Ups Overdue</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {model.performance.rows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={8}>
                                                    <EmptyBlock
                                                        title="No account manager activity"
                                                        description="No visit in this month could be attributed to an account manager."
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {model.performance.rows.map((row) => (
                                            <TableRow
                                                key={row.amId}
                                                className="cursor-pointer"
                                                onClick={() => setDrilldownAmId(row.amId)}
                                            >
                                                <TableCell className="text-[var(--sera-muted)]">{row.rank ?? '—'}</TableCell>
                                                <TableCell className="font-medium">
                                                    {row.amName}
                                                    {!row.hasRankableSample && (
                                                        <span className="ml-2 rounded-full border border-[var(--sera-line)] bg-[var(--sera-mist)] px-1.5 py-0.5 text-[10px] text-[var(--sera-muted)]">
                                                            Low sample
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">{row.shopsVisited}</TableCell>
                                                <TableCell className="text-right">{row.maturedShops}</TableCell>
                                                <TableCell className="text-right">
                                                    <span className="font-semibold text-[var(--sera-ink)]">{formatPercent(row.responseRate)}</span>
                                                    <span className="ml-1 text-[11px] text-[var(--sera-muted)]">
                                                        ({row.respondedShops}/{row.maturedShops})
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right text-emerald-700">{row.improvedOrActivatedShops}</TableCell>
                                                <TableCell className="text-right">{row.noResponseShops}</TableCell>
                                                <TableCell className={`text-right ${row.followUpsOverdue > 0 ? 'font-semibold text-rose-600' : ''}`}>
                                                    {row.followUpsOverdue}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}

            <Dialog open={Boolean(drilldownAmId)} onOpenChange={(open) => !open && setDrilldownAmId(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{drilldownAm?.amName ?? UNASSIGNED_AM_LABEL} — {month.label}</DialogTitle>
                    </DialogHeader>
                    {drilldownShops.length === 0 ? (
                        <EmptyBlock title="No shops for this account manager." />
                    ) : (
                        <div className="max-h-[60vh] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Shop</TableHead>
                                        <TableHead>Last Visit</TableHead>
                                        <TableHead className="text-right">Before 7D</TableHead>
                                        <TableHead className="text-right">After 7D</TableHead>
                                        <TableHead>Outcome</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {drilldownShops.map((entry) => {
                                        const row = entry.attributedRow ?? entry.currentRow
                                        return (
                                            <TableRow key={entry.shopId}>
                                                <TableCell>
                                                    <div className="font-medium">{entry.shopNamePrimary}</div>
                                                    {entry.shopBranchLabel && (
                                                        <div className="text-xs text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>{formatDate(entry.currentRow.visit_date)}</TableCell>
                                                <TableCell className="text-right">{row.before_scans}</TableCell>
                                                <TableCell className="text-right">{row.after_scans}</TableCell>
                                                <TableCell><OutcomePill outcome={entry.outcome} /></TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
