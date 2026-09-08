/**
 * Data source for the monthly Product Analytics report.
 *
 * Primary path is the `reporting_product_analytics` RPC, which aggregates the
 * whole report inside the database and returns a few KB of JSON regardless of
 * how many order items the month contains.
 *
 * The fallback mirrors `consumer-analytics-source.ts`: when application code
 * reaches a database whose migration / schema cache is behind, the aggregation
 * still runs SERVER-SIDE so the browser only ever receives the compact report.
 * It is deliberately different from the browser-side model it replaces:
 *
 *   - order items are read in ONE paged join filtered on the embedded order
 *     (`orders!inner`), never by batching order ids from the client;
 *   - only the selected window and its comparison window are read, never a
 *     rolling twelve months;
 *   - catalogue and inventory are read once, never per product.
 *
 * The fallback is a bridge for environments where the reporting migration has
 * not been applied yet; it is bounded and reports itself as degraded.
 */

import {
  ALL_CATEGORIES,
  ALL_CATEGORIES_LABEL,
  ELIGIBLE_ORDER_STATUSES,
  emptyAggregate,
  resolveProductReportPeriod,
  type CategoryTotals,
  type ProductAnalyticsAggregate,
  type ProductReportPeriod,
  type VariantAggregate,
} from './product-analytics'
import { reportingPeriodFromKey, REPORTING_TIME_ZONE, type ReportingPeriod } from './reporting-period'

const PAGE_SIZE = 1000
/** Hard ceiling for the degraded fallback. Beyond this the migration is required. */
export const MAX_FALLBACK_ROWS = 200_000

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000

export interface ProductAnalyticsSourceResult {
  aggregate: ProductAnalyticsAggregate
  source: 'rpc' | 'fallback'
  degraded: boolean
  notice: string | null
}

export function isMissingProductAnalyticsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_product_analytics') && message.includes('schema cache'))
}

export function isMissingProductPeriodsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_product_order_periods') && message.includes('schema cache'))
}

/** One selectable Product Category, as the filters endpoint returns it. */
export interface ReportingCategory {
  id: string
  name: string
}

/** MYT calendar date of an instant — the bucket a Malaysian 00:30 order belongs to. */
export function mytDate(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10)
}

// ── Pure aggregation (fallback + regression tests) ──────────────────────────

/** An order item joined to its order, as the fallback query returns it. */
export interface OrderItemRecord {
  variant_id: string | null
  product_id: string | null
  qty: number | null
  line_total: number | null
  unit_price?: number | null
  /** PostgREST embed — resolved in the same request, never an N+1 lookup. */
  orders?: { created_at: string | null; status: string | null }
    | Array<{ created_at: string | null; status: string | null }>
    | null
}

export interface CatalogueRecord {
  id: string
  product_id: string | null
  variant_name: string | null
  product_code: string | null
  is_active: boolean | null
  productName?: string | null
  /** Canonical `products.category_id` of the parent product. */
  categoryId?: string | null
  categoryName?: string | null
}

export interface InventoryRecord {
  variant_id: string
  quantity_on_hand: number | null
  quantity_available: number | null
  reorder_point: number | null
  safety_stock: number | null
  total_value: number | null
  updated_at?: string | null
}

function orderOf(row: OrderItemRecord): { created_at: string | null; status: string | null } | null {
  const order = row.orders
  if (!order) return null
  return Array.isArray(order) ? order[0] ?? null : order
}

/** Line value, preferring the generated `line_total` and falling back to qty × price. */
function lineValue(row: OrderItemRecord): number {
  const total = Number(row.line_total)
  if (Number.isFinite(total) && total !== 0) return total
  const qty = Number(row.qty) || 0
  const price = Number(row.unit_price) || 0
  return qty * price
}

/**
 * Fold order items, catalogue and inventory into the same shape the RPC returns.
 *
 * `items` must already be restricted to eligible statuses and to the union of
 * the report window and its comparison window; which window a row belongs to is
 * decided here from `orders.created_at`, bucketed in Asia/Kuala_Lumpur.
 */
