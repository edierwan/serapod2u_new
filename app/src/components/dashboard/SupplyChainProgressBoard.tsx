'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import SimpleProgressTracker from './SimpleProgressTracker'
import {
  AlertCircle,
  Factory,
  Warehouse,
  Truck,
  Store,
  Loader2,
  Activity,
  TrendingUp
} from 'lucide-react'

interface UserProfile {
  id: string
  role_code: string
  organization_id: string
  organizations: {
    org_type_code: string
  }
}

type StageKey = 'pending' | 'generated' | 'printed' | 'packed' | 'ready_to_ship' | 'received_warehouse' | 'warehouse_packed' | 'shipped_distributor' | 'opened'

interface RawRecord {
  id: string
  status: StageKey | null
  actual_unit_count: number | null
  expected_unit_count: number | null
  manufacturer_org_id: string | null
  warehouse_org_id: string | null
  shipped_to_distributor_id: string | null
  qr_batches: any
}

interface OrderSummary {
  orderId: string
  orderNo: string
  totalCases: number
  totalUnits: number
  completionPercent: number
  stageCounts: Record<StageKey, number>
}

interface ManufacturerSummary {
  id: string
  name: string
  totalCases: number
  completionPercent: number
  stageCounts: Record<StageKey, number>
}

interface OverviewData {
  totalCases: number
  totalUnits: number
  overallCompletion: number
  stageCounts: Record<StageKey, number>
  orders: OrderSummary[]
  manufacturerSummaries: ManufacturerSummary[]
}

type Scope = 'manufacturer' | 'hq'

const STAGE_ORDER: StageKey[] = ['pending', 'generated', 'printed', 'packed', 'ready_to_ship', 'received_warehouse', 'warehouse_packed', 'shipped_distributor', 'opened']

const STAGE_WEIGHTS: Record<StageKey, number> = {
  pending: 0.05, // Small weight to show minimal progress for pending orders
  generated: 0.05, // Same as pending - master codes generated but not yet printed
  printed: 0.20, // Increased from 0.15 to show more visible progress
  packed: 0.45,
  ready_to_ship: 0.45, // Same weight as packed - both represent completed manufacturing
  received_warehouse: 0.7,
  warehouse_packed: 0.75, // Scanned at warehouse and staged for shipment
  shipped_distributor: 0.9,
  opened: 1
}

const PIPELINE_META = [
  {
    key: 'pending_printed',
    label: 'Printing',
    icon: AlertCircle,
    bg: 'bg-slate-100',
    accent: 'text-slate-600'
  },
  {
    key: 'packed',
    label: 'Packed @ Manufacturer',
    icon: Factory,
    bg: 'bg-blue-50',
    accent: 'text-blue-600'
  },
  {
    key: 'received_warehouse',
    label: 'Received @ Warehouse',
    icon: Warehouse,
    bg: 'bg-indigo-50',
    accent: 'text-indigo-600'
  },
  {
    key: 'shipped_distributor',
    label: 'Shipped to Distributor',
    icon: Truck,
    bg: 'bg-amber-50',
    accent: 'text-amber-600'
  },
  {
    key: 'opened',
    label: 'Opened @ Shop',
    icon: Store,
    bg: 'bg-emerald-50',
    accent: 'text-emerald-600'
  }
] as const

function createEmptyStageCounts(): Record<StageKey, number> {
  return {
    pending: 0,
    generated: 0,
    printed: 0,
    packed: 0,
    ready_to_ship: 0,
    received_warehouse: 0,
    warehouse_packed: 0,
    shipped_distributor: 0,
    opened: 0
  }
}

function parseBatch(batch: any) {
  if (!batch) return { orderId: null, orderNo: 'Unknown Order' }
  const resolvedBatch = Array.isArray(batch) ? batch[0] : batch
  if (!resolvedBatch) return { orderId: null, orderNo: 'Unknown Order' }

  const order = resolvedBatch.orders
    ? (Array.isArray(resolvedBatch.orders) ? resolvedBatch.orders[0] : resolvedBatch.orders)
    : null

  return {
    orderId: order?.id || resolvedBatch.order_id || `batch-${resolvedBatch.id}`,
    orderNo: order?.order_no || resolvedBatch.order_id || 'Unassigned Order'
  }
}

