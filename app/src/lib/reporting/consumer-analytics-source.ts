/**
 * Data source for the monthly Consumer Analytics report.
 *
 * Primary path is the `reporting_consumer_analytics` RPC, which aggregates the
 * whole report inside the database and returns roughly 6 KB of JSON regardless
 * of how many scan rows the month contains.
 *
 * The fallback mirrors the pattern already used by `reporting-period-source.ts`:
 * when application code reaches a database whose migration / schema cache is
 * behind, aggregate server-side instead so the browser still only ever receives
 * the compact report. The fallback is bounded and reports itself as degraded —
 * it is a bridge for local work before the migration is applied, not a
 * Production-scale path.
 */

import {
  COHORT_MONTHS,
  TOP_CONSUMERS_LIMIT,
  TOP_PRODUCTS_LIMIT,
  TREND_MONTHS,
  daysInMonthKey,
  monthKeyRange,
  monthWindowUtc,
  mytParts,
  previousMonthKey,
  shiftMonthKey,
  type ConsumerAnalyticsAggregate,
  type MonthTotals,
} from './consumer-analytics'
import { reportingPeriodFromKey, type ReportingPeriod } from './reporting-period'

const PAGE_SIZE = 1000
/** Hard ceiling for the degraded fallback. Beyond this the migration is required. */
export const MAX_FALLBACK_ROWS = 100_000

export interface ScanRecord {
  consumer_id: string | null
  scanned_at: string | null
  qr_code_id?: string | null
  is_manual_adjustment?: boolean | null
  /** PostgREST embed — resolved in the same request, never an N+1 lookup. */
  qr_codes?: { product_id: string | null; variant_id: string | null } | null
}

export interface ConsumerAnalyticsSourceResult {
  aggregate: ConsumerAnalyticsAggregate
  source: 'rpc' | 'fallback'
  degraded: boolean
  notice: string | null
}

export function isMissingConsumerAnalyticsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_consumer_analytics') && message.includes('schema cache'))
}

export function isMissingConsumerPeriodsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_consumer_scan_periods') && message.includes('schema cache'))
}

// ── Pure aggregation (fallback + regression tests) ──────────────────────────

function isEligible(row: ScanRecord): row is ScanRecord & { scanned_at: string } {
  return row.is_manual_adjustment !== true && typeof row.scanned_at === 'string' && row.scanned_at.length > 0
}

function emptyTotals(): MonthTotals {
  return { totalScans: 0, identifiedScans: 0, identifiedConsumers: 0 }
}

/**
 * Aggregate raw scan rows into the same shape the RPC returns.
 *
 * `priorConsumerIds` carries identity history from before the loaded window; a
 * consumer listed there is returning even when their earliest scan in `rows`
 * falls inside the selected month.
 */
