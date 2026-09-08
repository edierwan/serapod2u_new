/**
 * Product Analytics — monthly product management report.
 *
 * Shared by the reporting API route (server), ProductsTab (client) and the PDF
 * generator, so the web report and the downloaded PDF can never disagree: all
 * three consume the single DTO this module builds.
 *
 * Everything here is pure. The aggregate arrives either from the
 * `reporting_product_analytics` RPC or from the route's bounded server-side
 * fallback; this module turns it into the display DTO and applies every
 * management classification rule.
 *
 * Reporting timezone is Asia/Kuala_Lumpur. Malaysia has observed a fixed +08:00
 * offset with no DST since 1982, so month/day boundaries are built from literal
 * `+08:00` exactly as `reporting-period.ts` already does.
 *
 * Month arithmetic, `MetricDelta` and the month-options builder are imported
 * from the Consumer Analytics monthly report rather than re-implemented — there
 * is one definition of "the previous calendar month" in reporting.
 */

import {
  currentReportingMonthKey,
  daysInMonthKey,
  isValidMonthKey,
  metricDelta,
  monthLabel,
  previousMonthKey,
  safeShare,
  shiftMonthKey,
  buildReportingMonthOptions,
  type MetricDelta,
} from './consumer-analytics'
import { REPORTING_TIME_ZONE } from './reporting-period'

export {
  REPORTING_TIME_ZONE,
  currentReportingMonthKey,
  isValidMonthKey,
  previousMonthKey,
  shiftMonthKey,
  daysInMonthKey,
  buildReportingMonthOptions,
  monthLabel,
}
export type { MetricDelta }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Order statuses counted as product demand.
 *
 * Deliberately unchanged from the previous ProductsTab implementation — this
 * redesign changes how the report is aggregated, never which orders it counts.
 * These are not all recognised accounting revenue, which is why the financial
 * KPI is labelled "Order Value" and never "Revenue".
 */
export const ELIGIBLE_ORDER_STATUSES = ['approved', 'closed', 'submitted'] as const

/** The business date the monthly report buckets on — `orders.created_at`. */
export const REPORT_DATE_FIELD = 'orders.created_at'

/** Sentinel for the unfiltered, consolidated report across every category. */
export const ALL_CATEGORIES = 'all'
export const ALL_CATEGORIES_LABEL = 'All Categories'

export const TOP_PRODUCTS_LIMIT = 10
export const ATTENTION_LIMIT = 15
export const ACTION_ROWS_LIMIT = 60
/**
 * Ranked contribution rows carried in the report so the drill-down needs no
 * second request. Beyond this the "Remaining SKUs" list is truncated and the
 * report says so, keeping the payload bounded by report size as everywhere else.
 */
export const CONTRIBUTION_ROWS_LIMIT = 100
/**
 * Share of period Order Value at or above which the Top 5 band is described as
 * concentrated. A documented threshold, so the wording is never alarming by
 * accident.
 */
export const CONCENTRATION_THRESHOLD_PCT = 70
export const STRATEGY_ROWS_LIMIT = 50

/** Days of stock cover above which a position reads as excess. */
export const EXCESS_COVER_DAYS = 90
/** Growth at or above this is "rising"; at or below its negative is "at risk". */
export const RISING_GROWTH_PCT = 20
export const AT_RISK_DECLINE_PCT = -30
/** Movement inside ±this band is treated as flat demand. */
export const STABLE_BAND_PCT = 10
/** A SKU is a top performer when its units reach this quantile of ordered SKUs. */
export const TOP_PERFORMER_QUANTILE = 0.75

// ── Period model ───────────────────────────────────────────────────────────

export interface ProductReportPeriod {
  month: string
  label: string
  /** True while the selected month is the running Malaysia month (month to date). */
  isCurrentMonth: boolean
  startUtc: string
  /** Exclusive upper bound — the report window is half-open `[startUtc, endUtc)`. */
  endUtc: string
  startDate: string
  /** Last day included in the report, `YYYY-MM-DD` in MYT. */
  endDate: string
  dayCount: number
  comparisonMonth: string
  comparisonLabel: string
  comparisonShortLabel: string
  comparisonStartUtc: string
  comparisonEndUtc: string
  comparisonStartDate: string
  comparisonEndDate: string
  comparisonDayCount: number
  /** True when the comparison window was shortened to fit a shorter previous month. */
  comparisonClamped: boolean
  rangeLabel: string
  comparisonRangeLabel: string
  timeZone: string
  /** Instant the report is measured to — `endUtc` for the window that was read. */
  asOf: string
}

function mytDayOfMonth(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    timeZone: REPORTING_TIME_ZONE,
  }).formatToParts(now)
  return Number(parts.find((part) => part.type === 'day')?.value ?? '1')
}

function monthStartUtc(month: string): string {
  return new Date(`${month}-01T00:00:00+08:00`).toISOString()
}