function buildOverview(records: RawRecord[]): {
  overview: OverviewData
  manufacturerMap: Map<string, { id: string; stageCounts: Record<StageKey, number>; totalCases: number; completionScore: number }>
} {
  const stageCounts = createEmptyStageCounts()
  const ordersMap = new Map<string, { orderId: string; orderNo: string; stageCounts: Record<StageKey, number>; totalCases: number; totalUnits: number; completionScore: number }>()
  const manufacturerMap = new Map<string, { id: string; stageCounts: Record<StageKey, number>; totalCases: number; completionScore: number }>()

  let totalCases = 0
  let totalUnits = 0
  let totalCompletionScore = 0

  records.forEach((record) => {
    const status = (record.status && STAGE_ORDER.includes(record.status)) ? record.status : 'pending'
    const stageCount = stageCounts[status]
    stageCounts[status] = stageCount + 1
    totalCases += 1

    const units = record.actual_unit_count && record.actual_unit_count > 0
      ? record.actual_unit_count
      : (record.expected_unit_count || 0)
    totalUnits += units

    const { orderId, orderNo } = parseBatch(record.qr_batches)
    if (!ordersMap.has(orderId)) {
      ordersMap.set(orderId, {
        orderId,
        orderNo,
        stageCounts: createEmptyStageCounts(),
        totalCases: 0,
        totalUnits: 0,
        completionScore: 0
      })
    }
    const orderEntry = ordersMap.get(orderId)!
    orderEntry.stageCounts[status] += 1
    orderEntry.totalCases += 1
    orderEntry.totalUnits += units
    orderEntry.completionScore += STAGE_WEIGHTS[status]

    if (record.manufacturer_org_id) {
      if (!manufacturerMap.has(record.manufacturer_org_id)) {
        manufacturerMap.set(record.manufacturer_org_id, {
          id: record.manufacturer_org_id,
          stageCounts: createEmptyStageCounts(),
          totalCases: 0,
          completionScore: 0
        })
      }
      const manufacturerEntry = manufacturerMap.get(record.manufacturer_org_id)!
      manufacturerEntry.stageCounts[status] += 1
      manufacturerEntry.totalCases += 1
      manufacturerEntry.completionScore += STAGE_WEIGHTS[status]
    }

    totalCompletionScore += STAGE_WEIGHTS[status]
  })

  const orders: OrderSummary[] = Array.from(ordersMap.values()).map((order) => ({
    orderId: order.orderId,
    orderNo: order.orderNo,
    totalCases: order.totalCases,
    totalUnits: order.totalUnits,
    completionPercent: order.totalCases ? Math.round((order.completionScore / order.totalCases) * 1000) / 10 : 0,
    stageCounts: order.stageCounts
  }))

  orders.sort((a, b) => b.totalCases - a.totalCases)

  const overview: OverviewData = {
    totalCases,
    totalUnits,
    overallCompletion: totalCases ? Math.round((totalCompletionScore / totalCases) * 1000) / 10 : 0,
    stageCounts,
    orders,
    manufacturerSummaries: []
  }

  return { overview, manufacturerMap }
}

function combinePipelineCounts(stageCounts: Record<StageKey, number>) {
  // Calculate cumulative counts for display stages
  // "Printing" includes everything from pending/generated onwards (pending + generated + printed + packed + ready_to_ship + ...)
  const printingTotal = stageCounts.pending + stageCounts.generated + stageCounts.printed + 
                       stageCounts.packed + stageCounts.ready_to_ship + stageCounts.received_warehouse + 
                       stageCounts.warehouse_packed + stageCounts.shipped_distributor + stageCounts.opened
  
  // "Packed @ Manufacturer" includes packed + ready_to_ship + all downstream
  const packedTotal = stageCounts.packed + stageCounts.ready_to_ship + 
                     stageCounts.received_warehouse + stageCounts.warehouse_packed + 
                     stageCounts.shipped_distributor + stageCounts.opened
  
  // "Received @ Warehouse" includes warehouse + warehouse_packed + all downstream
  const warehouseTotal = stageCounts.received_warehouse + stageCounts.warehouse_packed + 
                        stageCounts.shipped_distributor + stageCounts.opened
  
  // "Shipped to Distributor" includes distributor + opened
  const distributorTotal = stageCounts.shipped_distributor + stageCounts.opened
  
  // "Opened @ Shop" is just opened
  const shopTotal = stageCounts.opened
  
  return PIPELINE_META.map((meta) => {
    let count = 0
    if (meta.key === 'pending_printed') {
      count = printingTotal
    } else if (meta.key === 'packed') {
      count = packedTotal
    } else if (meta.key === 'received_warehouse') {
      count = warehouseTotal
    } else if (meta.key === 'shipped_distributor') {
      count = distributorTotal
    } else if (meta.key === 'opened') {
      count = shopTotal
    }
    return {
      ...meta,
      count
    }
  })
}

