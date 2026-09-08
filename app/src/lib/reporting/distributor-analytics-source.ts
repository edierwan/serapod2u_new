/**
 * Data source for the monthly Distributor Analytics report.
 *
 * Primary path is the `reporting_distributor_analytics` RPC, which aggregates
 * the whole report inside the database and returns a few KB of JSON however
 * many orders the month holds.
 *
 * The fallback mirrors `product-analytics-source.ts`: when application code
 * reaches a database whose migration / schema cache is behind, the aggregation
 * still runs SERVER-SIDE so the browser only ever receives the compact report.
 * It is deliberately different from the model it replaces:
 *
 *   - the browser never receives raw orders — the previous route returned the
 *     full order population plus every distributor on every request;
 *   - order items are read in ONE paged join filtered on the embedded order,
 *     never by batching order ids;
 *   - product labels are resolved in ONE `.in()` query over the ranked
 *     variants, never per line;
 *   - the only all-history read is a narrow `(id, buyer, created_at, status)`
 *     projection, which is what "first ever order" and dormancy require.
 *
 * The fallback is a bridge for environments where the reporting migration has
 * not been applied yet; it is bounded and reports itself as degraded.
 */

import {
  ALL_DISTRIBUTORS,
  ALL_DISTRIBUTORS_LABEL,
  ALL_STATUS,
  DISTRIBUTOR_ORG_TYPE,
  ELIGIBLE_ORDER_TYPE,
  emptyAggregate,
  resolveDistributorReportPeriod,
  type DistributorAggregate,
  type DistributorAnalyticsAggregate,
  type DistributorReportPeriod,
  type OrderRecordTotals,
  type ProductTotals,
  type StatusTotals,
} from './distributor-analytics'
import { reportingPeriodFromKey, REPORTING_TIME_ZONE, type ReportingPeriod } from './reporting-period'

const PAGE_SIZE = 1000
/** Hard ceiling for the degraded fallback. Beyond this the migration is required. */
export const MAX_FALLBACK_ROWS = 200_000
/** Variants whose labels are resolved for the Top Products table. */
const LABEL_LOOKUP_LIMIT = 50

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000

export interface DistributorAnalyticsSourceResult {
  aggregate: DistributorAnalyticsAggregate
  source: 'rpc' | 'fallback'
  degraded: boolean
  notice: string | null
}

export function isMissingDistributorAnalyticsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_distributor_analytics') && message.includes('schema cache'))
}

export function isMissingDistributorPeriodsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_distributor_order_periods') && message.includes('schema cache'))
}

/** One selectable distributor, as the filters endpoint returns it. */
export interface ReportingDistributor {
  id: string
  name: string
  orgCode: string | null
  isActive: boolean
}

/** MYT calendar date of an instant — the bucket a Malaysian 00:30 order belongs to. */
export function mytDate(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10)
}

// ── Records as the fallback queries return them ────────────────────────────

/** Narrow all-history order projection: no items, no joins, four columns. */
export interface OrderRecord {
  id: string
  buyer_org_id: string | null
  created_at: string | null
  status: string | null
  order_no?: string | null
  display_doc_no?: string | null
}

/** An order item joined to its order, as the windowed fallback query returns it. */
export interface OrderItemRecord {
  order_id: string
  variant_id: string | null
  product_id: string | null
  qty: number | null
  line_total: number | null
  unit_price?: number | null
}

export interface DistributorRecord {
  id: string
  org_name: string | null
  org_code?: string | null
  is_active?: boolean | null
}

export interface VariantLabelRecord {
  id: string
  product_id: string | null
  variant_name: string | null
  product_code: string | null
  productName?: string | null
}

/** Line value, preferring the generated `line_total` and falling back to qty × price. */
function lineValue(row: OrderItemRecord): number {
  const total = Number(row.line_total)
  if (Number.isFinite(total) && total !== 0) return total
  const qty = Number(row.qty) || 0
  const price = Number(row.unit_price) || 0
  return qty * price
}

// ── Pure aggregation (fallback + regression tests) ──────────────────────────

/**
 * Fold orders, order items and master data into the shape the RPC returns.
 *
 * `orders` must be the distributor's ALL-HISTORY eligible population already
 * restricted to the report's order type, buyer scope and status scope — the
 * lifetime first/last order dates that decide New and Dormant come from it.
 * `items` covers only the report window and its comparison window; which
 * window a row belongs to is decided from its order's `created_at`.
 */