export function aggregateProductOrders(
  items: OrderItemRecord[],
  catalogue: CatalogueRecord[],
  inventory: InventoryRecord[],
  month: string,
  now: Date = new Date(),
  period: ProductReportPeriod = resolveProductReportPeriod(month, now),
  categoryId: string = ALL_CATEGORIES,
): ProductAnalyticsAggregate {
  const currentStart = period.startUtc
  const currentEnd = period.endUtc
  const comparisonStart = period.comparisonStartUtc
  const comparisonEnd = period.comparisonEndUtc

  const isAllCategories = categoryId === ALL_CATEGORIES
  const catalogueById = new Map(catalogue.map((row) => [row.id, row]))
  const categoryOf = (variantId: string): string | null => catalogueById.get(variantId)?.categoryId ?? null

  /**
   * Category scope test, applied to every variant before it contributes to any
   * total. A variant whose product (and therefore category) cannot be resolved
   * is counted in the consolidated report but is deliberately excluded from
   * every specific-category filter — it is never silently assigned to one.
   */
  const inScope = (variantId: string): boolean =>
    isAllCategories || categoryOf(variantId) === categoryId

  const categoryName = isAllCategories
    ? ALL_CATEGORIES_LABEL
    : catalogue.find((row) => row.categoryId === categoryId)?.categoryName || 'Unknown category'

  const daily = new Map<string, { units: number; orderValue: number }>()
  const currentByVariant = new Map<string, { units: number; value: number }>()
  const previousByVariant = new Map<string, { units: number; value: number }>()
  const lastOrdered = new Map<string, string>()

  let currentUnits = 0
  let currentValue = 0
  let previousUnits = 0
  let previousValue = 0
  const currentSkus = new Set<string>()
  const previousSkus = new Set<string>()

  // Per-category totals feed Category Performance; they are accumulated across
  // EVERY category regardless of the selected scope, and only surfaced on the
  // consolidated report.
  const categoryTotals = new Map<string, {
    name: string
    currentUnits: number; currentValue: number; currentSkus: Set<string>
    previousUnits: number; previousValue: number; previousSkus: Set<string>
  }>()
  const categoryBucket = (id: string, name: string) => {
    const existing = categoryTotals.get(id)
    if (existing) return existing
    const created = {
      name,
      currentUnits: 0, currentValue: 0, currentSkus: new Set<string>(),
      previousUnits: 0, previousValue: 0, previousSkus: new Set<string>(),
    }
    categoryTotals.set(id, created)
    return created
  }

  for (const row of items) {
    const order = orderOf(row)
    const createdAt = order?.created_at
    const status = order?.status
    if (!createdAt || !status) continue
    if (!(ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(status)) continue
    const variantId = row.variant_id
    if (!variantId) continue

    const units = Number(row.qty) || 0
    const value = lineValue(row)
    const inCurrent = createdAt >= currentStart && createdAt < currentEnd
    const inPrevious = createdAt >= comparisonStart && createdAt < comparisonEnd
    if (!inCurrent && !inPrevious) continue

    const master = catalogueById.get(variantId)
    const rowCategoryId = master?.categoryId ?? null
    if (rowCategoryId) {
      const bucket = categoryBucket(rowCategoryId, master?.categoryName || 'Uncategorised')
      if (inCurrent) {
        bucket.currentUnits += units
        bucket.currentValue += value
        bucket.currentSkus.add(variantId)
      } else {
        bucket.previousUnits += units
        bucket.previousValue += value
        bucket.previousSkus.add(variantId)
      }
    }

    // Everything below this line is scoped to the selected category.
    if (!inScope(variantId)) continue

    const seen = lastOrdered.get(variantId)
    if (!seen || createdAt > seen) lastOrdered.set(variantId, createdAt)

    if (inCurrent) {
      currentUnits += units
      currentValue += value
      currentSkus.add(variantId)

      const bucket = currentByVariant.get(variantId) ?? { units: 0, value: 0 }
      bucket.units += units
      bucket.value += value
      currentByVariant.set(variantId, bucket)

      const date = mytDate(createdAt)
      const day = daily.get(date) ?? { units: 0, orderValue: 0 }
      day.units += units
      day.orderValue += value
      daily.set(date, day)
    } else {
      previousUnits += units
      previousValue += value
      previousSkus.add(variantId)

      const bucket = previousByVariant.get(variantId) ?? { units: 0, value: 0 }
      bucket.units += units
      bucket.value += value
      previousByVariant.set(variantId, bucket)
    }
  }

  const inventoryByVariant = new Map<string, {
    onHand: number; available: number; reorderPoint: number; safetyStock: number; value: number
  }>()
  let inventoryAsOf: string | null = null
  for (const row of inventory) {
    if (!row.variant_id) continue
    // The snapshot stays CURRENT, but it is scoped to the selected category.
    if (!inScope(row.variant_id)) continue
    const entry = inventoryByVariant.get(row.variant_id)
      ?? { onHand: 0, available: 0, reorderPoint: 0, safetyStock: 0, value: 0 }
    entry.onHand += Number(row.quantity_on_hand) || 0
    entry.available += Number(row.quantity_available) || 0
    // Reorder point and safety stock are per stocking location; the highest is
    // the level the network as a whole must not fall below.
    entry.reorderPoint = Math.max(entry.reorderPoint, Number(row.reorder_point) || 0)
    entry.safetyStock = Math.max(entry.safetyStock, Number(row.safety_stock) || 0)
    entry.value += Number(row.total_value) || 0
    inventoryByVariant.set(row.variant_id, entry)
    if (row.updated_at && (!inventoryAsOf || row.updated_at > inventoryAsOf)) inventoryAsOf = row.updated_at
  }

  // Every variant that traded in either window, or that currently holds stock,
  // or that is active master data — the union the management views need, all
  // restricted to the selected category scope.
  const activeInScope = catalogue.filter((row) => row.is_active !== false && inScope(row.id))
  const variantIds = new Set<string>([
    ...currentByVariant.keys(),
    ...previousByVariant.keys(),
    ...inventoryByVariant.keys(),
    ...activeInScope.map((row) => row.id),
  ])

  const variants: VariantAggregate[] = [...variantIds].map((variantId) => {
    const master = catalogueById.get(variantId)
    const current = currentByVariant.get(variantId) ?? { units: 0, value: 0 }
    const previous = previousByVariant.get(variantId) ?? { units: 0, value: 0 }
    const stock = inventoryByVariant.get(variantId)
      ?? { onHand: 0, available: 0, reorderPoint: 0, safetyStock: 0, value: 0 }
    return {
      variantId,
      productId: master?.product_id ?? null,
      categoryId: master?.categoryId ?? null,
      categoryName: master?.categoryName ?? null,
      productName: master?.productName ?? null,
      variantName: master?.variant_name ?? null,
      productCode: master?.product_code ?? null,
      isActive: master?.is_active !== false,
      currentUnits: current.units,
      currentValue: current.value,
      previousUnits: previous.units,
      previousValue: previous.value,
      stockOnHand: stock.onHand,
      stockAvailable: stock.available,
      reorderPoint: stock.reorderPoint,
      safetyStock: stock.safetyStock,
      stockValue: stock.value,
      lastOrderedAt: lastOrdered.get(variantId) ?? null,
    }
  })

  // Active SKUs by category, used both as the scoped denominator and by the
  // Category Performance rows.
  const activeByCategory = new Map<string, number>()
  for (const row of catalogue) {
    if (row.is_active === false || !row.categoryId) continue
    activeByCategory.set(row.categoryId, (activeByCategory.get(row.categoryId) ?? 0) + 1)
  }

  const categories: CategoryTotals[] = [...categoryTotals.entries()].map(([id, bucket]) => ({
    categoryId: id,
    categoryName: bucket.name,
    currentUnits: bucket.currentUnits,
    currentValue: bucket.currentValue,
    currentSkus: bucket.currentSkus.size,
    previousUnits: bucket.previousUnits,
    previousValue: bucket.previousValue,
    previousSkus: bucket.previousSkus.size,
    activeSkus: activeByCategory.get(id) ?? 0,
  }))

  return {
    month,
    categoryId,
    categoryName,
    current: { units: currentUnits, orderValue: currentValue, skus: currentSkus.size, orders: 0 },
    previous: { units: previousUnits, orderValue: previousValue, skus: previousSkus.size, orders: 0 },
    // Denominator follows the scope: "6 of 18 active Vape SKUs".
    activeSkus: activeInScope.length,
    // Exactly `dayCount` rows: for the running month that stops at today, so
    // days that have not happened never appear as zero activity.
    dailyTrend: Array.from({ length: period.dayCount }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      const entry = daily.get(date)
      return { date, units: entry?.units ?? 0, orderValue: entry?.orderValue ?? 0 }
    }),
    variants,
    inventory: {
      totalValue: [...inventoryByVariant.values()].reduce((sum, entry) => sum + entry.value, 0),
      totalOnHand: [...inventoryByVariant.values()].reduce((sum, entry) => sum + entry.onHand, 0),
      variantCount: inventoryByVariant.size,
      asOf: inventoryAsOf,
    },
    categories,
  }
}