/** `startUtc` advanced by whole MYT days. Safe because MYT never shifts offset. */
function addDaysUtc(startUtc: string, days: number): string {
  return new Date(new Date(startUtc).getTime() + days * DAY_MS).toISOString()
}

function dayKey(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * Report captions are composed explicitly rather than by locale convention:
 * "01 Sep 2026" is the agreed Serapod reporting format, while `en-MY` renders
 * a four-letter "Sept" and `en-US` puts the month first.
 */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-07` → "07 Sep 2026". */
export function formatReportDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day} ${MONTH_ABBR[Number(month) - 1]} ${year}`
}

function rangeLabel(startDate: string, endDate: string): string {
  return `${formatReportDate(startDate)} – ${formatReportDate(endDate)}`
}

/** `2026-08` → "Aug 2026", the short form used in KPI comparison captions. */
export function monthShortLabel(month: string): string {
  const [year, monthNo] = month.split('-')
  return `${MONTH_ABBR[Number(monthNo) - 1]} ${year}`
}

/**
 * Resolve the report window and its comparison window for a reporting month.
 *
 * Current month  → month to date (01 → today), compared against the SAME
 *                  elapsed days of the previous calendar month, so seven days
 *                  are never measured against a whole month. Where the previous
 *                  month is shorter the window clamps to its final day and
 *                  reports `comparisonClamped`.
 * Historical month → the complete calendar month, compared against the
 *                  complete previous calendar month (Feb vs the whole of Jan,
 *                  January vs the whole of the previous December).
 */
export function resolveProductReportPeriod(month: string, now: Date = new Date()): ProductReportPeriod {
  if (!isValidMonthKey(month)) throw new Error(`Invalid reporting month: ${month}`)

  const currentKey = currentReportingMonthKey(now)
  const isCurrentMonth = month === currentKey
  const daysInSelected = daysInMonthKey(month)
  // A month beyond the running Malaysia month has not happened; it is clamped
  // rather than generating future days the business cannot have traded in.
  const dayCount = month > currentKey
    ? 0
    : isCurrentMonth
      ? Math.min(mytDayOfMonth(now), daysInSelected)
      : daysInSelected

  const comparisonMonth = previousMonthKey(month)
  const daysInComparison = daysInMonthKey(comparisonMonth)
  const comparisonDayCount = isCurrentMonth
    ? Math.min(dayCount, daysInComparison)
    : daysInComparison

  const startUtc = monthStartUtc(month)
  const endUtc = addDaysUtc(startUtc, dayCount)
  const comparisonStartUtc = monthStartUtc(comparisonMonth)
  const comparisonEndUtc = addDaysUtc(comparisonStartUtc, comparisonDayCount)

  const startDate = dayKey(month, 1)
  const endDate = dayKey(month, Math.max(dayCount, 1))
  const comparisonStartDate = dayKey(comparisonMonth, 1)
  const comparisonEndDate = dayKey(comparisonMonth, Math.max(comparisonDayCount, 1))

  return {
    month,
    label: monthLabel(month),
    isCurrentMonth,
    startUtc,
    endUtc,
    startDate,
    endDate,
    dayCount,
    comparisonMonth,
    comparisonLabel: monthLabel(comparisonMonth),
    comparisonShortLabel: monthShortLabel(comparisonMonth),
    comparisonStartUtc,
    comparisonEndUtc,
    comparisonStartDate,
    comparisonEndDate,
    comparisonDayCount,
    comparisonClamped: isCurrentMonth && comparisonDayCount < dayCount,
    rangeLabel: rangeLabel(startDate, endDate),
    comparisonRangeLabel: rangeLabel(comparisonStartDate, comparisonEndDate),
    timeZone: REPORTING_TIME_ZONE,
    asOf: endUtc,
  }
}

// ── Raw aggregate (mirrors the RPC's JSON shape 1:1) ───────────────────────

export interface PeriodTotals {
  units: number
  orderValue: number
  skus: number
  orders: number
}

/** One product variant with both windows of demand and its current stock. */
export interface VariantAggregate {
  variantId: string
  productId: string | null
  /** Canonical `products.category_id`; null when the product is unresolvable. */
  categoryId: string | null
  categoryName: string | null
  productName: string | null
  variantName: string | null
  productCode: string | null
  isActive: boolean
  currentUnits: number
  currentValue: number
  previousUnits: number
  previousValue: number
  stockOnHand: number
  stockAvailable: number
  reorderPoint: number
  safetyStock: number
  stockValue: number
  /** Most recent eligible order carrying this variant, or null. */
  lastOrderedAt: string | null
}

/** One category's totals across both reporting windows. */
export interface CategoryTotals {
  categoryId: string
  categoryName: string
  currentUnits: number
  currentValue: number
  currentSkus: number
  previousUnits: number
  previousValue: number
  previousSkus: number
  activeSkus: number
}