export function aggregateConsumerScans(
  rows: ScanRecord[],
  month: string,
  options: { priorConsumerIds?: Set<string> } = {},
): ConsumerAnalyticsAggregate {
  const previous = previousMonthKey(month)
  const daysInMonth = daysInMonthKey(month)
  const priorConsumerIds = options.priorConsumerIds ?? new Set<string>()

  const monthScans = new Map<string, { scans: number; identifiedScans: number }>()
  const monthConsumers = new Map<string, Set<string>>()
  /** Earliest MYT month in which each consumer was seen anywhere in `rows`. */
  const firstSeen = new Map<string, string>()

  const daily = new Map<string, { scans: number; consumers: Set<string> }>()
  const heatmap = new Map<string, number>()
  const consumerScans = new Map<string, { scans: number; lastScan: string }>()
  const productScans = new Map<string, { productId: string | null; variantId: string | null; scans: number }>()

  for (const row of rows) {
    if (!isEligible(row)) continue
    const parts = mytParts(row.scanned_at)
    const bucket = parts.month

    const totals = monthScans.get(bucket) ?? { scans: 0, identifiedScans: 0 }
    totals.scans += 1
    if (row.consumer_id) totals.identifiedScans += 1
    monthScans.set(bucket, totals)

    if (row.consumer_id) {
      const set = monthConsumers.get(bucket) ?? new Set<string>()
      set.add(row.consumer_id)
      monthConsumers.set(bucket, set)

      const seen = firstSeen.get(row.consumer_id)
      if (!seen || bucket < seen) firstSeen.set(row.consumer_id, bucket)
    }

    if (bucket !== month) continue

    const day = daily.get(parts.date) ?? { scans: 0, consumers: new Set<string>() }
    day.scans += 1
    if (row.consumer_id) day.consumers.add(row.consumer_id)
    daily.set(parts.date, day)

    const cell = `${parts.dayOfWeek}:${parts.hour}`
    heatmap.set(cell, (heatmap.get(cell) ?? 0) + 1)

    if (row.consumer_id) {
      const entry = consumerScans.get(row.consumer_id) ?? { scans: 0, lastScan: row.scanned_at }
      entry.scans += 1
      if (row.scanned_at > entry.lastScan) entry.lastScan = row.scanned_at
      consumerScans.set(row.consumer_id, entry)
    }

    const productId = row.qr_codes?.product_id ?? null
    const variantId = row.qr_codes?.variant_id ?? null
    if (productId || variantId) {
      const key = `${productId ?? ''}:${variantId ?? ''}`
      const entry = productScans.get(key) ?? { productId, variantId, scans: 0 }
      entry.scans += 1
      productScans.set(key, entry)
    }
  }

  const totalsFor = (key: string): MonthTotals => {
    const totals = monthScans.get(key)
    if (!totals) return emptyTotals()
    return {
      totalScans: totals.scans,
      identifiedScans: totals.identifiedScans,
      identifiedConsumers: monthConsumers.get(key)?.size ?? 0,
    }
  }

  const returningIn = (target: string): number => {
    const consumers = monthConsumers.get(target)
    if (!consumers) return 0
    let count = 0
    for (const id of consumers) {
      if (priorConsumerIds.has(id)) { count += 1; continue }
      const seen = firstSeen.get(id)
      if (seen && seen < target) count += 1
    }
    return count
  }

  const cohortMonths = monthKeyRange(month, COHORT_MONTHS)
  const cohort = cohortMonths.map((key) => {
    const consumers = monthConsumers.get(key)
    const next = monthConsumers.get(shiftMonthKey(key, 1))
    let retained = 0
    if (consumers && next) {
      for (const id of consumers) if (next.has(id)) retained += 1
    }
    return { month: key, consumers: consumers?.size ?? 0, retained }
  })

  return {
    month,
    daysInMonth,
    current: totalsFor(month),
    previous: totalsFor(previous),
    returningCurrent: returningIn(month),
    returningPrevious: returningIn(previous),
    dailyTrend: Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      const entry = daily.get(date)
      return { date, scans: entry?.scans ?? 0, consumers: entry?.consumers.size ?? 0 }
    }),
    twelveMonthTrend: monthKeyRange(month, TREND_MONTHS).map((key) => ({
      month: key,
      scans: monthScans.get(key)?.scans ?? 0,
      consumers: monthConsumers.get(key)?.size ?? 0,
    })),
    activityHeatmap: [...heatmap.entries()]
      .map(([key, scans]) => {
        const [dayOfWeek, hour] = key.split(':').map(Number)
        return { dayOfWeek, hour, scans }
      })
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour),
    cohort,
    topConsumers: [...consumerScans.entries()]
      .map(([consumerId, entry]) => ({
        consumerId,
        scans: entry.scans,
        lastScan: entry.lastScan,
        name: null as string | null,
        phone: null as string | null,
      }))
      .sort((a, b) => b.scans - a.scans || (b.lastScan || '').localeCompare(a.lastScan || ''))
      .slice(0, TOP_CONSUMERS_LIMIT),
    topProducts: [...productScans.values()]
      .map((entry) => ({
        productId: entry.productId,
        variantId: entry.variantId,
        productName: null as string | null,
        variantName: null as string | null,
        scans: entry.scans,
      }))
      .sort((a, b) => b.scans - a.scans)
      .slice(0, TOP_PRODUCTS_LIMIT),
  }
}

