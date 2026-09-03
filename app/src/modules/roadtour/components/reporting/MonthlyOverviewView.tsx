'use client'

// Monthly Overview — the default RoadTour Reporting page.
// Four KPIs, two sections, at most two derived insights. Nothing else.

import { useMemo } from 'react'
import { AlertTriangle, Info, Store, TrendingUp, Flag, Target } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyBlock, KpiCard, LoadingBlock } from '../analytics/shared'
import { ReportingHeader } from './ReportingHeader'
import { SegmentedOutcomeBar, downloadCsv, formatPercent } from './ui'
import { useMonthlyReporting } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import {
    buildAmPerformance,
    buildManagementInsights,
    buildOverviewSummary,
    buildShopEntries,
} from '@/modules/roadtour/lib/reporting/aggregate'
import { IMPACT_METHOD_NOTE } from '@/modules/roadtour/lib/reporting/impactModel'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

export function MonthlyOverviewView({ userProfile, onViewChange }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null
    const reporting = useMonthlyReporting(organizationId)
    const { dataset, loading, error, month } = reporting

    const model = useMemo(() => {
        if (!dataset) return null
        const entries = buildShopEntries(dataset.rows)
        const summary = buildOverviewSummary(entries, dataset.rows)
        const amPerformance = buildAmPerformance(entries, dataset.rows)
        return {
            entries,
            summary,
            amPerformance,
            insights: buildManagementInsights(entries, summary, amPerformance),
        }
    }, [dataset])

    const exportReport = () => {
        if (!model || !dataset) return
        downloadCsv(
            `roadtour-monthly-overview-${dataset.meta.monthKey}.csv`,
            ['Shop', 'Region', 'Account Manager', 'Visits', 'Last Visit', 'Matured', 'Before 7D', 'After 7D', 'Outcome', 'Priority', 'Follow-Up Due'],
            model.entries.map((entry) => [
                entry.shopName,
                entry.region ?? '',
                entry.ownerAmName ?? UNASSIGNED_AM_LABEL,
                entry.visitCount,
                entry.currentRow.visit_date,
                entry.matured ? 'Yes' : 'No',
                (entry.attributedRow ?? entry.currentRow).before_scans,
                (entry.attributedRow ?? entry.currentRow).after_scans,
                entry.outcome,
                entry.priority,
                entry.dueDate,
            ]),
        )
    }

    return (
        <div className="sera-sc-page space-y-6">
            <ReportingHeader
                title="Monthly Overview"
                description="How many shops were visited this month, how many responded, and what needs attention."
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
                exportDisabled={!model || model.entries.length === 0}
            />

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {dataset?.meta.warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{warning}</span>
                </div>
            ))}

            {loading && <Card><LoadingBlock label="Loading monthly reporting…" /></Card>}

            {!loading && model && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <KpiCard
                            label="Shops Visited" icon={Store} accent="orange"
                            value={model.summary.shopsVisited}
                            sub={`${model.summary.totalVisits} visits in ${month.label}`}
                        />
                        <KpiCard
                            label="Shops Responding" icon={TrendingUp} accent="green"
                            value={model.summary.respondingShops}
                            sub={`of ${model.summary.maturedShops} matured shops`}
                        />
                        <KpiCard
                            label="Shops Requiring Follow-Up" icon={Flag} accent="rose"
                            value={model.summary.shopsRequiringFollowUp}
                            sub="Dropped, no response or overdue"
                        />
                        <KpiCard
                            label="Visit-to-Scan Conversion" icon={Target} accent="amber"
                            value={formatPercent(model.summary.visitToScanConversion)}
                            sub={model.summary.maturedShops > 0
                                ? `${model.summary.respondingShops} of ${model.summary.maturedShops} matured shops`
                                : 'No shop has completed the 7-day window yet'}
                        />
                    </div>

                    {model.insights.length > 0 && (
                        <div className="space-y-1.5 rounded-lg border border-[var(--sera-line)] bg-[var(--sera-mist)]/50 px-4 py-3">
                            {model.insights.map((insight) => (
                                <p key={insight} className="flex items-start gap-2 text-sm text-[var(--sera-ink-soft)]">
                                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sera-orange)]" />
                                    <span>{insight}</span>
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Account Manager Summary</CardTitle>
                                <p className="text-xs text-[var(--sera-muted)]">Top five by 7D response rate. {IMPACT_METHOD_NOTE}</p>
                            </CardHeader>
                            <CardContent className="p-0">
                                {model.amPerformance.rows.length === 0 ? (
                                    <EmptyBlock
                                        title="No account manager activity"
                                        description="No visit in this month could be attributed to an account manager."
                                    />
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Account Manager</TableHead>
                                                    <TableHead className="text-right">Shops</TableHead>
                                                    <TableHead className="text-right">Matured</TableHead>
                                                    <TableHead className="text-right">Responded</TableHead>
                                                    <TableHead className="text-right">No Response</TableHead>
                                                    <TableHead className="text-right">Follow-Up Due</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {model.amPerformance.rows.slice(0, 5).map((row) => (
                                                    <TableRow
                                                        key={row.amId}
                                                        className="cursor-pointer"
                                                        onClick={() => onViewChange('roadtour-am-performance')}
                                                    >
                                                        <TableCell className="font-medium">{row.amName}</TableCell>
                                                        <TableCell className="text-right">{row.shopsVisited}</TableCell>
                                                        <TableCell className="text-right">{row.maturedShops}</TableCell>
                                                        <TableCell className="text-right text-emerald-700">{row.respondedShops}</TableCell>
                                                        <TableCell className="text-right">{row.noResponseShops}</TableCell>
                                                        <TableCell className={`text-right ${row.followUpsOverdue > 0 ? 'font-semibold text-rose-600' : ''}`}>
                                                            {row.followUpsOverdue}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                                {model.amPerformance.unassignedVisits > 0 && (
                                    <p className="border-t border-[var(--sera-line)] px-4 py-2.5 text-sm text-amber-800">
                                        Unassigned Visits: <span className="font-semibold">{model.amPerformance.unassignedVisits}</span>
                                        <span className="ml-1 text-xs text-[var(--sera-muted)]">
                                            ({model.amPerformance.unassignedShops} shops) — excluded from the leaderboard.
                                        </span>
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Shop Outcome</CardTitle>
                                <p className="text-xs text-[var(--sera-muted)]">
                                    One outcome per shop, from its latest matured visit.
                                </p>
                            </CardHeader>
                            <CardContent>
                                <SegmentedOutcomeBar counts={model.summary.outcomeCounts} total={model.summary.shopsVisited} />
                            </CardContent>
                        </Card>
                    </div>

                    <p className="text-xs text-[var(--sera-muted)]">{IMPACT_METHOD_NOTE}</p>
                </>
            )}
        </div>
    )
}