export interface ProductAnalyticsAggregate {
  month: string
  /** `all`, or the selected `product_categories.id`. */
  categoryId: string
  categoryName: string
  current: PeriodTotals
  previous: PeriodTotals
  /** Active variants WITHIN the selected category scope. */
  activeSkus: number
  dailyTrend: { date: string; units: number; orderValue: number }[]
  variants: VariantAggregate[]
  inventory: {
    totalValue: number
    totalOnHand: number
    variantCount: number
    asOf: string | null
  }
  /**
   * Per-category totals for the Category Performance section. Populated only
   * for the consolidated `all` report — inside a category drill-down there is
   * nothing to compare against.
   */
  categories: CategoryTotals[]
}

// ── Display DTO ────────────────────────────────────────────────────────────

export type DemandTrend = 'growing' | 'stable' | 'declining' | 'new' | 'none'
export type StockStatus = 'low' | 'healthy' | 'excess' | 'dead' | 'none'
export type StrategyKey = 'rising' | 'at_risk' | 'promo' | 'top'
export type ActionKey = 'replenish' | 'maintain' | 'promote' | 'review'
export type ActionPriority = 'HIGH' | 'MEDIUM' | 'NORMAL'

/** Every product row the report can show, already classified. */
export interface ProductRow {
  variantId: string
  productName: string
  variantLabel: string
  /** "Cellera Hero / Banana Vanilla – BV" — the agreed identity structure. */
  label: string
  currentUnits: number
  currentValue: number
  previousUnits: number
  previousValue: number
  /** Relative movement in %. `null` when the comparison window had no baseline. */
  growthPct: number | null
  demandTrend: DemandTrend
  currentStock: number
  availableStock: number
  reorderPoint: number
  /** Days the current stock covers at the report period's demand rate. */
  stockCoverDays: number | null
  stockStatus: StockStatus
  lastOrderedAt: string | null
  action: ActionKey | null
  actionPriority: ActionPriority
  recommendation: string
}

export interface TopProductRow extends ProductRow {
  rank: number
  unitsSharePct: number | null
  valueSharePct: number | null
}

export interface AttentionRow extends ProductRow {
  status: 'No Orders' | 'Declining' | 'Slow' | 'Watch'
}

export type ContributionBandKey = 'top5' | 'next5' | 'remaining'

export interface ContributionBand {
  key: ContributionBandKey
  label: string
  skus: number
  orderValue: number
  sharePct: number | null
  /** 1-based rank range this band covers, for the drill-down caption. */
  rankFrom: number
  rankTo: number | null
}

/**
 * A ranked SKU inside a contribution band — the drill-down's row model.
 *
 * Deliberately a SLIM projection of `ProductRow` rather than the whole thing:
 * this is the longest array in the report, so it carries only the fields the
 * drawer renders. The recommendation sentence is looked up from `action` via
 * `ACTION_RECOMMENDATION` instead of being repeated on every row.
 */
export interface ContributionRow {
  variantId: string
  rank: number
  band: ContributionBandKey
  label: string
  currentUnits: number
  currentValue: number
  previousUnits: number
  previousValue: number
  growthPct: number | null
  demandTrend: DemandTrend
  /** Share of the SELECTED scope's order value. */
  valueSharePct: number | null
  currentStock: number
  availableStock: number
  reorderPoint: number
  stockCoverDays: number | null
  stockStatus: StockStatus
  lastOrderedAt: string | null
  action: ActionKey | null
}

/** One row of the Category Performance table (consolidated report only). */
export interface CategoryPerformanceRow {
  categoryId: string
  categoryName: string
  unitsOrdered: number
  orderValue: number
  skusOrdered: number
  activeSkus: number
  previousUnits: number
  previousOrderValue: number
  /** Units movement in %. `null` when the comparison window had no baseline. */
  changePct: number | null
  /** Share of the consolidated period order value. */
  valueSharePct: number | null
}

export interface ReportCategoryScope {
  /** `all`, or the selected `product_categories.id`. */
  id: string
  name: string
  isAll: boolean
}

export interface ProductAnalyticsReport {
  period: ProductReportPeriod
  category: ReportCategoryScope
  summary: {
    unitsOrdered: number
    orderValue: number
    skusOrdered: number
    activeSkus: number
    avgValuePerUnit: number | null
    avgUnitsPerDay: number
    avgValuePerDay: number
  }
  comparison: {
    unitsOrdered: MetricDelta
    orderValue: MetricDelta
    skusOrdered: MetricDelta
    avgValuePerUnit: { current: number | null; previous: number | null; changePct: number | null }
  }
  strategyInsights: {
    key: StrategyKey
    title: string
    description: string
    count: number
    rows: ProductRow[]
  }[]
  dailyTrend: { date: string; label: string; shortLabel: string; units: number; orderValue: number }[]
  topProducts: { byUnits: TopProductRow[]; byOrderValue: TopProductRow[] }
  productContribution: {
    totalOrderValue: number
    skuCount: number
    bands: ContributionBand[]
    /**
     * Every ordered SKU ranked by Order Value and tagged with its band, so the
     * contribution drill-down slices this array instead of refetching.
     */
    rows: ContributionRow[]
    /** True when `rows` was capped and the Remaining band is incomplete. */
    rowsTruncated: boolean
  }
  attentionProducts: AttentionRow[]
  inventorySnapshot: {
    totalValue: number
    totalOnHand: number
    variantCount: number
    asOf: string | null
    categories: { key: StockStatus; label: string; description: string; skus: number; units: number; value: number }[]
  }
  managementActions: {
    summary: { key: ActionKey; label: string; count: number }[]
    rows: ProductRow[]
  }
  /**
   * Category comparison, present ONLY on the consolidated `all` report. Inside a
   * category drill-down this is `null` and the section is not rendered.
   */
  categoryPerformance: CategoryPerformanceRow[] | null
  meta: {
    eligibleStatuses: string[]
    dateField: string
    excessCoverDays: number
  }
  isEmpty: boolean
}

