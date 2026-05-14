'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Plus, Search, Package, Gift, Star, Coins, BarChart3, LayoutGrid, List,
    Megaphone, Layers, QrCode, Scan, Award, AlertCircle, TrendingUp, Trophy,
    Activity, ChevronDown, RefreshCw,
} from 'lucide-react'
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
    PieChart, Pie, Cell,
} from 'recharts'
import JourneyOrderSelectorV2 from './JourneyOrderSelectorV2'
import JourneyDesignerV2 from './JourneyDesignerV2'
import JourneyCardWithStats from './JourneyCardWithStats'
import JourneyListRow from './JourneyListRow'
import MasterAnnouncementBannerView from '@/components/announcement-banner/MasterAnnouncementBannerView'

interface UserProfile {
    id: string
    organization_id: string
    full_name: string | null
    organizations: { id: string; org_name: string; org_type_code: string }
}

interface JourneyConfig {
    id: string
    org_id: string
    name: string
    is_active: boolean
    is_default: boolean
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    enable_scratch_card_game?: boolean
    require_staff_otp_for_points: boolean
    require_customer_otp_for_lucky_draw: boolean
    require_customer_otp_for_redemption: boolean
    require_security_code: boolean
    require_two_digit_code_for_features?: boolean
    require_security_code_for_features?: boolean
    start_at: string | null
    end_at: string | null
    created_at: string
    activation_status?: string | null
    activation_mode?: string | null
    order_info?: { order_no: string; legacy_order_no?: string; order_type: string; order_id: string }
}

interface Order {
    id: string; order_no: string; order_type: string; status: string
    has_redeem: boolean; has_lucky_draw: boolean; company_id: string
}

interface DashboardSummary {
    kpis: { totalJourneys: number; totalQrGenerated: number; totalScans: number; pointsRedeemed: number; failedScans: number }
    typeCounts: { points: number; luckyDraw: number; freeGift: number }
    trend: { date: string; scans: number; redeemed: number; failed: number }[]
    journeys: { id: string; stats: any }[]
    topPerforming: { id: string; name: string; order_no: string | null; scans: number; redeemed: number; conversionRate: number; sparkline: number[] } | null
    recentActivity: { id: string; type: string; title: string; location: string | null; time: string }[]
}

type TrendRange = '7d' | '30d' | '3m' | '6m' | 'lastMonth' | '12m'

const DEFAULT_PAGE_SIZE = 3

function formatNumber(n: number) {
    return n.toLocaleString()
}

function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 0) return 'just now'
    const m = Math.floor(ms / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m} mins ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

function parseTrendDate(value: string) {
    return new Date(`${value}T00:00:00`)
}

function filterTrendByRange(data: DashboardSummary['trend'], range: TrendRange) {
    if (data.length === 0) return []

    const latest = parseTrendDate(data[data.length - 1].date)
    let start = new Date(latest)
    let end = new Date(latest)

    if (range === '7d') {
        start.setDate(start.getDate() - 6)
    } else if (range === '30d') {
        start.setDate(start.getDate() - 29)
    } else if (range === '3m') {
        start.setMonth(start.getMonth() - 3)
    } else if (range === '6m') {
        start.setMonth(start.getMonth() - 6)
    } else if (range === '12m') {
        start.setFullYear(start.getFullYear() - 1)
    } else {
        start = new Date(latest.getFullYear(), latest.getMonth() - 1, 1)
        end = new Date(latest.getFullYear(), latest.getMonth(), 0)
    }

    return data.filter((point) => {
        const current = parseTrendDate(point.date)
        return current >= start && current <= end
    })
}

