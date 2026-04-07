'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area,
} from 'recharts'
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown,
  Store, Users, Scan, Target, Crown, Eye,
  ArrowUpRight, ArrowDownRight, ChevronRight,
} from 'lucide-react'
import { format, subDays, subMonths, eachMonthOfInterval } from 'date-fns'

// ── Types ──────────────────────────────────────────────────────────────
interface ShopPerformanceTabProps {
  userProfile: any
  chartGridColor: string
  chartTickColor: string
  isDark: boolean
}

interface ScanRow {
  id: string
  consumer_id: string | null
  scanned_at: string | null
  shop_id: string | null
  collected_points: boolean
  points_amount: number | null
}

interface ShopInfo {
  id: string
  org_name: string
  branch: string | null
}

// ── Constants ──────────────────────────────────────────────────────────
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

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#ef4444', '#14b8a6', '#f97316']

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: 'quarter', label: 'This Quarter' },
  { value: '12months', label: 'Last 12 Months' },
]

// ── Helpers ────────────────────────────────────────────────────────────
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

function formatNum(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toLocaleString()
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />
}

// ── Main Component ─────────────────────────────────────────────────────
export default function ShopPerformanceTab({ userProfile, chartGridColor, chartTickColor, isDark }: ShopPerformanceTabProps) {
  const supabase = useMemo(() => createClient(), [])

  const [period, setPeriod] = useState('30')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scans, setScans] = useState<ScanRow[]>([])
  const [shops, setShops] = useState<Map<string, ShopInfo>>(new Map())
  const [drillShopId, setDrillShopId] = useState<string | null>(null)

  const tooltipBg = isDark ? '#1f2937' : '#ffffff'
  const tooltipStyle = {
    borderRadius: '12px',
    border: 'none',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    backgroundColor: tooltipBg,
    color: isDark ? '#f3f4f6' : undefined,
  }

  // ── Data Fetching ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      // Fetch scans (last 12 months for all periods)
      const start = subMonths(new Date(), 12).toISOString()
      const { data: scanData, error: scanErr } = await supabase
        .from('consumer_qr_scans')
        .select('id, consumer_id, scanned_at, shop_id, collected_points, points_amount')
        .eq('is_manual_adjustment', false)
        .not('shop_id', 'is', null)
        .gte('scanned_at', start)
        .order('scanned_at', { ascending: false })

      if (!scanErr && scanData) {
        setScans(scanData as unknown as ScanRow[])

        // Fetch shop info for all referenced shop_ids
        const shopIds = [...new Set((scanData as any[]).map(s => s.shop_id).filter(Boolean))]
        if (shopIds.length > 0) {
          const shopMap = new Map<string, ShopInfo>()
          const batchSize = 200
          for (let i = 0; i < shopIds.length; i += batchSize) {
            const batch = shopIds.slice(i, i + batchSize)
            const { data: orgData } = await supabase
              .from('organizations')
              .select('id, org_name, branch')
              .in('id', batch)
            if (orgData) {
              (orgData as any[]).forEach(o => shopMap.set(o.id, o))
            }
          }
          setShops(shopMap)
        }
      }
    } catch (err) {
      console.error('ShopPerformanceTab fetch error:', err)
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

  // ── Period scans ─────────────────────────────────────────────────────
  const periodScans = useMemo(() => {
    const now = new Date()
    let start: Date
    if (period === '12months') start = subMonths(now, 12)
    else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3)
      start = new Date(now.getFullYear(), q * 3, 1)
    }
    else start = subDays(now, parseInt(period))
    const sISO = start.toISOString()
    return scans.filter(s => s.scanned_at && s.scanned_at >= sISO)
  }, [scans, period])

  // ── KPI ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const activeShops = new Set(periodScans.map(s => s.shop_id).filter(Boolean)).size
    const totalScans = periodScans.length
    const uniqueConsumers = new Set(periodScans.map(s => s.consumer_id).filter(Boolean)).size
    const totalPoints = periodScans.reduce((a, s) => a + (s.points_amount || 0), 0)
    const avgScansPerShop = activeShops > 0 ? totalScans / activeShops : 0

    return { activeShops, totalScans, uniqueConsumers, totalPoints, avgScansPerShop }
  }, [periodScans])

  // ── Top 10 Shops ─────────────────────────────────────────────────────
  const top10Shops = useMemo(() => {
    const map = new Map<string, { scans: number; consumers: Set<string>; points: number }>()
    periodScans.forEach(s => {
      if (!s.shop_id) return
      if (!map.has(s.shop_id)) map.set(s.shop_id, { scans: 0, consumers: new Set(), points: 0 })
      const entry = map.get(s.shop_id)!
      entry.scans++
      if (s.consumer_id) entry.consumers.add(s.consumer_id)
      entry.points += (s.points_amount || 0)
    })

    return [...map.entries()]
      .map(([shopId, data]) => {
        const info = shops.get(shopId)
        return {
          shopId,
          name: info ? `${info.org_name}${info.branch ? ` (${info.branch})` : ''}` : shopId.slice(0, 8),
          scans: data.scans,
          consumers: data.consumers.size,
          points: data.points,
        }
      })
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 10)
  }, [periodScans, shops])

  // ── Drill-down: consumers for selected shop ──────────────────────────
  const drillData = useMemo(() => {
    if (!drillShopId) return null
    const shopScans = periodScans.filter(s => s.shop_id === drillShopId)
    const consumerMap = new Map<string, { scans: number; points: number; lastScan: string }>()

    shopScans.forEach(s => {
      const cid = s.consumer_id || 'anonymous'
      if (!consumerMap.has(cid)) consumerMap.set(cid, { scans: 0, points: 0, lastScan: '' })
      const entry = consumerMap.get(cid)!
      entry.scans++
      entry.points += (s.points_amount || 0)
      if (s.scanned_at && s.scanned_at > entry.lastScan) entry.lastScan = s.scanned_at
    })

    return [...consumerMap.entries()]
      .map(([consumerId, data]) => ({
        consumerId,
        ...data,
      }))
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 20)
  }, [drillShopId, periodScans])

  // ── Monthly Trend for All Shops ──────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const now = new Date()
    const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now })
    return months.map(m => {
      const key = format(m, 'yyyy-MM')
      const mScans = scans.filter(s => s.scanned_at?.startsWith(key))
      const shopSet = new Set(mScans.map(s => s.shop_id).filter(Boolean))
      return {
        month: format(m, 'MMM'),
        scans: mScans.length,
        shops: shopSet.size,
      }
    })
  }, [scans])

  // ── Distribution by shop size ────────────────────────────────────────
  const shopDistribution = useMemo(() => {
    const map = new Map<string, number>()
    periodScans.forEach(s => {
      if (!s.shop_id) return
      map.set(s.shop_id, (map.get(s.shop_id) || 0) + 1)
    })
    const counts = [...map.values()]
    const bins = [
      { name: '1-5 scans', min: 1, max: 5, count: 0 },
      { name: '6-20 scans', min: 6, max: 20, count: 0 },
      { name: '21-50 scans', min: 21, max: 50, count: 0 },
      { name: '51-100 scans', min: 51, max: 100, count: 0 },
      { name: '100+ scans', min: 101, max: Infinity, count: 0 },
    ]
    counts.forEach(c => {
      const bin = bins.find(b => c >= b.min && c <= b.max)
      if (bin) bin.count++
    })
    return bins.filter(b => b.count > 0)
  }, [periodScans])

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="border-0 bg-card/80 backdrop-blur overflow-hidden">
              <CardContent className="pt-6 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const drillShopInfo = drillShopId ? shops.get(drillShopId) : null

  return (
    <div className="space-y-6">
      {/* Period & Refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store className="h-5 w-5 text-purple-600" />
          <h3 className="text-lg font-semibold">Shop Performance</h3>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Shops</span>
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Store className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="text-2xl font-bold"><AnimatedCounter value={kpis.activeShops} /></div>
            <p className="text-xs text-muted-foreground mt-1">with scans in period</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Scans</span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Scan className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="text-2xl font-bold"><AnimatedCounter value={kpis.totalScans} /></div>
            <p className="text-xs text-muted-foreground mt-1">across all shops</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Consumers</span>
              <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-900/30">
                <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="text-2xl font-bold"><AnimatedCounter value={kpis.uniqueConsumers} /></div>
            <p className="text-xs text-muted-foreground mt-1">unique consumers</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Points Issued</span>
              <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Target className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <div className="text-2xl font-bold"><AnimatedCounter value={kpis.totalPoints} /></div>
            <p className="text-xs text-muted-foreground mt-1">total points</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg / Shop</span>
              <div className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                <TrendingUp className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              </div>
            </div>
            <div className="text-2xl font-bold"><AnimatedCounter value={kpis.avgScansPerShop} decimals={1} /></div>
            <p className="text-xs text-muted-foreground mt-1">scans per shop</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trend */}
        <Card className="lg:col-span-2 border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Monthly Shop Activity</CardTitle>
            <CardDescription>Scans and active shops over last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrend}>
                  <defs>
                    <linearGradient id="colorShopScans" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: chartTickColor, fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: chartTickColor, fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="scans" stroke={COLORS.primary} strokeWidth={2} fill="url(#colorShopScans)" name="Scans" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Shop Distribution Pie */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Shop Size Distribution</CardTitle>
            <CardDescription>Shops grouped by scan volume</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={shopDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="count"
                    stroke="none"
                  >
                    {shopDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Shops']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-3">
              {shopDistribution.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-sm text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold">{item.count} shop{item.count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top 10 Shops */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-500" />
                Top 10 Shops
              </CardTitle>
              <CardDescription>Ranked by scan volume • Click to drill down</CardDescription>
            </div>
            {drillShopId && (
              <Button variant="outline" size="sm" onClick={() => setDrillShopId(null)} className="gap-1.5 text-xs">
                ← Back to Top 10
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!drillShopId ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar Chart */}
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top10Shops} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke={chartGridColor} />
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={140}
                      tick={{ fontSize: 11, fill: chartTickColor }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value.toLocaleString(), 'Scans']} />
                    <Bar dataKey="scans" radius={[0, 8, 8, 0]} barSize={22} cursor="pointer"
                      onClick={(data: any) => { if (data?.shopId) setDrillShopId(data.shopId) }}
                    >
                      {top10Shops.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-xs font-semibold uppercase text-muted-foreground">#</th>
                      <th className="text-left py-2 text-xs font-semibold uppercase text-muted-foreground">Shop</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase text-muted-foreground">Scans</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase text-muted-foreground">Consumers</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase text-muted-foreground">Points</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {top10Shops.map((shop, i) => (
                      <tr key={shop.shopId} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setDrillShopId(shop.shopId)}>
                        <td className="py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="font-medium">{shop.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-semibold">{shop.scans.toLocaleString()}</td>
                        <td className="py-2.5 text-right">{shop.consumers}</td>
                        <td className="py-2.5 text-right">{shop.points.toLocaleString()}</td>
                        <td className="py-2.5 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                      </tr>
                    ))}
                    {top10Shops.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No shop scan data for this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Drill-down: Top consumers for selected shop */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-purple-600" />
                <span className="font-semibold">
                  {drillShopInfo ? `${drillShopInfo.org_name}${drillShopInfo.branch ? ` (${drillShopInfo.branch})` : ''}` : drillShopId.slice(0, 8)}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {periodScans.filter(s => s.shop_id === drillShopId).length} scans
                </Badge>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">#</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">Consumer ID</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Scans</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Points</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-muted-foreground">Last Scan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {drillData?.map((c, i) => (
                      <tr key={c.consumerId} className="hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">
                          {c.consumerId === 'anonymous' ? <span className="text-muted-foreground italic">Anonymous</span> : c.consumerId.slice(0, 12) + '…'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{c.scans}</td>
                        <td className="px-3 py-2 text-right">{c.points.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {c.lastScan ? format(new Date(c.lastScan), 'dd MMM yyyy HH:mm') : '—'}
                        </td>
                      </tr>
                    ))}
                    {(!drillData || drillData.length === 0) && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          No consumer data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