// ── Arithmetic ─────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Growth of `current` over `previous` in %.
 *
 * `null` when the comparison window carried no baseline — a SKU going from 0 to
 * 400 units is new demand, never "Infinity%" and never a misleading "+0%".
 */
export function growthPercent(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return round1(((current - previous) / previous) * 100)
}

/** Days of cover at the report period's own demand rate. `null` = no demand to consume the stock. */
export function stockCoverDays(stock: number, units: number, dayCount: number): number | null {
  if (!(units > 0) || !(dayCount > 0) || !(stock > 0)) return null
  const perDay = units / dayCount
  return round1(stock / perDay)
}

// ── Classification rules ───────────────────────────────────────────────────

/**
 * Demand direction for the selected period against its comparison window.
 *
 * `new`  — nothing ordered in the comparison window, ordered in this one.
 * `none` — nothing ordered in the selected period.
 * The ±10% band around flat is deliberately wide: month-to-month order timing
 * moves small SKUs by a few percent without meaning anything.
 */
export function classifyDemand(currentUnits: number, previousUnits: number): DemandTrend {
  if (currentUnits <= 0) return 'none'
  if (previousUnits <= 0) return 'new'
  const growth = growthPercent(currentUnits, previousUnits)!
  if (growth > STABLE_BAND_PCT) return 'growing'
  if (growth < -STABLE_BAND_PCT) return 'declining'
  return 'stable'
}

/**
 * Current stock position. Evaluated in this order, so each SKU lands in exactly
 * one bucket:
 *
 * none   — nothing on hand.
 * dead   — stock on hand with no ordered units in either reporting window.
 * low    — available stock below the reorder point (falling back to safety
 *          stock where no reorder point is configured).
 * excess — stock covering more than `EXCESS_COVER_DAYS` of this period's demand.
 * healthy— everything else.
 */
export function classifyStock(
  onHand: number,
  available: number,
  reorderPoint: number,
  safetyStock: number,
  coverDays: number | null,
  currentUnits: number,
  previousUnits: number,
): StockStatus {
  if (onHand <= 0) return 'none'
  if (currentUnits <= 0 && previousUnits <= 0) return 'dead'
  const threshold = reorderPoint > 0 ? reorderPoint : safetyStock
  if (threshold > 0 && available < threshold) return 'low'
  if (currentUnits <= 0) return 'dead'
  if (coverDays !== null && coverDays > EXCESS_COVER_DAYS) return 'excess'
  return 'healthy'
}

/**
 * The one management action a SKU earns, first match wins.
 *
 * REPLENISH — demand holding or growing while stock sits below its reorder
 *             point (or has run out entirely with demand still live).
 * PROMOTE / REDUCE STOCK — demand flat or falling on top of an excess or dead
 *             stock position: the stock needs moving, not reordering.
 * REVIEW / AT RISK — demand fell away against a real prior baseline without a
 *             clear excess-stock story; a human needs to look at it.
 * MAINTAIN  — demand holding or growing on a healthy stock position.
 *
 * A SKU with no demand in either window and no excess stock earns no action and
 * is left out of the plan rather than padding it with noise.
 */
/** The recommendation sentence for each action — one definition, looked up by key. */
export const ACTION_RECOMMENDATION: Record<ActionKey, string> = {
  replenish: 'Raise a replenishment order before demand outruns stock',
  maintain: 'Hold the current plan and keep availability steady',
  promote: 'Promote, bundle or redistribute to move the standing stock',
  review: 'Review demand loss with the commercial team',
}

export const NO_ACTION_RECOMMENDATION = 'No action required this period'

