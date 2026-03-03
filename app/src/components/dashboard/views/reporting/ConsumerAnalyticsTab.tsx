'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
    ComposedChart,
    RadialBarChart,
    RadialBar,
} from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Scan,
    Users,
    TrendingUp,
    TrendingDown,
    Trophy,
    Clock,
    ArrowUpRight,
    ArrowDownRight,
    Loader2,
    RefreshCw,
    Package,
    Calendar,
    BarChart3,
    Zap,
    Target,
    Crown,
    Flame,
    Star,
    Hash,
    Eye,
    Download,
} from 'lucide-react'
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, differenceInDays, parseISO, isSameDay } from 'date-fns'

// ── Types ────────────────────────────────────────────────────────────────────
interface ConsumerAnalyticsTabProps {
    userProfile: any
    chartGridColor: string
    chartTickColor: string
    isDark: boolean
}

interface DailyScan {
    date: string
    scans: number
    uniqueConsumers: number
    points: number
    gifts: number
    luckyDraws: number
}

interface TopConsumer {
    phone: string
    name: string
    scanCount: number
    totalPoints: number
    lastActive: string
    rank: number
}

interface ProductScan {
    productName: string
    scanCount: number
    uniqueConsumers: number
    percentage: number
    [key: string]: string | number
}

interface HourlyData {
    hour: number
    label: string
    scans: number
}

interface SummaryStats {
    totalScans: number
    uniqueConsumers: number
    totalPoints: number
    avgScansPerDay: number
    peakDay: string
    peakDayScans: number
    growthRate: number
    retentionRate: number
    avgScansPerConsumer: number
    newConsumersThisPeriod: number
}

// ── Constants ────────────────────────────────────────────────────────────────
const PALETTE = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1',
    '#14b8a6', '#f97316',
]

const GRADIENT_PAIRS = {
    blue: { from: '#3b82f6', to: '#60a5fa' },
    green: { from: '#10b981', to: '#34d399' },
    purple: { from: '#8b5cf6', to: '#a78bfa' },
    orange: { from: '#f97316', to: '#fb923c' },
    pink: { from: '#ec4899', to: '#f472b6' },
    cyan: { from: '#06b6d4', to: '#22d3ee' },
}

