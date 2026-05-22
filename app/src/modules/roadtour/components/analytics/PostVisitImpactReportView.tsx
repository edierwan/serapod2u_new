'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, ReferenceLine,
} from 'recharts'
import { Store, TrendingUp, UserPlus, AlertCircle, Scan, Target, Lightbulb } from 'lucide-react'
import { AnalyticsFilterBar } from './AnalyticsFilterBar'
import {
    KpiCard, LoadingBlock, EmptyBlock, StatusPill,
    formatLiftPercent, formatNumber, PageHeader,
} from './shared'
import { useImpactDataset } from '@/modules/roadtour/lib/analytics/useImpactDataset'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const STATUS_COLORS: Record<string, string> = {
    Improved: '#10b981', Maintained: '#0ea5e9', Dropped: '#f59e0b',
    'Newly Activated': '#8b5cf6', 'No Response': '#ef4444',
}

export function PostVisitImpactReportView({ userProfile }: Props) {
    const companyId = userProfile?.organizations?.id
    const { dataset, loading, filters, setFilters } = useImpactDataset(companyId)

    const aggregatedDaily = useMemo(() => {
        if (!dataset) return []
        const w = dataset.windowDays
        const beforeBuckets = new Map<number, number>()
        const afterBuckets = new Map<number, number>()
        for (let i = 1; i <= w; i++) { beforeBuckets.set(-i, 0); afterBuckets.set(i, 0) }
        for (const v of dataset.visits) {
            for (const d of v.daily_before) beforeBuckets.set(d.day, (beforeBuckets.get(d.day) || 0) + d.count)
            for (const d of v.daily_after) afterBuckets.set(d.day, (afterBuckets.get(d.day) || 0) + d.count)
        }
        const out: { label: string; day: number; before: number; after: number }[] = []
        for (let i = w; i >= 1; i--) out.push({ day: -i, label: `Day -${i}`, before: beforeBuckets.get(-i) || 0, after: 0 })
        for (let i = 1; i <= w; i++) out.push({ day: i, label: `Day +${i}`, before: 0, after: afterBuckets.get(i) || 0 })
        return out
    }, [dataset])

    const statusBreakdown = useMemo(() => {
        if (!dataset) return []
        const s = dataset.summary
        return [
            { name: 'Improved', value: s.improved_shops },
            { name: 'Maintained', value: s.maintained_shops },
            { name: 'Dropped', value: s.dropped_shops },
            { name: 'Newly Activated', value: s.newly_activated_shops },
            { name: 'No Response', value: s.no_response_shops },
        ].filter((r) => r.value > 0)
    }, [dataset])

    const impactByAm = useMemo(() => {
        if (!dataset) return []
        const map = new Map<string, { name: string; total: number; lifts: number[] }>()
        for (const v of dataset.visits) {
            const entry = map.get(v.account_manager_user_id) || { name: v.account_manager_name, total: 0, lifts: [] }
            entry.total++
            if (v.scan_lift_percent !== null) entry.lifts.push(v.scan_lift_percent)
            map.set(v.account_manager_user_id, entry)
        }
        return Array.from(map.values())
            .map((e) => ({ name: e.name, visits: e.total, avgLift: e.lifts.length ? e.lifts.reduce((a, b) => a + b, 0) / e.lifts.length : 0 }))
            .sort((a, b) => b.avgLift - a.avgLift)
            .slice(0, 8)
    }, [dataset])

    const topImpacted = useMemo(() => {
        if (!dataset) return []
        return [...dataset.visits]
            .filter((v) => v.scan_lift_percent !== null)
            .sort((a, b) => (b.scan_lift_percent ?? 0) - (a.scan_lift_percent ?? 0))
            .slice(0, 10)
    }, [dataset])

    const s = dataset?.summary
    const w = dataset?.windowDays ?? filters.windowDays

    return (
        <div className="space-y-4">
            <PageHeader
                overline="RoadTour Analytics"
                title="Post-Visit Impact Report"
                description="Management overview of QR scan activity before vs. after RoadTour visits, with shop impact classification and account manager performance."
            />

            <AnalyticsFilterBar filters={filters} setFilters={setFilters} dataset={dataset} />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && dataset && (
                <>
                    {dataset.missingDataNote && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                            {dataset.missingDataNote}
                        </div>
                    )}

                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
                        <KpiCard label="Visited Shops" value={formatNumber(s!.visited_shops)} icon={Store} accent="blue" />
                        <KpiCard label="Improved Shops" value={formatNumber(s!.improved_shops)} icon={TrendingUp} accent="green" />
                        <KpiCard label="Newly Activated" value={formatNumber(s!.newly_activated_shops)} icon={UserPlus} accent="violet" />
                        <KpiCard label="No Response" value={formatNumber(s!.no_response_shops)} icon={AlertCircle} accent="amber" />
                        <KpiCard label="Average QR Scan Lift" value={formatLiftPercent(s!.avg_scan_lift_percent)} icon={Scan} accent="cyan" />
                        <KpiCard label="Visit-to-Scan Conversion" value={`${(s!.visit_to_scan_conversion * 100).toFixed(1)}%`} icon={Target} accent="rose" />
                    </div>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">QR Scans: {w} Days Before vs {w} Days After Visit</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {aggregatedDaily.length === 0 ? (
                                <EmptyBlock title="No scan activity recorded" description="No QR scans were detected for visited shops within the selected window." />
                            ) : (
                                <div className="h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={aggregatedDaily}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                            <YAxis tick={{ fontSize: 11 }} />
                                            <Tooltip />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                            <ReferenceLine x={`Day -1`} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Visit', position: 'insideTop', fontSize: 11, fill: '#475569' }} />
                                            <Bar dataKey="before" name={`Before Visit (${w}D)`} fill="#60a5fa" radius={[3, 3, 0, 0]} />
                                            <Bar dataKey="after" name={`After Visit (${w}D)`} fill="#10b981" radius={[3, 3, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid gap-3 lg:grid-cols-3">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Shop Impact Status</CardTitle></CardHeader>
                            <CardContent>
                                {statusBreakdown.length === 0 ? <EmptyBlock title="No shop impact data" /> : (
                                    <div className="h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={statusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75}>
                                                    {statusBreakdown.map((entry) => (
                                                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#64748b'} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader className="pb-2"><CardTitle className="text-base">Impact by Account Manager (Avg Lift %)</CardTitle></CardHeader>
                            <CardContent>
                                {impactByAm.length === 0 ? <EmptyBlock title="No account manager data" /> : (
                                    <div className="h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={impactByAm} layout="vertical" margin={{ left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                                                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                                                <Bar dataKey="avgLift" fill="#10b981" radius={[0, 3, 3, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                            <CardTitle className="text-base">Top Impacted Shops</CardTitle>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" />Ranked by lift %</div>
                        </CardHeader>
                        <CardContent>
                            {topImpacted.length === 0 ? (
                                <EmptyBlock title="No post-visit impact data found for the selected filters." description="Try widening the date range or adjusting the window." />
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>#</TableHead>
                                                <TableHead>Shop</TableHead>
                                                <TableHead>Account Manager</TableHead>
                                                <TableHead>Visit Date</TableHead>
                                                <TableHead className="text-right">Before {w}D</TableHead>
                                                <TableHead className="text-right">After {w}D</TableHead>
                                                <TableHead className="text-right">Lift %</TableHead>
                                                <TableHead>Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {topImpacted.map((row, idx) => (
                                                <TableRow key={row.visit_id}>
                                                    <TableCell>{idx + 1}</TableCell>
                                                    <TableCell className="font-medium">{row.shop_name}</TableCell>
                                                    <TableCell>{row.account_manager_name}</TableCell>
                                                    <TableCell>{row.visit_date}</TableCell>
                                                    <TableCell className="text-right">{row.before_scans}</TableCell>
                                                    <TableCell className="text-right">{row.after_scans}</TableCell>
                                                    <TableCell className="text-right text-emerald-700 font-semibold">{formatLiftPercent(row.scan_lift_percent)}</TableCell>
                                                    <TableCell><StatusPill status={row.status} /></TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Summary Insights</CardTitle></CardHeader>
                        <CardContent>
                            <ul className="text-sm text-foreground space-y-2">
                                <li>• <span className="font-semibold">{s!.visited_shops > 0 ? ((s!.improved_shops / s!.visited_shops) * 100).toFixed(1) : '0.0'}%</span> of visited shops improved their QR scan activity after visit.</li>
                                <li>• Average scan lift was <span className="font-semibold">{formatLiftPercent(s!.avg_scan_lift_percent)}</span>{s!.median_scan_lift_percent !== null ? <> (median {formatLiftPercent(s!.median_scan_lift_percent)})</> : null}.</li>
                                <li>• <span className="font-semibold">{formatNumber(s!.newly_activated_shops)}</span> shops were newly activated after visits, indicating acquisition impact.</li>
                                {s!.no_response_shops > 0 && (
                                    <li>• <span className="font-semibold">{formatNumber(s!.no_response_shops)}</span> shops show no response — recommend follow-up.</li>
                                )}
                            </ul>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}
