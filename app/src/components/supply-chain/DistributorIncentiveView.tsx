'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, subDays, startOfMonth, endOfMonth, differenceInDays } from 'date-fns'
import {
  Trophy, Target, TrendingUp, TrendingDown, Users, Gift, Zap,
  DollarSign, Calendar, BarChart3, Percent, ArrowUpRight,
  ArrowDownRight, Crown, Medal, Award, Star, Bell, MessageSquare,
  Send, Play, Pause, Settings, Plus, Eye, Edit, Trash2,
  ChevronRight, Activity, PieChart, Layers, ShieldCheck,
  AlertTriangle, CheckCircle2, XCircle, Clock, Filter,
  Download, RefreshCw, Sparkles, Flame, Hash
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarChart, Bar, LineChart, Line, PieChart as RechartsPC, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts'

// ── Types ───────────────────────────────────────────────────────
interface UserProfile {
  id: string
  organization_id: string | null
  organizations: { id: string; org_name: string; org_type_code: string; org_code: string }
  roles: { role_name: string; role_level: number }
}

interface Campaign {
  id: string
  name: string
  type: 'volume' | 'growth' | 'streak' | 'product-mix' | 'tiered'
  status: 'draft' | 'active' | 'paused' | 'ended'
  startDate: string
  endDate: string
  targetMetric: string
  targetValue: number
  rewardType: 'cash' | 'credit' | 'gift' | 'points'
  rewardValue: number
  eligibleDistributors: number
  participatingDistributors: number
  achievedCount: number
  totalSpend: number
  budgetCap: number
}

interface DistributorPerformance {
  id: string
  name: string
  orgCode: string
  totalOrders: number
  totalRevenue: number
  growthPercent: number
  activeCampaigns: number
  earnedRewards: number
  rank: number
  streak: number
  tier: 'platinum' | 'gold' | 'silver' | 'bronze'
  avatar?: string
}

// ── Constants ───────────────────────────────────────────────────
const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6']
const TIER_COLORS = { platinum: '#94a3b8', gold: '#f59e0b', silver: '#9ca3af', bronze: '#d97706' }
const TIER_ICONS = { platinum: Crown, gold: Medal, silver: Award, bronze: Star }
const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  'volume': 'Volume Target',
  'growth': 'Growth %',
  'streak': 'Order Streak',
  'product-mix': 'Product Mix',
  'tiered': 'Tiered Bonus'
}
const STATUS_STYLES: Record<string, string> = {
  'draft': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'active': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'paused': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  'ended': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// ── Tier assignment by revenue rank ─────────────────────────────
function assignTier(rank: number, total: number): 'platinum' | 'gold' | 'silver' | 'bronze' {
  const pct = rank / total
  if (pct <= 0.1) return 'platinum'
  if (pct <= 0.25) return 'gold'
  if (pct <= 0.5) return 'silver'
  return 'bronze'
}

// ── Real data fetcher: distributors from orders + organizations ──
async function fetchDistributorPerformance(
  supabase: ReturnType<typeof createClient>,
  period: string
): Promise<DistributorPerformance[]> {
  // Determine date window for the selected period
  const now = new Date()
  let periodStart: Date
  let prevStart: Date
  let prevEnd: Date
  if (period === 'month') {
    periodStart = startOfMonth(now)
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    prevStart = startOfMonth(prevMonth)
    prevEnd = endOfMonth(prevMonth)
  } else if (period === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3
    periodStart = new Date(now.getFullYear(), qMonth, 1)
    const prevQMonth = qMonth - 3 < 0 ? qMonth - 3 + 12 : qMonth - 3
    const prevQYear = qMonth - 3 < 0 ? now.getFullYear() - 1 : now.getFullYear()
    prevStart = new Date(prevQYear, prevQMonth, 1)
    prevEnd = new Date(periodStart.getTime() - 1)
  } else if (period === 'year') {
    periodStart = new Date(now.getFullYear(), 0, 1)
    prevStart = new Date(now.getFullYear() - 1, 0, 1)
    prevEnd = new Date(now.getFullYear() - 1, 11, 31)
  } else {
    // all time – no period filter, growth vs previous year
    periodStart = new Date(2000, 0, 1)
    prevStart = new Date(2000, 0, 1)
    prevEnd = new Date(2000, 0, 1)
  }

  const periodISO = format(periodStart, 'yyyy-MM-dd')
  const prevStartISO = format(prevStart, 'yyyy-MM-dd')
  const prevEndISO = format(prevEnd, 'yyyy-MM-dd')

  // Fetch all active distributors
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, org_code, org_name')
    .eq('org_type_code', 'DIST')
    .eq('is_active', true)
    .order('org_code')

  if (!orgs || orgs.length === 0) return []

  // Fetch current-period orders with line totals via RPC or raw join
  // We use two queries: current period and previous period
  const { data: currentOrders } = await supabase
    .from('orders')
    .select(`
      id,
      buyer_org_id,
      created_at,
      order_items ( line_total )
    `)
    .in('buyer_org_id', orgs.map(o => o.id))
    .not('status', 'in', '("draft","cancelled")')
    .gte('created_at', period === 'all' ? '2000-01-01' : periodISO)

  const { data: prevOrders } = period !== 'all' ? await supabase
    .from('orders')
    .select(`
      id,
      buyer_org_id,
      created_at,
      order_items ( line_total )
    `)
    .in('buyer_org_id', orgs.map(o => o.id))
    .not('status', 'in', '("draft","cancelled")')
    .gte('created_at', prevStartISO)
    .lte('created_at', prevEndISO)
  : { data: [] as any[] }

  // Aggregate current period
  const currentMap = new Map<string, { orders: number; revenue: number }>()
  for (const o of (currentOrders || [])) {
    const entry = currentMap.get(o.buyer_org_id) || { orders: 0, revenue: 0 }
    entry.orders += 1
    const lineItems = o.order_items as { line_total: number }[] | null
    entry.revenue += (lineItems || []).reduce((s: number, li: any) => s + (Number(li.line_total) || 0), 0)
    currentMap.set(o.buyer_org_id, entry)
  }

  // Aggregate previous period for growth calc
  const prevMap = new Map<string, { orders: number; revenue: number }>()
  for (const o of (prevOrders || [])) {
    const entry = prevMap.get(o.buyer_org_id) || { orders: 0, revenue: 0 }
    entry.orders += 1
    const lineItems = o.order_items as { line_total: number }[] | null
    entry.revenue += (lineItems || []).reduce((s: number, li: any) => s + (Number(li.line_total) || 0), 0)
    prevMap.set(o.buyer_org_id, entry)
  }

  // Calculate consecutive monthly order streaks
  const { data: allOrders } = await supabase
    .from('orders')
    .select('buyer_org_id, created_at')
    .in('buyer_org_id', orgs.map(o => o.id))
    .not('status', 'in', '("draft","cancelled")')
    .order('created_at', { ascending: false })

  const streakMap = new Map<string, number>()
  if (allOrders) {
    const orgMonths = new Map<string, Set<string>>()
    for (const o of allOrders) {
      const key = o.buyer_org_id
      if (!orgMonths.has(key)) orgMonths.set(key, new Set())
      const d = new Date(o.created_at as string)
      orgMonths.get(key)!.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    for (const [orgId, months] of orgMonths) {
      let streak = 0
      const cur = new Date(now.getFullYear(), now.getMonth(), 1)
      while (true) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
        if (months.has(key)) {
          streak++
          cur.setMonth(cur.getMonth() - 1)
        } else break
      }
      streakMap.set(orgId, streak)
    }
  }

  // Build performance list
  const results: DistributorPerformance[] = orgs.map(org => {
    const cur = currentMap.get(org.id) || { orders: 0, revenue: 0 }
    const prev = prevMap.get(org.id) || { orders: 0, revenue: 0 }
    const growthPercent = prev.revenue > 0
      ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100)
      : cur.revenue > 0 ? 100 : 0
    return {
      id: org.id,
      name: org.org_name,
      orgCode: org.org_code,
      totalOrders: cur.orders,
      totalRevenue: cur.revenue,
      growthPercent,
      activeCampaigns: 0,
      earnedRewards: 0,
      rank: 0,
      streak: streakMap.get(org.id) || 0,
      tier: 'bronze' as const,
    }
  })
    .filter(d => d.totalOrders > 0 || period === 'all')
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .map((d, i, arr) => ({ ...d, rank: i + 1, tier: assignTier(i + 1, arr.length) }))

  return results
}