// ───────────────────────────────── KPI Card ─────────────────────────────────
function KpiCard({ icon, label, value, hint, tone }: {
    icon: React.ReactNode; label: string; value: string | number; hint?: string;
    tone: 'blue' | 'indigo' | 'emerald' | 'amber' | 'red'
}) {
    const toneMap = {
        blue: 'bg-blue-50 text-blue-600 border-blue-100',
        indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
        emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        amber: 'bg-amber-50 text-amber-600 border-amber-100',
        red: 'bg-red-50 text-red-600 border-red-100',
    } as const
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_0_rgba(0,0,0,0.03)]">
            <div className="flex items-start gap-3">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${toneMap[tone]}`}>{icon}</span>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
                    {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
                </div>
            </div>
        </div>
    )
}

// ───────────────────────────────── Donut ─────────────────────────────────
function JourneyOverviewDonut({ points, luckyDraw, freeGift }: { points: number; luckyDraw: number; freeGift: number }) {
    const total = points + luckyDraw + freeGift
    const data = [
        { name: 'Points Collection', value: points, color: '#3b82f6' },
        { name: 'Lucky Draw', value: luckyDraw, color: '#a855f7' },
        { name: 'Free Gift', value: freeGift, color: '#10b981' },
    ]
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Journey Overview</h3>
            <p className="mb-3 text-[11px] text-slate-500">Distribution by active journey feature</p>
            <div className="flex items-center gap-3">
                <div className="relative w-24 h-24 flex-shrink-0">
                    {total > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={data} dataKey="value" innerRadius={28} outerRadius={42} startAngle={90} endAngle={-270} stroke="none">
                                    {data.map((d, i) => (<Cell key={i} fill={d.color} />))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="w-full h-full rounded-full border-[10px] border-slate-100" />
                    )}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold text-slate-900 leading-none">{total}</span>
                        <span className="text-[10px] text-slate-500">Total</span>
                    </div>
                </div>
                <div className="flex-1 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />Points Collection</span>
                        <span className="font-semibold text-slate-900">{points}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-500" />Lucky Draw</span>
                        <span className="font-semibold text-slate-900">{luckyDraw}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Free Gift</span>
                        <span className="font-semibold text-slate-900">{freeGift}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ───────────────────────────── Live Activity ─────────────────────────────
function LiveActivityFeed({ items }: { items: DashboardSummary['recentActivity'] }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Live Activity Feed</h3>
                <button className="text-xs text-blue-600 hover:text-blue-700">View All</button>
            </div>
            {items.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">No recent activity</div>
            ) : (
                <ul className="space-y-2.5">
                    {items.map(a => {
                        const tone = a.type === 'lucky_draw' ? 'bg-purple-50 text-purple-600' :
                            a.type === 'free_gift' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                        const icon = a.type === 'lucky_draw' ? <Star className="h-3.5 w-3.5" /> :
                            a.type === 'free_gift' ? <Gift className="h-3.5 w-3.5" /> : <Coins className="h-3.5 w-3.5" />
                        return (
                            <li key={a.id} className="flex items-start gap-2">
                                <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${tone}`}>{icon}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-800 truncate">{a.title}</p>
                                    <p className="text-[11px] text-slate-500">{timeAgo(a.time)}</p>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

