'use client'

// Shop drill-down — per-shop detail behind Monthly Overview and AM Performance.
// This is the only place that offers the 3D early-signal and 30D sustained-impact
// windows; every official management number stays on 7D.

import { useMemo, useState } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyBlock, LoadingBlock } from '../analytics/shared'
import { RoadtourStateFlag } from '../RoadtourStateFlag'
import { ReportingHeader } from './ReportingHeader'
import { OutcomePill, downloadCsv, formatDate, formatDateTime } from './ui'
import { useMonthlyReporting } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import { buildShopEntries, type ShopReportEntry } from '@/modules/roadtour/lib/reporting/aggregate'
import {
    DRILLDOWN_IMPACT_WINDOWS,
    IMPACT_METHOD_NOTE,
    OFFICIAL_IMPACT_WINDOW_DAYS,
} from '@/modules/roadtour/lib/reporting/impactModel'
import { resolveParticipantDisplay } from '@/modules/roadtour/lib/reporting/shopDisplay'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'
import { cn } from '@/lib/utils'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 25

export function ShopDrilldownView({ userProfile }: Props) {
    const organizationId = userProfile?.organizations?.id ?? userProfile?.organization_id ?? null
    const reporting = useMonthlyReporting(organizationId)
    const { dataset, loading, error, month, windowDays } = reporting
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(0)
    const [selectedShopId, setSelectedShopId] = useState<string | null>(null)

    const entries = useMemo(() => (dataset ? buildShopEntries(dataset.rows) : []), [dataset])

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return entries
        return entries.filter((entry) => (
            `${entry.shopName} ${entry.shopCode ?? ''} ${entry.region ?? ''}`.toLowerCase().includes(term)
        ))
    }, [entries, search])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const currentPage = Math.min(page, totalPages - 1)
    const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    const selected = filtered.find((entry) => entry.shopId === selectedShopId) ?? null

    const exportShops = () => {
        if (!dataset) return
        downloadCsv(
            `roadtour-shop-impact-${dataset.meta.monthKey}-${windowDays}d.csv`,
            ['Shop', 'Branch', 'Participant', 'Phone', 'Region', 'Campaign', 'Account Manager', 'Visit Date', `Before ${windowDays}D`, `After ${windowDays}D`, 'Outcome', 'Last Valid Scan'],
            filtered.map((entry) => {
                const row = entry.attributedRow ?? entry.currentRow
                return [
                    entry.shopNamePrimary,
                    entry.shopBranchLabel ?? '',
                    row.latest_participant_name ?? '',
                    row.latest_participant_phone ?? '',
                    entry.region ?? '',
                    row.campaign_name,
                    entry.ownerAmName ?? UNASSIGNED_AM_LABEL,
                    entry.currentRow.visit_date,
                    row.before_scans,
                    row.after_scans,
                    entry.outcome,
                    row.last_scan_after_at ?? '',
                ]
            }),
        )
    }

    return (
        <div className="sera-sc-page space-y-6">
            <ReportingHeader
                title="Shop Impact Detail"
                description="Per-shop product-QR activity before and after each RoadTour visit."
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
                onExport={exportShops}
                exportDisabled={filtered.length === 0}
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

            {loading && <Card><LoadingBlock label="Loading shop impact…" /></Card>}

            {!loading && dataset && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle className="text-base">Shops ({filtered.length})</CardTitle>
                                    <p className="text-xs text-[var(--sera-muted)]">
                                        {windowDays === OFFICIAL_IMPACT_WINDOW_DAYS
                                            ? IMPACT_METHOD_NOTE
                                            : `Drill-down view: ${windowDays} days before vs ${windowDays} days after each visit.`}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sera-muted)]" />
                                        <Input
                                            className="w-56 pl-9" placeholder="Search shop or region"
                                            value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }}
                                        />
                                    </div>
                                    <div className="flex overflow-hidden rounded-md border border-[var(--sera-line)]">
                                        {DRILLDOWN_IMPACT_WINDOWS.map((days) => (
                                            <button
                                                key={days}
                                                type="button"
                                                onClick={() => reporting.setWindowDays(days)}
                                                className={cn(
                                                    'px-2.5 py-1.5 text-xs font-medium transition-colors',
                                                    days === windowDays
                                                        ? 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)]'
                                                        : 'text-[var(--sera-muted)] hover:bg-[var(--sera-mist)]',
                                                )}
                                            >
                                                {days}D
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Shop</TableHead>
                                            <TableHead>Participant</TableHead>
                                            <TableHead className="w-[84px] text-center">Region</TableHead>
                                            <TableHead>Visit Date</TableHead>
                                            <TableHead className="text-right">Before {windowDays}D</TableHead>
                                            <TableHead className="text-right">After {windowDays}D</TableHead>
                                            <TableHead>Outcome</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {pageRows.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={7}>
                                                    <EmptyBlock title="No shops matched this month and search." />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {pageRows.map((entry) => {
                                            const row = entry.attributedRow ?? entry.currentRow
                                            const participant = resolveParticipantDisplay({
                                                participantCount: row.participant_count,
                                                latestParticipantName: row.latest_participant_name,
                                                latestParticipantPhone: row.latest_participant_phone,
                                            })
                                            return (
                                                <TableRow
                                                    key={entry.shopId}
                                                    className={cn('cursor-pointer', selectedShopId === entry.shopId && 'bg-[var(--sera-mist)]')}
                                                    onClick={() => setSelectedShopId(entry.shopId)}
                                                >
                                                    <TableCell>
                                                        <div className="min-w-[10rem] font-medium">{entry.shopNamePrimary}</div>
                                                        {entry.shopBranchLabel && (
                                                            <div className="text-xs text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className={cn('min-w-[9rem]', participant.isPlaceholder && 'text-[var(--sera-muted)]')}>
                                                            {participant.primary}
                                                        </div>
                                                        {participant.secondary && (
                                                            <div className="text-xs text-[var(--sera-muted)]">{participant.secondary}</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <div className="flex justify-center">
                                                            <RoadtourStateFlag stateName={entry.region} size="md" fallback="badge" />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">{formatDate(entry.currentRow.visit_date)}</TableCell>
                                                    <TableCell className="text-right">{row.before_scans}</TableCell>
                                                    <TableCell className="text-right">{row.after_scans}</TableCell>
                                                    <TableCell><OutcomePill outcome={entry.outcome} /></TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                            {filtered.length > PAGE_SIZE && (
                                <div className="flex items-center justify-between border-t border-[var(--sera-line)] px-3 py-2 text-xs text-[var(--sera-muted)]">
                                    <span>Showing {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + pageRows.length} of {filtered.length}</span>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Prev</Button>
                                        <span>Page {currentPage + 1} / {totalPages}</span>
                                        <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((value) => value + 1)}>Next</Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <ShopSnapshot entry={selected} windowDays={windowDays} onClose={() => setSelectedShopId(null)} />
                </div>
            )}
        </div>
    )
}

function ShopSnapshot({ entry, windowDays, onClose }: {
    entry: ShopReportEntry | null
    windowDays: number
    onClose: () => void
}) {
    if (!entry) {
        return (
            <Card className="hidden lg:block">
                <CardHeader className="pb-2"><CardTitle className="text-base">Shop Snapshot</CardTitle></CardHeader>
                <CardContent>
                    <EmptyBlock title="Select a shop" description="Click any row to see that shop's visit and scan detail." />
                </CardContent>
            </Card>
        )
    }

    const row = entry.attributedRow ?? entry.currentRow
    const participant = resolveParticipantDisplay({
        participantCount: row.participant_count,
        latestParticipantName: row.latest_participant_name,
        latestParticipantPhone: row.latest_participant_phone,
    })

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Shop Snapshot</CardTitle>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close snapshot"><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <div>
                    <div className="font-semibold text-[var(--sera-ink)]">{entry.shopNamePrimary}</div>
                    {entry.shopBranchLabel && <div className="text-xs text-[var(--sera-muted)]">{entry.shopBranchLabel}</div>}
                    {entry.shopCode && <div className="text-xs text-[var(--sera-muted)]">Code: {entry.shopCode}</div>}
                    {entry.region && <div className="text-xs text-[var(--sera-muted)]">Region: {entry.region}</div>}
                    <div className="mt-2"><OutcomePill outcome={entry.outcome} /></div>
                </div>

                <dl className="space-y-1.5 border-t border-[var(--sera-line)] pt-3 text-xs">
                    <SnapshotRow label="Responsible AM" value={entry.ownerAmName || UNASSIGNED_AM_LABEL} />
                    <SnapshotRow label="Participant" value={participant.secondary ? `${participant.primary} · ${participant.secondary}` : participant.primary} />
                    <SnapshotRow label="Campaign" value={row.campaign_name} />
                    <SnapshotRow label="Visits this month" value={String(entry.visitCount)} />
                    <SnapshotRow label="Latest visit" value={formatDateTime(entry.currentRow.visit_at)} />
                    <SnapshotRow label="Observation completes" value={formatDateTime((entry.attributedRow ?? entry.currentRow).matures_at)} />
                    <SnapshotRow label="Last valid scan after" value={formatDateTime(row.last_scan_after_at)} />
                    <SnapshotRow label="Recommended action" value={entry.action} />
                    <SnapshotRow label="Follow-up due" value={formatDate(entry.dueDate)} />
                </dl>

                <div className="grid grid-cols-2 gap-2 border-t border-[var(--sera-line)] pt-3 text-center">
                    <div className="rounded border border-[var(--sera-line)] p-2">
                        <div className="text-[11px] text-[var(--sera-muted)]">Before {windowDays}D</div>
                        <div className="font-display text-lg font-semibold">{row.before_scans}</div>
                    </div>
                    <div className="rounded border border-[var(--sera-line)] p-2">
                        <div className="text-[11px] text-[var(--sera-muted)]">After {windowDays}D</div>
                        <div className="font-display text-lg font-semibold">{row.after_scans}</div>
                    </div>
                </div>

                {row.notes && (
                    <div className="border-t border-[var(--sera-line)] pt-3">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">Visit notes</div>
                        <p className="whitespace-pre-wrap rounded bg-[var(--sera-mist)]/60 p-2 text-xs">{row.notes}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-[var(--sera-muted)]">{label}</dt>
            <dd className="min-w-0 break-words text-right text-[var(--sera-ink)]">{value}</dd>
        </div>
    )
}