// ── Real data fetcher: monthly trend from orders ────────────────
async function fetchMonthlyTrend(
  supabase: ReturnType<typeof createClient>
): Promise<{ month: string; revenue: number; orders: number; distributors: number }[]> {
  const now = new Date()
  const months: { month: string; start: string; end: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      month: format(d, 'MMM yyyy'),
      start: format(startOfMonth(d), 'yyyy-MM-dd'),
      end: format(endOfMonth(d), 'yyyy-MM-dd'),
    })
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('id, buyer_org_id, created_at, order_items ( line_total )')
    .not('status', 'in', '("draft","cancelled")')
    .gte('created_at', months[0].start)

  const result = months.map(m => {
    const mOrders = (orders || []).filter(o => {
      const d = o.created_at?.substring(0, 10) || ''
      return d >= m.start && d <= m.end
    })
    const distSet = new Set(mOrders.map(o => o.buyer_org_id))
    const revenue = mOrders.reduce((s, o) => {
      const lineItems = o.order_items as { line_total: number }[] | null
      return s + (lineItems || []).reduce((ls: number, li: any) => ls + (Number(li.line_total) || 0), 0)
    }, 0)
    return {
      month: m.month,
      revenue: Math.round(revenue),
      orders: mOrders.length,
      distributors: distSet.size,
    }
  })

  return result
}

