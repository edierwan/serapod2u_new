'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell, ComposedChart, Line,
} from 'recharts'
import {
  Download, TrendingUp, TrendingDown, Users, ShoppingCart,
  Loader2, RefreshCw, DollarSign, ArrowUpRight, ArrowDownRight, 
  Building2, Target, CheckCircle2, Search, Copy, Link2,
  PieChart as PieChartIcon, UserMinus, UserPlus, Repeat, Crown,
  Medal, Award, ChevronRight, Package, Minus,
  Calendar as CalendarIcon, Filter, X,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useTheme } from '@/components/providers/ThemeProvider'
import type {
  DistributorReportData,
  KPICard,
  DistributorLeaderboardRow,
  ComparisonItem,
  InsightCard as InsightCardType,
  MonthlyTrendPoint,
  DistributorDetail,
} from '@/lib/reporting/distributorReports.types'

// ============================================================
// CONSTANTS & COLORS
// ============================================================
const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  purple: '#8b5cf6',
  pink: '#ec4899',
  cyan: '#06b6d4',
  indigo: '#6366f1',
}

const CHART_COLORS = [
  COLORS.primary, COLORS.success, COLORS.warning,
  COLORS.purple, COLORS.pink, COLORS.cyan,
]

const ICON_MAP: Record<string, any> = {
  ShoppingCart, DollarSign, Target, Building2, RefreshCw, CheckCircle2,
  PieChart: PieChartIcon, UserMinus, UserPlus, Repeat,
}

// ============================================================
// ANIMATED COUNTER
// ============================================================
function AnimatedCounter({ value, prefix = '', suffix = '', decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number
}) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let start = 0
    const dur = 900
    let raf: number
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      const ease = 1 - Math.pow(1 - p, 4)
      setDisplay(ease * value)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span>{prefix}{display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</span>
}

// ============================================================
// SKELETON LOADER
// ============================================================
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />
}

function KPICardSkeleton() {
  return (
    <Card className="border-0 bg-card/80 backdrop-blur overflow-hidden">
      <CardContent className="pt-6 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-20" />
      </CardContent>
    </Card>
  )
}

