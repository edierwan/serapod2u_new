'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line,
} from 'recharts'
import { Store, TrendingUp, TrendingDown, BarChart3, Calendar, X } from 'lucide-react'
import { AnalyticsFilterBar } from './AnalyticsFilterBar'
import {
    KpiCard, LoadingBlock, EmptyBlock, StatusPill,
    formatLiftPercent, formatNumber, PageHeader,
} from './shared'
import { useImpactDataset } from '@/modules/roadtour/lib/analytics/useImpactDataset'
import { resolveShopImpactParticipantDisplay } from '@/modules/roadtour/lib/analytics/shopImpactDetail'
import type { ImpactStatus, VisitImpactRow } from '@/modules/roadtour/types/analytics'
import { RoadtourStateFlag } from '../RoadtourStateFlag'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 10

export function ShopImpactDetailView({ userProfile }: Props) {
    const companyId = userProfile?.organizations?.id
    const { dataset, loading, filters, setFilters } = useImpactDataset(companyId)
    const [statusFilter, setStatusFilter] = useState<ImpactStatus | 'all'>('all')
    const [shopSearch, setShopSearch] = useState('')
    const [page, setPage] = useState(0)
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const filtered = useMemo(() => {
        if (!dataset) return []
        const term = shopSearch.trim().toLowerCase()
        return dataset.visits.filter((v) => {
            if (statusFilter !== 'all' && v.status !== statusFilter) return false
            if (term && !(`${v.shop_name} ${v.shop_code ?? ''}`).toLowerCase().includes(term)) return false
            return true
        })
    }, [dataset, statusFilter, shopSearch])

    const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

    const top10 = useMemo(() => {
        return [...filtered]
            .filter((v) => v.scan_lift_percent !== null)
            .sort((a, b) => (b.scan_lift_percent ?? 0) - (a.scan_lift_percent ?? 0))
            .slice(0, 10)
            .map((v) => ({ name: v.shop_name, lift: v.scan_lift_percent ?? 0 }))
    }, [filtered])

    const selected: VisitImpactRow | null = selectedId ? filtered.find((v) => v.visit_id === selectedId) || null : null

    const s = dataset?.summary
    const w = dataset?.windowDays ?? filters.windowDays
    const droppedCount = s?.dropped_shops ?? 0

    return (
        <div className="space-y-4">
            <PageHeader
                overline="RoadTour Analytics"
                title="Shop Impact Detail"
                description="Per-shop drilldown of QR scan activity before and after RoadTour visits."
            />

            <AnalyticsFilterBar
                filters={filters} setFilters={setFilters} dataset={dataset}
                showStatus statusValue={statusFilter} onStatusChange={(v) => { setStatusFilter(v); setPage(0) }}
                showShopSearch shopSearchValue={shopSearch} onShopSearchChange={(v) => { setShopSearch(v); setPage(0) }}
            />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && dataset && (
                <>
                    {dataset.missingDataNote && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                            {dataset.missingDataNote}
                        </div>
                    )}

                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                        <KpiCard label="Total Shops Analyzed" value={formatNumber(s!.visited_shops)} icon={Store} accent="blue" />
                        <KpiCard label="Improved Shops" value={formatNumber(s!.improved_shops)} icon={TrendingUp} accent="green" />
                        <KpiCard label="Dropped Shops" value={formatNumber(droppedCount)} icon={TrendingDown} accent="rose" />
                        <KpiCard label="Avg Lift" value={formatLiftPercent(s!.avg_scan_lift_percent)} icon={BarChart3} accent="cyan" />
                        <KpiCard label="Median Lift" value={formatLiftPercent(s!.median_scan_lift_percent)} icon={BarChart3} accent="violet" />
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
                        <div className="space-y-3">
                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base">Top 10 Shops by Scan Lift %</CardTitle></CardHeader>
                                <CardContent>
                                    {top10.length === 0 ? <EmptyBlock title="No lift data" /> : (
                                        <div className="h-56">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={top10}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
                                                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                                                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                                                    <Bar dataKey="lift" fill="#10b981" radius={[3, 3, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Shop</TableHead>
                                                    <TableHead>Participant</TableHead>
                                                    <TableHead className="w-[84px] text-center">Region</TableHead>
                                                    <TableHead>Campaign</TableHead>
                                                    <TableHead>Visit Date</TableHead>
                                                    <TableHead className="text-right">Before {w}D</TableHead>
                                                    <TableHead className="text-right">After {w}D</TableHead>
                                                    <TableHead className="text-right">Lift %</TableHead>
                                                    <TableHead>Last Scan After</TableHead>
                                                    <TableHead>Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {pageRows.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={9}>
                                                            <EmptyBlock title="No shops matched the filters." />
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                                {pageRows.map((row) => {
                                                    const participantDisplay = resolveShopImpactParticipantDisplay({
                                                        participantCount: row.participant_count,
                                                        latestParticipantName: row.latest_participant_name,
                                                        latestParticipantPhone: row.latest_participant_phone,
                                                    })

                                                    return (
                                                        <TableRow
                                                            key={row.visit_id}
                                                            className={`cursor-pointer ${selectedId === row.visit_id ? 'bg-accent' : ''}`}
                                                            onClick={() => setSelectedId(row.visit_id)}
                                                        >
                                                            <TableCell>
                                                                <div className="min-w-[180px]">
                                                                    <div className="font-medium">{row.shop_name_primary}</div>
                                                                    {row.shop_branch_label && (
                                                                        <div className="text-xs text-muted-foreground">{row.shop_branch_label}</div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="min-w-[160px]">
                                                                    <div className={`font-medium ${participantDisplay.isPlaceholder ? 'text-muted-foreground' : ''}`}>{participantDisplay.primary}</div>
                                                                    {participantDisplay.secondary && (
                                                                        <div className="text-xs text-muted-foreground">{participantDisplay.secondary}</div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                <div className="flex justify-center">
                                                                    <RoadtourStateFlag stateName={row.shop_region} size="md" fallback="badge" />
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>{row.campaign_name}</TableCell>
                                                            <TableCell>{row.visit_date}</TableCell>
                                                            <TableCell className="text-right">{row.before_scans}</TableCell>
                                                            <TableCell className="text-right">{row.after_scans}</TableCell>
                                                            <TableCell className={`text-right font-semibold ${row.scan_lift_percent === null ? 'text-[var(--sera-ink-soft)]' : row.scan_lift_percent >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                                                                {row.status === 'newly_activated' ? 'NEW' : formatLiftPercent(row.scan_lift_percent)}
                                                            </TableCell>
                                                            <TableCell>{row.last_scan_after_at ? new Date(row.last_scan_after_at).toLocaleString() : '—'}</TableCell>
                                                            <TableCell><StatusPill status={row.status} /></TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                    <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
                                        <div>Showing {pageRows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + pageRows.length} of {filtered.length}</div>
                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
                                            <span>Page {page + 1} / {totalPages}</span>
                                            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next</Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <ShopSnapshotPanel row={selected} windowDays={w} onClose={() => setSelectedId(null)} />
                    </div>
                </>
            )}
        </div>
    )
}

function ShopSnapshotPanel({ row, windowDays, onClose }: { row: VisitImpactRow | null; windowDays: number; onClose: () => void }) {
    if (!row) {
        return (
            <Card className="hidden lg:block">
                <CardHeader className="pb-2"><CardTitle className="text-base">Selected Shop Snapshot</CardTitle></CardHeader>
                <CardContent>
                    <EmptyBlock title="Select a shop" description="Click any row in the table to see detailed shop impact." />
                </CardContent>
            </Card>
        )
    }
    const participantDisplay = resolveShopImpactParticipantDisplay({
        participantCount: row.participant_count,
        latestParticipantName: row.latest_participant_name,
        latestParticipantPhone: row.latest_participant_phone,
    })
    const trend = [
        ...row.daily_before.map((d) => ({ label: `D${d.day}`, count: d.count })),
        ...row.daily_after.map((d) => ({ label: `D+${d.day}`, count: d.count })),
    ]
    return (
        <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Selected Shop Snapshot</CardTitle>
                <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-3">
                <div>
                    <div className="text-sm font-semibold">{row.shop_name_primary}</div>
                    {row.shop_branch_label && <div className="text-xs text-muted-foreground">{row.shop_branch_label}</div>}
                    {row.shop_code && <div className="text-xs text-muted-foreground">Code: {row.shop_code}</div>}
                    {row.shop_region && <div className="text-xs text-muted-foreground">Region: {row.shop_region}</div>}
                    <div className="text-xs text-muted-foreground">Participant: {participantDisplay.primary}{participantDisplay.secondary ? ` • ${participantDisplay.secondary}` : ''}</div>
                    <div className="mt-1"><StatusPill status={row.status} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Before {windowDays}D</div><div className="text-lg font-bold">{row.before_scans}</div></div>
                    <div className="rounded border p-2"><div className="text-xs text-muted-foreground">After {windowDays}D</div><div className="text-lg font-bold">{row.after_scans}</div></div>
                </div>
                <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={Math.max(1, Math.floor(trend.length / 6))} />
                            <YAxis tick={{ fontSize: 9 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Lift</span><span className="font-semibold text-emerald-700">{row.status === 'newly_activated' ? 'NEW' : formatLiftPercent(row.scan_lift_percent)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last Scan After</span><span>{row.last_scan_after_at ? new Date(row.last_scan_after_at).toLocaleString() : '—'}</span></div>
                </div>
                {row.notes && (
                    <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Visit Notes</div>
                        <p className="text-xs text-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap line-clamp-6">{row.notes}</p>
                    </div>
                )}
                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Recommended Next Action</div>
                    <p className="text-sm">{recommendedActionFor(row)}</p>
                </div>
                <div className="flex flex-col gap-2 pt-2 border-t">
                    <Button disabled title="Coming soon" className="w-full"><Calendar className="h-4 w-4 mr-1.5" />Create Follow-Up Task</Button>
                    <button disabled className="text-xs text-muted-foreground hover:underline hover:text-[var(--sera-orange-deep)] disabled:opacity-60">View Full Shop History</button>
                </div>
            </CardContent>
        </Card>
    )
}

function recommendedActionFor(row: VisitImpactRow): string {
    if (row.status === 'no_response' && row.days_since_visit >= 7) return 'Immediate visit — no scans recorded in 7+ days.'
    if (row.status === 'no_response') return 'Follow-up within 48 hours — no scans recorded post-visit.'
    if (row.status === 'dropped') return 'Call & re-engage — scan activity has dropped after visit.'
    if (row.status === 'newly_activated') return 'Nurture engagement — newly activated shop, introduce loyalty program.'
    if (row.status === 'improved') return 'Praise & upsell — sustain momentum with bundle offers.'
    return 'Monitor and reinforce engagement.'
}