// ── Supabase access ────────────────────────────────────────────────────────

/** Reporting months that contain eligible consumer scan activity. */
export async function fetchConsumerScanPeriods(supabase: any): Promise<ReportingPeriod[]> {
  const { data, error } = await supabase.rpc('reporting_consumer_scan_periods')
  if (!error) {
    return ((data || []) as { period_key: string; transaction_count: number | string }[])
      .map((row) => reportingPeriodFromKey(row.period_key, Number(row.transaction_count) || 0))
      .filter((period): period is ReportingPeriod => Boolean(period))
  }
  if (!isMissingConsumerPeriodsRpc(error)) throw error

  // Degraded discovery: newest scan wins, months are derived locally.
  const { data: latest, error: latestError } = await supabase
    .from('consumer_qr_scans')
    .select('scanned_at')
    .eq('is_manual_adjustment', false)
    .not('scanned_at', 'is', null)
    .order('scanned_at', { ascending: false })
    .limit(1)
  if (latestError) throw latestError

  const newest = (latest || [])[0]?.scanned_at
  const endMonth = newest ? mytParts(newest).month : null
  if (!endMonth) return []
  return monthKeyRange(endMonth, TREND_MONTHS)
    .map((key) => reportingPeriodFromKey(key)!)
    .sort((a, b) => b.key.localeCompare(a.key))
}