// ─────────────────────────── Top Performing ──────────────────────────────
function TopPerformingCard({ top }: { top: DashboardSummary['topPerforming'] }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Top Performing Journey</h3>
                <Select defaultValue="week">
                    <SelectTrigger className="h-7 w-[88px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="day">Today</SelectItem>
                        <SelectItem value="week">This Week</SelectItem>
                        <SelectItem value="month">This Month</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {!top ? (
                <div className="py-6 text-center text-xs text-slate-400">No data yet</div>
            ) : (
                <div>
                    <p className="text-sm font-semibold text-slate-900">{top.order_no || top.name}</p>
                    <p className="text-[11px] text-slate-500 mb-2">Points Collection</p>
                    <div className="grid grid-cols-3 gap-2 text-center mb-2">
                        <div>
                            <p className="text-[10px] text-slate-500">Scans</p>
                            <p className="text-sm font-semibold text-slate-900">{formatNumber(top.scans)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500">Redeemed</p>
                            <p className="text-sm font-semibold text-slate-900">{formatNumber(top.redeemed)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500">Conv. Rate</p>
                            <p className="text-sm font-semibold text-emerald-600">{top.conversionRate}%</p>
                        </div>
                    </div>
                    <div className="h-10">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={top.sparkline.map((v, i) => ({ i, v }))}>
                                <Area type="monotone" dataKey="v" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={1.5} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    )
}

// ───────────────────────────── Trend Chart ───────────────────────────────
function EngagementTrendChart({ data, metric }: { data: DashboardSummary['trend']; metric: 'scans' | 'redeemed' | 'failed' }) {
    const hasData = data.some(d => (d as any)[metric] > 0)
    return (
        <div className={`${hasData ? 'h-[260px]' : 'h-[220px]'} max-h-[300px]`}>
            {!hasData ? (
                <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center text-slate-400">
                    <BarChart3 className="mb-2 h-8 w-8" />
                    <p className="text-sm font-semibold text-slate-600">No engagement data yet</p>
                    <p className="mt-0.5 max-w-sm text-xs">Once consumers scan QR codes, the trend chart will expand with live engagement signals.</p>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tickFormatter={(v: string) => `${parseInt(v.slice(8, 10))} ${new Date(v).toLocaleDateString(undefined, { month: 'short' })}`} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={Math.max(1, Math.floor(data.length / 8))} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                        <Area type="monotone" dataKey={metric} stroke="#3b82f6" fillOpacity={1} fill="url(#trendArea)" strokeWidth={2} />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    )
}

// ─────────────────────────────────── Main ─────────────────────────────────
export default function JourneyBuilderV2({ userProfile }: { userProfile: UserProfile }) {
    const [step, setStep] = useState<'select-order' | 'design-journey' | 'preview'>('select-order')
    const [journeys, setJourneys] = useState<JourneyConfig[]>([])
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [selectedJourney, setSelectedJourney] = useState<JourneyConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [summaryLoading, setSummaryLoading] = useState(true)
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
    const [typeFilter, setTypeFilter] = useState<'all' | 'points' | 'lucky_draw' | 'free_gift'>('all')
    const [rangeFilter, setRangeFilter] = useState<'all' | '7d' | '30d' | '90d'>('all')
    const [activeTab, setActiveTab] = useState('existing')
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
    const [visibleCount, setVisibleCount] = useState(DEFAULT_PAGE_SIZE)
    const [trendMetric, setTrendMetric] = useState<'scans' | 'redeemed' | 'failed'>('scans')
    const [trendRange, setTrendRange] = useState<TrendRange>('30d')

    const supabase = createClient()

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const tab = params.get('tab')
        if (tab === 'announcement-banner') setActiveTab('announcement-banner')
    }, [])

    useEffect(() => { loadJourneys(); loadSummary() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function loadJourneys() {
        try {
            setLoading(true)
            const { data: configs } = await supabase
                .from('journey_configurations')
                .select('*')
                .eq('org_id', userProfile.organization_id)
                .order('created_at', { ascending: false })

            const ids = (configs || []).map((c: any) => c.id)
            const { data: links } = await supabase
                .from('journey_order_links')
                .select('id, journey_config_id, order_id')
                .in('journey_config_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

            const orderIds = (links || []).map(l => l.order_id).filter(Boolean)
            let ordersMap = new Map<string, any>()
            if (orderIds.length > 0) {
                const { data: orders } = await supabase
                    .from('orders')
                    .select('id, order_no, display_doc_no, order_type')
                    .in('id', orderIds)
                ordersMap = new Map((orders || []).map((o: any) => [o.id, {
                    ...o, display_doc_no: o.display_doc_no, legacy_order_no: o.order_no,
                    order_no: o.display_doc_no || o.order_no,
                }]))
            }
            const linksMap = new Map((links || []).map(l => {
                const o = ordersMap.get(l.order_id)
                return [l.journey_config_id, o ? { ...o, order_id: l.order_id } : null]
            }))
            setJourneys((configs || []).map((c: any) => ({ ...c, order_info: linksMap.get(c.id) })))
        } catch (e) {
            console.error('Error loading journeys', e); setJourneys([])
        } finally { setLoading(false) }
    }

    async function loadSummary() {
        try {
            setSummaryLoading(true)
            const r = await fetch('/api/journey/dashboard-summary')
            const d = await r.json()
            if (r.ok) setSummary(d)
        } catch (e) {
            console.error('summary error', e)
        } finally { setSummaryLoading(false) }
    }

    function handleOrderSelected(order: Order) { setSelectedOrder(order); setStep('design-journey') }
    function handleJourneyCreated() {
        loadJourneys(); loadSummary(); setStep('select-order'); setSelectedOrder(null); setSelectedJourney(null); setActiveTab('existing')
    }

    async function handleEditJourney(journey: JourneyConfig) {
        try {
            const { data: freshJourney } = await supabase.from('journey_configurations').select('*').eq('id', journey.id).single()
            const { data: link } = await supabase.from('journey_order_links').select('order_id').eq('journey_config_id', journey.id).single()
            if (link) {
                const { data: order } = await supabase.from('orders')
                    .select('id, order_no, display_doc_no, order_type, status, has_redeem, has_lucky_draw, company_id')
                    .eq('id', link.order_id).single()
                if (order) setSelectedOrder({ ...order, order_no: order.display_doc_no || order.order_no } as Order)
            }
            setSelectedJourney(freshJourney as JourneyConfig); setStep('design-journey')
        } catch (e) { console.error(e); alert('Failed to load order details for editing') }
    }

    async function handleDeleteJourney(journeyId: string) {
        if (!confirm('Are you sure you want to delete this journey? This action cannot be undone.')) return
        try {
            const { error } = await supabase.from('journey_configurations').delete().eq('id', journeyId)
            if (error) throw error
            loadJourneys(); loadSummary()
        } catch (e: any) { alert('Failed to delete: ' + e.message) }
    }

    async function handleDuplicateJourney(journey: JourneyConfig) {
        try {
            const { error } = await supabase.from('journey_configurations').insert({
                org_id: userProfile.organization_id, name: `${journey.name} (Copy)`,
                is_active: false, is_default: false,
                points_enabled: journey.points_enabled, lucky_draw_enabled: journey.lucky_draw_enabled,
                redemption_enabled: journey.redemption_enabled,
                require_staff_otp_for_points: journey.require_staff_otp_for_points,
                require_customer_otp_for_lucky_draw: journey.require_customer_otp_for_lucky_draw,
                require_customer_otp_for_redemption: journey.require_customer_otp_for_redemption,
                created_by: userProfile.id,
            })
            if (error) throw error
            loadJourneys(); alert('Journey duplicated successfully!')
        } catch (e: any) { alert('Failed to duplicate: ' + e.message) }
    }

    // Filters
    const filtered = useMemo(() => {
        const s = searchQuery.trim().toLowerCase()
        return journeys.filter(j => {
            if (statusFilter === 'active' && !j.is_active) return false
            if (statusFilter === 'inactive' && j.is_active) return false
            if (typeFilter === 'points' && !j.points_enabled) return false
            if (typeFilter === 'lucky_draw' && !j.lucky_draw_enabled) return false
            if (typeFilter === 'free_gift' && !j.redemption_enabled) return false
            if (rangeFilter !== 'all') {
                const days = rangeFilter === '7d' ? 7 : rangeFilter === '30d' ? 30 : 90
                if (Date.now() - new Date(j.created_at).getTime() > days * 86400_000) return false
            }
            if (!s) return true
            return j.name.toLowerCase().includes(s) || (j.order_info?.order_no || '').toLowerCase().includes(s)
        })
    }, [journeys, searchQuery, statusFilter, typeFilter, rangeFilter])

    const visibleJourneys = filtered.slice(0, visibleCount)
    const hasMore = visibleCount < filtered.length

    useEffect(() => { setVisibleCount(DEFAULT_PAGE_SIZE) }, [searchQuery, statusFilter, typeFilter, rangeFilter])

    function clearFilters() {
        setSearchQuery(''); setStatusFilter('all'); setTypeFilter('all'); setRangeFilter('all')
    }

    if (step === 'design-journey' && selectedOrder) {
        return (
            <JourneyDesignerV2
                key={selectedJourney?.id || 'new'}
                order={selectedOrder}
                userProfile={userProfile}
                journey={selectedJourney}
                onBack={() => { setStep('select-order'); setSelectedOrder(null); setSelectedJourney(null) }}
                onSuccess={handleJourneyCreated}
            />
        )
    }

    const trendData = useMemo(() => {
        if (!summary) return []
        return filterTrendByRange(summary.trend, trendRange)
    }, [summary, trendRange])

    const k = summary?.kpis

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Journey Builder</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Create engaging consumer experiences when they scan QR codes</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { loadJourneys(); loadSummary() }}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading || summaryLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button size="sm" onClick={() => setActiveTab('create')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Create Journey
                    </Button>
                </div>
            </div>

            {/* Main grid: content + sidebar */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5 min-w-0">
                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        <KpiCard tone="blue" icon={<Layers className="h-4 w-4" />} label="Total Journeys" value={formatNumber(k?.totalJourneys ?? 0)} hint="Active campaigns" />
                        <KpiCard tone="indigo" icon={<QrCode className="h-4 w-4" />} label="Total QR Generated" value={formatNumber(k?.totalQrGenerated ?? 0)} hint="All time" />
                        <KpiCard tone="emerald" icon={<Scan className="h-4 w-4" />} label="Total Scans" value={formatNumber(k?.totalScans ?? 0)} hint="vs last 30 days" />
                        <KpiCard tone="amber" icon={<Award className="h-4 w-4" />} label="Points Redeemed" value={formatNumber(k?.pointsRedeemed ?? 0)} hint="vs last 30 days" />
                        <KpiCard tone="red" icon={<AlertCircle className="h-4 w-4" />} label="Failed Scans" value={formatNumber(k?.failedScans ?? 0)} hint="vs last 30 days" />
                    </div>

                    {/* Chart */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-900">QR Engagement Trend</h3>
                            <div className="flex items-center gap-2">
                                <Select value={trendRange} onValueChange={(v: any) => setTrendRange(v)}>
                                    <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="7d">Last 7 Days</SelectItem>
                                        <SelectItem value="30d">Last 30 Days</SelectItem>
                                        <SelectItem value="3m">Last 3 Months</SelectItem>
                                        <SelectItem value="6m">Last 6 Months</SelectItem>
                                        <SelectItem value="lastMonth">Last Month</SelectItem>
                                        <SelectItem value="12m">Last 12 Months</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={trendMetric} onValueChange={(v: any) => setTrendMetric(v)}>
                                    <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="scans">Scans</SelectItem>
                                        <SelectItem value="redeemed">Redeemed</SelectItem>
                                        <SelectItem value="failed">Failed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <EngagementTrendChart data={trendData} metric={trendMetric} />
                    </div>

                    {/* Tabs */}
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="bg-white border border-slate-200">
                            <TabsTrigger value="existing">Existing Journeys</TabsTrigger>
                            <TabsTrigger value="create">Create New</TabsTrigger>
                            <TabsTrigger value="announcement-banner" className="flex items-center gap-1.5">
                                <Megaphone className="w-3.5 h-3.5" />Announcement Banner
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="existing" className="space-y-4 mt-4">
                            {/* Filter bar */}
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative flex-1 min-w-[220px]">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                        <Input
                                            placeholder="Search journeys by name or order number..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-8 h-9"
                                        />
                                    </div>
                                    <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                                        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Status</SelectItem>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                                        <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Journey Type" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Types</SelectItem>
                                            <SelectItem value="points">Points Collection</SelectItem>
                                            <SelectItem value="lucky_draw">Lucky Draw</SelectItem>
                                            <SelectItem value="free_gift">Free Gift</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={rangeFilter} onValueChange={(v: any) => setRangeFilter(v)}>
                                        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Date Range" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All time</SelectItem>
                                            <SelectItem value="7d">Last 7 days</SelectItem>
                                            <SelectItem value="30d">Last 30 days</SelectItem>
                                            <SelectItem value="90d">Last 90 days</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-slate-600">Clear</Button>
                                    <div className="ml-auto flex items-center gap-2">
                                        <Button variant="outline" size="sm" className="h-9 bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100">
                                            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />Analytics View
                                        </Button>
                                        <div className="flex border border-slate-200 rounded-md">
                                            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-r-none h-9 w-9 p-0">
                                                <List className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button variant={viewMode === 'card' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('card')} className="rounded-l-none h-9 w-9 p-0">
                                                <LayoutGrid className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* List/Cards */}
                            {loading ? (
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {[0, 1, 2].map(i => (
                                        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
                                            <div className="h-4 w-2/3 bg-slate-100 rounded mb-2" />
                                            <div className="h-3 w-1/3 bg-slate-100 rounded mb-4" />
                                            <div className="h-24 bg-slate-100 rounded mb-3" />
                                            <div className="h-8 bg-slate-100 rounded" />
                                        </div>
                                    ))}
                                </div>
                            ) : filtered.length === 0 ? (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                        <h3 className="text-base font-semibold text-slate-900 mb-1">
                                            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || rangeFilter !== 'all'
                                                ? 'No matching journeys found' : 'No journeys yet'}
                                        </h3>
                                        <p className="text-sm text-slate-500 mb-4">
                                            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || rangeFilter !== 'all'
                                                ? 'Try adjusting your filters' : 'Create your first consumer journey to get started'}
                                        </p>
                                        {!searchQuery && statusFilter === 'all' && typeFilter === 'all' && rangeFilter === 'all' && (
                                            <Button onClick={() => setActiveTab('create')}>
                                                <Plus className="w-4 h-4 mr-2" />Create Your First Journey
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            ) : viewMode === 'card' ? (
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {visibleJourneys.map((journey) => (
                                        <JourneyCardWithStats
                                            key={journey.id}
                                            journey={journey}
                                            onEdit={() => handleEditJourney(journey)}
                                            onDuplicate={() => handleDuplicateJourney(journey)}
                                            onDelete={() => handleDeleteJourney(journey.id)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <Card>
                                    <CardContent className="p-0">
                                        <div className="divide-y">
                                            {visibleJourneys.map((journey) => (
                                                <JourneyListRow
                                                    key={journey.id}
                                                    journey={journey}
                                                    onEdit={() => handleEditJourney(journey)}
                                                    onDuplicate={() => handleDuplicateJourney(journey)}
                                                    onDelete={() => handleDeleteJourney(journey.id)}
                                                />
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Pagination row */}
                            {filtered.length > 0 && (
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                    <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
                                        <p className="text-xs font-medium text-slate-500">
                                            Showing 1 to {Math.min(visibleCount, filtered.length)} of {filtered.length} journeys
                                        </p>
                                        <div className="flex flex-wrap items-center justify-center gap-2">
                                            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                                <Button variant="ghost" size="sm" disabled className="h-8 px-3 text-xs">Prev</Button>
                                                <span className="grid h-8 min-w-8 place-items-center rounded-md bg-white px-2 text-xs font-semibold text-slate-900 shadow-sm">1</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={!hasMore}
                                                    onClick={() => setVisibleCount(c => c + DEFAULT_PAGE_SIZE)}
                                                    className="h-8 px-3 text-xs"
                                                >
                                                    Next
                                                </Button>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={!hasMore}
                                                onClick={() => setVisibleCount(c => c + DEFAULT_PAGE_SIZE)}
                                                className="h-9"
                                            >
                                                <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                                                Load Next {hasMore ? Math.min(DEFAULT_PAGE_SIZE, filtered.length - visibleCount) : DEFAULT_PAGE_SIZE} Journeys
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={!hasMore}
                                                onClick={() => setVisibleCount(filtered.length)}
                                                className="h-9 text-slate-600"
                                            >
                                                View All Journeys
                                            </Button>
                                            {!hasMore && visibleCount > DEFAULT_PAGE_SIZE && (
                                                <Button variant="ghost" size="sm" onClick={() => setVisibleCount(DEFAULT_PAGE_SIZE)} className="h-9 text-slate-600">
                                                    Show less
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="create" className="mt-4">
                            <JourneyOrderSelectorV2 userProfile={userProfile} onOrderSelected={handleOrderSelected} />
                        </TabsContent>

                        <TabsContent value="announcement-banner" className="mt-4">
                            <MasterAnnouncementBannerView userProfile={userProfile} />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right Sidebar */}
                <aside className="space-y-4 self-start lg:sticky lg:top-4">
                    <JourneyOverviewDonut
                        points={summary?.typeCounts.points ?? 0}
                        luckyDraw={summary?.typeCounts.luckyDraw ?? 0}
                        freeGift={summary?.typeCounts.freeGift ?? 0}
                    />
                    <LiveActivityFeed items={summary?.recentActivity ?? []} />
                    <TopPerformingCard top={summary?.topPerforming ?? null} />
                </aside>
            </div>
        </div>
    )
}
