'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import {
  ChevronLeft, RefreshCw, Users, Building2, Target, TrendingUp,
  TrendingDown, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle,
  Clock, ShoppingCart, Repeat, Crown, Medal, Award, ChevronRight,
  Package, DollarSign, UserMinus, Shield, Activity, Timer,
  BarChart3, PieChart as PieChartIcon, Zap,
} from 'lucide-react'
import { format } from 'date-fns'
import { useTheme } from '@/components/providers/ThemeProvider'

// ============================================================
// TYPES
// ============================================================
interface RepeatAnalytics {
  overview: {
    repeatRate: number
    repeatDists: number
    singleOrderDists: number
    avgRepeatOrders: number
    avgDaysBetweenOrders: number
    repeatRevenue: number
    singleRevenue: number
    repeatRevenueShare: number
  }
  freqBuckets: Record<string, number>
  repeatTrend: Array<{
    month: string
    label: string
    repeatRate: number
    repeatDists: number
    totalDists: number
  }>
  topRepeatDists: Array<{
    id: string
    name: string
    orders: number
    rm: number
    aov: number
    lastDate: string
    avgGap: number | null
  }>
  singleOrderDistList: Array<{
    id: string
    name: string
    rm: number
    lastDate: string
  }>
  atRiskDists: Array<{
    id: string
    name: string
    orders: number
    rm: number
    avgGap: number | null
    lastDate: string
    daysSinceLastOrder: number
    riskLevel: 'warning' | 'at_risk' | 'inactive'
  }>
  gapBuckets: Record<string, number>
  productRepeat: Array<{
    variantId: string
    name: string
    uniqueDistributors: number
    totalQty: number
    totalRM: number
  }>
}

// ============================================================
// CONSTANTS
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
  orange: '#f97316',
}

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']