export function classifyAction(row: {
  demandTrend: DemandTrend
  stockStatus: StockStatus
  currentUnits: number
  previousUnits: number
  growthPct: number | null
}): { action: ActionKey | null; priority: ActionPriority; recommendation: string } {
  const rising = row.demandTrend === 'growing' || row.demandTrend === 'new' || row.demandTrend === 'stable'
  const fading = row.demandTrend === 'declining' || row.demandTrend === 'none'

  if (rising && (row.stockStatus === 'low' || row.stockStatus === 'none')) {
    return { action: 'replenish', priority: 'HIGH', recommendation: ACTION_RECOMMENDATION.replenish }
  }
  if (fading && (row.stockStatus === 'excess' || row.stockStatus === 'dead')) {
    return {
      action: 'promote',
      priority: row.demandTrend === 'none' ? 'HIGH' : 'MEDIUM',
      recommendation: ACTION_RECOMMENDATION.promote,
    }
  }
  if (fading && row.previousUnits > 0) {
    return { action: 'review', priority: 'MEDIUM', recommendation: ACTION_RECOMMENDATION.review }
  }
  if (rising && row.currentUnits > 0) {
    return { action: 'maintain', priority: 'NORMAL', recommendation: ACTION_RECOMMENDATION.maintain }
  }
  return { action: null, priority: 'NORMAL', recommendation: NO_ACTION_RECOMMENDATION }
}

// ── Labelling ──────────────────────────────────────────────────────────────

/**
 * Trailing "[ … ]" flavour segment of a master-data variant name.
 *
 * Mirrors `lib/inventory/variant-display-label.ts`, which owns this rule for
 * the Inventory screens. It is re-derived here rather than imported so the
 * reporting DTO builder stays free of any client-module dependency and can run
 * unchanged inside the API route and the PDF generator.
 */
const BRACKETED_FLAVOUR = /\[([^[\]]*)\]\s*$/

export function variantFlavour(variantName?: string | null): string {
  const name = (variantName || '').trim()
  if (!name) return 'No variant'
  const match = name.match(BRACKETED_FLAVOUR)
  return (match ? match[1] : name).trim() || 'No variant'
}

/** "Cellera Hero / Banana Vanilla – BV" — the agreed product identity structure. */
export function productIdentityLabel(
  productName?: string | null,
  variantName?: string | null,
  productCode?: string | null,
): string {
  const product = (productName || '').trim()
  const flavour = variantFlavour(variantName)
  const hasFlavour = Boolean((variantName || '').trim())
  const code = (productCode || '').trim()
  const duplicate = product && hasFlavour && product.toLowerCase() === flavour.toLowerCase()

  let identity: string
  if (!product) identity = hasFlavour ? flavour : 'No variant'
  else if (!hasFlavour || duplicate) identity = product
  else identity = `${product} / ${flavour}`

  return code ? `${identity} – ${code}` : identity
}

// ── Aggregate → report ─────────────────────────────────────────────────────

export function emptyAggregate(
  month: string,
  period?: ProductReportPeriod,
  categoryId: string = ALL_CATEGORIES,
  categoryName: string = ALL_CATEGORIES_LABEL,
): ProductAnalyticsAggregate {
  const resolved = period ?? resolveProductReportPeriod(month)
  const zero: PeriodTotals = { units: 0, orderValue: 0, skus: 0, orders: 0 }
  return {
    month,
    categoryId,
    categoryName,
    current: { ...zero },
    previous: { ...zero },
    activeSkus: 0,
    dailyTrend: Array.from({ length: resolved.dayCount }, (_, i) => ({
      date: dayKey(month, i + 1),
      units: 0,
      orderValue: 0,
    })),
    variants: [],
    inventory: { totalValue: 0, totalOnHand: 0, variantCount: 0, asOf: null },
    categories: [],
  }
}

const STRATEGY_META: Record<StrategyKey, { title: string; description: string }> = {
  rising: {
    title: 'Rising Stars',
    description: `Units up more than ${RISING_GROWTH_PCT}% on the comparison period, plus SKUs with brand-new demand`,
  },
  at_risk: {
    title: 'At Risk',
    description: `Units down ${Math.abs(AT_RISK_DECLINE_PCT)}% or more against a real comparison baseline`,
  },
  promo: {
    title: 'Promotion Candidates',
    description: `Flat or falling demand carrying excess or dead stock (over ${EXCESS_COVER_DAYS} days of cover)`,
  },
  top: {
    title: 'Top Performers',
    description: 'Top quartile of ordered demand with a stable or improving trend',
  },
}

const ACTION_META: Record<ActionKey, string> = {
  replenish: 'Replenish',
  maintain: 'Maintain',
  promote: 'Promote / Reduce Stock',
  review: 'Review / At Risk',
}

const STOCK_META: Record<StockStatus, { label: string; description: string }> = {
  low: { label: 'Low Stock / Replenish', description: 'Available stock below the reorder point' },
  healthy: { label: 'Healthy', description: 'Stock in line with the period’s demand' },
  excess: { label: 'Excess Stock', description: `More than ${EXCESS_COVER_DAYS} days of cover at this period’s demand` },
  dead: { label: 'Dead Stock', description: 'Stock on hand with no ordered units in either reporting window' },
  none: { label: 'No Stock', description: 'Nothing on hand' },
}