// ── Compute tier distribution from real distributor list ─────────
function computeTierDistribution(distributors: DistributorPerformance[]) {
  const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 }
  for (const d of distributors) counts[d.tier]++
  return [
    { name: 'Platinum', value: counts.platinum, fill: TIER_COLORS.platinum },
    { name: 'Gold', value: counts.gold, fill: TIER_COLORS.gold },
    { name: 'Silver', value: counts.silver, fill: TIER_COLORS.silver },
    { name: 'Bronze', value: counts.bronze, fill: TIER_COLORS.bronze },
  ].filter(t => t.value > 0)
}

// ── Static campaign data (kept until incentive_campaigns table exists) ──
function getStaticCampaigns(): Campaign[] {
  return [
    {
      id: 'camp-001', name: 'Q1 Volume Blitz', type: 'volume', status: 'active',
      startDate: '2025-01-01', endDate: '2025-03-31', targetMetric: 'Total cases ordered',
      targetValue: 500, rewardType: 'cash', rewardValue: 2000, eligibleDistributors: 24,
      participatingDistributors: 18, achievedCount: 7, totalSpend: 14000, budgetCap: 48000,
    },
    {
      id: 'camp-002', name: 'Monthly Growth Sprint', type: 'growth', status: 'active',
      startDate: '2025-01-01', endDate: '2025-06-30', targetMetric: 'MoM growth %',
      targetValue: 15, rewardType: 'credit', rewardValue: 500, eligibleDistributors: 24,
      participatingDistributors: 22, achievedCount: 12, totalSpend: 6000, budgetCap: 12000,
    },
    {
      id: 'camp-003', name: 'Streak Warrior', type: 'streak', status: 'active',
      startDate: '2025-02-01', endDate: '2025-07-31', targetMetric: 'Consecutive monthly orders',
      targetValue: 6, rewardType: 'gift', rewardValue: 1500, eligibleDistributors: 24,
      participatingDistributors: 20, achievedCount: 0, totalSpend: 0, budgetCap: 36000,
    },
    {
      id: 'camp-004', name: 'New SKU Push', type: 'product-mix', status: 'draft',
      startDate: '2025-04-01', endDate: '2025-06-30', targetMetric: 'Min 5 SKU diversity',
      targetValue: 5, rewardType: 'points', rewardValue: 1000, eligibleDistributors: 24,
      participatingDistributors: 0, achievedCount: 0, totalSpend: 0, budgetCap: 24000,
    },
    {
      id: 'camp-005', name: 'Tiered Excellence', type: 'tiered', status: 'paused',
      startDate: '2025-01-01', endDate: '2025-12-31', targetMetric: 'Cumulative revenue',
      targetValue: 100000, rewardType: 'cash', rewardValue: 5000, eligibleDistributors: 24,
      participatingDistributors: 15, achievedCount: 3, totalSpend: 15000, budgetCap: 120000,
    },
    {
      id: 'camp-006', name: 'Holiday Push 2024', type: 'volume', status: 'ended',
      startDate: '2024-11-01', endDate: '2024-12-31', targetMetric: 'Total cases ordered',
      targetValue: 300, rewardType: 'cash', rewardValue: 1500, eligibleDistributors: 20,
      participatingDistributors: 18, achievedCount: 14, totalSpend: 21000, budgetCap: 30000,
    },
  ]
}

// ── Sub-Components ──────────────────────────────────────────────

