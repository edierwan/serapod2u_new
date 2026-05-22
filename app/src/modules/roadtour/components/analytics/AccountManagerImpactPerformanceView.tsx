'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ZAxis, Legend,
} from 'recharts'
import { Users, TrendingUp, BarChart3, Trophy, ShieldAlert, Lightbulb } from 'lucide-react'
import { AnalyticsFilterBar } from './AnalyticsFilterBar'
import { KpiCard, LoadingBlock, EmptyBlock, formatLiftPercent, formatNumber, PageHeader } from './shared'
import { useImpactDataset } from '@/modules/roadtour/lib/analytics/useImpactDataset'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

interface AmRow {
    id: string
    name: string
    campaignIds: Set<string>
    shopsVisited: Set<string>
    improvedShops: number
    noResponseShops: number
    lifts: number[]
    afterPositive: number
    visitCount: number
}

export function AccountManagerImpactPerformanceView({ userProfile }: Props) {
    const companyId = userProfile?.organizations?.id
    const { dataset, loading, filters, setFilters } = useImpactDataset(companyId)

    const ams = useMemo(() => {
        if (!dataset) return [] as Array<{
            id: string; name: string; campaignsManaged: number; shopsVisited: number; improvedShops: number;
            conversion: number; avgLift: number; noResponseRate: number; visitCount: number;
        }>
        const map = new Map<string, AmRow>()
        for (const v of dataset.visits) {
            const e = map.get(v.account_manager_user_id) || {
                id: v.account_manager_user_id,
                name: v.account_manager_name,
                campaignIds: new Set<string>(),
                shopsVisited: new Set<string>(),
                improvedShops: 0,
                noResponseShops: 0,
                lifts: [],
                afterPositive: 0,
                visitCount: 0,
            }
            e.campaignIds.add(v.campaign_id)
            e.shopsVisited.add(v.shop_id)
            e.visitCount++
            if (v.status === 'improved') e.improvedShops++
            if (v.status === 'no_response') e.noResponseShops++
            if (v.after_scans > 0) e.afterPositive++
            if (v.scan_lift_percent !== null) e.lifts.push(v.scan_lift_percent)
            map.set(v.account_manager_user_id, e)
        }
        return Array.from(map.values()).map((e) => {
            const shopsVisited = e.shopsVisited.size
            const avgLift = e.lifts.length ? e.lifts.reduce((a, b) => a + b, 0) / e.lifts.length : 0
            return {
                id: e.id,
                name: e.name,
                campaignsManaged: e.campaignIds.size,
                shopsVisited,
                improvedShops: e.improvedShops,
                conversion: e.visitCount > 0 ? (e.afterPositive / e.visitCount) * 100 : 0,
                avgLift,
                noResponseRate: e.visitCount > 0 ? (e.noResponseShops / e.visitCount) * 100 : 0,
                visitCount: e.visitCount,
            }
        }).sort((a, b) => b.avgLift - a.avgLift)
    }, [dataset])

    const best = ams[0]
    const worstNoResponse = [...ams].sort((a, b) => b.noResponseRate - a.noResponseRate)[0]
    const teamImprovedRate = ams.length
        ? (ams.reduce((a, r) => a + (r.shopsVisited > 0 ? r.improvedShops / r.shopsVisited : 0), 0) / ams.length) * 100
        : 0
    const teamAvgLift = ams.length ? ams.reduce((a, r) => a + r.avgLift, 0) / ams.length : 0

    return (
        <div className="space-y-4">
            <PageHeader
                overline="RoadTour Analytics"
                title="Account Manager Impact Performance"
                description="Compare RoadTour account manager performance based on post-visit shop impact."
            />

            <AnalyticsFilterBar filters={filters} setFilters={setFilters} dataset={dataset} />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && dataset && (
                <>
                    {dataset.missingDataNote && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">{dataset.missingDataNote}</div>
                    )}

                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                        <KpiCard label="Total Account Managers" value={formatNumber(ams.length)} icon={Users} accent="blue" />
                        <KpiCard label="Improved Shops Rate" value={`${teamImprovedRate.toFixed(1)}%`} icon={TrendingUp} accent="green" />
                        <KpiCard label="Average Scan Lift" value={formatLiftPercent(teamAvgLift)} icon={BarChart3} accent="cyan" />
                        <KpiCard label="Best Performer" value={best?.name ?? '—'} sub={best ? `${formatLiftPercent(best.avgLift)} Avg Lift` : ''} icon={Trophy} accent="amber" />
                        <KpiCard label="Lowest Response Rate" value={worstNoResponse?.name ?? '—'} sub={worstNoResponse ? `${worstNoResponse.noResponseRate.toFixed(1)}% No Response` : ''} icon={ShieldAlert} accent="rose" />
                    </div>

                    <div className="grid gap-3 lg:grid-cols-3">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Average Scan Lift % by Account Manager</CardTitle></CardHeader>
                            <CardContent>
                                {ams.length === 0 ? <EmptyBlock title="No account managers" /> : (
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={ams.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                                                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                                                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                                                <Bar dataKey="avgLift" fill="#10b981" radius={[0, 3, 3, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Shops Visited vs Improved Shops</CardTitle></CardHeader>
                            <CardContent>
                                {ams.length === 0 ? <EmptyBlock title="No data" /> : (
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={ams.slice(0, 10)}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
                                                <YAxis tick={{ fontSize: 11 }} />
                                                <Tooltip />
                                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                                <Bar dataKey="shopsVisited" name="Shops Visited" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                                                <Bar dataKey="improvedShops" name="Improved Shops" fill="#10b981" radius={[3, 3, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Visit Count vs Conversion Rate</CardTitle></CardHeader>
                            <CardContent>
                                {ams.length === 0 ? <EmptyBlock title="No data" /> : (
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                <XAxis type="number" dataKey="visitCount" name="Visits" tick={{ fontSize: 11 }} />
                                                <YAxis type="number" dataKey="conversion" name="Conversion %" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                                                <ZAxis dataKey="avgLift" range={[40, 280]} name="Avg Lift" />
                                                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: any, name: string) => name === 'Conversion %' ? `${(v as number).toFixed(1)}%` : v} />
                                                <Scatter data={ams} fill="#8b5cf6" />
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Account Manager Performance Leaderboard</CardTitle></CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Rank</TableHead>
                                                <TableHead>Account Manager</TableHead>
                                                <TableHead className="text-right">Campaigns Managed</TableHead>
                                                <TableHead className="text-right">Shops Visited</TableHead>
                                                <TableHead className="text-right">Improved Shops</TableHead>
                                                <TableHead className="text-right">Conversion %</TableHead>
                                                <TableHead className="text-right">Avg Lift %</TableHead>
                                                <TableHead className="text-right">No Response %</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {ams.length === 0 && (
                                                <TableRow><TableCell colSpan={8}><EmptyBlock title="No account managers found in the selected period." /></TableCell></TableRow>
                                            )}
                                            {ams.map((row, idx) => (
                                                <TableRow key={row.id}>
                                                    <TableCell>{idx + 1}</TableCell>
                                                    <TableCell className="font-medium">{row.name}</TableCell>
                                                    <TableCell className="text-right">{row.campaignsManaged}</TableCell>
                                                    <TableCell className="text-right">{row.shopsVisited}</TableCell>
                                                    <TableCell className="text-right">{row.improvedShops}</TableCell>
                                                    <TableCell className="text-right">{row.conversion.toFixed(1)}%</TableCell>
                                                    <TableCell className="text-right text-emerald-700 font-semibold">{formatLiftPercent(row.avgLift)}</TableCell>
                                                    <TableCell className={`text-right ${row.noResponseRate > 20 ? 'text-rose-600 font-semibold' : ''}`}>{row.noResponseRate.toFixed(1)}%</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" />Performance Insights</CardTitle></CardHeader>
                            <CardContent>
                                <ul className="text-sm space-y-2">
                                    {best && (
                                        <li>• <span className="font-semibold">{best.name}</span> leads with avg lift <span className="font-semibold">{formatLiftPercent(best.avgLift)}</span> and conversion <span className="font-semibold">{best.conversion.toFixed(1)}%</span>.</li>
                                    )}
                                    <li>• Team average scan lift is <span className="font-semibold">{formatLiftPercent(teamAvgLift)}</span>.</li>
                                    {ams.length > 0 && (
                                        <li>• Top performer converted <span className="font-semibold">{best?.conversion.toFixed(1)}%</span> of visits into post-visit scans.</li>
                                    )}
                                    {worstNoResponse && worstNoResponse.noResponseRate > 0 && (
                                        <li>• <span className="font-semibold">{worstNoResponse.name}</span> has highest No Response rate at <span className="font-semibold">{worstNoResponse.noResponseRate.toFixed(1)}%</span> — follow-up recommended.</li>
                                    )}
                                </ul>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}