// ── Supabase access ────────────────────────────────────────────────────────

/** Reporting months that contain eligible product order activity. */
export async function fetchProductOrderPeriods(supabase: any): Promise<ReportingPeriod[]> {
  const { data, error } = await supabase.rpc('reporting_product_order_periods')
  if (!error) {
    return ((data || []) as { period_key: string; transaction_count: number | string }[])
      .map((row) => reportingPeriodFromKey(row.period_key, Number(row.transaction_count) || 0))
      .filter((period): period is ReportingPeriod => Boolean(period))
  }
  if (!isMissingProductPeriodsRpc(error)) throw error

  // Degraded discovery: read only the order timestamps, never the items, and
  // derive the distinct MYT months locally.
  const months = new Map<string, number>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from('orders')
      .select('created_at')
      .in('status', ELIGIBLE_ORDER_STATUSES as unknown as string[])
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
        `Product Analytics fallback exceeded its row budget while reading ${label}. Apply migration `
        + '20260907120000_product_analytics_monthly_report.sql so the report is aggregated in the database.',
      )
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Active, selectable Product Categories from canonical master data.
 *
 * Mirrors the query every other category dropdown in the app uses
 * (`is_active = true`, ordered by name), and `product_categories` RLS already
 * limits non-admins to active rows. Categories management has retired are
 * therefore never offered.
 */