export function aggregateDistributorOrders(
  orders: OrderRecord[],
  items: OrderItemRecord[],
  distributors: DistributorRecord[],
  variants: VariantLabelRecord[],
  month: string,
  now: Date = new Date(),
  period: DistributorReportPeriod = resolveDistributorReportPeriod(month, now),
  distributorId: string = ALL_DISTRIBUTORS,
  status: string = ALL_STATUS,
): DistributorAnalyticsAggregate {
  const { startUtc, endUtc, comparisonStartUtc, comparisonEndUtc } = period

  const valueByOrder = new Map<string, number>()
  const itemCountByOrder = new Map<string, number>()
  for (const item of items) {
    valueByOrder.set(item.order_id, (valueByOrder.get(item.order_id) ?? 0) + lineValue(item))
    itemCountByOrder.set(item.order_id, (itemCountByOrder.get(item.order_id) ?? 0) + 1)
  }

  const nameById = new Map(distributors.map((row) => [row.id, row]))

  interface Bucket {
    currentOrders: number
    currentValue: number
    previousOrders: number
    previousValue: number
    firstOrderAt: string | null
    lastOrderAt: string | null
    lifetimeOrders: number
  }
  const buckets = new Map<string, Bucket>()
  const bucketFor = (id: string): Bucket => {
    let bucket = buckets.get(id)
    if (!bucket) {
      bucket = {
        currentOrders: 0, currentValue: 0, previousOrders: 0, previousValue: 0,
        firstOrderAt: null, lastOrderAt: null, lifetimeOrders: 0,
      }
      buckets.set(id, bucket)
    }
    return bucket
  }

  const dayTotals = new Map<string, { orders: number; orderValue: number }>()
  const statusTotals = new Map<string, StatusTotals>()
  const currentOrderIds = new Set<string>()
  const recent: OrderRecordTotals[] = []

  let currentOrders = 0
  let currentValue = 0
  let previousOrders = 0
  let previousValue = 0

  for (const order of orders) {
    const createdAt = order.created_at
    const buyerId = order.buyer_org_id
    if (!createdAt || !buyerId) continue

    const bucket = bucketFor(buyerId)
    bucket.lifetimeOrders += 1
    if (bucket.firstOrderAt === null || createdAt < bucket.firstOrderAt) bucket.firstOrderAt = createdAt
    if (bucket.lastOrderAt === null || createdAt > bucket.lastOrderAt) bucket.lastOrderAt = createdAt

    const value = valueByOrder.get(order.id) ?? 0
    // Half-open windows: an order stamped exactly at the next month's boundary
    // belongs to that month, never to both.
    const inCurrent = createdAt >= startUtc && createdAt < endUtc
    const inPrevious = createdAt >= comparisonStartUtc && createdAt < comparisonEndUtc

    if (inCurrent) {
      bucket.currentOrders += 1
      bucket.currentValue += value
      currentOrders += 1
      currentValue += value
      currentOrderIds.add(order.id)

      const day = mytDate(createdAt)
      const dayBucket = dayTotals.get(day) ?? { orders: 0, orderValue: 0 }
      dayBucket.orders += 1
      dayBucket.orderValue += value
      dayTotals.set(day, dayBucket)

      const statusKey = order.status || 'unknown'
      const statusBucket = statusTotals.get(statusKey) ?? { status: statusKey, orders: 0, orderValue: 0 }
      statusBucket.orders += 1
      statusBucket.orderValue += value
      statusTotals.set(statusKey, statusBucket)

      recent.push({
        orderId: order.id,
        orderNo: order.display_doc_no || order.order_no || null,
        createdAt,
        status: statusKey,
        distributorId: buyerId,
        distributorName: (nameById.get(buyerId)?.org_name || '').trim() || 'Unknown distributor',
        orderValue: value,
        itemCount: itemCountByOrder.get(order.id) ?? 0,
      })
    }
    if (inPrevious) {
      bucket.previousOrders += 1
      bucket.previousValue += value
      previousOrders += 1
      previousValue += value
    }
  }

  // ── Top products, from the CURRENT window only ──────────────────────────
  const variantById = new Map(variants.map((row) => [row.id, row]))
  const productTotals = new Map<string, ProductTotals>()
  for (const item of items) {
    if (!currentOrderIds.has(item.order_id)) continue
    const key = item.variant_id || `product:${item.product_id ?? 'unknown'}`
    const variant = item.variant_id ? variantById.get(item.variant_id) : undefined
    const entry = productTotals.get(key) ?? {
      variantId: item.variant_id,
      productId: item.product_id ?? variant?.product_id ?? null,
      productName: variant?.productName ?? null,
      variantName: variant?.variant_name ?? null,
      productCode: variant?.product_code ?? null,
      units: 0,
      orderValue: 0,
    }
    entry.units += Number(item.qty) || 0
    entry.orderValue += lineValue(item)
    productTotals.set(key, entry)
  }

  // ── Distributor rows ────────────────────────────────────────────────────
  const distributorRows: DistributorAggregate[] = [...buckets.entries()].map(([id, bucket]) => {
    const org = nameById.get(id)
    return {
      distributorId: id,
      name: (org?.org_name || '').trim() || 'Unknown distributor',
      orgCode: org?.org_code ?? null,
      isActive: org?.is_active !== false,
      currentOrders: bucket.currentOrders,
      currentValue: bucket.currentValue,
      previousOrders: bucket.previousOrders,
      previousValue: bucket.previousValue,
      firstOrderAt: bucket.firstOrderAt,
      lastOrderAt: bucket.lastOrderAt,
      lifetimeOrders: bucket.lifetimeOrders,
    }
  })

  const activeDistributors = distributorRows.filter((row) => row.currentOrders > 0).length
  const previousActive = distributorRows.filter((row) => row.previousOrders > 0).length

  // Every day of the report window is present, including days with no trading,
  // and no day beyond it — the running month stops at today.
  const dailyTrend = Array.from({ length: period.dayCount }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`
    const bucket = dayTotals.get(date)
    return { date, orders: bucket?.orders ?? 0, orderValue: bucket?.orderValue ?? 0 }
  })

  const scopeName = distributorId === ALL_DISTRIBUTORS
    ? ALL_DISTRIBUTORS_LABEL
    : (nameById.get(distributorId)?.org_name || '').trim() || 'Unknown distributor'

  return {
    month,
    distributorId,
    distributorName: scopeName,
    status,
    current: { orders: currentOrders, orderValue: currentValue, activeDistributors },
    previous: { orders: previousOrders, orderValue: previousValue, activeDistributors: previousActive },
    dailyTrend,
    distributors: distributorRows,
    statusBreakdown: [...statusTotals.values()],
    topProducts: [...productTotals.values()],
    recentOrders: recent
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20),
  }
}

// ── Query helpers ──────────────────────────────────────────────────────────

async function readPages<T>(
  build: (from: number, to: number) => any,
  budget: { remaining: number },
  label: string,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data || []) as T[]
    rows.push(...page)
    budget.remaining -= page.length
    if (budget.remaining < 0) {
      throw new Error(
        `Distributor Analytics fallback exceeded its row budget while reading ${label}. Apply migration `
        + '20260908130000_distributor_analytics_monthly_report.sql so the report is aggregated in the database.',
      )
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Selectable distributors from canonical master data.
 *
 * Every DIST organisation is offered, active or not: a distributor that has
 * been deactivated still has trading history the report must be able to open.
 */
export async function fetchReportingDistributors(supabase: any): Promise<ReportingDistributor[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, org_name, org_code, is_active')
    .eq('org_type_code', DISTRIBUTOR_ORG_TYPE)
    .order('org_name', { ascending: true })
  if (error) throw error
  return ((data || []) as any[]).map((row) => ({
    id: row.id,
    name: (row.org_name || '').trim() || 'Unknown distributor',
    orgCode: row.org_code ?? null,
    isActive: row.is_active !== false,
  }))
}

/** Reporting months that hold eligible distributor order activity, newest first. */
export async function fetchDistributorOrderPeriods(supabase: any): Promise<ReportingPeriod[]> {
  const { data, error } = await supabase.rpc('reporting_distributor_order_periods')
  if (!error) {
    return ((data || []) as any[])
      .map((row) => reportingPeriodFromKey(String(row.period_key), Number(row.transaction_count) || 0))
      .filter((period): period is ReportingPeriod => period !== null)
      .sort((a, b) => b.key.localeCompare(a.key))
  }
  if (!isMissingDistributorPeriodsRpc(error)) throw error

  const months = new Map<string, number>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from('orders')
      .select('created_at')
      .eq('order_type', ELIGIBLE_ORDER_TYPE)
      .not('created_at', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (pageError) throw pageError
    const rows = (page || []) as { created_at: string }[]
    for (const row of rows) {
      const key = mytDate(row.created_at).slice(0, 7)
      months.set(key, (months.get(key) ?? 0) + 1)
    }
    if (rows.length < PAGE_SIZE || from > 50_000) break
  }

  return [...months.entries()]
    .map(([key, count]) => reportingPeriodFromKey(key, count)!)
    .filter(Boolean)
    .sort((a, b) => b.key.localeCompare(a.key))
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function fetchDistributorAnalyticsAggregate(
  supabase: any,
  month: string,
  distributorId: string = ALL_DISTRIBUTORS,
  status: string = ALL_STATUS,
  now: Date = new Date(),
): Promise<DistributorAnalyticsSourceResult> {
  const period = resolveDistributorReportPeriod(month, now)
  const isAllDistributors = distributorId === ALL_DISTRIBUTORS
  const isAllStatus = status === ALL_STATUS

  const { data, error } = await supabase.rpc('reporting_distributor_analytics', {
    p_month: month,
    p_distributor_id: isAllDistributors ? null : distributorId,
    p_status: isAllStatus ? null : status,
  })
  if (!error) {
    return {
      aggregate: normalizeAggregate(data, month, period, distributorId, status),
      source: 'rpc',
      degraded: false,
      notice: null,
    }
  }
  if (!isMissingDistributorAnalyticsRpc(error)) throw error

  if (period.dayCount === 0) {
    return {
      aggregate: emptyAggregate(month, period, distributorId, ALL_DISTRIBUTORS_LABEL, status),
      source: 'fallback',
      degraded: true,
      notice: 'The selected reporting month has not started yet.',
    }
  }

  // Distributor organisations are resolved first so the order scans can filter
  // on stable ids. This is what keeps "buyer must be a distributor" a single
  // indexed `IN`, rather than a post-filter over every order in the database.
  const allDistributors = await fetchReportingDistributors(supabase)
  const scopedDistributors = isAllDistributors
    ? allDistributors
    : allDistributors.filter((row) => row.id === distributorId)

  if (scopedDistributors.length === 0) {
    return {
      aggregate: emptyAggregate(month, period, distributorId, ALL_DISTRIBUTORS_LABEL, status),
      source: 'fallback',
      degraded: true,
      notice: 'No distributor organisations are visible for the selected scope.',
    }
  }

  const distributorIds = scopedDistributors.map((row) => row.id)
  const budget = { remaining: MAX_FALLBACK_ROWS }

  const withScope = (query: any) => {
    let scoped = query
      .eq('order_type', ELIGIBLE_ORDER_TYPE)
      .in('buyer_org_id', distributorIds)
    if (!isAllStatus) scoped = scoped.eq('status', status)
    return scoped
  }

  const [orders, items] = await Promise.all([
    // All-history, narrow projection. "First ever order" and dormancy cannot be
    // decided from the report window, so this read is unavoidable without the
    // RPC — it carries no joins and no order lines.
    readPages<OrderRecord>(
      (from, to) => withScope(
        supabase
          .from('orders')
          .select('id, buyer_org_id, created_at, status, order_no, display_doc_no'),
      )
        .not('created_at', 'is', null)
        .order('created_at', { ascending: true })
        .range(from, to),
      budget,
      'orders',
    ),
    // The report window and its comparison window are adjacent, so one range
    // covering both is a single scan rather than two.
    readPages<OrderItemRecord>(
      (from, to) => {
        let query = supabase
          .from('order_items')
          .select('order_id, variant_id, product_id, qty, unit_price, line_total, orders!inner(created_at, order_type, buyer_org_id, status)')
          .eq('orders.order_type', ELIGIBLE_ORDER_TYPE)
          .in('orders.buyer_org_id', distributorIds)
          .gte('orders.created_at', period.comparisonStartUtc)
          .lt('orders.created_at', period.endUtc)
        if (!isAllStatus) query = query.eq('orders.status', status)
        return query.order('id', { ascending: true }).range(from, to)
      },
      budget,
      'order items',
    ),
  ])

  // Product labels are resolved for the ranked variants only — one `.in()`
  // query over at most LABEL_LOOKUP_LIMIT ids, never one lookup per line.
  const variants = await fetchVariantLabels(supabase, items, orders, period)

  return {
    aggregate: aggregateDistributorOrders(
      orders, items, scopedDistributors.map((row) => ({
        id: row.id, org_name: row.name, org_code: row.orgCode, is_active: row.isActive,
      })),
      variants, month, now, period, distributorId, status,
    ),
    source: 'fallback',
    degraded: true,
    notice:
      'Reporting function not installed yet — figures were aggregated on the server. Apply migration '
      + '20260908130000_distributor_analytics_monthly_report.sql to aggregate the report in the database.',
  }
}

/** Resolve product identity for the highest-value variants in the report window. */
async function fetchVariantLabels(
  supabase: any,
  items: OrderItemRecord[],
  orders: OrderRecord[],
  period: DistributorReportPeriod,
): Promise<VariantLabelRecord[]> {
  const inWindow = new Set(
    orders
      .filter((order) => order.created_at
        && order.created_at >= period.startUtc
        && order.created_at < period.endUtc)
      .map((order) => order.id),
  )

  const valueByVariant = new Map<string, number>()
  for (const item of items) {
    if (!item.variant_id || !inWindow.has(item.order_id)) continue
    valueByVariant.set(item.variant_id, (valueByVariant.get(item.variant_id) ?? 0) + lineValue(item))
  }
  const ids = [...valueByVariant.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LABEL_LOOKUP_LIMIT)
    .map(([id]) => id)
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, product_id, variant_name, product_code, products(product_name)')
    .in('id', ids)
  if (error) throw error

  return ((data || []) as any[]).map((row) => {
    // PostgREST resolves an embedded relation as an object or a single-element array.
    const embedded = Array.isArray(row.products) ? row.products[0] : row.products
    return {
      id: row.id,
      product_id: row.product_id ?? null,
      variant_name: row.variant_name ?? null,
      product_code: row.product_code ?? null,
      productName: embedded?.product_name ?? null,
    }
  })
}

/** Coerce the RPC's JSON (bigint counts arrive as numbers, arrays may be null). */
function normalizeAggregate(
  payload: any,
  month: string,
  period: DistributorReportPeriod,
  distributorId: string = ALL_DISTRIBUTORS,
  status: string = ALL_STATUS,
): DistributorAnalyticsAggregate {
  const totals = (value: any) => ({
    orders: Number(value?.orders) || 0,
    orderValue: Number(value?.orderValue) || 0,
    activeDistributors: Number(value?.activeDistributors) || 0,
  })

  return {
    month: payload?.month || month,
    distributorId: payload?.distributorId || distributorId,
    distributorName: payload?.distributorName
      || (distributorId === ALL_DISTRIBUTORS ? ALL_DISTRIBUTORS_LABEL : 'Unknown distributor'),
    status: payload?.status || status,
    current: totals(payload?.current),
    previous: totals(payload?.previous),
    dailyTrend: (payload?.dailyTrend || []).map((row: any) => ({
      date: String(row.date),
      orders: Number(row.orders) || 0,
      orderValue: Number(row.orderValue) || 0,
    })),
    distributors: (payload?.distributors || []).map((row: any): DistributorAggregate => ({
      distributorId: String(row.distributorId),
      name: row.name ?? 'Unknown distributor',
      orgCode: row.orgCode ?? null,
      isActive: row.isActive !== false,
      currentOrders: Number(row.currentOrders) || 0,
      currentValue: Number(row.currentValue) || 0,
      previousOrders: Number(row.previousOrders) || 0,
      previousValue: Number(row.previousValue) || 0,
      firstOrderAt: row.firstOrderAt ?? null,
      lastOrderAt: row.lastOrderAt ?? null,
      lifetimeOrders: Number(row.lifetimeOrders) || 0,
    })),
    statusBreakdown: (payload?.statusBreakdown || []).map((row: any): StatusTotals => ({
      status: String(row.status ?? 'unknown'),
      orders: Number(row.orders) || 0,
      orderValue: Number(row.orderValue) || 0,
    })),
    topProducts: (payload?.topProducts || []).map((row: any): ProductTotals => ({
      variantId: row.variantId ?? null,
      productId: row.productId ?? null,
      productName: row.productName ?? null,
      variantName: row.variantName ?? null,
      productCode: row.productCode ?? null,
      units: Number(row.units) || 0,
      orderValue: Number(row.orderValue) || 0,
    })),
    recentOrders: (payload?.recentOrders || []).map((row: any): OrderRecordTotals => ({
      orderId: String(row.orderId),
      orderNo: row.orderNo ?? null,
      createdAt: String(row.createdAt),
      status: String(row.status ?? 'unknown'),
      distributorId: String(row.distributorId),
      distributorName: row.distributorName ?? 'Unknown distributor',
      orderValue: Number(row.orderValue) || 0,
      itemCount: Number(row.itemCount) || 0,
    })),
  }
}

export { REPORTING_TIME_ZONE, resolveDistributorReportPeriod }