// ============================================================
// KPI CARD
// ============================================================
function KPICardComponent({ kpi, loading }: { kpi: KPICard; loading: boolean }) {
  if (loading) return <KPICardSkeleton />

  const Icon = ICON_MAP[kpi.icon] || Target
  const isUp = kpi.trend === 'up'
  const isDown = kpi.trend === 'down'

  return (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-500 border-0 bg-card/80 backdrop-blur hover:-translate-y-0.5">
      <div
        className="absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full opacity-[0.08] group-hover:opacity-[0.15] transition-opacity duration-500"
        style={{ backgroundColor: kpi.color }}
      />
      <div
        className="absolute bottom-0 left-0 h-1 w-full opacity-80"
        style={{ background: `linear-gradient(to right, ${kpi.color}, transparent)` }}
      />
      <CardContent className="pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
            <div className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
              {typeof kpi.value === 'number' && !kpi.formattedValue.includes('%') ? (
                <AnimatedCounter
                  value={kpi.value}
                  prefix={kpi.label.includes('Amount') || kpi.label.includes('Order Value') ? 'RM ' : ''}
                  decimals={kpi.label.includes('Amount') || kpi.label.includes('Order Value') ? 2 : 0}
                />
              ) : (
                kpi.formattedValue
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {kpi.delta !== null && (
                <Badge
                  variant="secondary"
                  className={`text-xs font-medium ${
                    isUp
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : isDown
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isUp && <ArrowUpRight className="w-3 h-3 mr-0.5" />}
                  {isDown && <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {!isUp && !isDown && <Minus className="w-3 h-3 mr-0.5" />}
                  {Math.abs(kpi.delta).toFixed(1)}%
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">{kpi.deltaLabel}</span>
            </div>
          </div>
          <div className="p-3 rounded-xl shrink-0" style={{ backgroundColor: `${kpi.color}12` }}>
            <Icon className="w-5 h-5" style={{ color: kpi.color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// RANK BADGE
// ============================================================
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30"><Crown className="w-4 h-4 text-amber-600" /></div>
  if (rank === 2) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800"><Medal className="w-4 h-4 text-slate-500" /></div>
  if (rank === 3) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30"><Award className="w-4 h-4 text-orange-600" /></div>
  return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted"><span className="text-xs font-bold text-muted-foreground">{rank}</span></div>
}

// ============================================================
// INSIGHT CARD COMPONENT
// ============================================================
function InsightCardComponent({ insight }: { insight: InsightCardType }) {
  const Icon = ICON_MAP[insight.icon] || Target
  return (
    <Card className="border-0 bg-card/80 backdrop-blur hover:shadow-lg transition-all duration-300 overflow-hidden group">
      <div className="absolute top-0 left-0 h-full w-1 opacity-80" style={{ backgroundColor: insight.color }} />
      <CardContent className="pt-5 pb-4 pl-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${insight.color}15` }}>
            <Icon className="w-4 h-4" style={{ color: insight.color }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{insight.title}</p>
            <p className="text-xl font-bold text-foreground">{insight.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// DISTRIBUTOR DETAIL DRAWER
// ============================================================
function DistributorDetailDrawer({
  open,
  onClose,
  distributorId,
  isDark,
}: {
  open: boolean
  onClose: () => void
  distributorId: string | null
  isDark: boolean
}) {
  const [detail, setDetail] = useState<DistributorDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!distributorId || !open) return
    setLoading(true)
    fetch(`/api/reporting/distributors/${distributorId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [distributorId, open])

  const chartGrid = isDark ? '#374151' : '#f0f0f0'
  const chartTick = isDark ? '#9ca3af' : '#6b7280'
  const tooltipBg = isDark ? 'rgba(31,41,55,0.95)' : 'rgba(255,255,255,0.95)'

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-xl font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            {loading ? <Skeleton className="h-6 w-40" /> : detail?.name || 'Distributor'}
          </SheetTitle>
          <SheetDescription>Performance detail & order history</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : detail ? (
          <div className="space-y-6 py-4">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total RM', value: `RM ${detail.totalRM.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`, color: COLORS.success },
                { label: 'Orders', value: detail.totalOrders, color: COLORS.primary },
                { label: 'AOV', value: `RM ${detail.aov.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`, color: COLORS.purple },
                { label: 'Growth', value: detail.growthPct !== null ? `${detail.growthPct.toFixed(1)}%` : 'N/A', color: detail.growthPct && detail.growthPct > 0 ? COLORS.success : COLORS.danger },
              ].map((item) => (
                <div key={item.label} className="p-3 rounded-xl bg-muted/50">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Last Order */}
            {detail.lastOrderDate && (
              <p className="text-xs text-muted-foreground">
                Last order: <span className="font-medium text-foreground">{format(new Date(detail.lastOrderDate), 'dd MMM yyyy')}</span>
              </p>
            )}

            {/* Trend Chart */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold">Monthly Trend (Last 12 months)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.trend}>
                      <defs>
                        <linearGradient id="detailGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 16px rgba(0,0,0,0.12)', backgroundColor: tooltipBg }}
                        formatter={(v: number) => [`RM ${v.toLocaleString()}`, 'Amount']}
                      />
                      <Area type="monotone" dataKey="amount" stroke={COLORS.primary} strokeWidth={2} fill="url(#detailGrad)" dot={false} activeDot={{ r: 5, fill: COLORS.primary, stroke: '#fff', strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Top Products */}
            {detail.topProducts.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-semibold">Top Products / SKUs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {detail.topProducts.slice(0, 8).map((p, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-sm truncate">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground">{p.qty} pcs</span>
                          <span className="text-sm font-semibold">RM {p.amount.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Orders */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold">Recent Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {detail.recentOrders.map((o, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                      <div>
                        <p className="text-sm font-medium">{o.orderNo}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(o.date), 'dd MMM yyyy')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">RM {o.amount.toLocaleString()}</p>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            o.status === 'approved'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : o.status === 'submitted'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {o.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {detail.recentOrders.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No orders found</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Aging Buckets (if available) */}
            {detail.agingBuckets && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-semibold">Payment Aging</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '0-30d', value: detail.agingBuckets.current, color: COLORS.success },
                      { label: '31-60d', value: detail.agingBuckets.days31_60, color: COLORS.warning },
                      { label: '61-90d', value: detail.agingBuckets.days61_90, color: COLORS.danger },
                      { label: '90+d', value: detail.agingBuckets.days90plus, color: '#dc2626' },
                    ].map((b) => (
                      <div key={b.label} className="text-center p-2 rounded-lg bg-muted/40">
                        <p className="text-[10px] font-semibold text-muted-foreground">{b.label}</p>
                        <p className="text-sm font-bold" style={{ color: b.color }}>RM {b.value.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Unable to load distributor details</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ============================================================
// MAIN — DISTRIBUTOR REPORTS TAB
// ============================================================
interface DistributorReportsTabProps {
  userProfile: any
}

export default function DistributorReportsTab({ userProfile }: DistributorReportsTabProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const chartGrid = isDark ? '#374151' : '#f0f0f0'
  const chartTick = isDark ? '#9ca3af' : '#6b7280'
  const tooltipBg = isDark ? 'rgba(31,41,55,0.95)' : 'rgba(255,255,255,0.95)'
  const tooltipStyle = { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.15)', backgroundColor: tooltipBg, color: isDark ? '#f3f4f6' : undefined }

  // ── State ──────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)
  const [dateRange, setDateRange] = useState('thisMonth')
  const [orderType, setOrderType] = useState('')
  const [seller, setSeller] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [trendMetric, setTrendMetric] = useState<'amount' | 'orders'>('amount')
  const [comparisonMode, setComparisonMode] = useState<'absolute' | 'growth'>('absolute')
  const [sortField, setSortField] = useState<string>('totalRM')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedDistId, setSelectedDistId] = useState<string | null>(null)
  const [sellers, setSellers] = useState<{ id: string; org_name: string }[]>([])

  // ── Fetch report data ────────────────────────────────────
  const fetchReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('dateRange', dateRange)
      if (orderType) params.set('orderType', orderType)
      if (seller) params.set('seller', seller)
      if (status) params.set('status', status)
      if (search) params.set('search', search)

      // Update URL for shareability
      const newUrl = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState(null, '', newUrl)

      const res = await fetch(`/api/reporting/distributors/report?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setData(json)
      if (json.sellers) setSellers(json.sellers)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateRange, orderType, seller, status, search])

  // ── Init from URL search params ──────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('dateRange')) setDateRange(sp.get('dateRange')!)
    if (sp.get('orderType')) setOrderType(sp.get('orderType')!)
    if (sp.get('seller')) setSeller(sp.get('seller')!)
    if (sp.get('status')) setStatus(sp.get('status')!)
    if (sp.get('search')) setSearch(sp.get('search')!)
  }, [])

  useEffect(() => { fetchReport() }, [fetchReport])

  // ── CSV Export ────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const params = new URLSearchParams()
    params.set('dateRange', dateRange)
    if (orderType) params.set('orderType', orderType)
    if (seller) params.set('seller', seller)
    if (status) params.set('status', status)
    if (search) params.set('search', search)
    window.open(`/api/reporting/distributors/csv?${params}`, '_blank')
  }, [dateRange, orderType, seller, status, search])

  // ── Copy Share Link ──────────────────────────────────────
  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
  }, [])

  // ── Sort leaderboard ─────────────────────────────────────
  const sortedLeaderboard = useMemo(() => {
    if (!data?.leaderboard) return []
    const lb = [...data.leaderboard]
    lb.sort((a: any, b: any) => {
      const va = a[sortField] ?? 0
      const vb = b[sortField] ?? 0
      return sortDir === 'desc' ? vb - va : va - vb
    })
    return lb.map((row: any, idx: number) => ({ ...row, rank: idx + 1 }))
  }, [data?.leaderboard, sortField, sortDir])

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortField(field); setSortDir('desc') }
  }

  // ── Render ────────────────────────────────────────────────
  const kpis: KPICard[] = data?.kpis || []
  const trend: MonthlyTrendPoint[] = data?.trend || []
  const comparison: ComparisonItem[] = data?.comparison || []
  const insights: InsightCardType[] = data?.insights || []

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      {/* ─── HEADER / FILTERS ────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Distributor Reports</h2>
                <p className="text-sm text-muted-foreground">Distributor performance, sell-in trends, and monthly comparison</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleCopyLink} className="bg-card shadow-sm">
              <Link2 className="w-4 h-4 mr-1.5" /> Share
            </Button>
            <Button size="sm" onClick={handleExportCSV} className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[160px] bg-card border-border shadow-sm h-9 text-sm">
              <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="lastMonth">Last Month</SelectItem>
              <SelectItem value="last3Months">Last 3 Months</SelectItem>
              <SelectItem value="last6Months">Last 6 Months</SelectItem>
              <SelectItem value="last12Months">Last 12 Months</SelectItem>
            </SelectContent>
          </Select>

          <Select value={orderType} onValueChange={setOrderType}>
            <SelectTrigger className="w-[130px] bg-card border-border shadow-sm h-9 text-sm">
              <SelectValue placeholder="Order Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Types</SelectItem>
              <SelectItem value="H2M">H2M</SelectItem>
              <SelectItem value="D2H">D2H</SelectItem>
              <SelectItem value="S2D">S2D</SelectItem>
            </SelectContent>
          </Select>

          <Select value={seller} onValueChange={setSeller}>
            <SelectTrigger className="w-[170px] bg-card border-border shadow-sm h-9 text-sm">
              <SelectValue placeholder="All Sellers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Sellers</SelectItem>
              {sellers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.org_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[130px] bg-card border-border shadow-sm h-9 text-sm">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search distributor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-[180px] h-9 text-sm bg-card shadow-sm"
              onKeyDown={(e) => e.key === 'Enter' && fetchReport()}
            />
          </div>

          <Button variant="ghost" size="icon" onClick={fetchReport} className="h-9 w-9">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          {(orderType || seller || status || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setOrderType(''); setSeller(''); setStatus(''); setSearch('') }}
              className="h-9 text-xs text-muted-foreground"
            >
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* ─── ERROR BANNER ────────────────────────────────────── */}
      {error && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <X className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="font-medium text-red-800 dark:text-red-200">Failed to load report</p>
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchReport}>
              <RefreshCw className="w-4 h-4 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── KPI CARDS ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <KPICardSkeleton key={i} />)
          : kpis.map((kpi) => <KPICardComponent key={kpi.id} kpi={kpi} loading={false} />)}
      </div>

      {/* ─── TREND CHART ─────────────────────────────────────── */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg font-semibold">Monthly Sell-In Trend</CardTitle>
              <CardDescription>Distributor order activity over time</CardDescription>
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <Button
                size="sm"
                variant={trendMetric === 'amount' ? 'default' : 'ghost'}
                onClick={() => setTrendMetric('amount')}
                className={`h-7 text-xs ${trendMetric === 'amount' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
              >
                RM
              </Button>
              <Button
                size="sm"
                variant={trendMetric === 'orders' ? 'default' : 'ghost'}
                onClick={() => setTrendMetric('orders')}
                className={`h-7 text-xs ${trendMetric === 'orders' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
              >
                # Orders
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : trend.length > 0 ? (
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <defs>
                    <linearGradient id="distTrendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 12 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: chartTick, fontSize: 12 }}
                    tickFormatter={(v) =>
                      trendMetric === 'amount'
                        ? v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                        : v
                    }
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number) => [
                      trendMetric === 'amount' ? `RM ${v.toLocaleString()}` : v.toLocaleString(),
                      trendMetric === 'amount' ? 'Amount' : 'Orders',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey={trendMetric}
                    stroke={COLORS.primary}
                    strokeWidth={2.5}
                    fill="url(#distTrendGrad)"
                    dot={false}
                    activeDot={{ r: 6, fill: COLORS.primary, stroke: '#fff', strokeWidth: 2 }}
                  />
                  <Line type="monotone" dataKey={trendMetric} stroke={COLORS.indigo} strokeWidth={1} strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              <p>No trend data available for the selected period</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── LEADERBOARD ─────────────────────────────────────── */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Top Distributor Leaderboard</CardTitle>
              <CardDescription>{sortedLeaderboard.length} distributors ranked by performance</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : sortedLeaderboard.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium w-12">#</th>
                    <th className="text-left py-3 px-2 font-medium">Distributor</th>
                    <th className="text-right py-3 px-2 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('totalRM')}>
                      Total RM {sortField === 'totalRM' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="text-right py-3 px-2 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('orders')}>
                      Orders {sortField === 'orders' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="text-right py-3 px-2 font-medium hidden lg:table-cell cursor-pointer hover:text-foreground" onClick={() => toggleSort('aov')}>
                      AOV {sortField === 'aov' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="text-right py-3 px-2 font-medium hidden md:table-cell">Growth</th>
                    <th className="text-right py-3 px-2 font-medium hidden lg:table-cell cursor-pointer hover:text-foreground" onClick={() => toggleSort('sharePct')}>
                      Share {sortField === 'sharePct' && (sortDir === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="text-right py-3 px-2 font-medium hidden xl:table-cell">Last Order</th>
                    <th className="text-right py-3 px-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((row: DistributorLeaderboardRow) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors group"
                      onClick={() => { setSelectedDistId(row.id); setDrawerOpen(true) }}
                    >
                      <td className="py-3.5 px-2"><RankBadge rank={row.rank} /></td>
                      <td className="py-3.5 px-2">
                        <span className="font-medium text-foreground group-hover:text-blue-600 transition-colors">{row.name}</span>
                      </td>
                      <td className="py-3.5 px-2 text-right font-semibold tabular-nums">
                        RM {row.totalRM.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-2 text-right tabular-nums">{row.orders}</td>
                      <td className="py-3.5 px-2 text-right tabular-nums hidden lg:table-cell">
                        RM {row.aov.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-2 text-right hidden md:table-cell">
                        {row.growthPct !== null ? (
                          <Badge variant="secondary" className={`text-[10px] ${row.growthPct >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {row.growthPct >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                            {Math.abs(row.growthPct).toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-2 text-right tabular-nums hidden lg:table-cell">
                        {row.sharePct.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-2 text-right hidden xl:table-cell text-xs text-muted-foreground">
                        {row.lastOrderDate ? format(new Date(row.lastOrderDate), 'dd MMM') : '—'}
                      </td>
                      <td className="py-3.5 px-2 text-right">
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No distributor order activity found</p>
              <p className="text-sm mt-1">Adjust filters or select a different date range</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── COMPARISON CHART ────────────────────────────────── */}
      {comparison.length > 0 && (
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg font-semibold">Period Comparison</CardTitle>
                <CardDescription>Top 10 distributors — current vs previous period</CardDescription>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <Button
                  size="sm"
                  variant={comparisonMode === 'absolute' ? 'default' : 'ghost'}
                  onClick={() => setComparisonMode('absolute')}
                  className={`h-7 text-xs ${comparisonMode === 'absolute' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
                >
                  Absolute RM
                </Button>
                <Button
                  size="sm"
                  variant={comparisonMode === 'growth' ? 'default' : 'ghost'}
                  onClick={() => setComparisonMode('growth')}
                  className={`h-7 text-xs ${comparisonMode === 'growth' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
                >
                  Growth %
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                {comparisonMode === 'absolute' ? (
                  <BarChart data={comparison} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke={chartGrid} />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: chartTick, fontSize: 11 }}
                      tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      tick={{ fill: chartTick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`RM ${v.toLocaleString()}`, '']} />
                    <Legend />
                    <Bar dataKey="current" name="Current Period" fill={COLORS.primary} radius={[0, 6, 6, 0]} barSize={14} />
                    <Bar dataKey="previous" name="Previous Period" fill={COLORS.primary + '40'} radius={[0, 6, 6, 0]} barSize={14} />
                  </BarChart>
                ) : (
                  <BarChart data={comparison} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke={chartGrid} />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: chartTick, fontSize: 11 }}
                      tickFormatter={(v) => `${v.toFixed(0)}%`}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      tick={{ fill: chartTick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, 'Growth']} />
                    <Bar dataKey="growthPct" name="Growth %" radius={[0, 6, 6, 0]} barSize={16}>
                      {comparison.map((entry, idx) => (
                        <Cell key={idx} fill={entry.growthPct >= 0 ? COLORS.success : COLORS.danger} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── INSIGHTS / SEGMENTATION ────────────────────────── */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Insights & Segmentation</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {insights.map((insight) => (
              <InsightCardComponent key={insight.type} insight={insight} />
            ))}
          </div>
        </div>
      )}

      {/* ─── EMPTY STATE ─────────────────────────────────────── */}
      {!loading && !error && (!data || data.totalCount === 0) && (
        <Card className="border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">No Distributor Activity</h3>
            <p className="text-sm text-muted-foreground mt-1">No distributor order activity found for this filter selection.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { setDateRange('last12Months'); setOrderType(''); setSeller(''); setStatus(''); setSearch('') }}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Reset Filters
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── DETAIL DRAWER ───────────────────────────────────── */}
      <DistributorDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        distributorId={selectedDistId}
        isDark={isDark}
      />
    </div>
  )
}