export async function fetchReportingCategories(supabase: any): Promise<ReportingCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, category_name')
    .eq('is_active', true)
    .order('category_name', { ascending: true })
  if (error) throw error
  return ((data || []) as any[]).map((row) => ({ id: row.id, name: row.category_name }))
}

export async function fetchProductAnalyticsAggregate(
  supabase: any,
  month: string,
  categoryId: string = ALL_CATEGORIES,
  now: Date = new Date(),
): Promise<ProductAnalyticsSourceResult> {
  const period = resolveProductReportPeriod(month, now)
  const isAllCategories = categoryId === ALL_CATEGORIES

  const { data, error } = await supabase.rpc('reporting_product_analytics', {
    p_month: month,
    p_category_id: isAllCategories ? null : categoryId,
  })
  if (!error) {
    return { aggregate: normalizeAggregate(data, month, period, categoryId), source: 'rpc', degraded: false, notice: null }
  }
  if (!isMissingProductAnalyticsRpc(error)) throw error

  if (period.dayCount === 0) {
    return {
      aggregate: emptyAggregate(month, period, categoryId),
      source: 'fallback',
      degraded: true,
      notice: 'The selected reporting month has not started yet.',
    }
  }

  const budget = { remaining: MAX_FALLBACK_ROWS }
  const statuses = ELIGIBLE_ORDER_STATUSES as unknown as string[]

  // The report window and its comparison window are adjacent, so one range
  // covering both is a single scan rather than two.
  const [items, variants, products, inventory] = await Promise.all([
    readPages<OrderItemRecord>(
      (from, to) => supabase
        .from('order_items')
        .select('variant_id, product_id, qty, unit_price, line_total, orders!inner(created_at, status)')
        .in('orders.status', statuses)
        .gte('orders.created_at', period.comparisonStartUtc)
        .lt('orders.created_at', period.endUtc)
        .order('id', { ascending: true })
        .range(from, to),
      budget,
      'order items',
    ),
    readPages<any>(
      (from, to) => supabase
        .from('product_variants')
        .select('id, product_id, variant_name, product_code, is_active')
        .range(from, to),
      budget,
      'product variants',
    ),
    readPages<any>(
      // `products.category_id` is the canonical category assignment; the
      // category is never inferred from product, variant or brand names.
      (from, to) => supabase
        .from('products')
        .select('id, product_name, category_id, product_categories(category_name)')
        .range(from, to),
      budget,
      'products',
    ),
    readPages<InventoryRecord>(
      (from, to) => supabase
        .from('product_inventory')
        .select('variant_id, quantity_on_hand, quantity_available, reorder_point, safety_stock, total_value, updated_at')
        .range(from, to),
      budget,
      'inventory',
    ),
  ])

  const productById = new Map(((products || []) as any[]).map((row) => {
    // PostgREST resolves an embedded relation as an object or a single-element array.
    const embedded = Array.isArray(row.product_categories) ? row.product_categories[0] : row.product_categories
    return [row.id, {
      name: row.product_name as string | null,
      categoryId: (row.category_id ?? null) as string | null,
      categoryName: (embedded?.category_name ?? null) as string | null,
    }]
  }))
  const catalogue: CatalogueRecord[] = ((variants || []) as any[]).map((row) => {
    const product = row.product_id ? productById.get(row.product_id) : undefined
    return {
      id: row.id,
      product_id: row.product_id,
      variant_name: row.variant_name,
      product_code: row.product_code,
      is_active: row.is_active,
      productName: product?.name ?? null,
      categoryId: product?.categoryId ?? null,
      categoryName: product?.categoryName ?? null,
    }
  })

  return {
    aggregate: aggregateProductOrders(items, catalogue, inventory, month, now, period, categoryId),
    source: 'fallback',
    degraded: true,
    notice:
      'Reporting function not installed yet — figures were aggregated on the server from the selected month and its '
      + 'comparison period. "Last order" reflects that window only, until migration '
      + '20260907120000_product_analytics_monthly_report.sql is applied.',
  }
}

