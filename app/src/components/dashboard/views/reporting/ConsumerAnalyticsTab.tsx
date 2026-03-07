'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from 'recharts'
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Users, Scan, Target, BarChart3, Activity, Zap, Crown, Eye,
  UserPlus, UserCheck, Clock, Calendar, Flame, Star, Package,
} from 'lucide-react'
import {
  format, subDays, subMonths, startOfMonth, endOfMonth,
  eachMonthOfInterval, parseISO, differenceInDays, getDay, getHours,
} from 'date-fns'

// ── Types ──────────────────────────────────────────────────────────────────
interface ConsumerAnalyticsTabProps {
  userProfile: any
  chartGridColor: string
  chartTickColor: string
  isDark: boolean
}

interface ScanRow {
  id: string
  consumer_id: string | null
  scanned_at: string | null
  qr_code_id: string | null
  collected_points: boolean
  entered_lucky_draw: boolean
  redeemed_gift: boolean
  points_amount: number | null
  consumer_name: string | null
  consumer_phone: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────
const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  indigo: '#6366f1',
  pink: '#ec4899',
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#ef4444']

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: '12months', label: 'Last 12 Months' },
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`)

// ── Helpers ────────────────────────────────────────────────────────────────
function AnimatedCounter({ value, prefix = '', suffix = '', decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number
}) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let raf: number
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 900, 1)
      const ease = 1 - Math.pow(1 - p, 4)
      setDisplay(ease * value)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span>{prefix}{display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</span>
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />
}

function KPICardSkeleton() {
  return (
    <Card className="border-0 bg-card/80 backdrop-blur overflow-hidden">
      <CardContent className="pt-6 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  )
}

function formatNum(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toLocaleString()
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function ConsumerAnalyticsTab({ userProfile, chartGridColor, chartTickColor, isDark }: ConsumerAnalyticsTabProps) {
  const supabase = useMemo(() => createClient(), [])

  const [period, setPeriod] = useState('30')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scans, setScans] = useState<ScanRow[]>([])
  const [allScans, setAllScans] = useState<ScanRow[]>([]) // 12mo for monthly trends
  const [qrProductMap, setQrProductMap] = useState<Map<string, string>>(new Map()) // qr_code_id -> product name

  // ── Data Fetching ────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const last12Start = subMonths(new Date(), 12).toISOString()

      const { data, error } = await supabase
        .from('consumer_qr_scans')
        .select('id, consumer_id, scanned_at, qr_code_id, collected_points, entered_lucky_draw, redeemed_gift, points_amount, consumer_name, consumer_phone')
        .eq('is_manual_adjustment', false)
        .gte('scanned_at', last12Start)
        .order('scanned_at', { ascending: false })

      if (!error && data) {
        setAllScans(data as unknown as ScanRow[])

        // Build QR code → product name lookup
        const qrIds = [...new Set((data as any[]).map(s => s.qr_code_id).filter(Boolean))]
        if (qrIds.length > 0) {
          const nameMap = new Map<string, string>()
          const batchSize = 200
          for (let i = 0; i < qrIds.length; i += batchSize) {
            const batch = qrIds.slice(i, i + batchSize)
            const { data: qrRows } = await supabase
              .from('qr_codes')
              .select('id, product_id, products(product_name), product_variants(variant_name)')
              .in('id', batch)
            if (qrRows) {
              (qrRows as any[]).forEach(qr => {
                const prodName = qr.products?.product_name || ''
                const varName = qr.product_variants?.variant_name || ''
                const label = varName ? `${prodName} - ${varName}` : prodName || `QR-${qr.id.slice(0, 8)}`
                nameMap.set(qr.id, label)
              })
            }
          }
          setQrProductMap(nameMap)
        }
      }
    } catch (err) {
      console.error('ConsumerAnalyticsTab fetch error:', err)
    }
  }, [supabase])

  useEffect(() => {
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  // ── Period scans ─────────────────────────────────────────────────────────
  const periodScans = useMemo(() => {
    const now = new Date()
    let start: Date
    if (period === '12months') start = subMonths(now, 12)
    else start = subDays(now, parseInt(period))
    const sISO = start.toISOString()
    return allScans.filter(s => s.scanned_at && s.scanned_at >= sISO)
  }, [allScans, period])

  // ── KPI Metrics ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date()
    const days = period === '12months' ? 365 : parseInt(period)
    const prevStart = subDays(now, days * 2).toISOString()
    const prevEnd = subDays(now, days).toISOString()
    const prevScans = allScans.filter(s => s.scanned_at && s.scanned_at >= prevStart && s.scanned_at < prevEnd)

    const totalScans = periodScans.length
    const prevTotal = prevScans.length
    const scanGrowth = prevTotal > 0 ? ((totalScans - prevTotal) / prevTotal) * 100 : 0

    const uniqueConsumers = new Set(periodScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size
    const prevUnique = new Set(prevScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size
    const uniqueGrowth = prevUnique > 0 ? ((uniqueConsumers - prevUnique) / prevUnique) * 100 : 0

    const avgPerConsumer = uniqueConsumers > 0 ? totalScans / uniqueConsumers : 0
    const avgPerDay = totalScans / Math.max(days, 1)

    // Retention: consumers who scanned in both periods
    const currIds = new Set(periodScans.filter(s => s.consumer_id).map(s => s.consumer_id))
    const prevIds = new Set(prevScans.filter(s => s.consumer_id).map(s => s.consumer_id))
    const returnees = [...currIds].filter(id => prevIds.has(id)).length
    const retentionRate = prevIds.size > 0 ? (returnees / prevIds.size) * 100 : 0

    // Peak day
    const dayMap = new Map<string, number>()
    periodScans.forEach(s => {
      if (!s.scanned_at) return
      const key = s.scanned_at.slice(0, 10)
      dayMap.set(key, (dayMap.get(key) || 0) + 1)
    })
    let peakDay = '-'
    let peakCount = 0
    dayMap.forEach((c, d) => { if (c > peakCount) { peakCount = c; peakDay = d } })

    const pointsCollected = periodScans.filter(s => s.collected_points).length
    const redemptions = periodScans.filter(s => s.redeemed_gift).length

    return {
      totalScans, scanGrowth, uniqueConsumers, uniqueGrowth,
      avgPerConsumer, avgPerDay, retentionRate, peakDay, peakCount,
      pointsCollected, redemptions, days,
    }
  }, [periodScans, allScans, period])

  // ── Daily Scan Trend ─────────────────────────────────────────────────────
  const dailyTrend = useMemo(() => {
    const days = period === '12months' ? 365 : parseInt(period)
    const now = new Date()
    const data: { date: string; scans: number; consumers: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(now, i)
      const key = format(d, 'yyyy-MM-dd')
      const dayScans = periodScans.filter(s => s.scanned_at?.startsWith(key))
      data.push({
        date: format(d, days > 90 ? 'MMM' : 'dd MMM'),
        scans: dayScans.length,
        consumers: new Set(dayScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size,
      })
    }
    // Aggregate by month for 12months
    if (period === '12months') {
      const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now })
      return months.map(m => {
        const key = format(m, 'yyyy-MM')
        const mScans = allScans.filter(s => s.scanned_at?.startsWith(key))
        return {
          date: format(m, 'MMM yyyy'),
          scans: mScans.length,
          consumers: new Set(mScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size,
        }
      })
    }
    // For 90+ days, aggregate weekly
    if (days >= 90) {
      const weekly: typeof data = []
      for (let i = 0; i < data.length; i += 7) {
        const chunk = data.slice(i, i + 7)
        weekly.push({
          date: chunk[0].date,
          scans: chunk.reduce((a, c) => a + c.scans, 0),
          consumers: chunk.reduce((a, c) => a + c.consumers, 0),
        })
      }
      return weekly
    }
    return data
  }, [periodScans, allScans, period])

  // ── Monthly Analytics (always last 12 months) ────────────────────────────
  const monthlyAnalytics = useMemo(() => {
    const now = new Date()
    const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now })
    return months.map(m => {
      const key = format(m, 'yyyy-MM')
      const mScans = allScans.filter(s => s.scanned_at?.startsWith(key))
      const uniq = new Set(mScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size
      return {
        month: format(m, 'MMM yyyy'),
        monthShort: format(m, 'MMM'),
        scans: mScans.length,
        consumers: uniq,
        avgPerConsumer: uniq > 0 ? Math.round((mScans.length / uniq) * 10) / 10 : 0,
      }
    })
  }, [allScans])

  // ── Month-over-Month Comparison ──────────────────────────────────────────
  const momComparison = useMemo(() => {
    const now = new Date()
    const thisMonthKey = format(now, 'yyyy-MM')
    const lastMonthKey = format(subMonths(now, 1), 'yyyy-MM')
    const thisScans = allScans.filter(s => s.scanned_at?.startsWith(thisMonthKey))
    const lastScans = allScans.filter(s => s.scanned_at?.startsWith(lastMonthKey))
    const thisUniq = new Set(thisScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size
    const lastUniq = new Set(lastScans.filter(s => s.consumer_id).map(s => s.consumer_id)).size

    const scanGrowth = lastScans.length > 0 ? ((thisScans.length - lastScans.length) / lastScans.length) * 100 : 0
    const consumerGrowth = lastUniq > 0 ? ((thisUniq - lastUniq) / lastUniq) * 100 : 0

    return {
      thisMonth: { scans: thisScans.length, consumers: thisUniq },
      lastMonth: { scans: lastScans.length, consumers: lastUniq },
      scanGrowth, consumerGrowth,
    }
  }, [allScans])

  // ── Consumer Growth (New vs Returning) ───────────────────────────────────
  const consumerGrowth = useMemo(() => {
    const now = new Date()
    const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now })
    const seenBefore = new Set<string>()

    return months.map(m => {
      const key = format(m, 'yyyy-MM')
      const mScans = allScans
        .filter(s => s.scanned_at?.startsWith(key) && s.consumer_id)
        .sort((a, b) => (a.scanned_at || '') < (b.scanned_at || '') ? -1 : 1)

      const monthIds = new Set<string>()
      let newCount = 0
      let returningCount = 0

      mScans.forEach(s => {
        const cid = s.consumer_id!
        if (!monthIds.has(cid)) {
          monthIds.add(cid)
          if (seenBefore.has(cid)) {
            returningCount++
          } else {
            newCount++
          }
        }
      })

      // Add all this month's consumers to seenBefore for next month
      monthIds.forEach(id => seenBefore.add(id))

      return {
        month: format(m, 'MMM'),
        new: newCount,
        returning: returningCount,
        total: newCount + returningCount,
      }
    })
  }, [allScans])

  // ── Product Engagement ───────────────────────────────────────────────────
  const productEngagement = useMemo(() => {
    // Group scans by qr_code_id then resolve to product names
    const qrMap = new Map<string, number>()
    periodScans.forEach(s => {
      if (s.qr_code_id) {
        qrMap.set(s.qr_code_id, (qrMap.get(s.qr_code_id) || 0) + 1)
      }
    })
    // Merge by product name (multiple QR codes can map to same product)
    const productAgg = new Map<string, number>()
    qrMap.forEach((count, qrId) => {
      const name = qrProductMap.get(qrId) || `QR-${qrId.slice(0, 8)}`
      productAgg.set(name, (productAgg.get(name) || 0) + count)
    })
    const sorted = [...productAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    return sorted.map(([name, count], i) => ({
      name,
      scans: count,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }))
  }, [periodScans, qrProductMap])

  // ── Top Consumers ────────────────────────────────────────────────────────
  const topConsumers = useMemo(() => {
    const map = new Map<string, { scans: number; lastScan: string; name: string; phone: string }>()
    periodScans.forEach(s => {
      const cid = s.consumer_id || 'anonymous'
      const existing = map.get(cid) || { scans: 0, lastScan: '', name: s.consumer_name || 'Anonymous', phone: s.consumer_phone || '-' }
      existing.scans++
      if (s.scanned_at && s.scanned_at > existing.lastScan) {
        existing.lastScan = s.scanned_at
        if (s.consumer_name) existing.name = s.consumer_name
        if (s.consumer_phone) existing.phone = s.consumer_phone
      }
      map.set(cid, existing)
    })
    return [...map.entries()]
      .filter(([k]) => k !== 'anonymous')
      .sort((a, b) => b[1].scans - a[1].scans)
      .slice(0, 15)
      .map(([id, data], i) => ({
        rank: i + 1,
        id,
        name: data.name,
        phone: data.phone,
        scans: data.scans,
        lastScan: data.lastScan,
        frequency: data.scans > 10 ? 'High' : data.scans > 3 ? 'Medium' : 'Low',
      }))
  }, [periodScans])

  // ── Activity Heatmap ─────────────────────────────────────────────────────
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    periodScans.forEach(s => {
      if (!s.scanned_at) return
      const d = new Date(s.scanned_at)
      const day = getDay(d)
      const hour = getHours(d)
      grid[day][hour]++
    })
    // Flatten for rendering
    const result: { day: number; hour: number; count: number }[] = []
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        result.push({ day: d, hour: h, count: grid[d][h] })
      }
    }
    return { grid, flat: result, max: Math.max(...result.map(r => r.count), 1) }
  }, [periodScans])

  // ── Retention Cohort (simple month-over-month) ───────────────────────────
  const retentionCohort = useMemo(() => {
    const now = new Date()
    const months = eachMonthOfInterval({ start: subMonths(now, 5), end: now })

    return months.slice(0, -1).map((m, i) => {
      const key = format(m, 'yyyy-MM')
      const nextKey = format(months[i + 1], 'yyyy-MM')

      const thisIds = new Set(
        allScans.filter(s => s.scanned_at?.startsWith(key) && s.consumer_id).map(s => s.consumer_id!)
      )
      const nextIds = new Set(
        allScans.filter(s => s.scanned_at?.startsWith(nextKey) && s.consumer_id).map(s => s.consumer_id!)
      )
      const retained = [...thisIds].filter(id => nextIds.has(id)).length

      return {
        cohort: format(m, 'MMM yyyy'),
        total: thisIds.size,
        retained,
        rate: thisIds.size > 0 ? Math.round((retained / thisIds.size) * 100) : 0,
      }
    })
  }, [allScans])

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <KPICardSkeleton key={i} />)}
        </div>
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Scan className="h-5 w-5 text-blue-600" />
            Consumer Scan Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {period === '12months' ? 'Last 12 Months' : `Last ${period} Days`} &bull; Real-time consumer engagement intelligence
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[160px] bg-card">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          {
            title: 'TOTAL SCANS', value: kpis.totalScans, icon: Scan, color: COLORS.primary,
            sub: `avg ${Math.round(kpis.avgPerDay)}/day`, growth: kpis.scanGrowth,
          },
          {
            title: 'UNIQUE CONSUMERS', value: kpis.uniqueConsumers, icon: Users, color: COLORS.success,
            sub: `${kpis.avgPerConsumer.toFixed(0)} scans/user`, growth: kpis.uniqueGrowth,
          },
          {
            title: 'PEAK DAY', value: kpis.peakCount, icon: Flame, color: COLORS.warning,
            sub: kpis.peakDay !== '-' ? format(new Date(kpis.peakDay), 'dd MMM') : '-', growth: null,
          },
          {
            title: 'RETENTION RATE', value: kpis.retentionRate, icon: Target, color: COLORS.purple,
            sub: 'returning consumers', growth: null, suffix: '%', decimals: 1,
          },
        ]).map((card, i) => (
          <Card key={i} className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden group hover:shadow-xl transition-all">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider">{card.title}</span>
                <div className="p-2 rounded-xl shadow-sm" style={{ backgroundColor: `${card.color}15` }}>
                  <card.icon className="h-4 w-4" style={{ color: card.color }} />
                </div>
              </div>
              <div className="text-2xl font-bold text-foreground">
                <AnimatedCounter value={card.value} suffix={card.suffix || ''} decimals={card.decimals || 0} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                {card.growth !== null && (
                  <Badge variant="secondary" className={`text-xs ${card.growth >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {card.growth >= 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                    {Math.abs(card.growth).toFixed(1)}%
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">{card.sub}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Daily Scan Trend */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              {period === '12months' ? 'Monthly' : 'Daily'} Scan Trend
            </CardTitle>
            <CardDescription>Scans &amp; unique consumers over time</CardDescription>
          </div>
          <Badge variant="outline">{dailyTrend.length} {period === '12months' ? 'months' : 'days'}</Badge>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="date" tick={{ fill: chartTickColor, fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: chartTickColor, fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTickColor, fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', border: 'none', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="scans" stroke={COLORS.primary} fill={`${COLORS.primary}30`} name="Scans" />
                <Line yAxisId="right" type="monotone" dataKey="consumers" stroke={COLORS.success} strokeWidth={2} dot={false} name="Unique Consumers" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Analytics + Month-over-Month */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trend Chart */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-600" />
              Monthly Analytics (12 Months)
            </CardTitle>
            <CardDescription>Scans, consumers, and avg per consumer by month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyAnalytics}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="monthShort" tick={{ fill: chartTickColor, fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: chartTickColor, fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTickColor, fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', border: 'none', borderRadius: 12 }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="scans" fill={COLORS.primary} name="Scans" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="consumers" fill={COLORS.success} name="Consumers" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="avgPerConsumer" stroke={COLORS.warning} strokeWidth={2} name="Avg/Consumer" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Month-over-Month Comparison */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">This Month vs Last Month</CardTitle>
            <CardDescription>Month-over-month comparison</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-muted/50">
                <div className="text-xs font-semibold text-muted-foreground mb-1">TOTAL SCANS</div>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold">{momComparison.thisMonth.scans.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground ml-2">vs {momComparison.lastMonth.scans.toLocaleString()}</span>
                  </div>
                  <Badge className={momComparison.scanGrowth >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
                    {momComparison.scanGrowth >= 0 ? '+' : ''}{momComparison.scanGrowth.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-muted/50">
                <div className="text-xs font-semibold text-muted-foreground mb-1">UNIQUE CONSUMERS</div>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold">{momComparison.thisMonth.consumers.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground ml-2">vs {momComparison.lastMonth.consumers.toLocaleString()}</span>
                  </div>
                  <Badge className={momComparison.consumerGrowth >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
                    {momComparison.consumerGrowth >= 0 ? '+' : ''}{momComparison.consumerGrowth.toFixed(1)}%
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consumer Growth: New vs Returning */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-green-600" />
            Consumer Growth
          </CardTitle>
          <CardDescription>New vs returning consumers per month</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={consumerGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="month" tick={{ fill: chartTickColor, fontSize: 11 }} />
                <YAxis tick={{ fill: chartTickColor, fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', border: 'none', borderRadius: 12 }} />
                <Legend />
                <Bar dataKey="new" stackId="a" fill={COLORS.success} name="New" radius={[0, 0, 0, 0]} />
                <Bar dataKey="returning" stackId="a" fill={COLORS.primary} name="Returning" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Activity Heatmap + Retention Cohort */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Heatmap */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600" />
              Activity Heatmap
            </CardTitle>
            <CardDescription>Scan activity by day-of-week and hour</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="min-w-[500px]">
                <div className="flex gap-0.5">
                  <div className="w-10" />
                  {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                    <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">{h}:00</div>
                  ))}
                </div>
                {DAY_NAMES.map((day, di) => (
                  <div key={di} className="flex items-center gap-0.5 mb-0.5">
                    <div className="w-10 text-xs text-muted-foreground text-right pr-1">{day}</div>
                    {Array.from({ length: 24 }).map((_, hi) => {
                      const count = heatmapData.grid[di][hi]
                      const intensity = count / heatmapData.max
                      return (
                        <div
                          key={hi}
                          className="flex-1 aspect-square rounded-sm transition-colors"
                          style={{
                            backgroundColor: count === 0
                              ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')
                              : `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`,
                          }}
                          title={`${day} ${hi}:00 — ${count} scans`}
                        />
                      )
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <span className="text-xs text-muted-foreground">Less</span>
                  {[0.1, 0.3, 0.5, 0.7, 1].map((v, i) => (
                    <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(59, 130, 246, ${0.15 + v * 0.85})` }} />
                  ))}
                  <span className="text-xs text-muted-foreground">More</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Retention Cohort */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-purple-600" />
              Monthly Retention Cohort
            </CardTitle>
            <CardDescription>% of consumers who scanned again next month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {retentionCohort.map((c, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-24 text-sm font-medium text-muted-foreground">{c.cohort}</div>
                  <div className="flex-1">
                    <div className="h-6 bg-muted rounded-full overflow-hidden relative">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${c.rate}%`,
                          backgroundColor: c.rate >= 50 ? COLORS.success : c.rate >= 25 ? COLORS.warning : COLORS.danger,
                        }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
                        {c.rate}% ({c.retained}/{c.total})
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {retentionCohort.length === 0 && (
              <div className="text-center text-muted-foreground py-8">Not enough data for retention analysis</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Consumers Leaderboard */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-600" />
            Top Consumers
          </CardTitle>
          <CardDescription>Monthly ranking by engagement</CardDescription>
        </CardHeader>
        <CardContent>
          {topConsumers.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No consumer data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">#</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Consumer</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground text-right">Total Scans</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Last Scan</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {topConsumers.map((c) => (
                    <tr key={c.id} className="border-b border-muted/50 hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${c.rank === 1 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            c.rank === 2 ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' :
                              c.rank === 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                'bg-muted text-muted-foreground'
                          }`}>
                          {c.rank <= 3 ? ['🥇', '🥈', '🥉'][c.rank - 1] : c.rank}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                      </td>
                      <td className="py-3 pr-4 text-right font-bold">{c.scans.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {c.lastScan ? format(new Date(c.lastScan), 'dd MMM yyyy') : '-'}
                      </td>
                      <td className="py-3">
                        <Badge variant="secondary" className={
                          c.frequency === 'High' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            c.frequency === 'Medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                              'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }>{c.frequency}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Engagement */}
      {productEngagement.length > 0 && (
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Eye className="h-5 w-5 text-cyan-600" />
              Product Engagement
            </CardTitle>
            <CardDescription>Top scanned products by engagement volume</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productEngagement} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" tick={{ fill: chartTickColor, fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={160} tick={{ fill: chartTickColor, fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', border: 'none', borderRadius: 12 }} />
                  <Bar dataKey="scans" radius={[0, 4, 4, 0]}>
                    {productEngagement.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