/** Units at the top-performer quantile of the SKUs that were actually ordered. */
function topPerformerThreshold(orderedUnits: number[]): number {
  if (orderedUnits.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...orderedUnits].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * TOP_PERFORMER_QUANTILE),
  )
  return sorted[index]
}

export function buildProductAnalyticsReport(
  aggregate: ProductAnalyticsAggregate,
  now: Date = new Date(),
): ProductAnalyticsReport {
  const period = resolveProductReportPeriod(aggregate.month, now)
  const { dayCount } = period
  const categoryId = aggregate.categoryId || ALL_CATEGORIES
  const isAllCategories = categoryId === ALL_CATEGORIES
  const category: ReportCategoryScope = {
    id: categoryId,
    name: isAllCategories ? ALL_CATEGORIES_LABEL : (aggregate.categoryName || 'Unknown category'),
    isAll: isAllCategories,
  }

  const rows: ProductRow[] = aggregate.variants.map((variant) => {
    const growthPct = growthPercent(variant.currentUnits, variant.previousUnits)
    const demandTrend = classifyDemand(variant.currentUnits, variant.previousUnits)
    const coverDays = stockCoverDays(variant.stockOnHand, variant.currentUnits, dayCount)
    const stockStatus = classifyStock(
      variant.stockOnHand,
      variant.stockAvailable,
      variant.reorderPoint,
      variant.safetyStock,
      coverDays,
      variant.currentUnits,
      variant.previousUnits,
    )
    const { action, priority, recommendation } = classifyAction({
      demandTrend,
      stockStatus,
      currentUnits: variant.currentUnits,
      previousUnits: variant.previousUnits,
      growthPct,
    })

    return {
      variantId: variant.variantId,
      productName: (variant.productName || '').trim() || 'Unknown product',
      variantLabel: variantFlavour(variant.variantName),
      label: productIdentityLabel(variant.productName, variant.variantName, variant.productCode),
      currentUnits: variant.currentUnits,
      currentValue: round2(variant.currentValue),
      previousUnits: variant.previousUnits,
      previousValue: round2(variant.previousValue),
      growthPct,
      demandTrend,
      currentStock: variant.stockOnHand,
      availableStock: variant.stockAvailable,
      reorderPoint: variant.reorderPoint,
      stockCoverDays: coverDays,
      stockStatus,
      lastOrderedAt: variant.lastOrderedAt,
      action,
      actionPriority: priority,
      recommendation,
    }
  })

  const totalUnits = aggregate.current.units
  const totalValue = round2(aggregate.current.orderValue)
  const previousUnits = aggregate.previous.units
  const previousValue = round2(aggregate.previous.orderValue)

  const avgValuePerUnit = totalUnits > 0 ? round2(totalValue / totalUnits) : null
  const previousAvgValuePerUnit = previousUnits > 0 ? round2(previousValue / previousUnits) : null

  // ── Strategy insights ──────────────────────────────────────────────────
  const orderedUnits = rows.filter((row) => row.currentUnits > 0).map((row) => row.currentUnits)
  const performerFloor = topPerformerThreshold(orderedUnits)

  const rising = rows
    .filter((row) => row.currentUnits > 0
      && (row.demandTrend === 'new' || (row.growthPct !== null && row.growthPct > RISING_GROWTH_PCT)))
    .sort((a, b) => (b.growthPct ?? Number.POSITIVE_INFINITY) - (a.growthPct ?? Number.POSITIVE_INFINITY)
      || b.currentUnits - a.currentUnits)

  const atRisk = rows
    .filter((row) => row.previousUnits > 0 && row.growthPct !== null && row.growthPct <= AT_RISK_DECLINE_PCT)
    .sort((a, b) => (a.growthPct ?? 0) - (b.growthPct ?? 0))

  const promo = rows
    .filter((row) => (row.stockStatus === 'excess' || row.stockStatus === 'dead')
      && (row.demandTrend === 'none' || row.demandTrend === 'declining' || row.demandTrend === 'stable'))
    .sort((a, b) => b.currentStock - a.currentStock)

  const top = rows
    .filter((row) => row.currentUnits > 0
      && row.currentUnits >= performerFloor
      && (row.growthPct === null || row.growthPct >= -STABLE_BAND_PCT))
    .sort((a, b) => b.currentUnits - a.currentUnits)

  const strategyLists: Record<StrategyKey, ProductRow[]> = { rising, at_risk: atRisk, promo, top }

  // ── Rankings and contribution ──────────────────────────────────────────
  const ordered = rows.filter((row) => row.currentUnits > 0 || row.currentValue > 0)

  const rank = (list: ProductRow[]): TopProductRow[] =>
    list.slice(0, TOP_PRODUCTS_LIMIT).map((row, index) => ({
      ...row,
      rank: index + 1,
      unitsSharePct: safeShare(row.currentUnits, totalUnits),
      valueSharePct: safeShare(row.currentValue, totalValue),
    }))

  const byUnits = rank([...ordered].sort((a, b) => b.currentUnits - a.currentUnits || b.currentValue - a.currentValue))
  const byOrderValue = rank([...ordered].sort((a, b) => b.currentValue - a.currentValue || b.currentUnits - a.currentUnits))

  const valueRanked = [...ordered].sort((a, b) => b.currentValue - a.currentValue)
  const bandTotal = (slice: ProductRow[]) => round2(slice.reduce((sum, row) => sum + row.currentValue, 0))
  const topFive = valueRanked.slice(0, 5)
  const nextFive = valueRanked.slice(5, 10)
  const remaining = valueRanked.slice(10)
  // Band totals and shares are unchanged by the drill-down: the same slices
  // produce both the summary rows and the rows the drawer lists.
  const bands: ContributionBand[] = [
    { key: 'top5', label: 'Top 5 SKUs', skus: topFive.length, orderValue: bandTotal(topFive), sharePct: safeShare(bandTotal(topFive), totalValue), rankFrom: 1, rankTo: 5 },
    { key: 'next5', label: 'Next 5 SKUs', skus: nextFive.length, orderValue: bandTotal(nextFive), sharePct: safeShare(bandTotal(nextFive), totalValue), rankFrom: 6, rankTo: 10 },
    { key: 'remaining', label: 'Remaining SKUs', skus: remaining.length, orderValue: bandTotal(remaining), sharePct: safeShare(bandTotal(remaining), totalValue), rankFrom: 11, rankTo: null },
  ]

  const bandOfRank = (rank: number): ContributionBandKey =>
    rank <= 5 ? 'top5' : rank <= 10 ? 'next5' : 'remaining'

  const contributionRows: ContributionRow[] = valueRanked
    .slice(0, CONTRIBUTION_ROWS_LIMIT)
    .map((row, index) => ({
      variantId: row.variantId,
      rank: index + 1,
      band: bandOfRank(index + 1),
      label: row.label,
      currentUnits: row.currentUnits,
      currentValue: row.currentValue,
      previousUnits: row.previousUnits,
      previousValue: row.previousValue,
      growthPct: row.growthPct,
      demandTrend: row.demandTrend,
      // Share is always against the SELECTED scope's order value, so a category
      // drill-down divides by that category's total, never company-wide.
      valueSharePct: safeShare(row.currentValue, totalValue),
      currentStock: row.currentStock,
      availableStock: row.availableStock,
      reorderPoint: row.reorderPoint,
      stockCoverDays: row.stockCoverDays,
      stockStatus: row.stockStatus,
      lastOrderedAt: row.lastOrderedAt,
      action: row.action,
    }))

  // ── Products requiring attention ───────────────────────────────────────
  const attention: AttentionRow[] = rows
    .map((row): AttentionRow | null => {
      if (row.currentUnits === 0 && row.previousUnits > 0) return { ...row, status: 'No Orders' }
      if (row.growthPct !== null && row.growthPct <= AT_RISK_DECLINE_PCT) return { ...row, status: 'Declining' }
      if (row.growthPct !== null && row.growthPct < -STABLE_BAND_PCT) return { ...row, status: 'Slow' }
      if (row.stockStatus === 'excess' || row.stockStatus === 'dead') return { ...row, status: 'Watch' }
      return null
    })
    .filter((row): row is AttentionRow => row !== null)
    .sort((a, b) => {
      const order = { 'No Orders': 0, Declining: 1, Slow: 2, Watch: 3 }
      return order[a.status] - order[b.status]
        || (a.growthPct ?? 0) - (b.growthPct ?? 0)
        || b.currentStock - a.currentStock
    })
    .slice(0, ATTENTION_LIMIT)

  // ── Current inventory snapshot ─────────────────────────────────────────
  const stockValueByVariant = new Map(aggregate.variants.map((variant) => [variant.variantId, variant.stockValue]))
  const stockBuckets: StockStatus[] = ['low', 'healthy', 'excess', 'dead']
  const categories = stockBuckets.map((key) => {
    const bucket = rows.filter((row) => row.stockStatus === key)
    return {
      key,
      label: STOCK_META[key].label,
      description: STOCK_META[key].description,
      skus: bucket.length,
      units: bucket.reduce((sum, row) => sum + row.currentStock, 0),
      value: round2(bucket.reduce((sum, row) => sum + (stockValueByVariant.get(row.variantId) ?? 0), 0)),
    }
  })

  // ── Management action plan ─────────────────────────────────────────────
  const priorityOrder: Record<ActionPriority, number> = { HIGH: 0, MEDIUM: 1, NORMAL: 2 }
  const actionRows = rows
    .filter((row) => row.action !== null)
    .sort((a, b) => priorityOrder[a.actionPriority] - priorityOrder[b.actionPriority]
      || b.currentUnits - a.currentUnits
      || b.currentStock - a.currentStock)

  const actionKeys: ActionKey[] = ['replenish', 'maintain', 'promote', 'review']
  const actionSummary = actionKeys.map((key) => ({
    key,
    label: ACTION_META[key],
    // Counted over every classified row, and the rows array below carries them
    // all, so a card's number always equals the list it opens.
    count: actionRows.filter((row) => row.action === key).length,
  }))

  // Chart axis labels: "3 Sep" full, "3" compact for narrow mobile axes.
  const dayLabel = (date: string) => {
    const [, month, day] = date.split('-')
    return { full: `${Number(day)} ${MONTH_ABBR[Number(month) - 1]}`, short: String(Number(day)) }
  }

  // Category Performance compares categories against each other, which only
  // means something on the consolidated report. Inside a drill-down the user is
  // already within one category, so the section is omitted entirely.
  const categoryPerformance: CategoryPerformanceRow[] | null = isAllCategories
    ? aggregate.categories
        .map((row) => ({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          unitsOrdered: row.currentUnits,
          orderValue: round2(row.currentValue),
          skusOrdered: row.currentSkus,
          activeSkus: row.activeSkus,
          previousUnits: row.previousUnits,
          previousOrderValue: round2(row.previousValue),
          changePct: growthPercent(row.currentUnits, row.previousUnits),
          valueSharePct: safeShare(row.currentValue, aggregate.current.orderValue),
        }))
        .sort((a, b) => b.orderValue - a.orderValue || b.unitsOrdered - a.unitsOrdered)
    : null

  return {
    period,
    category,
    summary: {
      unitsOrdered: totalUnits,
      orderValue: totalValue,
      skusOrdered: aggregate.current.skus,
      activeSkus: aggregate.activeSkus,
      avgValuePerUnit,
      avgUnitsPerDay: dayCount > 0 ? Math.round(totalUnits / dayCount) : 0,
      avgValuePerDay: dayCount > 0 ? round2(totalValue / dayCount) : 0,
    },
    comparison: {
      unitsOrdered: metricDelta(totalUnits, previousUnits),
      orderValue: metricDelta(totalValue, previousValue),
      skusOrdered: metricDelta(aggregate.current.skus, aggregate.previous.skus),
      avgValuePerUnit: {
        current: avgValuePerUnit,
        previous: previousAvgValuePerUnit,
        changePct: avgValuePerUnit !== null && previousAvgValuePerUnit !== null && previousAvgValuePerUnit > 0
          ? round1(((avgValuePerUnit - previousAvgValuePerUnit) / previousAvgValuePerUnit) * 100)
          : null,
      },
    },
    strategyInsights: (Object.keys(STRATEGY_META) as StrategyKey[]).map((key) => ({
      key,
      title: STRATEGY_META[key].title,
      description: STRATEGY_META[key].description,
      count: strategyLists[key].length,
      rows: strategyLists[key].slice(0, STRATEGY_ROWS_LIMIT),
    })),
    dailyTrend: aggregate.dailyTrend.map((row) => {
      const { full, short } = dayLabel(row.date)
      return {
        date: row.date,
        label: full,
        shortLabel: short,
        units: row.units,
        orderValue: round2(row.orderValue),
      }
    }),
    topProducts: { byUnits, byOrderValue },
    productContribution: {
      totalOrderValue: totalValue,
      skuCount: ordered.length,
      bands,
      rows: contributionRows,
      rowsTruncated: valueRanked.length > CONTRIBUTION_ROWS_LIMIT,
    },
    attentionProducts: attention,
    inventorySnapshot: {
      totalValue: round2(aggregate.inventory.totalValue),
      totalOnHand: aggregate.inventory.totalOnHand,
      variantCount: aggregate.inventory.variantCount,
      asOf: aggregate.inventory.asOf,
      categories,
    },
    managementActions: { summary: actionSummary, rows: actionRows.slice(0, ACTION_ROWS_LIMIT) },
    categoryPerformance,
    meta: {
      eligibleStatuses: [...ELIGIBLE_ORDER_STATUSES],
      dateField: REPORT_DATE_FIELD,
      excessCoverDays: EXCESS_COVER_DAYS,
    },
    isEmpty: totalUnits === 0 && totalValue === 0,
  }
}

/**
 * Filename-safe form of a category name: "Pet Food" → "Pet_Food".
 *
 * Anything that is not a letter or digit collapses to a single underscore, so a
 * category named "Vape / Pods (2026)" cannot produce a path separator.
 */
export function categoryFilenameSegment(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * `Serapod_Product_Performance_2026-09_MTD.pdf` for the consolidated report,
 * `Serapod_Product_Performance_Vape_2026-09_MTD.pdf` inside a category, and
 * `Serapod_Product_Performance_Pet_Food_2026-08.pdf` for a closed month.
 */
export function productReportFilename(period: ProductReportPeriod, category?: ReportCategoryScope): string {
  const segment = category && !category.isAll ? categoryFilenameSegment(category.name) : ''
  const scope = segment ? `${segment}_` : ''
  return `Serapod_Product_Performance_${scope}${period.month}${period.isCurrentMonth ? '_MTD' : ''}.pdf`
}
