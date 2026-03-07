'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
  ComposedChart,
  Line,
  Cell,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
} from 'recharts'
import {
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Package,
  Boxes,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Star,
  Zap,
  Target,
  BarChart3,
  ShoppingCart,
  Layers,
  Trophy,
  Flame,
  Rocket,
  ShieldAlert,
  Megaphone,
  Crown,
  Search,
  X,
  Eye,
} from 'lucide-react'
import {
  format,
  subDays,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  differenceInDays,
  parseISO,
} from 'date-fns'

// ── Types ──────────────────────────────────────────────────────────────────
interface ProductsTabProps {
  userProfile: any
  chartGridColor: string
  chartTickColor: string
  isDark: boolean
}

interface OrderRow {
  id: string
  order_type: string
  status: string
  created_at: string
}

interface OrderItemRow {
  order_id: string
  product_id: string
  variant_id: string
  qty: number
  unit_price: number
  line_total: number
}

interface VariantRow {
  id: string
  variant_name: string
  product_id: string
  is_active: boolean
  base_cost: number | null
  suggested_retail_price: number | null
}

interface ProductRow {
  id: string
  product_name: string
  product_code: string
  is_active: boolean
  category_id: string | null
}

interface InventoryRow {
  variant_id: string
  organization_id: string
  quantity_on_hand: number
  quantity_available: number
  quantity_allocated: number
  reorder_point: number
  average_cost: number
  total_value: number
  updated_at: string
}