async function readScanPages(
  supabase: any,
  select: string,
  startUtc: string,
  endUtc: string,
  budget: { remaining: number },
): Promise<ScanRecord[]> {
  const rows: ScanRecord[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('consumer_qr_scans')
      .select(select)
      .eq('is_manual_adjustment', false)
      .not('scanned_at', 'is', null)
      .gte('scanned_at', startUtc)
      .lt('scanned_at', endUtc)
      .order('scanned_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data || []) as ScanRecord[]
    rows.push(...page)
    budget.remaining -= page.length
    if (budget.remaining < 0) {
      throw new Error(
        'Consumer Analytics fallback exceeded its row budget. Apply migration '
        + '20260906120000_consumer_analytics_monthly_report.sql so the report is aggregated in the database.',
      )
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

/** Fill display names for the ranked rows only — at most two small lookups. */
async function resolveNames(supabase: any, aggregate: ConsumerAnalyticsAggregate): Promise<void> {
  const consumerIds = aggregate.topConsumers.map((row) => row.consumerId)
  if (consumerIds.length > 0) {
    const { data } = await supabase.from('users').select('id, full_name, phone').in('id', consumerIds)
    const byId = new Map(((data || []) as any[]).map((row) => [row.id, row]))
    for (const row of aggregate.topConsumers) {
      const user = byId.get(row.consumerId)
      row.name = user?.full_name ?? null
      row.phone = user?.phone ?? null
    }
  }

  const productIds = [...new Set(aggregate.topProducts.map((row) => row.productId).filter(Boolean))] as string[]
  const variantIds = [...new Set(aggregate.topProducts.map((row) => row.variantId).filter(Boolean))] as string[]

  const [products, variants] = await Promise.all([
    productIds.length ? supabase.from('products').select('id, product_name').in('id', productIds) : Promise.resolve({ data: [] }),
    variantIds.length ? supabase.from('product_variants').select('id, variant_name').in('id', variantIds) : Promise.resolve({ data: [] }),
  ])

  const productById = new Map(((products?.data || []) as any[]).map((row) => [row.id, row.product_name]))
  const variantById = new Map(((variants?.data || []) as any[]).map((row) => [row.id, row.variant_name]))
  for (const row of aggregate.topProducts) {
    row.productName = row.productId ? productById.get(row.productId) ?? null : null
    row.variantName = row.variantId ? variantById.get(row.variantId) ?? null : null
  }
}

export async function fetchConsumerAnalyticsAggregate(
  supabase: any,
  month: string,
): Promise<ConsumerAnalyticsSourceResult> {
  const { data, error } = await supabase.rpc('reporting_consumer_analytics', { p_month: month })
  if (!error) {
    return {
      aggregate: normalizeAggregate(data, month),
      source: 'rpc',
      degraded: false,
      notice: null,
    }
  }
  if (!isMissingConsumerAnalyticsRpc(error)) throw error

  const window = monthWindowUtc(month)
  const historyStart = monthWindowUtc(monthKeyRange(month, TREND_MONTHS)[0]).startUtc
  const budget = { remaining: MAX_FALLBACK_ROWS }

  const [historyRows, monthRows] = await Promise.all([
    readScanPages(supabase, 'consumer_id, scanned_at', historyStart, window.startUtc, budget),
    readScanPages(
      supabase,
      'consumer_id, scanned_at, qr_code_id, qr_codes(product_id, variant_id)',
      window.startUtc,
      window.endUtc,
      budget,
    ),
  ])

  const aggregate = aggregateConsumerScans([...historyRows, ...monthRows], month)
  await resolveNames(supabase, aggregate)

  return {
    aggregate,
    source: 'fallback',
    degraded: true,
    notice:
      'Reporting function not installed yet — figures were aggregated on the server from the last 12 months. '
      + 'New vs returning classification is limited to that window until migration '
      + '20260906120000_consumer_analytics_monthly_report.sql is applied.',
  }
}

/** Coerce the RPC's JSON (bigint counts arrive as numbers, arrays may be null). */
function normalizeAggregate(payload: any, month: string): ConsumerAnalyticsAggregate {
  const totals = (value: any): MonthTotals => ({
    totalScans: Number(value?.totalScans) || 0,
    identifiedScans: Number(value?.identifiedScans) || 0,
    identifiedConsumers: Number(value?.identifiedConsumers) || 0,
  })

  return {
    month: payload?.month || month,
    daysInMonth: Number(payload?.daysInMonth) || daysInMonthKey(month),
    current: totals(payload?.current),
    previous: totals(payload?.previous),
    returningCurrent: Number(payload?.returningCurrent) || 0,
    returningPrevious: Number(payload?.returningPrevious) || 0,
    dailyTrend: (payload?.dailyTrend || []).map((row: any) => ({
      date: String(row.date),
      scans: Number(row.scans) || 0,
      consumers: Number(row.consumers) || 0,
    })),
    twelveMonthTrend: (payload?.twelveMonthTrend || []).map((row: any) => ({
      month: String(row.month),
      scans: Number(row.scans) || 0,
      consumers: Number(row.consumers) || 0,
    })),
    activityHeatmap: (payload?.activityHeatmap || []).map((row: any) => ({
      dayOfWeek: Number(row.dayOfWeek) || 0,
      hour: Number(row.hour) || 0,
      scans: Number(row.scans) || 0,
    })),
    cohort: (payload?.cohort || []).map((row: any) => ({
      month: String(row.month),
      consumers: Number(row.consumers) || 0,
      retained: Number(row.retained) || 0,
    })),
    topConsumers: (payload?.topConsumers || []).map((row: any) => ({
      consumerId: String(row.consumerId),
      scans: Number(row.scans) || 0,
      lastScan: row.lastScan ?? null,
      name: row.name ?? null,
      phone: row.phone ?? null,
    })),
    topProducts: (payload?.topProducts || []).map((row: any) => ({
      productId: row.productId ?? null,
      variantId: row.variantId ?? null,
      productName: row.productName ?? null,
      variantName: row.variantName ?? null,
      scans: Number(row.scans) || 0,
    })),
  }
}