function KPICard({ title, value, subtitle, icon: Icon, trend, trendValue, color, loading }: {
  title: string; value: string | number; subtitle: string
  icon: any; trend?: 'up' | 'down' | 'neutral'; trendValue?: string
  color: string; loading?: boolean
}) {
  return (
    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur hover:shadow-xl transition-all duration-300">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            {loading ? (
              <div className="h-8 w-24 bg-muted rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{typeof value === 'number' ? value.toLocaleString() : value}</p>
            )}
            <div className="flex items-center gap-2">
              {trend && trendValue && (
                <span className={`flex items-center text-xs font-semibold ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : trend === 'down' ? <ArrowDownRight className="w-3 h-3" /> : null}
                  {trendValue}
                </span>
              )}
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CampaignCard({ campaign, onEdit, onToggle }: {
  campaign: Campaign
  onEdit: (c: Campaign) => void
  onToggle: (c: Campaign) => void
}) {
  const daysLeft = differenceInDays(new Date(campaign.endDate), new Date())
  const progress = campaign.participatingDistributors > 0
    ? Math.round((campaign.achievedCount / campaign.participatingDistributors) * 100)
    : 0
  const budgetUsed = campaign.budgetCap > 0
    ? Math.round((campaign.totalSpend / campaign.budgetCap) * 100)
    : 0

  return (
    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur hover:shadow-xl transition-all duration-300 group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground">{campaign.name}</h3>
              <Badge className={STATUS_STYLES[campaign.status]}>{campaign.status}</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">{CAMPAIGN_TYPE_LABELS[campaign.type]}</Badge>
              <span>{format(new Date(campaign.startDate), 'MMM d')} – {format(new Date(campaign.endDate), 'MMM d, yyyy')}</span>
              {campaign.status === 'active' && daysLeft > 0 && (
                <span className="text-amber-600 font-medium">{daysLeft}d left</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(campaign)}>
              <Edit className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggle(campaign)}>
              {campaign.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Target */}
        <div className="p-3 bg-muted/60 rounded-lg mb-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{campaign.targetMetric}</span>
            <span className="font-bold text-foreground">{campaign.targetValue.toLocaleString()}</span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <p className="text-lg font-bold text-blue-600">{campaign.participatingDistributors}</p>
            <p className="text-[10px] text-muted-foreground">Participating</p>
          </div>
          <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded-lg">
            <p className="text-lg font-bold text-green-600">{campaign.achievedCount}</p>
            <p className="text-[10px] text-muted-foreground">Achieved</p>
          </div>
          <div className="text-center p-2 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
            <p className="text-lg font-bold text-purple-600">
              {campaign.rewardType === 'cash' || campaign.rewardType === 'credit'
                ? `RM${campaign.rewardValue.toLocaleString()}`
                : campaign.rewardValue.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground capitalize">{campaign.rewardType}/person</p>
          </div>
        </div>

        {/* Achievement Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Achievement Rate</span>
            <span className="font-semibold">{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-indigo-500 to-purple-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Budget */}
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Budget Used</span>
            <span className="font-semibold">RM{campaign.totalSpend.toLocaleString()} / RM{campaign.budgetCap.toLocaleString()}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${budgetUsed > 80 ? 'bg-red-500' : budgetUsed > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(budgetUsed, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function LeaderboardRow({ dist, index }: { dist: DistributorPerformance; index: number }) {
  const TierIcon = TIER_ICONS[dist.tier]
  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-200 hover:bg-muted/60 ${index < 3 ? 'bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-950/10' : ''}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${index === 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
          index === 1 ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' :
            index === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
              'bg-muted text-muted-foreground'
        }`}>
        {index < 3 ? ['🥇', '🥈', '🥉'][index] : `#${index + 1}`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-foreground truncate">{dist.name}</p>
          <TierIcon className="w-4 h-4 flex-shrink-0" style={{ color: TIER_COLORS[dist.tier] }} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{dist.orgCode}</span>
          <span>{dist.totalOrders} orders</span>
          {dist.streak > 0 && (
            <span className="flex items-center gap-0.5 text-orange-500">
              <Flame className="w-3 h-3" /> {dist.streak}mo streak
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-foreground">RM{dist.totalRevenue.toLocaleString()}</p>
        <div className="flex items-center justify-end gap-1">
          <span className={`text-xs font-medium ${dist.growthPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {dist.growthPercent >= 0 ? '+' : ''}{dist.growthPercent}%
          </span>
          <span className="text-xs text-muted-foreground">MoM</span>
        </div>
      </div>
      <div className="text-right min-w-[80px]">
        <p className="text-sm font-semibold text-indigo-600">RM{dist.earnedRewards.toLocaleString()}</p>
        <p className="text-[10px] text-muted-foreground">earned</p>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────

interface DistributorIncentiveViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

export default function DistributorIncentiveView({ userProfile, onViewChange }: DistributorIncentiveViewProps) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [distributors, setDistributors] = useState<DistributorPerformance[]>([])
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([])
  const [roiData, setROIData] = useState<any[]>([])
  const [tierDist, setTierDist] = useState<any[]>([])
  const [campaignFilter, setCampaignFilter] = useState<string>('all')
  const [leaderboardPeriod, setLeaderboardPeriod] = useState('month')

  const isDark = typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  const chartGridColor = isDark ? '#374151' : '#e5e7eb'
  const chartTickColor = isDark ? '#9ca3af' : '#6b7280'

  const supabase = createClient()

  // ── Data Fetch (real data from orders + organizations) ──────
  const loadData = useCallback(async (period?: string) => {
    setLoading(true)
    try {
      const p = period ?? leaderboardPeriod
      const [dists, trend] = await Promise.all([
        fetchDistributorPerformance(supabase, p),
        fetchMonthlyTrend(supabase),
      ])
      setDistributors(dists)
      setTierDist(computeTierDistribution(dists))
      setMonthlyTrend(trend.map(t => ({
        month: t.month,
        reward: t.revenue, // mapped to "reward" key to match chart dataKey
        participation: t.distributors,
        achievement: t.orders,
      })))
      setROIData([]) // No campaign ROI data until incentive_campaigns table exists
      setCampaigns(getStaticCampaigns())
    } finally {
      setLoading(false)
    }
  }, [leaderboardPeriod, supabase])

  useEffect(() => {
    loadData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when leaderboard period changes
  useEffect(() => {
    loadData(leaderboardPeriod)
  }, [leaderboardPeriod]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed KPIs ─────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = campaigns.filter(c => c.status === 'active')
    const totalSpend = campaigns.reduce((s, c) => s + c.totalSpend, 0)
    const totalBudget = campaigns.reduce((s, c) => s + c.budgetCap, 0)
    const avgAchievement = active.length > 0
      ? Math.round(active.reduce((s, c) => s + (c.participatingDistributors > 0 ? (c.achievedCount / c.participatingDistributors) * 100 : 0), 0) / active.length)
      : 0
    const uniqueParticipants = new Set(active.flatMap(c => Array.from({ length: c.participatingDistributors }, (_, i) => i))).size
    return {
      activeCampaigns: active.length,
      totalSpend,
      totalBudget,
      avgAchievement,
      uniqueParticipants: Math.min(uniqueParticipants, distributors.length),
      budgetUtilization: totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0,
      estimatedROI: totalSpend > 0 ? Math.round((distributors.reduce((s, d) => s + d.totalRevenue, 0) / totalSpend) * 100) : 0,
    }
  }, [campaigns, distributors])

  const filteredCampaigns = useMemo(() => {
    if (campaignFilter === 'all') return campaigns
    return campaigns.filter(c => c.status === campaignFilter)
  }, [campaigns, campaignFilter])

  // ── Handlers ──────────────────────────────────────────────────
  const handleEditCampaign = useCallback((c: Campaign) => {
    // TODO: Open campaign editor modal
    console.log('Edit campaign:', c.id)
  }, [])

  const handleToggleCampaign = useCallback((c: Campaign) => {
    setCampaigns(prev => prev.map(cp =>
      cp.id === c.id
        ? { ...cp, status: cp.status === 'active' ? 'paused' : 'active' }
        : cp
    ))
  }, [])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-lg">
              <Trophy className="w-6 h-6" />
            </div>
            Distributor Incentive Program
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Design, launch and monitor incentive campaigns to drive distributor performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg">
            <Plus className="w-4 h-4 mr-1" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="dashboard" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow gap-1.5">
            <BarChart3 className="w-4 h-4" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow gap-1.5">
            <Target className="w-4 h-4" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow gap-1.5">
            <Crown className="w-4 h-4" /> Leaderboard
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow gap-1.5">
            <Bell className="w-4 h-4" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="insights" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow gap-1.5">
            <Sparkles className="w-4 h-4" /> Insights
          </TabsTrigger>
        </TabsList>

        {/* ═══ DASHBOARD TAB ═══ */}
        <TabsContent value="dashboard" className="space-y-6 mt-6">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard title="Active Campaigns" value={kpis.activeCampaigns} subtitle="running now"
              icon={Target} color="#6366f1" trend="up" trendValue="+1 this month" loading={loading} />
            <KPICard title="Total Spend" value={`RM${kpis.totalSpend.toLocaleString()}`} subtitle={`of RM${kpis.totalBudget.toLocaleString()} budget`}
              icon={DollarSign} color="#22c55e" trend="neutral" trendValue={`${kpis.budgetUtilization}% utilised`} loading={loading} />
            <KPICard title="Avg Achievement" value={`${kpis.avgAchievement}%`} subtitle="across active campaigns"
              icon={TrendingUp} color="#f59e0b" trend={kpis.avgAchievement > 50 ? 'up' : 'down'} trendValue={kpis.avgAchievement > 50 ? 'on track' : 'needs push'} loading={loading} />
            <KPICard title="Estimated ROI" value={`${kpis.estimatedROI}%`} subtitle="revenue vs spend"
              icon={Zap} color="#8b5cf6" trend="up" trendValue="strong return" loading={loading} />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly Incentive Trend */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-indigo-500" /> Distributor Order Trend
                </CardTitle>
                <CardDescription>Monthly revenue, active distributors & order count (last 12 months)</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="month" tick={{ fill: chartTickColor, fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fill: chartTickColor, fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTickColor, fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                    <Legend />
                    <Area yAxisId="left" type="monotone" dataKey="reward" name="Revenue (RM)" fill="#6366f120" stroke="#6366f1" />
                    <Bar yAxisId="right" dataKey="participation" name="Active Distributors" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={20} />
                    <Line yAxisId="right" type="monotone" dataKey="achievement" name="Orders" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Tier Distribution */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-500" /> Tier Distribution
                </CardTitle>
                <CardDescription>Distributor loyalty tiers</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsPC>
                    <Pie
                      data={tierDist}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {tierDist.map((entry: any, index: number) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RechartsPC>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {tierDist.map((t: any) => (
                    <div key={t.name} className="flex items-center gap-2 text-xs">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.fill }} />
                      <span className="text-muted-foreground">{t.name}</span>
                      <span className="font-bold ml-auto">{t.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Campaign ROI */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500" /> Campaign ROI Analysis
                </CardTitle>
                <CardDescription>Revenue generated vs. incentive spend</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={roiData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="name" tick={{ fill: chartTickColor, fontSize: 11 }} />
                    <YAxis tick={{ fill: chartTickColor, fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: isDark ? '#1f2937' : '#fff', border: 'none', borderRadius: 12 }} />
                    <Legend />
                    <Bar dataKey="spend" name="Spend (RM)" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={16} />
                    <Bar dataKey="revenueGenerated" name="Revenue (RM)" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Quick Campaign Status */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Target className="w-5 h-5 text-indigo-500" /> Active Campaign Status
                </CardTitle>
                <CardDescription>Real-time progress of running campaigns</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {campaigns.filter(c => c.status === 'active').map(c => {
                  const progress = c.participatingDistributors > 0 ? Math.round((c.achievedCount / c.participatingDistributors) * 100) : 0
                  return (
                    <div key={c.id} className="p-3 bg-muted/50 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge className={STATUS_STYLES.active}>{progress}%</Badge>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{c.achievedCount}/{c.participatingDistributors} achieved</span>
                        <span>{differenceInDays(new Date(c.endDate), new Date())}d remaining</span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ CAMPAIGNS TAB ═══ */}
        <TabsContent value="campaigns" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{filteredCampaigns.length} campaigns</span>
            </div>
            <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
              <Plus className="w-4 h-4 mr-1" /> Create Campaign
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredCampaigns.map(c => (
              <CampaignCard key={c.id} campaign={c} onEdit={handleEditCampaign} onToggle={handleToggleCampaign} />
            ))}
          </div>

          {/* Campaign Types Reference */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Campaign Type Reference</CardTitle>
              <CardDescription>Available incentive mechanics you can deploy</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { type: 'volume', icon: Hash, desc: 'Reward distributors who hit a minimum order volume within the campaign period' },
                  { type: 'growth', icon: TrendingUp, desc: 'Bonus for distributors showing month-over-month growth above threshold' },
                  { type: 'streak', icon: Flame, desc: 'Loyalty bonus for placing orders every month consecutively' },
                  { type: 'product-mix', icon: PieChart, desc: 'Encourage ordering diverse SKUs — reward for breadth of portfolio' },
                  { type: 'tiered', icon: Layers, desc: 'Multi-tier bonus structure: Bronze → Silver → Gold → Platinum rewards' },
                ].map(ct => (
                  <div key={ct.type} className="p-4 bg-muted/40 rounded-xl border border-border/50 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                    <ct.icon className="w-8 h-8 text-indigo-500 mb-2" />
                    <p className="font-semibold text-sm text-foreground mb-1">{CAMPAIGN_TYPE_LABELS[ct.type]}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{ct.desc}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ LEADERBOARD TAB ═══ */}
        <TabsContent value="leaderboard" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500" /> Distributor Leaderboard
              </h2>
              <p className="text-sm text-muted-foreground">Ranked by total revenue contribution</p>
            </div>
            <Select value={leaderboardPeriod} onValueChange={setLeaderboardPeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Top 3 Podium */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {distributors.slice(0, 3).map((dist, index) => {
              const TierIcon = TIER_ICONS[dist.tier]
              const gradients = [
                'from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20 border-yellow-200 dark:border-yellow-800',
                'from-gray-50 to-slate-50 dark:from-gray-950/20 dark:to-slate-950/20 border-gray-200 dark:border-gray-800',
                'from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-orange-200 dark:border-orange-800',
              ]
              return (
                <Card key={dist.id} className={`border shadow-lg bg-gradient-to-br ${gradients[index]}`}>
                  <CardContent className="p-6 text-center">
                    <div className="text-4xl mb-2">{['🥇', '🥈', '🥉'][index]}</div>
                    <h3 className="font-bold text-lg text-foreground">{dist.name}</h3>
                    <div className="flex items-center justify-center gap-1 mt-1 mb-3">
                      <TierIcon className="w-4 h-4" style={{ color: TIER_COLORS[dist.tier] }} />
                      <span className="text-xs uppercase font-medium" style={{ color: TIER_COLORS[dist.tier] }}>{dist.tier}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 bg-white/50 dark:bg-white/5 rounded-lg">
                        <p className="text-xl font-bold text-foreground">RM{(dist.totalRevenue / 1000).toFixed(0)}K</p>
                        <p className="text-[10px] text-muted-foreground">Revenue</p>
                      </div>
                      <div className="p-2 bg-white/50 dark:bg-white/5 rounded-lg">
                        <p className="text-xl font-bold text-foreground">{dist.totalOrders}</p>
                        <p className="text-[10px] text-muted-foreground">Orders</p>
                      </div>
                      <div className="p-2 bg-white/50 dark:bg-white/5 rounded-lg">
                        <p className="text-xl font-bold text-green-600">+{Math.max(0, dist.growthPercent)}%</p>
                        <p className="text-[10px] text-muted-foreground">Growth</p>
                      </div>
                      <div className="p-2 bg-white/50 dark:bg-white/5 rounded-lg">
                        <p className="text-xl font-bold text-indigo-600">RM{(dist.earnedRewards / 1000).toFixed(1)}K</p>
                        <p className="text-[10px] text-muted-foreground">Rewards</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Full Leaderboard */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardContent className="p-2">
              <div className="divide-y divide-border">
                {distributors.map((dist, index) => (
                  <LeaderboardRow key={dist.id} dist={dist} index={index} />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ NOTIFICATIONS TAB ═══ */}
        <TabsContent value="notifications" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Bell className="w-5 h-5 text-indigo-500" /> WhatsApp & Notification Control
              </h2>
              <p className="text-sm text-muted-foreground">Manage automated incentive messages to distributors</p>
            </div>
          </div>

          {/* Notification Templates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                id: 'campaign-launch',
                title: 'Campaign Launch Announcement',
                trigger: 'When a new campaign goes active',
                channel: 'WhatsApp + In-App',
                status: 'enabled',
                lastSent: '2 days ago',
                icon: Send,
                template: '🎯 New Incentive Campaign: {campaign_name}\n\nTarget: {target_metric} ≥ {target_value}\nReward: {reward_type} RM{reward_value}\nPeriod: {start_date} – {end_date}\n\nStart ordering now to qualify!',
              },
              {
                id: 'milestone-alert',
                title: 'Milestone Achievement Alert',
                trigger: 'When distributor hits 50%, 75%, 100% of target',
                channel: 'WhatsApp',
                status: 'enabled',
                lastSent: '5 hours ago',
                icon: Trophy,
                template: '🏆 Congratulations {dist_name}!\n\nYou\'ve reached {milestone}% of your target in {campaign_name}.\nCurrent: {current_value}/{target_value}\n\nKeep going!',
              },
              {
                id: 'weekly-progress',
                title: 'Weekly Progress Report',
                trigger: 'Every Monday 9:00 AM',
                channel: 'WhatsApp',
                status: 'enabled',
                lastSent: 'Monday',
                icon: BarChart3,
                template: '📊 Weekly Incentive Report\n\nActive Campaigns: {active_count}\nYour Rank: #{rank}\nRewards Earned: RM{earned}\nNext Milestone: {next_milestone}',
              },
              {
                id: 'campaign-ending',
                title: 'Campaign Ending Reminder',
                trigger: '7 days and 1 day before campaign ends',
                channel: 'WhatsApp + In-App',
                status: 'enabled',
                lastSent: '1 week ago',
                icon: Clock,
                template: '⏰ {campaign_name} ends in {days_left} days!\n\nYour progress: {current_value}/{target_value}\nYou need {remaining} more to qualify.\n\nDon\'t miss out on RM{reward_value}!',
              },
              {
                id: 'tier-upgrade',
                title: 'Tier Upgrade Notification',
                trigger: 'When distributor moves to a higher tier',
                channel: 'WhatsApp + In-App',
                status: 'disabled',
                lastSent: 'Never',
                icon: Crown,
                template: '👑 You\'ve been promoted to {new_tier} tier!\n\nBenefits unlocked:\n- Higher reward multiplier\n- Priority stock allocation\n- Exclusive campaigns',
              },
              {
                id: 'reward-payout',
                title: 'Reward Payout Confirmation',
                trigger: 'When reward is processed',
                channel: 'WhatsApp',
                status: 'enabled',
                lastSent: '3 days ago',
                icon: Gift,
                template: '🎁 Reward Paid!\n\nCampaign: {campaign_name}\nAmount: RM{reward_amount}\nType: {reward_type}\nRef: {ref_number}\n\nThank you for your performance!',
              },
            ].map((notif) => (
              <Card key={notif.id} className="border-0 shadow-lg bg-card/80 backdrop-blur hover:shadow-xl transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${notif.status === 'enabled' ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-muted'}`}>
                        <notif.icon className={`w-5 h-5 ${notif.status === 'enabled' ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground text-sm">{notif.title}</h3>
                        <p className="text-xs text-muted-foreground">{notif.trigger}</p>
                      </div>
                    </div>
                    <Badge className={notif.status === 'enabled' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}>
                      {notif.status}
                    </Badge>
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg mb-3 font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                    {notif.template.substring(0, 120)}...
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {notif.channel}
                    </span>
                    <span>Last sent: {notif.lastSent}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* WhatsApp Connection Status */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-green-500" /> WhatsApp Gateway Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-100 dark:border-green-800 text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="font-semibold text-green-700 dark:text-green-400">Connected</p>
                  <p className="text-xs text-muted-foreground">Gateway Status</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-foreground">247</p>
                  <p className="text-xs text-muted-foreground">Messages Sent (30d)</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-foreground">98.4%</p>
                  <p className="text-xs text-muted-foreground">Delivery Rate</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-foreground">73%</p>
                  <p className="text-xs text-muted-foreground">Read Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ INSIGHTS TAB ═══ */}
        <TabsContent value="insights" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" /> Strategic Insights
              </h2>
              <p className="text-sm text-muted-foreground">AI-powered recommendations to optimise your incentive program</p>
            </div>
          </div>

          {/* Insight Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: 'High ROI Campaign Pattern',
                severity: 'opportunity',
                icon: TrendingUp,
                insight: 'Volume-based campaigns show 535% ROI vs 600% for growth-based. Consider shifting 20% budget from volume to growth campaigns for better returns.',
                action: 'Reallocate Q2 budget allocation',
                metric: '+12% projected ROI',
              },
              {
                title: 'Underperforming Distributor Cluster',
                severity: 'warning',
                icon: AlertTriangle,
                insight: '4 Bronze-tier distributors have negative MoM growth. They represent RM180K potential revenue. Targeted "comeback" campaign could re-engage them.',
                action: 'Create recovery campaign',
                metric: '4 distributors at risk',
              },
              {
                title: 'Streak Momentum',
                severity: 'positive',
                icon: Flame,
                insight: '8 distributors are on 3+ month ordering streaks. History shows streak campaigns have 0% churn rate during active period. Consider extending the Streak Warrior campaign.',
                action: 'Extend campaign 3 months',
                metric: '0% churn during streaks',
              },
              {
                title: 'Budget Efficiency Alert',
                severity: 'info',
                icon: DollarSign,
                insight: 'The Tiered Excellence campaign has used 12.5% of budget but generated 125K revenue. This is the most cost-efficient campaign running. Scale it to more participants.',
                action: 'Expand eligibility criteria',
                metric: '733% ROI',
              },
              {
                title: 'Optimal Notification Timing',
                severity: 'opportunity',
                icon: Clock,
                insight: 'WhatsApp messages sent between 9-10 AM have 89% read rate vs 61% for afternoon sends. Schedule all automated notifications for morning delivery.',
                action: 'Update notification schedule',
                metric: '+28% read rate potential',
              },
              {
                title: 'Product Mix Opportunity',
                severity: 'positive',
                icon: PieChart,
                insight: 'Top 3 distributors order 7+ SKUs. Bottom 5 order only 2-3 SKUs. Launching the "New SKU Push" campaign draft could increase average SKU diversity by 40%.',
                action: 'Activate draft campaign',
                metric: '+40% diversity potential',
              },
            ].map((insight, index) => {
              const severityStyles: Record<string, { bg: string; border: string; icon: string }> = {
                opportunity: { bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-800', icon: 'text-blue-500' },
                warning: { bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-200 dark:border-amber-800', icon: 'text-amber-500' },
                positive: { bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-200 dark:border-green-800', icon: 'text-green-500' },
                info: { bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-800', icon: 'text-purple-500' },
              }
              const style = severityStyles[insight.severity]
              return (
                <Card key={index} className={`border shadow-lg ${style.bg} ${style.border}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="p-2 bg-white/60 dark:bg-white/5 rounded-lg">
                        <insight.icon className={`w-5 h-5 ${style.icon}`} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground text-sm">{insight.title}</h3>
                        <Badge variant="outline" className="mt-1 text-[10px]">{insight.metric}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">{insight.insight}</p>
                    <Button variant="outline" size="sm" className="w-full">
                      {insight.action} <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Program Health Score */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" /> Program Health Score
              </CardTitle>
              <CardDescription>Composite health metric of your incentive program</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: 'Participation', score: 83, max: 100, color: '#22c55e' },
                  { label: 'Achievement Rate', score: 62, max: 100, color: '#f59e0b' },
                  { label: 'Budget Efficiency', score: 91, max: 100, color: '#6366f1' },
                  { label: 'Engagement', score: 75, max: 100, color: '#06b6d4' },
                  { label: 'Overall', score: 78, max: 100, color: '#8b5cf6' },
                ].map((health) => (
                  <div key={health.label} className="text-center p-4 bg-muted/40 rounded-xl">
                    <div className="relative inline-flex items-center justify-center w-20 h-20 mb-2">
                      <svg className="w-20 h-20 -rotate-90">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" className="text-muted" strokeWidth="6" />
                        <circle cx="40" cy="40" r="34" fill="none" stroke={health.color} strokeWidth="6"
                          strokeDasharray={`${2 * Math.PI * 34}`}
                          strokeDashoffset={`${2 * Math.PI * 34 * (1 - health.score / health.max)}`}
                          strokeLinecap="round" />
                      </svg>
                      <span className="absolute text-lg font-bold text-foreground">{health.score}</span>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">{health.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
