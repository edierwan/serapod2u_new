'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts'
import { Flag, Clock, BarChart3, UserPlus, Calendar, Download, Lightbulb } from 'lucide-react'
import { AnalyticsFilterBar } from './AnalyticsFilterBar'
import {
    KpiCard, LoadingBlock, EmptyBlock, StatusPill, PriorityPill,
    formatNumber, PageHeader,
} from './shared'
import { useImpactDataset } from '@/modules/roadtour/lib/analytics/useImpactDataset'
import {
    classifyFollowUpPriority, recommendedAction, recommendedFollowUpDate,
    type FollowUpPriority, type VisitImpactRow,
} from '@/modules/roadtour/types/analytics'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const PAGE_SIZE = 10
const PRIORITY_COLORS: Record<FollowUpPriority, string> = {
    high: '#ef4444', medium: '#f59e0b', low: '#94a3b8', healthy: '#10b981',
}

export function FollowUpPriorityQueueView({ userProfile }: Props) {
    const companyId = userProfile?.organizations?.id
    const { dataset, loading, filters, setFilters } = useImpactDataset(companyId)
    const [priorityFilter, setPriorityFilter] = useState<FollowUpPriority | 'all'>('all')
    const [statusFilter, setStatusFilter] = useState<'all' | VisitImpactRow['status']>('all')
    const [daysFilter, setDaysFilter] = useState<'any' | 'le3' | '3to7' | 'gt7'>('any')
    const [page, setPage] = useState(0)

    const annotated = useMemo(() => {
        if (!dataset) return []
        return dataset.visits.map((v) => {
            const priority = classifyFollowUpPriority(v)
            return {
                ...v,
                priority,
                recommended: recommendedAction(priority, v.status, v.days_since_visit),
                nextFollowUp: recommendedFollowUpDate(v.visit_date, priority),
            }
        })
    }, [dataset])

    const filtered = useMemo(() => {
        return annotated.filter((v) => {
            if (priorityFilter !== 'all' && v.priority !== priorityFilter) return false
            if (statusFilter !== 'all' && v.status !== statusFilter) return false
            if (daysFilter === 'le3' && v.days_since_visit > 3) return false
            if (daysFilter === '3to7' && (v.days_since_visit < 3 || v.days_since_visit > 7)) return false
            if (daysFilter === 'gt7' && v.days_since_visit <= 7) return false
            return true
        })
    }, [annotated, priorityFilter, statusFilter, daysFilter])

    const buckets = useMemo(() => {
        const counts: Record<FollowUpPriority, number> = { high: 0, medium: 0, low: 0, healthy: 0 }
        for (const v of annotated) counts[v.priority]++
        const total = annotated.length || 1
        return [
            { key: 'high' as const, label: 'High Priority', desc: 'No scan in 7D or drop >50%', count: counts.high, pct: (counts.high / total) * 100, color: 'bg-rose-500', text: 'text-rose-700' },
            { key: 'medium' as const, label: 'Follow Up Soon', desc: '3-7 days since visit', count: counts.medium, pct: (counts.medium / total) * 100, color: 'bg-amber-500', text: 'text-amber-700' },
            { key: 'low' as const, label: 'Monitor', desc: 'Low response, watch trend', count: counts.low, pct: (counts.low / total) * 100, color: 'bg-slate-400', text: 'text-slate-700' },
            { key: 'healthy' as const, label: 'Healthy', desc: 'Good engagement', count: counts.healthy, pct: (counts.healthy / total) * 100, color: 'bg-emerald-500', text: 'text-emerald-700' },
        ]
    }, [annotated])

    const donut = buckets.map((b) => ({ name: b.label, value: b.count, key: b.key }))

    const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

    const today = new Date().toISOString().slice(0, 10)
    const dueToday = annotated.filter((v) => v.nextFollowUp === today)

    const kpis = useMemo(() => {
        const highPriority = buckets.find((b) => b.key === 'high')?.count ?? 0
        const noResp7d = annotated.filter((v) => v.status === 'no_response' && v.days_since_visit >= 7).length
        const lowResp = annotated.filter((v) => v.after_scans > 0 && v.before_scans > 0 && v.after_scans <= v.before_scans).length
        const newlyActivated = annotated.filter((v) => v.status === 'newly_activated').length
        return { highPriority, noResp7d, lowResp, newlyActivated, dueToday: dueToday.length }
    }, [annotated, buckets, dueToday])

    const exportCsv = () => {
        const header = ['Shop', 'Region', 'Account Manager', 'Visit Date', 'Days Since Visit', `After ${dataset?.windowDays}D Scans`, 'Status', 'Priority', 'Recommended Action', 'Next Follow-Up']
        const rows = filtered.map((v) => [
            v.shop_name, v.shop_region ?? '', v.account_manager_name, v.visit_date, v.days_since_visit,
            v.after_scans, v.status, v.priority, v.recommended, v.nextFollowUp,
        ])
        const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `roadtour-follow-up-${today}.csv`; a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="space-y-4">
            <PageHeader
                overline="RoadTour Analytics"
                title="Follow-Up Priority & Opportunity Queue"
                description="Operational queue for shops needing follow-up after RoadTour visits, with recommended actions."
            />

            <AnalyticsFilterBar
                filters={filters} setFilters={setFilters} dataset={dataset}
                showStatus statusValue={statusFilter as any}
                onStatusChange={(v) => { setStatusFilter(v as any); setPage(0) }}
                extra={
                    <>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Priority</label>
                            <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v as any); setPage(0) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Priorities</SelectItem>
                                    <SelectItem value="high">High</SelectItem>
                                    <SelectItem value="medium">Medium</SelectItem>
                                    <SelectItem value="low">Low</SelectItem>
                                    <SelectItem value="healthy">Healthy</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Days Since Visit</label>
                            <Select value={daysFilter} onValueChange={(v) => { setDaysFilter(v as any); setPage(0) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="any">Any</SelectItem>
                                    <SelectItem value="le3">≤ 3 days</SelectItem>
                                    <SelectItem value="3to7">3–7 days</SelectItem>
                                    <SelectItem value="gt7">&gt; 7 days</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </>
                }
            />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && dataset && (
                <>
                    {dataset.missingDataNote && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">{dataset.missingDataNote}</div>
                    )}

                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                        <KpiCard label="High Priority Shops" value={formatNumber(kpis.highPriority)} icon={Flag} accent="rose" />
                        <KpiCard label={`No Response in ${dataset.windowDays}D`} value={formatNumber(kpis.noResp7d)} icon={Clock} accent="amber" />
                        <KpiCard label="Low Response Shops" value={formatNumber(kpis.lowResp)} icon={BarChart3} accent="slate" />
                        <KpiCard label="Newly Activated" value={formatNumber(kpis.newlyActivated)} icon={UserPlus} accent="violet" />
                        <KpiCard label="Follow-Up Due Today" value={formatNumber(kpis.dueToday)} icon={Calendar} accent="cyan" />
                    </div>

                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        {buckets.map((b) => (
                            <Card key={b.key}>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className={`text-xs font-medium ${b.text}`}>{b.label}</div>
                                            <div className="text-2xl font-bold">{b.count} <span className="text-xs font-medium text-muted-foreground">Shops</span></div>
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground">{b.pct.toFixed(0)}% of total</div>
                                    </div>
                                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                                        <div className={`${b.color} h-full rounded-full`} style={{ width: `${b.pct}%` }} />
                                    </div>
                                    <div className="mt-1 text-[11px] text-muted-foreground">{b.desc}</div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
                        <Card>
                            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
                                <CardTitle className="text-base">Shops Requiring Follow-Up <span className="text-muted-foreground text-xs font-normal ml-2">{filtered.length} shops</span></CardTitle>
                                <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-3.5 w-3.5 mr-1.5" />Export</Button>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>#</TableHead>
                                                <TableHead>Shop</TableHead>
                                                <TableHead>Region</TableHead>
                                                <TableHead>Account Manager</TableHead>
                                                <TableHead>Visit Date</TableHead>
                                                <TableHead className="text-right">Days Since</TableHead>
                                                <TableHead className="text-right">After {dataset.windowDays}D Scans</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Priority</TableHead>
                                                <TableHead>Recommended Action</TableHead>
                                                <TableHead>Next Follow-Up</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {pageRows.length === 0 && (
                                                <TableRow><TableCell colSpan={11}><EmptyBlock title="No shops match the selected filters." /></TableCell></TableRow>
                                            )}
                                            {pageRows.map((row, idx) => (
                                                <TableRow key={row.visit_id}>
                                                    <TableCell>{page * PAGE_SIZE + idx + 1}</TableCell>
                                                    <TableCell className="font-medium">{row.shop_name}</TableCell>
                                                    <TableCell>{row.shop_region || '—'}</TableCell>
                                                    <TableCell>{row.account_manager_name}</TableCell>
                                                    <TableCell>{row.visit_date}</TableCell>
                                                    <TableCell className="text-right">{row.days_since_visit}</TableCell>
                                                    <TableCell className="text-right">{row.after_scans}</TableCell>
                                                    <TableCell><StatusPill status={row.status} /></TableCell>
                                                    <TableCell><PriorityPill priority={row.priority} /></TableCell>
                                                    <TableCell>{row.recommended}</TableCell>
                                                    <TableCell className={row.nextFollowUp === today ? 'text-rose-600 font-semibold' : ''}>{row.nextFollowUp}</TableCell>
                                                </TableRow>
                                            ))}
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

                        <div className="space-y-3">
                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" />Recommended Actions</CardTitle></CardHeader>
                                <CardContent>
                                    <ul className="text-xs space-y-2">
                                        <li><span className="font-semibold text-rose-700">No Scan in 7 Days:</span> Immediate follow-up required. Priority: High</li>
                                        <li><span className="font-semibold text-amber-700">No Scan in 3 Days:</span> Follow-up within 48 hours. Priority: Medium</li>
                                        <li><span className="font-semibold text-rose-700">Scan Drop &gt; 50%:</span> Address issues and re-engage. Priority: High</li>
                                        <li><span className="font-semibold text-violet-700">Newly Activated:</span> Nurture early engagement. Priority: Medium</li>
                                        <li><span className="font-semibold text-emerald-700">Follow-Up Due Today:</span> Schedule visit or call today. Priority: High</li>
                                    </ul>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base">Shops by Follow-Up Priority</CardTitle></CardHeader>
                                <CardContent>
                                    {donut.every((d) => d.value === 0) ? <EmptyBlock title="No data" /> : (
                                        <div className="h-48">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={36} outerRadius={64}>
                                                        {donut.map((entry) => (
                                                            <Cell key={entry.key} fill={PRIORITY_COLORS[entry.key]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip />
                                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base">Upcoming Follow-Up Tasks</CardTitle></CardHeader>
                                <CardContent>
                                    {dueToday.length === 0 ? (
                                        <EmptyBlock title="No tasks due today" />
                                    ) : (
                                        <ul className="text-xs space-y-2 max-h-48 overflow-y-auto">
                                            {dueToday.slice(0, 8).map((t) => (
                                                <li key={t.visit_id} className="border-l-2 border-rose-500 pl-2">
                                                    <div className="font-medium">{t.shop_name}</div>
                                                    <div className="text-muted-foreground">{t.account_manager_name} • {t.shop_region || '—'}</div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