export default function SupplyChainProgressBoard({ userProfile }: { userProfile: UserProfile }) {
  const scope: Scope | null = useMemo(() => {
    const orgType = userProfile.organizations?.org_type_code
    if (orgType === 'MANU') {
      return 'manufacturer'
    }

    if (
      orgType === 'HQ' ||
      ['SUPER_ADMIN', 'HQ_ADMIN', 'POWER_USER'].includes(userProfile.role_code)
    ) {
      return 'hq'
    }

    return null
  }, [userProfile.organizations?.org_type_code, userProfile.role_code])

  const supabase = createClient()
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope) return
    loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userProfile.organization_id])

  async function loadOverview() {
    try {
      setLoading(true)
      setError(null)

      const baseQuery = supabase
        .from('qr_master_codes')
        .select(`
          id,
          status,
          actual_unit_count,
          expected_unit_count,
          manufacturer_org_id,
          warehouse_org_id,
          shipped_to_distributor_id,
          qr_batches!inner (
            id,
            order_id,
            orders (
              id,
              order_no
            )
          )
        `)
        .order('updated_at', { ascending: false })

      if (scope === 'manufacturer') {
        baseQuery.eq('manufacturer_org_id', userProfile.organization_id)
      }

      const { data, error: queryError } = await baseQuery.limit(scope === 'manufacturer' ? 400 : 800)

      if (queryError) {
        throw queryError
      }

      const rawRecords = (data || []) as RawRecord[]

      if (!rawRecords.length) {
        setOverview({
          totalCases: 0,
          totalUnits: 0,
          overallCompletion: 0,
          stageCounts: createEmptyStageCounts(),
          orders: [],
          manufacturerSummaries: []
        })
        return
      }

      const { overview: baseOverview, manufacturerMap } = buildOverview(rawRecords)

      if (scope === 'hq' && manufacturerMap.size > 0) {
        const manufacturerIds = Array.from(manufacturerMap.keys()).filter(Boolean)

        let nameLookup = new Map<string, string>()
        if (manufacturerIds.length > 0) {
          const { data: orgsData, error: orgError } = await supabase
            .from('organizations')
            .select('id, org_name')
            .in('id', manufacturerIds)

          if (!orgError && orgsData) {
            nameLookup = new Map(orgsData.map((org) => [org.id, org.org_name]))
          }
        }

        baseOverview.manufacturerSummaries = Array.from(manufacturerMap.values()).map((manufacturer) => ({
          id: manufacturer.id,
          name: nameLookup.get(manufacturer.id) || 'Manufacturer',
          totalCases: manufacturer.totalCases,
          completionPercent: manufacturer.totalCases
            ? Math.round((manufacturer.completionScore / manufacturer.totalCases) * 1000) / 10
            : 0,
          stageCounts: manufacturer.stageCounts
        }))

        baseOverview.manufacturerSummaries.sort((a, b) => b.totalCases - a.totalCases)
      }

      setOverview(baseOverview)
    } catch (err) {
      console.error('Error loading supply chain progress:', err)
      setError(err instanceof Error ? err.message : 'Unable to load supply chain progress right now')
    } finally {
      setLoading(false)
    }
  }

  if (!scope) {
    return null
  }

  if (loading && !overview) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading supply chain pipeline…</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-semibold">Unable to load progress overview</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!overview) {
    return null
  }

  const pipelineSegments = combinePipelineCounts(overview.stageCounts)
  const totalCases = overview.totalCases || 1

  if (scope === 'manufacturer') {
    return (
      <div className="space-y-6">
        <Card className="border-blue-200">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <Activity className="h-5 w-5" />
              Manufacturing Pipeline Snapshot
            </CardTitle>
            <p className="text-sm text-blue-700">
              Monitor how your master cases move from packing to the field across all active orders.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 sm:p-4">
                <p className="text-xs uppercase tracking-wide text-blue-500">Total Master Cases</p>
                <p className="mt-2 text-xl sm:text-2xl font-semibold text-blue-900">{overview.totalCases}</p>
                <p className="text-xs text-blue-600 hidden sm:block">Across {overview.orders.length} recent orders</p>
              </div>
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 sm:p-4">
                <p className="text-xs uppercase tracking-wide text-indigo-500">Units Accounted For</p>
                <p className="mt-2 text-xl sm:text-2xl font-semibold text-indigo-900">{overview.totalUnits.toLocaleString()}</p>
                <p className="text-xs text-indigo-600 hidden sm:block">Expected &amp; scanned unit totals</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 sm:p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-500">Overall Completion</p>
                <p className="mt-2 text-xl sm:text-2xl font-semibold text-emerald-900">{overview.overallCompletion}%</p>
                <Progress value={overview.overallCompletion} className="mt-3 h-2" />
                <p className="text-xs text-emerald-600 mt-2 hidden sm:block">Weighted across all master cases</p>
              </div>
            </div>

            {/* Supply Chain Status Flow */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Supply Chain Status Flow</h3>
              <SimpleProgressTracker
                steps={pipelineSegments.map((segment) => ({
                  key: segment.key,
                  label: segment.label,
                  icon: segment.icon,
                  count: segment.count,
                  percent: Math.round((segment.count / totalCases) * 1000) / 10,
                  color: segment.accent,
                  bgColor: segment.bg,
                  borderColor: 'border-gray-200'
                }))}
                totalCases={totalCases}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Order Progress Board
            </CardTitle>
            <p className="text-sm text-gray-500">
              Your most active orders ranked by master case throughput.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {overview.orders.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-gray-500">
                No manufacturing activity detected yet. Start linking master cases to see progress here.
              </div>
            )}

            {overview.orders.slice(0, 6).map((order) => {
              const percent = Math.min(100, Math.max(0, order.completionPercent))
              return (
                <div key={order.orderId} className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{order.orderNo}</p>
                      <p className="text-xs text-gray-500">{order.totalUnits.toLocaleString()} units • {order.totalCases} master cases</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {percent}% complete
                    </Badge>
                  </div>
                  <Progress value={percent} className="mt-3 h-2" />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 md:grid-cols-4">
                    <span>Packed: {order.stageCounts.packed + order.stageCounts.ready_to_ship}</span>
                    <span>Warehouse: {order.stageCounts.received_warehouse}</span>
                    <span>Distributor: {order.stageCounts.shipped_distributor}</span>
                    <span>Shop: {order.stageCounts.opened}</span>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    )
  }

  // HQ scope
  const topManufacturers = overview.manufacturerSummaries.slice(0, 6)
  const watchlist = [...overview.orders]
    .sort((a, b) => a.completionPercent - b.completionPercent)
    .slice(0, 6)

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-slate-900">
            <Activity className="h-5 w-5" />
            Network Supply Pipeline
          </CardTitle>
          <p className="text-sm text-slate-600">
            Track how manufactured cases progress through warehouse, distributor, and shop touchpoints.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Master Cases</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{overview.totalCases}</p>
              <p className="text-xs text-slate-600">Across entire managed network</p>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs uppercase tracking-wide text-blue-500">Units Accounted For</p>
              <p className="mt-2 text-2xl font-semibold text-blue-900">{overview.totalUnits.toLocaleString()}</p>
              <p className="text-xs text-blue-600">Expected plus scanned units</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs uppercase tracking-wide text-emerald-500">Network Completion</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-900">{overview.overallCompletion}%</p>
              <Progress value={overview.overallCompletion} className="mt-3 h-2" />
              <p className="text-xs text-emerald-600 mt-2">Weighted average across all cases</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-xs uppercase tracking-wide text-indigo-500">Active Manufacturers</p>
              <p className="mt-2 text-2xl font-semibold text-indigo-900">{overview.manufacturerSummaries.length}</p>
              <p className="text-xs text-indigo-600">Contributing to this pipeline</p>
            </div>
          </div>

          {/* Supply Chain Status Flow */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Supply Chain Status Flow</h3>
            <SimpleProgressTracker
              steps={pipelineSegments.map((segment) => ({
                key: segment.key,
                label: segment.label,
                icon: segment.icon,
                count: segment.count,
                percent: Math.round((segment.count / totalCases) * 1000) / 10,
                color: segment.accent,
                bgColor: segment.bg,
                borderColor: 'border-gray-200'
              }))}
              totalCases={totalCases}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Orders Watchlist
          </CardTitle>
          <p className="text-sm text-gray-500">
            Identify orders that still need attention to keep inventory flowing downstream.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {watchlist.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-gray-500">
              All tracked orders are progressing smoothly.
            </div>
          )}

          {watchlist.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:hidden">
                {watchlist.map((order) => {
                  const percent = Math.min(100, Math.max(0, order.completionPercent))
                  return (
                    <div
                      key={`mobile-${order.orderId}`}
                      className="rounded-xl border border-gray-200 bg-white/80 p-3 shadow-sm"
                    >
                      <p className="text-xs font-semibold text-gray-900 truncate">{order.orderNo}</p>
                      <p className="mt-1 text-[11px] text-gray-500 truncate">
                        {order.totalUnits.toLocaleString()} units
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-500">Cases {order.totalCases}</span>
                        <Badge 
                          variant={percent >= 70 ? 'secondary' : percent >= 30 ? 'default' : 'destructive'} 
                          className="text-[10px]"
                        >
                          {percent}%
                        </Badge>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full ${
                            percent >= 70 ? 'bg-emerald-500' : percent >= 30 ? 'bg-blue-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[10px] text-gray-400">
                        Pending/Gen: {order.stageCounts.pending + order.stageCounts.generated} • Printed+: {order.stageCounts.printed + order.stageCounts.packed + order.stageCounts.ready_to_ship + order.stageCounts.received_warehouse + order.stageCounts.warehouse_packed + order.stageCounts.shipped_distributor + order.stageCounts.opened}
                      </p>
                    </div>
                  )
                })}
              </div>

              <div className="hidden sm:flex sm:flex-col sm:gap-4">
                {watchlist.map((order) => {
                  const percent = Math.min(100, Math.max(0, order.completionPercent))
                  return (
                    <div key={order.orderId} className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{order.orderNo}</p>
                          <p className="text-xs text-gray-500">{order.totalUnits.toLocaleString()} units • {order.totalCases} master cases</p>
                        </div>
                        <Badge 
                          variant={percent >= 70 ? 'secondary' : percent >= 30 ? 'default' : 'destructive'} 
                          className="text-xs"
                        >
                          {percent}% complete
                        </Badge>
                      </div>
                      <Progress value={percent} className="mt-3 h-2" />
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 md:grid-cols-5">
                        <span title="Cases generated but not yet printed">Pending/Gen: {order.stageCounts.pending + order.stageCounts.generated}</span>
                        <span title="Cases that reached printing stage or beyond">Printed+: {order.stageCounts.printed + order.stageCounts.packed + order.stageCounts.ready_to_ship + order.stageCounts.received_warehouse + order.stageCounts.warehouse_packed + order.stageCounts.shipped_distributor + order.stageCounts.opened}</span>
                        <span title="Cases that reached packed stage or beyond">Packed+: {order.stageCounts.packed + order.stageCounts.ready_to_ship + order.stageCounts.received_warehouse + order.stageCounts.warehouse_packed + order.stageCounts.shipped_distributor + order.stageCounts.opened}</span>
                        <span title="Cases that reached warehouse or beyond">Warehouse+: {order.stageCounts.received_warehouse + order.stageCounts.warehouse_packed + order.stageCounts.shipped_distributor + order.stageCounts.opened}</span>
                        <span title="Cases shipped to distributor or opened">Distributor+: {order.stageCounts.shipped_distributor + order.stageCounts.opened}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