/** Coerce the RPC's JSON (bigint counts arrive as numbers, arrays may be null). */
function normalizeAggregate(
  payload: any,
  month: string,
  period: ProductReportPeriod,
  categoryId: string = ALL_CATEGORIES,
): ProductAnalyticsAggregate {
  const totals = (value: any) => ({
    units: Number(value?.units) || 0,
    orderValue: Number(value?.orderValue) || 0,
    skus: Number(value?.skus) || 0,
    orders: Number(value?.orders) || 0,
  })

  return {
    month: payload?.month || month,
    categoryId: payload?.categoryId || categoryId,
    categoryName: payload?.categoryName || (categoryId === ALL_CATEGORIES ? ALL_CATEGORIES_LABEL : 'Unknown category'),
    current: totals(payload?.current),
    previous: totals(payload?.previous),
    activeSkus: Number(payload?.activeSkus) || 0,
    dailyTrend: (payload?.dailyTrend || []).map((row: any) => ({
      date: String(row.date),
      units: Number(row.units) || 0,
      orderValue: Number(row.orderValue) || 0,
    })),
    variants: (payload?.variants || []).map((row: any): VariantAggregate => ({
      variantId: String(row.variantId),
      productId: row.productId ?? null,
      categoryId: row.categoryId ?? null,
      categoryName: row.categoryName ?? null,
      productName: row.productName ?? null,
      variantName: row.variantName ?? null,
      productCode: row.productCode ?? null,
      isActive: row.isActive !== false,
      currentUnits: Number(row.currentUnits) || 0,
      currentValue: Number(row.currentValue) || 0,
      previousUnits: Number(row.previousUnits) || 0,
      previousValue: Number(row.previousValue) || 0,
      stockOnHand: Number(row.stockOnHand) || 0,
      stockAvailable: Number(row.stockAvailable) || 0,
      reorderPoint: Number(row.reorderPoint) || 0,
      safetyStock: Number(row.safetyStock) || 0,
      stockValue: Number(row.stockValue) || 0,
      lastOrderedAt: row.lastOrderedAt ?? null,
    })),
    inventory: {
      totalValue: Number(payload?.inventory?.totalValue) || 0,
      totalOnHand: Number(payload?.inventory?.totalOnHand) || 0,
      variantCount: Number(payload?.inventory?.variantCount) || 0,
      asOf: payload?.inventory?.asOf ?? null,
    },
    categories: (payload?.categories || []).map((row: any): CategoryTotals => ({
      categoryId: String(row.categoryId),
      categoryName: row.categoryName ?? 'Uncategorised',
      currentUnits: Number(row.currentUnits) || 0,
      currentValue: Number(row.currentValue) || 0,
      currentSkus: Number(row.currentSkus) || 0,
      previousUnits: Number(row.previousUnits) || 0,
      previousValue: Number(row.previousValue) || 0,
      previousSkus: Number(row.previousSkus) || 0,
      activeSkus: Number(row.activeSkus) || 0,
    })),
  }
}

export { REPORTING_TIME_ZONE, resolveProductReportPeriod }