interface CategoryRow {
  id: string
  category_name: string
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

const PERIOD_OPTIONS = [
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: '180', label: 'Last 6 Months' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
]

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

function ChartSkeleton({ height = 'h-64' }: { height?: string }) {
  return <Skeleton className={`w-full ${height}`} />
}

function getDateRange(period: string): { start: Date; end: Date } {
  const now = new Date()
  switch (period) {
    case '30':
      return { start: subDays(now, 30), end: now }
    case '90':
      return { start: subDays(now, 90), end: now }
    case '180':
      return { start: subDays(now, 180), end: now }
    case 'this_month':
      return { start: startOfMonth(now), end: now }
    case 'last_month': {
      const lm = subMonths(now, 1)
      return { start: startOfMonth(lm), end: endOfMonth(lm) }
    }
    default:
      return { start: subDays(now, 30), end: now }
  }
}

function rankBadgeColor(rank: number): string {
  if (rank === 1) return 'bg-yellow-500 text-white'
  if (rank === 2) return 'bg-gray-400 text-white'
  if (rank === 3) return 'bg-amber-700 text-white'
  return 'bg-muted text-muted-foreground'
}

function formatRM(val: number): string {
  if (val >= 1_000_000) return `RM ${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `RM ${(val / 1_000).toFixed(1)}K`
  return `RM ${val.toFixed(2)}`
}

function formatNum(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toLocaleString()
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function ProductsTab({ userProfile, chartGridColor, chartTickColor, isDark }: ProductsTabProps) {
  const supabase = useMemo(() => createClient(), [])

  // State
  const [period, setPeriod] = useState('90')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Raw data
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([])
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [inventory, setInventory] = useState<InventoryRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [showSkuModal, setShowSkuModal] = useState(false)
  const [skuSearch, setSkuSearch] = useState('')

  // ── Data Fetching ────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const last12Start = subMonths(new Date(), 12).toISOString()

      const [ordersRes, variantsRes, productsRes, inventoryRes, categoriesRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, order_type, status, created_at')
          .in('status', ['approved', 'closed', 'submitted'])
          .gte('created_at', last12Start),
        supabase
          .from('product_variants')
          .select('id, variant_name, product_id, is_active, base_cost, suggested_retail_price'),
        supabase
          .from('products')
          .select('id, product_name, product_code, is_active, category_id'),
        supabase
          .from('product_inventory')
          .select('variant_id, organization_id, quantity_on_hand, quantity_available, quantity_allocated, reorder_point, average_cost, total_value, updated_at'),
        supabase
          .from('product_categories')
          .select('id, category_name'),
      ])

      const orderIds = (ordersRes.data || []).map((o: any) => o.id)

      // Fetch order items in batches to avoid URL length limits
      let allItems: OrderItemRow[] = []
      const batchSize = 200
      for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize)
        const itemsRes = await supabase
          .from('order_items')
          .select('order_id, product_id, variant_id, qty, unit_price, line_total')
          .in('order_id', batch)
        if (itemsRes.data) allItems = allItems.concat(itemsRes.data as OrderItemRow[])
      }

      setOrders((ordersRes.data || []) as unknown as OrderRow[])
      setOrderItems(allItems)
      setVariants((variantsRes.data || []) as unknown as VariantRow[])
      setProducts((productsRes.data || []) as unknown as ProductRow[])
      setInventory((inventoryRes.data || []) as unknown as InventoryRow[])
      setCategories((categoriesRes.data || []) as unknown as CategoryRow[])
    } catch (err) {
      console.error('ProductsTab fetch error:', err)
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

  // ── Lookups ──────────────────────────────────────────────────────────────
  const variantMap = useMemo(() => {
    const m = new Map<string, VariantRow>()
    variants.forEach(v => m.set(v.id, v))
    return m
  }, [variants])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    products.forEach(p => m.set(p.id, p))
    return m
  }, [products])

  const orderDateMap = useMemo(() => {
    const m = new Map<string, string>()
    orders.forEach(o => m.set(o.id, o.created_at))
    return m
  }, [orders])

  // ── Period Filtering ─────────────────────────────────────────────────────
  const { start: periodStart, end: periodEnd } = useMemo(() => getDateRange(period), [period])

  const periodOrders = useMemo(() => {
    const s = periodStart.toISOString()
    const e = periodEnd.toISOString()
    return orders.filter(o => o.created_at >= s && o.created_at <= e)
  }, [orders, periodStart, periodEnd])

  const periodOrderIds = useMemo(() => new Set(periodOrders.map(o => o.id)), [periodOrders])

  const periodItems = useMemo(
    () => orderItems.filter(item => periodOrderIds.has(item.order_id)),
    [orderItems, periodOrderIds]
  )

  // ── 1. KPI Metrics ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const activeSKUs = variants.filter(v => v.is_active).length
    const totalUnits = periodItems.reduce((s, i) => s + (i.qty || 0), 0)
    const totalRevenue = periodItems.reduce((s, i) => s + (i.line_total || 0), 0)
    const inventoryValue = inventory.reduce((s, i) => s + (i.total_value || 0), 0)
    const avgInventory = inventory.reduce((s, i) => s + (i.quantity_on_hand || 0), 0)
    const turnoverRatio = avgInventory > 0 ? totalUnits / avgInventory : 0

    return { activeSKUs, totalUnits, totalRevenue, inventoryValue, turnoverRatio }
  }, [variants, periodItems, inventory])

  // ── 2. Demand Trend (12 months) ──────────────────────────────────────────
  const demandTrend = useMemo(() => {
    const now = new Date()
    const monthStarts = eachMonthOfInterval({ start: subMonths(now, 11), end: now })

    return monthStarts.map(ms => {
      const me = endOfMonth(ms)
      const msISO = ms.toISOString()
      const meISO = me.toISOString()

      const monthOrderIds = new Set(
        orders
          .filter(o => o.created_at >= msISO && o.created_at <= meISO)
          .map(o => o.id)
      )

      let units = 0
      let revenue = 0
      orderItems.forEach(item => {
        if (monthOrderIds.has(item.order_id)) {
          units += item.qty || 0
          revenue += item.line_total || 0
        }
      })

      return {
        month: format(ms, 'MMM yy'),
        units,
        revenue: Math.round(revenue),
      }
    })
  }, [orders, orderItems])

  // ── 3. Top Performing SKUs ───────────────────────────────────────────────
  const topSKUs = useMemo(() => {
    const byVariant = new Map<string, { units: number; revenue: number }>()

    periodItems.forEach(item => {
      const key = item.variant_id
      const cur = byVariant.get(key) || { units: 0, revenue: 0 }
      cur.units += item.qty || 0
      cur.revenue += item.line_total || 0
      byVariant.set(key, cur)
    })

    const totalUnits = periodItems.reduce((s, i) => s + (i.qty || 0), 0)
    const totalRevenue = periodItems.reduce((s, i) => s + (i.line_total || 0), 0)

    const entries = Array.from(byVariant.entries()).map(([vid, data]) => {
      const v = variantMap.get(vid)
      const p = v ? productMap.get(v.product_id) : null
      return {
        variantId: vid,
        name: v?.variant_name || 'Unknown',
        productName: p?.product_name || '',
        units: data.units,
        revenue: data.revenue,
        unitPct: totalUnits > 0 ? (data.units / totalUnits) * 100 : 0,
        revenuePct: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
      }
    })

    const topByUnits = [...entries].sort((a, b) => b.units - a.units).slice(0, 10)
    const topByRevenue = [...entries].sort((a, b) => b.revenue - a.revenue).slice(0, 10)

    return { topByUnits, topByRevenue }
  }, [periodItems, variantMap, productMap])

  // ── 4. Slow Moving Products ──────────────────────────────────────────────
  const slowMoving = useMemo(() => {
    const now = new Date()
    const last3Start = subMonths(now, 3).toISOString()
    const prev3Start = subMonths(now, 6).toISOString()

    const last3OrderIds = new Set(
      orders.filter(o => o.created_at >= last3Start).map(o => o.id)
    )
    const prev3OrderIds = new Set(
      orders.filter(o => o.created_at >= prev3Start && o.created_at < last3Start).map(o => o.id)
    )

    const last3Units = new Map<string, number>()
    const prev3Units = new Map<string, number>()
    const lastOrderDate = new Map<string, string>()

    orderItems.forEach(item => {
      const d = orderDateMap.get(item.order_id)
      if (!d) return

      // Track last order date
      const cur = lastOrderDate.get(item.variant_id) || ''
      if (d > cur) lastOrderDate.set(item.variant_id, d)

      if (last3OrderIds.has(item.order_id)) {
        last3Units.set(item.variant_id, (last3Units.get(item.variant_id) || 0) + (item.qty || 0))
      }
      if (prev3OrderIds.has(item.order_id)) {
        prev3Units.set(item.variant_id, (prev3Units.get(item.variant_id) || 0) + (item.qty || 0))
      }
    })

    const results: Array<{
      variantId: string
      name: string
      productName: string
      decline: number
      lastOrdered: string
      severity: 'red' | 'amber'
      reason: string
    }> = []

    const allVariantIds = new Set([...last3Units.keys(), ...prev3Units.keys()])

    allVariantIds.forEach(vid => {
      const recent = last3Units.get(vid) || 0
      const previous = prev3Units.get(vid) || 0
      const v = variantMap.get(vid)
      const p = v ? productMap.get(v.product_id) : null

      if (recent === 0 && previous > 0) {
        results.push({
          variantId: vid,
          name: v?.variant_name || 'Unknown',
          productName: p?.product_name || '',
          decline: -100,
          lastOrdered: lastOrderDate.get(vid) || '',
          severity: 'red',
          reason: 'Zero orders in last 3 months',
        })
      } else if (previous > 0) {
        const change = ((recent - previous) / previous) * 100
        if (change <= -30) {
          results.push({
            variantId: vid,
            name: v?.variant_name || 'Unknown',
            productName: p?.product_name || '',
            decline: Math.round(change),
            lastOrdered: lastOrderDate.get(vid) || '',
            severity: change <= -60 ? 'red' : 'amber',
            reason: `${Math.abs(Math.round(change))}% decline vs prior period`,
          })
        }
      }
    })

    return results.sort((a, b) => a.decline - b.decline).slice(0, 12)
  }, [orders, orderItems, orderDateMap, variantMap, productMap])

  // ── 5. Inventory Health ──────────────────────────────────────────────────
  const inventoryHealth = useMemo(() => {
    const now = new Date()
    const sixMonthsAgo = subMonths(now, 6).toISOString()

    // Variants with orders in the last 6 months
    const recentOrderVariants = new Set<string>()
    orders.forEach(o => {
      if (o.created_at >= sixMonthsAgo) {
        orderItems.forEach(item => {
          if (item.order_id === o.id) recentOrderVariants.add(item.variant_id)
        })
      }
    })

    // Aggregate inventory per variant
    const invByVariant = new Map<string, { available: number; reorderPoint: number; onHand: number }>()
    inventory.forEach(inv => {
      const cur = invByVariant.get(inv.variant_id) || { available: 0, reorderPoint: 0, onHand: 0 }
      cur.available += inv.quantity_available || 0
      cur.reorderPoint = Math.max(cur.reorderPoint, inv.reorder_point || 0)
      cur.onHand += inv.quantity_on_hand || 0
      invByVariant.set(inv.variant_id, cur)
    })

    const cats = {
      fastMoving: { count: 0, units: 0, color: COLORS.danger },
      normal: { count: 0, units: 0, color: COLORS.success },
      slowMoving: { count: 0, units: 0, color: COLORS.warning },
      deadStock: { count: 0, units: 0, color: '#6b7280' },
    }

    invByVariant.forEach((data, vid) => {
      const rp = data.reorderPoint || 1

      if (!recentOrderVariants.has(vid) && data.onHand > 0) {
        cats.deadStock.count++
        cats.deadStock.units += data.onHand
      } else if (data.available < rp) {
        cats.fastMoving.count++
        cats.fastMoving.units += data.onHand
      } else if (data.available <= rp * 2) {
        cats.normal.count++
        cats.normal.units += data.onHand
      } else if (data.available > rp * 3) {
        cats.slowMoving.count++
        cats.slowMoving.units += data.onHand
      } else {
        cats.normal.count++
        cats.normal.units += data.onHand
      }
    })

    return cats
  }, [orders, orderItems, inventory])

  // ── 6. Product Performance Quadrant ──────────────────────────────────────
  const quadrantData = useMemo(() => {
    const byVariant = new Map<string, { units: number; revenue: number }>()

    periodItems.forEach(item => {
      const cur = byVariant.get(item.variant_id) || { units: 0, revenue: 0 }
      cur.units += item.qty || 0
      cur.revenue += item.line_total || 0
      byVariant.set(item.variant_id, cur)
    })

    const points = Array.from(byVariant.entries()).map(([vid, data]) => {
      const v = variantMap.get(vid)
      const p = v ? productMap.get(v.product_id) : null
      const rpu = data.units > 0 ? data.revenue / data.units : 0
      return {
        variantId: vid,
        name: v?.variant_name || 'Unknown',
        productName: p?.product_name || '',
        units: data.units,
        revenuePerUnit: Math.round(rpu * 100) / 100,
        revenue: data.revenue,
      }
    })

    if (points.length === 0) return { points: [], medianUnits: 0, medianRPU: 0 }

    const sortedUnits = [...points].sort((a, b) => a.units - b.units)
    const sortedRPU = [...points].sort((a, b) => a.revenuePerUnit - b.revenuePerUnit)
    const medianUnits = sortedUnits[Math.floor(sortedUnits.length / 2)]?.units || 0
    const medianRPU = sortedRPU[Math.floor(sortedRPU.length / 2)]?.revenuePerUnit || 0

    const colored = points.map(pt => {
      let quadrant: string
      let fill: string
      if (pt.units >= medianUnits && pt.revenuePerUnit >= medianRPU) {
        quadrant = 'High Demand / High Value'
        fill = COLORS.success
      } else if (pt.units >= medianUnits && pt.revenuePerUnit < medianRPU) {
        quadrant = 'High Demand / Low Value'
        fill = COLORS.primary
      } else if (pt.units < medianUnits && pt.revenuePerUnit >= medianRPU) {
        quadrant = 'Low Demand / High Value'
        fill = COLORS.warning
      } else {
        quadrant = 'Low Demand / Low Value'
        fill = COLORS.danger
      }
      return { ...pt, quadrant, fill }
    })

    return { points: colored, medianUnits, medianRPU }
  }, [periodItems, variantMap, productMap])

  // ── 7. Strategy Insights ─────────────────────────────────────────────────
  const strategyInsights = useMemo(() => {
    const now = new Date()
    const last3Start = subMonths(now, 3).toISOString()
    const prev3Start = subMonths(now, 6).toISOString()

    const last3OrderIds = new Set(
      orders.filter(o => o.created_at >= last3Start).map(o => o.id)
    )
    const prev3OrderIds = new Set(
      orders.filter(o => o.created_at >= prev3Start && o.created_at < last3Start).map(o => o.id)
    )

    const last3Map = new Map<string, number>()
    const prev3Map = new Map<string, number>()

    orderItems.forEach(item => {
      if (last3OrderIds.has(item.order_id)) {
        last3Map.set(item.variant_id, (last3Map.get(item.variant_id) || 0) + (item.qty || 0))
      }
      if (prev3OrderIds.has(item.order_id)) {
        prev3Map.set(item.variant_id, (prev3Map.get(item.variant_id) || 0) + (item.qty || 0))
      }
    })

    const risingStars: string[] = []
    const atRisk: string[] = []
    const topPerformers: string[] = []

    const allV = new Set([...last3Map.keys(), ...prev3Map.keys()])
    allV.forEach(vid => {
      const recent = last3Map.get(vid) || 0
      const previous = prev3Map.get(vid) || 0
      if (previous > 0 && recent > previous * 1.2) risingStars.push(vid)
      if (previous > 0 && recent < previous * 0.7) atRisk.push(vid)
      if (recent > 0 && previous > 0 && recent >= previous * 0.9) topPerformers.push(vid)
    })

    // Promotion candidates: high inventory + low recent demand
    const invByVariant = new Map<string, number>()
    inventory.forEach(inv => {
      invByVariant.set(inv.variant_id, (invByVariant.get(inv.variant_id) || 0) + (inv.quantity_on_hand || 0))
    })

    const promotionCandidates: string[] = []
    invByVariant.forEach((qty, vid) => {
      const recentDemand = last3Map.get(vid) || 0
      if (qty > 0 && recentDemand < qty * 0.1) promotionCandidates.push(vid)
    })

    return [
      {
        key: 'rising',
        icon: <Rocket className="h-5 w-5" />,
        title: 'Rising Stars',
        value: risingStars.length,
        description: 'Products with >20% growth in last 3 months',
        color: COLORS.success,
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/30',
      },
      {
        key: 'at_risk',
        icon: <ShieldAlert className="h-5 w-5" />,
        title: 'At Risk',
        value: atRisk.length,
        description: 'Products with declining demand trend',
        color: COLORS.danger,
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
      },
      {
        key: 'promo',
        icon: <Megaphone className="h-5 w-5" />,
        title: 'Promotion Candidates',
        value: promotionCandidates.length,
        description: 'High inventory with low recent demand',
        color: COLORS.warning,
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
      },
      {
        key: 'top',
        icon: <Crown className="h-5 w-5" />,
        title: 'Top Performers',
        value: topPerformers.length,
        description: 'Consistent high demand products',
        color: COLORS.primary,
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/30',
      },
    ]
  }, [orders, orderItems, inventory])

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <KPICardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardContent className="pt-6"><ChartSkeleton height="h-72" /></CardContent>
          </Card>
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardContent className="pt-6"><ChartSkeleton height="h-72" /></CardContent>
          </Card>
        </div>
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardContent className="pt-6"><ChartSkeleton height="h-80" /></CardContent>
        </Card>
      </div>
    )
  }

  const hasData = orderItems.length > 0

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-500" />
            Product Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            SKU performance, inventory health &amp; demand trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── 1. KPI Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Active SKUs */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-400/50 transition-all" onClick={() => setShowSkuModal(true)}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Boxes className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Active SKUs</span>
            </div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
              <AnimatedCounter value={kpis.activeSKUs} />
              <Eye className="h-4 w-4 text-blue-400 opacity-60" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">click to view SKU details</p>
          </CardContent>
          <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-400" />
        </Card>

        {/* Total Units Ordered */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <ShoppingCart className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Units Ordered</span>
            </div>
            <div className="text-2xl font-bold">
              <AnimatedCounter value={kpis.totalUnits} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">in period</p>
          </CardContent>
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        </Card>

        {/* Total Revenue */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Revenue</span>
            </div>
            <div className="text-2xl font-bold">
              <AnimatedCounter value={kpis.totalRevenue} prefix="RM " decimals={0} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">line total</p>
          </CardContent>
          <div className="h-1 bg-gradient-to-r from-purple-500 to-purple-400" />
        </Card>

        {/* Inventory Value */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Layers className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Inventory Value</span>
            </div>
            <div className="text-2xl font-bold">
              <AnimatedCounter value={kpis.inventoryValue} prefix="RM " decimals={0} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">total stock</p>
          </CardContent>
          <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
        </Card>

        {/* Turnover Ratio */}
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Zap className="h-4 w-4 text-cyan-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Turnover Ratio</span>
            </div>
            <div className="text-2xl font-bold">
              <AnimatedCounter value={kpis.turnoverRatio} decimals={2} suffix="x" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">units / inventory</p>
          </CardContent>
          <div className="h-1 bg-gradient-to-r from-cyan-500 to-cyan-400" />
        </Card>
      </div>

      {!hasData ? (
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No order data yet</h3>
            <p className="text-sm text-muted-foreground">
              Once orders are placed, product analytics will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── 2. Product Demand Trend ──────────────────────────────────── */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                Product Demand Trend
              </CardTitle>
              <CardDescription>Monthly units ordered and revenue over the last 12 months</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={demandTrend} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="month" tick={{ fill: chartTickColor, fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fill: chartTickColor, fontSize: 12 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: chartTickColor, fontSize: 12 }}
                    tickFormatter={(v: number) => formatRM(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1e293b' : '#fff',
                      border: 'none',
                      borderRadius: 12,
                      boxShadow: '0 4px 24px rgba(0,0,0,.12)',
                    }}
                    formatter={(val: number, name: string) => {
                      if (name === 'revenue') return [formatRM(val), 'Revenue']
                      return [val.toLocaleString(), 'Units']
                    }}
                  />
                  <Legend />
                  <defs>
                    <linearGradient id="gradUnits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="units"
                    stroke={COLORS.primary}
                    fill="url(#gradUnits)"
                    strokeWidth={2}
                    name="units"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="revenue"
                    stroke={COLORS.success}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="revenue"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ── 3. Top Performing SKUs ───────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top by Units */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  Top 10 SKUs by Units
                </CardTitle>
                <CardDescription>Highest volume products in selected period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {topSKUs.topByUnits.map((sku, idx) => (
                  <div key={sku.variantId} className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeColor(idx + 1)}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate max-w-[180px]" title={sku.name}>
                          {sku.name}
                        </span>
                        <span className="text-sm font-semibold ml-2 whitespace-nowrap">
                          {sku.units.toLocaleString()} units
                        </span>
                      </div>
                      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                          style={{
                            width: `${sku.unitPct}%`,
                            background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.cyan})`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">{sku.unitPct.toFixed(1)}%</span>
                  </div>
                ))}
                {topSKUs.topByUnits.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No data</p>
                )}
              </CardContent>
            </Card>

            {/* Top by Revenue */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-purple-500" />
                  Top 10 SKUs by Revenue
                </CardTitle>
                <CardDescription>Highest revenue products in selected period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {topSKUs.topByRevenue.map((sku, idx) => (
                  <div key={sku.variantId} className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeColor(idx + 1)}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate max-w-[180px]" title={sku.name}>
                          {sku.name}
                        </span>
                        <span className="text-sm font-semibold ml-2 whitespace-nowrap">
                          {formatRM(sku.revenue)}
                        </span>
                      </div>
                      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                          style={{
                            width: `${sku.revenuePct}%`,
                            background: `linear-gradient(90deg, ${COLORS.purple}, ${COLORS.pink})`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">{sku.revenuePct.toFixed(1)}%</span>
                  </div>
                ))}
                {topSKUs.topByRevenue.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── 4. Slow Moving Products ──────────────────────────────────── */}
          {slowMoving.length > 0 && (
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Slow Moving Products
                </CardTitle>
                <CardDescription>Products with significant demand decline (last 3 months vs prior 3 months)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {slowMoving.map((item) => (
                    <div
                      key={item.variantId}
                      className={`rounded-lg border p-3 ${
                        item.severity === 'red'
                          ? 'border-red-500/30 bg-red-500/5'
                          : 'border-amber-500/30 bg-amber-500/5'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" title={item.name}>{item.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.productName}</p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`ml-2 flex-shrink-0 text-xs ${
                            item.severity === 'red'
                              ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {item.decline === -100 ? 'No Orders' : `${item.decline}%`}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {item.severity === 'red' ? (
                          <AlertCircle className="h-3 w-3 text-red-500" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        )}
                        <span>{item.reason}</span>
                      </div>
                      {item.lastOrdered && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last ordered: {format(parseISO(item.lastOrdered), 'dd MMM yyyy')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── 5. Inventory Health ──────────────────────────────────────── */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-500" />
                Inventory Health
              </CardTitle>
              <CardDescription>SKU distribution by inventory movement category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                  {
                    label: 'Fast Moving',
                    icon: <Flame className="h-4 w-4" />,
                    ...inventoryHealth.fastMoving,
                    desc: 'Stock below reorder point',
                  },
                  {
                    label: 'Normal',
                    icon: <CheckCircle2 className="h-4 w-4" />,
                    ...inventoryHealth.normal,
                    desc: 'Healthy stock levels',
                  },
                  {
                    label: 'Slow Moving',
                    icon: <AlertTriangle className="h-4 w-4" />,
                    ...inventoryHealth.slowMoving,
                    desc: 'Excess stock (>3x reorder)',
                  },
                  {
                    label: 'Dead Stock',
                    icon: <AlertCircle className="h-4 w-4" />,
                    ...inventoryHealth.deadStock,
                    desc: 'No orders in 6 months',
                  },
                ].map((cat) => (
                  <div
                    key={cat.label}
                    className="rounded-lg border p-4 text-center"
                    style={{ borderColor: `${cat.color}30` }}
                  >
                    <div className="flex items-center justify-center gap-2 mb-2" style={{ color: cat.color }}>
                      {cat.icon}
                      <span className="text-sm font-semibold">{cat.label}</span>
                    </div>
                    <p className="text-2xl font-bold" style={{ color: cat.color }}>
                      {cat.count}
                    </p>
                    <p className="text-xs text-muted-foreground">SKUs</p>
                    <p className="text-sm font-medium mt-1">{formatNum(cat.units)} units</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cat.desc}</p>
                  </div>
                ))}
              </div>

              {/* Stacked horizontal bar */}
              {(() => {
                const total =
                  inventoryHealth.fastMoving.count +
                  inventoryHealth.normal.count +
                  inventoryHealth.slowMoving.count +
                  inventoryHealth.deadStock.count
                if (total === 0) return null
                const segments = [
                  { ...inventoryHealth.fastMoving, label: 'Fast' },
                  { ...inventoryHealth.normal, label: 'Normal' },
                  { ...inventoryHealth.slowMoving, label: 'Slow' },
                  { ...inventoryHealth.deadStock, label: 'Dead' },
                ]
                return (
                  <div className="space-y-2">
                    <div className="flex h-6 rounded-full overflow-hidden">
                      {segments.map((seg) => {
                        const pct = (seg.count / total) * 100
                        if (pct === 0) return null
                        return (
                          <div
                            key={seg.label}
                            className="flex items-center justify-center text-xs font-medium text-white transition-all duration-500"
                            style={{ width: `${pct}%`, background: seg.color, minWidth: pct > 0 ? 20 : 0 }}
                            title={`${seg.label}: ${seg.count} SKUs (${pct.toFixed(1)}%)`}
                          >
                            {pct >= 8 ? `${pct.toFixed(0)}%` : ''}
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-center gap-4 flex-wrap">
                      {segments.map((seg) => (
                        <div key={seg.label} className="flex items-center gap-1.5 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
                          <span className="text-muted-foreground">{seg.label} ({seg.count})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          {/* ── 6. Product Performance Quadrant ──────────────────────────── */}
          {quadrantData.points.length > 0 && (
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-indigo-500" />
                  Product Performance Quadrant
                </CardTitle>
                <CardDescription>
                  Units sold vs revenue per unit — quadrant lines at median values
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis
                      type="number"
                      dataKey="units"
                      name="Units Sold"
                      tick={{ fill: chartTickColor, fontSize: 12 }}
                      label={{ value: 'Units Sold', position: 'insideBottom', offset: -8, fill: chartTickColor, fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="revenuePerUnit"
                      name="Revenue / Unit (RM)"
                      tick={{ fill: chartTickColor, fontSize: 12 }}
                      label={{ value: 'RM / Unit', angle: -90, position: 'insideLeft', offset: 4, fill: chartTickColor, fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: isDark ? '#1e293b' : '#fff',
                        border: 'none',
                        borderRadius: 12,
                        boxShadow: '0 4px 24px rgba(0,0,0,.12)',
                      }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="p-3 space-y-1">
                            <p className="font-semibold text-sm">{d.name}</p>
                            {d.productName && <p className="text-xs text-muted-foreground">{d.productName}</p>}
                            <p className="text-xs">Units: <span className="font-medium">{d.units.toLocaleString()}</span></p>
                            <p className="text-xs">RM/Unit: <span className="font-medium">RM {d.revenuePerUnit.toFixed(2)}</span></p>
                            <p className="text-xs">Revenue: <span className="font-medium">{formatRM(d.revenue)}</span></p>
                            <Badge className="text-[10px] mt-1" style={{ background: d.fill, color: '#fff' }}>
                              {d.quadrant}
                            </Badge>
                          </div>
                        )
                      }}
                    />
                    {/* Median reference lines */}
                    {quadrantData.medianUnits > 0 && (
                      <svg>
                        <line
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="0"
                          stroke={isDark ? '#475569' : '#cbd5e1'}
                          strokeDasharray="6 3"
                        />
                      </svg>
                    )}
                    <Scatter data={quadrantData.points} isAnimationActive>
                      {quadrantData.points.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} fillOpacity={0.8} stroke={entry.fill} strokeWidth={1} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>

                {/* Quadrant Legend */}
                <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
                  {[
                    { label: 'High Demand / High Value', color: COLORS.success },
                    { label: 'High Demand / Low Value', color: COLORS.primary },
                    { label: 'Low Demand / High Value', color: COLORS.warning },
                    { label: 'Low Demand / Low Value', color: COLORS.danger },
                  ].map(q => (
                    <div key={q.label} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: q.color }} />
                      <span className="text-muted-foreground">{q.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── 7. Product Strategy Insights ─────────────────────────────── */}
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Product Strategy Insights
              </CardTitle>
              <CardDescription>Data-driven recommendations based on product performance analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {strategyInsights.map((insight) => (
                  <div
                    key={insight.key}
                    className={`rounded-lg border p-4 ${insight.bgColor} ${insight.borderColor}`}
                  >
                    <div className="flex items-center gap-2 mb-3" style={{ color: insight.color }}>
                      {insight.icon}
                      <span className="text-sm font-semibold">{insight.title}</span>
                    </div>
                    <p className="text-3xl font-bold mb-1" style={{ color: insight.color }}>
                      {insight.value}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── SKU Detail Modal ──────────────────────────────────────────── */}
      <Dialog open={showSkuModal} onOpenChange={setShowSkuModal}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-blue-500" />
              Active SKU Directory ({variants.filter(v => v.is_active).length} variants)
            </DialogTitle>
            <DialogDescription>Complete list of active product variants with pricing and inventory details</DialogDescription>
          </DialogHeader>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SKU name, product name, or code..."
              value={skuSearch}
              onChange={e => setSkuSearch(e.target.value)}
              className="pl-9"
            />
            {skuSearch && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setSkuSearch('')}>
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto min-h-0 -mx-2 px-2">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="text-left py-2 pl-2">#</th>
                  <th className="text-left py-2">Product</th>
                  <th className="text-left py-2">Variant / SKU</th>
                  <th className="text-left py-2">Code</th>
                  <th className="text-right py-2">Base Cost</th>
                  <th className="text-right py-2">Retail Price</th>
                  <th className="text-right py-2">On Hand</th>
                  <th className="text-right py-2 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {variants
                  .filter(v => v.is_active)
                  .filter(v => {
                    if (!skuSearch) return true
                    const q = skuSearch.toLowerCase()
                    const prod = productMap.get(v.product_id)
                    return (
                      (v.variant_name || '').toLowerCase().includes(q) ||
                      (prod?.product_name || '').toLowerCase().includes(q) ||
                      (prod?.product_code || '').toLowerCase().includes(q)
                    )
                  })
                  .map((v, idx) => {
                    const prod = productMap.get(v.product_id)
                    const inv = inventory.find(i => i.variant_id === v.id)
                    return (
                      <tr key={v.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 pl-2 text-muted-foreground">{idx + 1}</td>
                        <td className="py-2.5">
                          <span className="font-medium text-foreground">{prod?.product_name || '-'}</span>
                        </td>
                        <td className="py-2.5">
                          <span className="text-foreground">{v.variant_name || '-'}</span>
                        </td>
                        <td className="py-2.5">
                          <Badge variant="outline" className="text-[10px] font-mono">{prod?.product_code || '-'}</Badge>
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          {v.base_cost != null ? `RM ${v.base_cost.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          {v.suggested_retail_price != null ? `RM ${v.suggested_retail_price.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          {inv ? inv.quantity_on_hand.toLocaleString() : '-'}
                        </td>
                        <td className="py-2.5 text-right pr-2">
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
                            Active
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
            {variants.filter(v => v.is_active).filter(v => {
              if (!skuSearch) return true
              const q = skuSearch.toLowerCase()
              const prod = productMap.get(v.product_id)
              return (v.variant_name || '').toLowerCase().includes(q) || (prod?.product_name || '').toLowerCase().includes(q) || (prod?.product_code || '').toLowerCase().includes(q)
            }).length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No SKUs match your search</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