const RISK_CONFIG = {
  warning: { label: 'Warning', color: '#f59e0b', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  at_risk: { label: 'At Risk', color: '#ef4444', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  inactive: { label: 'Inactive', color: '#6b7280', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', icon: UserMinus },
}

// ============================================================
// ANIMATED COUNTER
// ============================================================
function AnimatedCounter({ value, prefix = '', suffix = '', decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number
}) {
  return <span>{prefix}{value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</span>
}

// ============================================================
// RANK BADGE
// ============================================================
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30"><Crown className="w-3.5 h-3.5 text-amber-600" /></div>
  if (rank === 2) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800"><Medal className="w-3.5 h-3.5 text-slate-500" /></div>
  if (rank === 3) return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/30"><Award className="w-3.5 h-3.5 text-orange-600" /></div>
  return <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted"><span className="text-[10px] font-bold text-muted-foreground">{rank}</span></div>
}

// ============================================================
// OVERVIEW KPI MINI CARD
// ============================================================
function MiniKPI({ label, value, icon: Icon, color, subtitle }: {
  label: string; value: string | number; icon: any; color: string; subtitle?: string
}) {
  return (
    <Card className="relative overflow-hidden border-0 bg-card/80 backdrop-blur hover:shadow-lg transition-all duration-300 group">
      <div className="absolute top-0 right-0 w-20 h-20 -mr-4 -mt-4 rounded-full opacity-[0.06] group-hover:opacity-[0.12] transition-opacity" style={{ backgroundColor: color }} />
      <div className="absolute bottom-0 left-0 h-0.5 w-full opacity-70" style={{ background: `linear-gradient(to right, ${color}, transparent)` }} />
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5 min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-xl font-bold text-foreground tracking-tight">{value}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${color}12` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================
interface RepeatRateAnalyticsProps {
  data: RepeatAnalytics | null
  loading: boolean
  onBack: () => void
  onDistributorClick: (id: string) => void
}

export default function RepeatRateAnalytics({ data, loading, onBack, onDistributorClick }: RepeatRateAnalyticsProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const chartGrid = isDark ? '#374151' : '#f0f0f0'
  const chartTick = isDark ? '#9ca3af' : '#6b7280'
  const tooltipBg = isDark ? 'rgba(31,41,55,0.95)' : 'rgba(255,255,255,0.95)'
  const tooltipStyle = { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.15)', backgroundColor: tooltipBg, color: isDark ? '#f3f4f6' : undefined }

  const [riskTab, setRiskTab] = useState<'all' | 'warning' | 'at_risk' | 'inactive'>('all')

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-in fade-in-50 duration-500">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-0 bg-card/80">
              <CardContent className="pt-6 space-y-3">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="h-[350px] bg-muted animate-pulse rounded-xl" />
      </div>
    )
  }

  const ov = data.overview

  // Freq bucket chart data
  const freqData = Object.entries(data.freqBuckets).map(([key, value]) => ({
    bucket: key === '1' ? '1 order' : key === '6+' ? '6+ orders' : `${key} orders`,
    count: value,
  }))

  // Gap bucket chart data
  const gapData = Object.entries(data.gapBuckets).map(([key, value]) => ({
    range: key,
    count: value,
  }))

  // Revenue split for pie
  const revenueSplit = [
    { name: 'Repeat Distributors', value: ov.repeatRevenue },
    { name: 'Single-Order Distributors', value: ov.singleRevenue },
  ]

  // Filtered at-risk
  const filteredRisk = riskTab === 'all' ? data.atRiskDists : data.atRiskDists.filter((d) => d.riskLevel === riskTab)

  // Insight messages
  const insights: string[] = []
  if (ov.repeatRate > 50) insights.push(`Strong repeat rate at ${ov.repeatRate.toFixed(1)}% — more than half of active distributors reorder.`)
  else if (ov.repeatRate > 25) insights.push(`Moderate repeat rate at ${ov.repeatRate.toFixed(1)}% — room for improvement in retention.`)
  else insights.push(`Low repeat rate at ${ov.repeatRate.toFixed(1)}% — retention strategy needs attention.`)

  if (ov.repeatRevenueShare > 70) insights.push(`${ov.repeatRevenueShare.toFixed(0)}% of revenue comes from repeat distributors — healthy dependency.`)
  if (data.atRiskDists.length > 0) insights.push(`${data.atRiskDists.length} distributor${data.atRiskDists.length > 1 ? 's' : ''} flagged as at-risk or inactive — follow up recommended.`)
  if (data.topRepeatDists.length > 0) insights.push(`Top repeat distributor: ${data.topRepeatDists[0].name} with ${data.topRepeatDists[0].orders} orders.`)
  if (ov.avgDaysBetweenOrders > 0) insights.push(`Average reorder gap is ${ov.avgDaysBetweenOrders.toFixed(0)} days.`)
  if (data.productRepeat.length > 0) insights.push(`Most repeated product: ${data.productRepeat[0].name} ordered by ${data.productRepeat[0].uniqueDistributors} distributors.`)

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      {/* ─── HEADER ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> Back to Reports
          </Button>
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-br from-cyan-600 to-blue-600 rounded-xl shadow-lg shadow-cyan-200/50 dark:shadow-cyan-900/30">
              <Repeat className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Repeat Rate Analytics</h2>
              <p className="text-xs text-muted-foreground">Distributor retention, reorder patterns & churn risk</p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── INSIGHT BANNER ──────────────────────────────────── */}
      <Card className="border-0 bg-gradient-to-r from-indigo-50 to-cyan-50 dark:from-indigo-950/40 dark:to-cyan-950/40 shadow-sm">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-1.5">Key Insights</p>
              <ul className="space-y-1">
                {insights.map((msg, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 mt-1.5" />
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── OVERVIEW KPI CARDS ──────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MiniKPI
          label="Repeat Rate"
          value={`${ov.repeatRate.toFixed(1)}%`}
          icon={Repeat}
          color={COLORS.cyan}
          subtitle={`${ov.repeatDists} of ${ov.repeatDists + ov.singleOrderDists} distributors`}
        />
        <MiniKPI
          label="Repeat Distributors"
          value={ov.repeatDists}
          icon={Users}
          color={COLORS.success}
          subtitle="Ordered more than once"
        />
        <MiniKPI
          label="Single-Order Distributors"
          value={ov.singleOrderDists}
          icon={UserMinus}
          color={COLORS.warning}
          subtitle="Only 1 order in period"
        />
        <MiniKPI
          label="Avg Repeat Orders"
          value={ov.avgRepeatOrders.toFixed(1)}
          icon={ShoppingCart}
          color={COLORS.primary}
          subtitle="Per repeat distributor"
        />
        <MiniKPI
          label="Avg Days Between Orders"
          value={ov.avgDaysBetweenOrders > 0 ? `${ov.avgDaysBetweenOrders.toFixed(0)} days` : 'N/A'}
          icon={Timer}
          color={COLORS.purple}
          subtitle="Reorder gap"
        />
        <MiniKPI
          label="Repeat Revenue Share"
          value={`${ov.repeatRevenueShare.toFixed(1)}%`}
          icon={DollarSign}
          color={COLORS.indigo}
          subtitle={`RM ${ov.repeatRevenue.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`}
        />
      </div>

      {/* ─── ROW: FREQ DISTRIBUTION + REVENUE SPLIT ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Frequency Distribution */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              Order Frequency Distribution
            </CardTitle>
            <CardDescription>How many orders each distributor placed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={freqData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Distributors']} />
                  <Bar dataKey="count" name="Distributors" radius={[6, 6, 0, 0]} barSize={40}>
                    {freqData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Split Pie */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-purple-600" />
              Revenue Split
            </CardTitle>
            <CardDescription>Repeat vs single-order distributor revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] flex items-center">
              <div className="w-1/2 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={revenueSplit}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill={COLORS.success} />
                      <Cell fill={COLORS.warning} />
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => [`RM ${v.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-1/2 space-y-4 pl-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.success }} />
                    <span className="text-xs font-medium text-muted-foreground">Repeat Distributors</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    RM {ov.repeatRevenue.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{ov.repeatRevenueShare.toFixed(1)}% of total</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.warning }} />
                    <span className="text-xs font-medium text-muted-foreground">Single-Order</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    RM {ov.singleRevenue.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{(100 - ov.repeatRevenueShare).toFixed(1)}% of total</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── REPEAT TREND CHART ──────────────────────────────── */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-600" />
            Repeat Rate Trend Over Time
          </CardTitle>
          <CardDescription>Monthly repeat rate — is retention improving or declining?</CardDescription>
        </CardHeader>
        <CardContent>
          {data.repeatTrend.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.repeatTrend}>
                  <defs>
                    <linearGradient id="repeatTrendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: chartTick, fontSize: 11 }}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) => [
                      name === 'repeatRate' ? `${v.toFixed(1)}%` : v,
                      name === 'repeatRate' ? 'Repeat Rate' : name === 'repeatDists' ? 'Repeat Dists' : 'Total Dists',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="repeatRate"
                    stroke={COLORS.cyan}
                    strokeWidth={2.5}
                    fill="url(#repeatTrendGrad)"
                    dot={{ r: 4, fill: COLORS.cyan, stroke: '#fff', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: COLORS.cyan, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              <p>Not enough data for trend chart</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── TOP REPEAT DISTRIBUTORS TABLE ───────────────────── */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500" />
            Top Repeat Distributors
          </CardTitle>
          <CardDescription>Distributors with the strongest repeat-purchase behavior</CardDescription>
        </CardHeader>
        <CardContent>
          {data.topRepeatDists.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2.5 px-2 font-medium w-10">#</th>
                    <th className="text-left py-2.5 px-2 font-medium">Distributor</th>
                    <th className="text-right py-2.5 px-2 font-medium">Orders</th>
                    <th className="text-right py-2.5 px-2 font-medium">Revenue (RM)</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">AOV (RM)</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden lg:table-cell">Avg Gap</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">Last Order</th>
                    <th className="text-right py-2.5 px-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRepeatDists.map((d, idx) => (
                    <tr
                      key={d.id}
                      className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors group"
                      onClick={() => onDistributorClick(d.id)}
                    >
                      <td className="py-3 px-2"><RankBadge rank={idx + 1} /></td>
                      <td className="py-3 px-2">
                        <span className="font-medium text-foreground group-hover:text-blue-600 transition-colors">{d.name}</span>
                      </td>
                      <td className="py-3 px-2 text-right font-semibold tabular-nums">{d.orders}</td>
                      <td className="py-3 px-2 text-right font-semibold tabular-nums">
                        {d.rm.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums hidden md:table-cell">
                        {d.aov.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums hidden lg:table-cell">
                        {d.avgGap !== null ? `${d.avgGap.toFixed(0)}d` : '—'}
                      </td>
                      <td className="py-3 px-2 text-right text-xs text-muted-foreground hidden md:table-cell">
                        {d.lastDate ? format(new Date(d.lastDate), 'dd MMM yy') : '—'}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No repeat distributors in this period</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── ROW: SINGLE-ORDER DISTS + AT-RISK ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Single-Order Distributors */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <UserMinus className="w-4 h-4 text-amber-500" />
              Single-Order Distributors
            </CardTitle>
            <CardDescription>{data.singleOrderDistList.length} distributors with only 1 order</CardDescription>
          </CardHeader>
          <CardContent>
            {data.singleOrderDistList.length > 0 ? (
              <div className="space-y-2 max-h-[340px] overflow-y-auto">
                {data.singleOrderDistList.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors cursor-pointer group"
                    onClick={() => onDistributorClick(d.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                        <Building2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate group-hover:text-blue-600 transition-colors">{d.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {d.lastDate ? format(new Date(d.lastDate), 'dd MMM yyyy') : 'No date'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-sm font-semibold tabular-nums">RM {d.rm.toLocaleString('en-MY', { maximumFractionDigits: 0 })}</p>
                      <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">1 order</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>All distributors have repeat orders</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* At-Risk Distributors */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  At-Risk Distributors
                </CardTitle>
                <CardDescription>Distributors showing signs of churn</CardDescription>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'warning', 'at_risk', 'inactive'] as const).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={riskTab === tab ? 'default' : 'ghost'}
                    onClick={() => setRiskTab(tab)}
                    className={`h-6 text-[10px] px-2 ${riskTab === tab ? 'bg-blue-600 text-white' : ''}`}
                  >
                    {tab === 'all' ? 'All' : tab === 'at_risk' ? 'At Risk' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab !== 'all' && ` (${data.atRiskDists.filter((d) => d.riskLevel === tab).length})`}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredRisk.length > 0 ? (
              <div className="space-y-2 max-h-[340px] overflow-y-auto">
                {filteredRisk.map((d) => {
                  const cfg = RISK_CONFIG[d.riskLevel]
                  const RiskIcon = cfg.icon
                  return (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors cursor-pointer group"
                      onClick={() => onDistributorClick(d.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center shrink-0`}>
                          <RiskIcon className={`w-3.5 h-3.5 ${cfg.text}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate group-hover:text-blue-600 transition-colors">{d.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {d.orders} order{d.orders > 1 ? 's' : ''} · Last: {d.lastDate ? format(new Date(d.lastDate), 'dd MMM yy') : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-xs font-medium tabular-nums">{d.daysSinceLastOrder}d ago</p>
                        <Badge variant="secondary" className={`text-[10px] ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No at-risk distributors found</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── ROW: REORDER GAP + PRODUCT REPEAT ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reorder Gap Analysis */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Timer className="w-4 h-4 text-purple-600" />
              Reorder Time Gap Analysis
            </CardTitle>
            <CardDescription>Average days between orders per distributor</CardDescription>
          </CardHeader>
          <CardContent>
            {gapData.some((d) => d.count > 0) ? (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gapData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                    <XAxis dataKey="range" tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 10 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: chartTick, fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Distributors']} />
                    <Bar dataKey="count" name="Distributors" fill={COLORS.purple} radius={[6, 6, 0, 0]} barSize={36}>
                      {gapData.map((_, idx) => (
                        <Cell key={idx} fill={idx < 2 ? COLORS.success : idx < 3 ? COLORS.primary : idx < 4 ? COLORS.warning : COLORS.danger} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                <p>Not enough reorder data for gap analysis</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Product Repeat Analysis */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Package className="w-4 h-4 text-pink-600" />
              Product Repeat Analysis
            </CardTitle>
            <CardDescription>Products driving repeat purchases</CardDescription>
          </CardHeader>
          <CardContent>
            {data.productRepeat.length > 0 ? (
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {data.productRepeat.slice(0, 10).map((p, idx) => {
                  const maxDist = Math.max(...data.productRepeat.map((x) => x.uniqueDistributors), 1)
                  const pct = (p.uniqueDistributors / maxDist) * 100
                  return (
                    <div key={p.variantId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                          <span className="text-xs font-medium truncate">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className="text-muted-foreground">{p.uniqueDistributors} dist</span>
                          <span className="font-semibold tabular-nums">RM {p.totalRM.toLocaleString('en-MY', { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                <p>No product repeat data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