// ── Animated Number ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, duration = 800, prefix = '', suffix = '', decimals = 0 }: {
    value: number; duration?: number; prefix?: string; suffix?: string; decimals?: number
}) {
    const [display, setDisplay] = useState(0)
    useEffect(() => {
        let start: number; let raf: number
        const run = (t: number) => {
            if (!start) start = t
            const p = Math.min((t - start) / duration, 1)
            const ease = 1 - Math.pow(1 - p, 4)
            setDisplay(ease * value)
            if (p < 1) raf = requestAnimationFrame(run)
        }
        raf = requestAnimationFrame(run)
        return () => cancelAnimationFrame(raf)
    }, [value, duration])
    return <span>{prefix}{display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</span>
}

// ── Sparkline Mini Chart ─────────────────────────────────────────────────────
function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
    if (!data.length) return null
    const max = Math.max(...data, 1)
    const w = 120
    const points = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${height - (v / max) * (height - 4)}`).join(' ')
    return (
        <svg width={w} height={height} className="overflow-visible">
            <defs>
                <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
            </defs>
            <polyline fill="none" stroke={color} strokeWidth={2} points={points} strokeLinecap="round" strokeLinejoin="round" />
            <polygon fill={`url(#spark-${color.replace('#', '')})`} points={`0,${height} ${points} ${w},${height}`} />
        </svg>
    )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, change, icon: Icon, color, subtitle, loading, sparkData, delay = 0 }: {
    title: string; value: number | string; change?: number; icon: any; color: string; subtitle?: string; loading?: boolean; sparkData?: number[]; delay?: number
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay }}
        >
            <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-card/80 backdrop-blur">
                <div className="absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full opacity-[0.07] group-hover:opacity-[0.14] transition-opacity" style={{ backgroundColor: color }} />
                <CardContent className="pt-6 pb-4">
                    <div className="flex items-start justify-between">
                        <div className="space-y-1.5 flex-1 min-w-0">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            ) : (
                                <div className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                                    {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
                                </div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                                {change !== undefined && change !== null && (
                                    <Badge variant="secondary" className={`text-[10px] font-semibold ${
                                        change >= 0
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    }`}>
                                        {change >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                                        {Math.abs(change).toFixed(1)}%
                                    </Badge>
                                )}
                                {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${color}15` }}>
                                <Icon className="w-5 h-5" style={{ color }} />
                            </div>
                            {sparkData && sparkData.length > 1 && (
                                <Sparkline data={sparkData} color={color} height={32} />
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    )
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
        <div className="bg-card/95 backdrop-blur-lg border border-border rounded-xl shadow-2xl p-3 min-w-[160px]">
            <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 py-0.5">
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-xs text-muted-foreground">{entry.name}</span>
                    </div>
                    <span className="text-xs font-bold text-foreground">{Number(entry.value).toLocaleString()}</span>
                </div>
            ))}
        </div>
    )
}

// ── Rank Badge ───────────────────────────────────────────────────────────────
function RankBadge({ rank }: { rank: number }) {
    if (rank === 1) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 shadow-lg shadow-amber-200/50"><Crown className="w-3.5 h-3.5 text-white" /></div>
    if (rank === 2) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-gray-300 to-gray-400"><Crown className="w-3.5 h-3.5 text-white" /></div>
    if (rank === 3) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-600"><Crown className="w-3.5 h-3.5 text-white" /></div>
    return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-xs font-bold text-muted-foreground">{rank}</div>
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function ConsumerAnalyticsTab({ userProfile, chartGridColor, chartTickColor, isDark }: ConsumerAnalyticsTabProps) {
    const supabase = createClient()

    // ── State ────────────────────────────────────────────────────────────────
    const [loading, setLoading] = useState(true)
    const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'quarter' | 'all'>('30d')
    const [topN, setTopN] = useState<number>(10)
    const [dailyData, setDailyData] = useState<DailyScan[]>([])
    const [topConsumers, setTopConsumers] = useState<TopConsumer[]>([])
    const [productScans, setProductScans] = useState<ProductScan[]>([])
    const [hourlyData, setHourlyData] = useState<HourlyData[]>([])
    const [summary, setSummary] = useState<SummaryStats>({
        totalScans: 0, uniqueConsumers: 0, totalPoints: 0, avgScansPerDay: 0,
        peakDay: '', peakDayScans: 0, growthRate: 0, retentionRate: 0,
        avgScansPerConsumer: 0, newConsumersThisPeriod: 0,
    })
    const [refreshing, setRefreshing] = useState(false)

    const companyId = userProfile?.organizations?.id

    // ── Date range calculation ───────────────────────────────────────────────
    const dateRange = useMemo(() => {
        const now = new Date()
        switch (period) {
            case '7d': return { from: subDays(now, 7), to: now, label: 'Last 7 Days' }
            case '30d': return { from: subDays(now, 30), to: now, label: 'Last 30 Days' }
            case '90d': return { from: subDays(now, 90), to: now, label: 'Last 90 Days' }
            case 'quarter': return { from: startOfQuarter(now), to: endOfQuarter(now), label: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}` }
            case 'all': return { from: new Date('2024-01-01'), to: now, label: 'All Time' }
            default: return { from: subDays(now, 30), to: now, label: 'Last 30 Days' }
        }
    }, [period])

    // ── Data loading (server-side aggregation via RPC) ──────────────────────
    const loadData = useCallback(async () => {
        if (!companyId) return
        setLoading(true)
        try {
            const fromDate = dateRange.from.toISOString()
            const toDate = dateRange.to.toISOString()
            const rpcParams = { p_company_id: companyId, p_from: fromDate, p_to: toDate }

            // Fire all 5 RPC calls in parallel for speed
            const [summaryRes, dailyRes, topRes, productRes, hourlyRes] = await Promise.all([
                supabase.rpc('fn_consumer_analytics_summary', rpcParams),
                supabase.rpc('fn_consumer_analytics_daily', rpcParams),
                supabase.rpc('fn_consumer_analytics_top_consumers', { ...rpcParams, p_limit: 50 }),
                supabase.rpc('fn_consumer_analytics_products', rpcParams),
                supabase.rpc('fn_consumer_analytics_hourly', rpcParams),
            ])

            // 1) Daily data
            const dailyArr: DailyScan[] = (dailyRes.data || []).map((row: any) => ({
                date: format(parseISO(row.scan_date), 'dd MMM'),
                scans: Number(row.scans),
                uniqueConsumers: Number(row.unique_consumers),
                points: Number(row.points),
                gifts: Number(row.gifts),
                luckyDraws: Number(row.lucky_draws),
            }))
            setDailyData(dailyArr)

            // 2) Summary stats
            const s = summaryRes.data?.[0] || summaryRes.data || { total_scans: 0, unique_consumers: 0, total_points: 0 }
            const totalScans = Number(s.total_scans) || 0
            const uniqueConsumers = Number(s.unique_consumers) || 0
            const totalPoints = Number(s.total_points) || 0
            const days = Math.max(differenceInDays(dateRange.to, dateRange.from), 1)
            const peakEntry = dailyArr.reduce((best, d) => d.scans > (best?.scans || 0) ? d : best, dailyArr[0])

            // Growth rate: compare first half vs second half of daily data
            const half = Math.floor(dailyArr.length / 2)
            const firstHalfScans = dailyArr.slice(0, half).reduce((sum, d) => sum + d.scans, 0)
            const secondHalfScans = dailyArr.slice(half).reduce((sum, d) => sum + d.scans, 0)
            const growthRate = firstHalfScans > 0 ? ((secondHalfScans - firstHalfScans) / firstHalfScans) * 100 : 0

            // Retention: consumers appearing in both halves (from daily unique counts approximation)
            const firstHalfConsumers = dailyArr.slice(0, half).reduce((sum, d) => sum + d.uniqueConsumers, 0)
            const secondHalfConsumers = dailyArr.slice(half).reduce((sum, d) => sum + d.uniqueConsumers, 0)
            const avgHalfConsumers = (firstHalfConsumers + secondHalfConsumers) / 2
            const retentionRate = uniqueConsumers > 0 && avgHalfConsumers > 0
                ? Math.min(((uniqueConsumers / avgHalfConsumers) * 100), 100)
                : 0

            setSummary({
                totalScans,
                uniqueConsumers,
                totalPoints,
                avgScansPerDay: Math.round(totalScans / days),
                peakDay: peakEntry?.date || '-',
                peakDayScans: peakEntry?.scans || 0,
                growthRate: parseFloat(growthRate.toFixed(1)),
                retentionRate: parseFloat(retentionRate.toFixed(1)),
                avgScansPerConsumer: uniqueConsumers > 0 ? parseFloat((totalScans / uniqueConsumers).toFixed(1)) : 0,
                newConsumersThisPeriod: uniqueConsumers,
            })

            // 3) Top consumers (already enriched with names by the SQL function)
            const topArr: TopConsumer[] = (topRes.data || []).map((row: any, i: number) => ({
                phone: row.phone,
                name: row.consumer_name || row.phone,
                scanCount: Number(row.scan_count),
                totalPoints: Number(row.total_points),
                lastActive: row.last_active,
                rank: i + 1,
            }))
            setTopConsumers(topArr)

            // 4) Product scans
            const productRows = productRes.data || []
            const totalProductScans = productRows.reduce((sum: number, r: any) => sum + Number(r.scan_count), 0) || 1
            const productArr: ProductScan[] = productRows.map((r: any) => ({
                productName: r.product_name,
                scanCount: Number(r.scan_count),
                uniqueConsumers: Number(r.unique_consumers),
                percentage: parseFloat(((Number(r.scan_count) / totalProductScans) * 100).toFixed(1)),
            }))
            setProductScans(productArr)

            // 5) Hourly heatmap
            const hourMap = new Map<number, number>()
            ;(hourlyRes.data || []).forEach((row: any) => hourMap.set(Number(row.hour), Number(row.scans)))
            const hourlyArr: HourlyData[] = Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                label: `${i.toString().padStart(2, '0')}:00`,
                scans: hourMap.get(i) || 0,
            }))
            setHourlyData(hourlyArr)

        } catch (err) {
            console.error('Consumer analytics load error:', err)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [companyId, dateRange, supabase])

    useEffect(() => { loadData() }, [loadData])

    const handleRefresh = () => { setRefreshing(true); loadData() }

    // ── Derived data ─────────────────────────────────────────────────────────
    const displayedTopConsumers = useMemo(() => topConsumers.slice(0, topN), [topConsumers, topN])
    const sparkScans = useMemo(() => dailyData.map(d => d.scans), [dailyData])
    const sparkConsumers = useMemo(() => dailyData.map(d => d.uniqueConsumers), [dailyData])
    const maxHourlyScan = useMemo(() => Math.max(...hourlyData.map(h => h.scans), 1), [hourlyData])

    // Weekly aggregation for bar chart
    const weeklyData = useMemo(() => {
        if (dailyData.length === 0) return []
        const weeks: { label: string; scans: number; consumers: number }[] = []
        const chunkSize = 7
        for (let i = 0; i < dailyData.length; i += chunkSize) {
            const chunk = dailyData.slice(i, i + chunkSize)
            const label = chunk.length > 1 ? `${chunk[0].date} – ${chunk[chunk.length - 1].date}` : chunk[0].date
            weeks.push({
                label,
                scans: chunk.reduce((s, d) => s + d.scans, 0),
                consumers: chunk.reduce((s, d) => s + d.uniqueConsumers, 0),
            })
        }
        return weeks
    }, [dailyData])

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                        <Scan className="w-5 h-5 text-blue-500" />
                        Consumer Scan Analytics
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{dateRange.label} &bull; Real-time consumer engagement intelligence</p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                        <SelectTrigger className="w-[160px] bg-card border-border">
                            <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7d">Last 7 Days</SelectItem>
                            <SelectItem value="30d">Last 30 Days</SelectItem>
                            <SelectItem value="90d">Last 90 Days</SelectItem>
                            <SelectItem value="quarter">This Quarter</SelectItem>
                            <SelectItem value="all">All Time</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </motion.div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard title="Total Scans" value={summary.totalScans} change={summary.growthRate} icon={Scan} color="#3b82f6" subtitle={`avg ${summary.avgScansPerDay}/day`} loading={loading} sparkData={sparkScans} delay={0} />
                <KpiCard title="Unique Consumers" value={summary.uniqueConsumers} icon={Users} color="#10b981" subtitle={`${summary.avgScansPerConsumer} scans/user`} loading={loading} sparkData={sparkConsumers} delay={0.05} />
                <KpiCard title="Peak Day" value={summary.peakDayScans} icon={Zap} color="#f59e0b" subtitle={summary.peakDay} loading={loading} delay={0.1} />
                <KpiCard title="Retention Rate" value={`${summary.retentionRate}%`} icon={Target} color="#8b5cf6" subtitle="returning consumers" loading={loading} delay={0.15} />
            </div>

            {/* Scan Trend Chart (Full Width) */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-blue-500" />
                                    Daily Scan Trend
                                </CardTitle>
                                <CardDescription>Scans &amp; unique consumers over time</CardDescription>
                            </div>
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs">
                                {dailyData.length} days
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center h-[320px]">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={320}>
                                <ComposedChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                                    <defs>
                                        <linearGradient id="gradScans" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradConsumers" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: chartTickColor }} tickLine={false} axisLine={false} interval={period === '7d' ? 0 : 'preserveStartEnd'} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: chartTickColor }} tickLine={false} axisLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: chartTickColor }} tickLine={false} axisLine={false} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                                    <Area yAxisId="left" type="monotone" dataKey="scans" name="Scans" fill="url(#gradScans)" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} />
                                    <Line yAxisId="right" type="monotone" dataKey="uniqueConsumers" name="Unique Consumers" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} strokeDasharray="4 4" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {/* Two-Column: Weekly Breakdown + Hourly Heatmap */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Bar Chart */}
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
                    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur h-full">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-indigo-500" />
                                Weekly Breakdown
                            </CardTitle>
                            <CardDescription>Scans grouped by week</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="flex items-center justify-center h-[260px]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={weeklyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: chartTickColor }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: chartTickColor }} tickLine={false} axisLine={false} />
                                        <Tooltip content={<ChartTooltip />} />
                                        <Bar dataKey="scans" name="Scans" radius={[6, 6, 0, 0]} maxBarSize={40}>
                                            {weeklyData.map((_, i) => (
                                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Hourly Scan Heatmap */}
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }}>
                    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur h-full">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <Clock className="w-4 h-4 text-cyan-500" />
                                Peak Hours
                            </CardTitle>
                            <CardDescription>Scan activity by hour of day</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="flex items-center justify-center h-[260px]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-12 gap-1">
                                        {hourlyData.map((h) => {
                                            const intensity = h.scans / maxHourlyScan
                                            const bg = isDark
                                                ? `rgba(59, 130, 246, ${0.1 + intensity * 0.8})`
                                                : `rgba(59, 130, 246, ${0.05 + intensity * 0.85})`
                                            return (
                                                <div
                                                    key={h.hour}
                                                    className="relative group cursor-default"
                                                    title={`${h.label}: ${h.scans.toLocaleString()} scans`}
                                                >
                                                    <div
                                                        className="aspect-square rounded-md transition-all duration-300 hover:scale-110 hover:shadow-lg flex items-center justify-center"
                                                        style={{ backgroundColor: bg }}
                                                    >
                                                        <span className={`text-[9px] font-bold ${intensity > 0.5 ? 'text-white' : 'text-muted-foreground'}`}>
                                                            {h.hour}
                                                        </span>
                                                    </div>
                                                    {/* Tooltip on hover */}
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-foreground text-background rounded-lg text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                                                        {h.label} – {h.scans.toLocaleString()} scans
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    {/* Legend bar */}
                                    <div className="flex items-center justify-between pt-2">
                                        <span className="text-[10px] text-muted-foreground">Low activity</span>
                                        <div className="flex gap-0.5">
                                            {[0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((v, i) => (
                                                <div key={i} className="w-6 h-2 rounded-sm" style={{ backgroundColor: `rgba(59, 130, 246, ${v})` }} />
                                            ))}
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">High activity</span>
                                    </div>
                                    {/* Peak hour highlight */}
                                    {(() => {
                                        const peak = hourlyData.reduce((best, h) => h.scans > best.scans ? h : best, hourlyData[0])
                                        return peak ? (
                                            <div className="flex items-center justify-center gap-2 pt-1">
                                                <Flame className="w-3.5 h-3.5 text-orange-500" />
                                                <span className="text-xs font-medium text-muted-foreground">
                                                    Peak at <span className="text-foreground font-bold">{peak.label}</span> with <span className="text-foreground font-bold">{peak.scans.toLocaleString()}</span> scans
                                                </span>
                                            </div>
                                        ) : null
                                    })()}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* Two-Column: Top Consumers + Product Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Consumers Ranking */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur h-full">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                                        <Trophy className="w-4 h-4 text-amber-500" />
                                        Top Consumers
                                    </CardTitle>
                                    <CardDescription>Ranked by scan activity</CardDescription>
                                </div>
                                <Select value={topN.toString()} onValueChange={(v) => setTopN(parseInt(v))}>
                                    <SelectTrigger className="w-[100px] h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="5">Top 5</SelectItem>
                                        <SelectItem value="10">Top 10</SelectItem>
                                        <SelectItem value="20">Top 20</SelectItem>
                                        <SelectItem value="50">Top 50</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                            {loading ? (
                                <div className="flex items-center justify-center h-[300px]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                            ) : displayedTopConsumers.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground text-sm">No consumer data available</div>
                            ) : (
                                <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                                    <AnimatePresence>
                                        {displayedTopConsumers.map((consumer, i) => {
                                            const maxScans = displayedTopConsumers[0]?.scanCount || 1
                                            const barWidth = (consumer.scanCount / maxScans) * 100
                                            return (
                                                <motion.div
                                                    key={consumer.phone}
                                                    initial={{ opacity: 0, x: -20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.03 }}
                                                    className="group relative p-3 rounded-xl hover:bg-muted/50 transition-colors"
                                                >
                                                    {/* Progress background */}
                                                    <div className="absolute inset-0 rounded-xl overflow-hidden opacity-[0.06] group-hover:opacity-[0.1] transition-opacity">
                                                        <div className="h-full rounded-xl" style={{ width: `${barWidth}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
                                                    </div>

                                                    <div className="relative flex items-center gap-3">
                                                        <RankBadge rank={consumer.rank} />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-semibold text-foreground truncate">{consumer.name}</p>
                                                            <p className="text-[10px] text-muted-foreground">{consumer.phone} &bull; Last active: {format(new Date(consumer.lastActive), 'dd MMM')}</p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-lg font-bold text-foreground">{consumer.scanCount.toLocaleString()}</p>
                                                            <p className="text-[10px] text-muted-foreground">scans</p>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )
                                        })}
                                    </AnimatePresence>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Product Scan Distribution */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
                    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur h-full">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <Package className="w-4 h-4 text-purple-500" />
                                Product Performance
                            </CardTitle>
                            <CardDescription>Scan distribution by product</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                            {loading ? (
                                <div className="flex items-center justify-center h-[300px]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                            ) : productScans.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground text-sm">No product data available</div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Donut Chart */}
                                    <div className="flex items-center justify-center">
                                        <ResponsiveContainer width={220} height={220}>
                                            <PieChart>
                                                <Pie
                                                    data={productScans}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={95}
                                                    paddingAngle={3}
                                                    dataKey="scanCount"
                                                    nameKey="productName"
                                                    animationBegin={0}
                                                    animationDuration={1200}
                                                    animationEasing="ease-out"
                                                >
                                                    {productScans.map((_, i) => (
                                                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="none" />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<ChartTooltip />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* Product bars */}
                                    <div className="space-y-3">
                                        {productScans.map((product, i) => (
                                            <motion.div
                                                key={product.productName}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.5 + i * 0.05 }}
                                                className="group p-3 rounded-xl hover:bg-muted/50 transition-colors"
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                                                        <span className="text-sm font-medium text-foreground">{product.productName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <Badge variant="secondary" className="text-[10px]">
                                                            <Users className="w-3 h-3 mr-1" />
                                                            {product.uniqueConsumers}
                                                        </Badge>
                                                        <span className="text-sm font-bold text-foreground">{product.scanCount.toLocaleString()}</span>
                                                    </div>
                                                </div>
                                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                    <motion.div
                                                        className="h-full rounded-full"
                                                        style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${product.percentage}%` }}
                                                        transition={{ duration: 1, delay: 0.5 + i * 0.1, ease: 'easeOut' }}
                                                    />
                                                </div>
                                                <div className="flex justify-between mt-1">
                                                    <span className="text-[10px] text-muted-foreground">{product.percentage}% of total</span>
                                                    <span className="text-[10px] text-muted-foreground">{product.uniqueConsumers} consumers</span>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* Engagement Heatmap / Consumer Insights */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <Star className="w-4 h-4 text-amber-500" />
                            Engagement Scorecard
                        </CardTitle>
                        <CardDescription>Key consumer engagement metrics at a glance</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: 'Avg Scans / Consumer', value: summary.avgScansPerConsumer, icon: Hash, color: '#3b82f6' },
                                { label: 'Avg Scans / Day', value: summary.avgScansPerDay, icon: Calendar, color: '#10b981' },
                                { label: 'Consumer Retention', value: `${summary.retentionRate}%`, icon: Target, color: '#8b5cf6' },
                                { label: 'Growth Rate', value: `${summary.growthRate > 0 ? '+' : ''}${summary.growthRate}%`, icon: summary.growthRate >= 0 ? TrendingUp : TrendingDown, color: summary.growthRate >= 0 ? '#10b981' : '#ef4444' },
                            ].map((metric, i) => (
                                <motion.div
                                    key={metric.label}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.55 + i * 0.05 }}
                                    className="relative text-center p-5 rounded-2xl bg-muted/50 hover:bg-muted transition-colors group"
                                >
                                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3" style={{ backgroundColor: `${metric.color}15` }}>
                                        <metric.icon className="w-5 h-5" style={{ color: metric.color }} />
                                    </div>
                                    <p className="text-2xl font-bold text-foreground">
                                        {typeof metric.value === 'number' ? <AnimatedNumber value={metric.value} decimals={1} /> : metric.value}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-1 font-medium">{metric.label}</p>
                                </motion.div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    )
}
