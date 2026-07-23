/**
 * Shared aggregation logic for the "Shop by Negeri" report.
 * Used by both the client tab (ShopByNegeriTab) and the server-side
 * Excel export route so the numbers always match.
 *
 * Data sources (existing schema, no migration required):
 *  - consumer_qr_scans (id, consumer_id, scanned_at, shop_id, points_amount, is_manual_adjustment)
 *  - organizations     (id, org_name, branch, state_id, contact_name, contact_phone)
 *  - states            (id, state_name, region_id)
 *  - regions           (id, region_name)
 */

import { subDays, subMonths } from 'date-fns'
import { REPORTING_TIME_ZONE } from './reporting-period'

// ── Row types ──────────────────────────────────────────────────────────
export interface NegeriScanRow {
  id: string
  consumer_id: string | null
  scanned_at: string | null
  shop_id: string | null
  points_amount: number | null
}

export interface NegeriOrgRow {
  id: string
  org_name: string
  branch: string | null
  state_id: string | null
  contact_name: string | null
  contact_phone: string | null
}

export interface NegeriStateRow {
  id: string
  state_name: string
  region_id: string | null
}

export interface NegeriRegionRow {
  id: string
  region_name: string
}

// ── Date presets (shared with the rest of reporting) ───────────────────
export const NEGERI_PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: 'quarter', label: 'This Quarter' },
  { value: '12months', label: 'Last 12 Months' },
] as const

export type NegeriPeriod = (typeof NEGERI_PERIOD_OPTIONS)[number]['value']

export interface DateWindow {
  start: Date
  end: Date
  /** Previous equal-length window (for growth comparison) */
  prevStart: Date
  prevEnd: Date
}

export function computeNegeriDateWindow(period: string, now: Date = new Date()): DateWindow {
  let start: Date
  const end = now

  if (period === '12months') start = subMonths(now, 12)
  else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    start = new Date(now.getFullYear(), q * 3, 1)
  } else {
    const days = parseInt(period, 10)
    start = subDays(now, Number.isFinite(days) ? days : 30)
  }

  const spanMs = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime())
  const prevStart = new Date(start.getTime() - spanMs)

  return { start, end, prevStart, prevEnd }
}

// ── Helpers ────────────────────────────────────────────────────────────
function growthPct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

function stateLabel(states: Map<string, NegeriStateRow>, stateId: string): string {
  return states.get(stateId)?.state_name || 'Unassigned'
}

// ── Output types ───────────────────────────────────────────────────────
export interface NegeriKpis {
  totalStatesActive: number
  totalStates: number
  totalShops: number
  totalScans: number
  totalConsumers: number
  totalPoints: number
  avgScansPerShop: number
  topNegeri: string
  topNegeriScans: number
}

export interface StateRankRow {
  rank: number
  stateId: string
  negeri: string
  shops: number
  scans: number
  consumers: number
  points: number
  avgPerShop: number
  growth: number | null
}

export interface TopShopRow {
  stateId: string
  negeri: string
  shopId: string
  shopName: string
  contactPhone: string
  scans: number
  consumers: number
  avgPerShop: number
  growth: number | null
}

export interface MonthlyTrendRow {
  monthKey: string
  monthLabel: string
  scans: number
  shops: number
  consumers: number
}

export interface MonthlyByStateRow {
  monthKey: string
  monthLabel: string
  stateId: string
  negeri: string
  scans: number
  shops: number
  consumers: number
}

export interface NegeriReport {
  kpis: NegeriKpis
  ranking: StateRankRow[]
  topShops: TopShopRow[]
  monthlyTrend: MonthlyTrendRow[]
  monthlyByState: MonthlyByStateRow[]
}

export interface BuildNegeriReportArgs {
  scans: NegeriScanRow[]
  orgs: NegeriOrgRow[]
  states: NegeriStateRow[]
  /** region_id filter, or 'all' / '' for no filter */
  regionId?: string | null
  /** state_id filter, or 'all' / '' for no filter */
  negeriId?: string | null
  /** free-text search applied to negeri name (ranking / top shops) */
  search?: string | null
  window: DateWindow
  /** max top shops per negeri to include */
  topShopsPerState?: number
}

// ── Core builder ───────────────────────────────────────────────────────
export function buildNegeriReport(args: BuildNegeriReportArgs): NegeriReport {
  const {
    scans,
    orgs,
    states,
    regionId,
    negeriId,
    search,
    window,
    topShopsPerState = 5,
  } = args

  const stateMap = new Map<string, NegeriStateRow>(states.map((s) => [s.id, s]))
  const orgMap = new Map<string, NegeriOrgRow>(orgs.map((o) => [o.id, o]))

  const hasRegion = !!regionId && regionId !== 'all'
  const hasNegeri = !!negeriId && negeriId !== 'all'
  const searchLc = (search || '').trim().toLowerCase()

  // Set of state ids allowed by the region/negeri filter
  const allowedStateIds = new Set<string>()
  for (const s of states) {
    if (hasNegeri && s.id !== negeriId) continue
    if (hasRegion && s.region_id !== regionId) continue
    allowedStateIds.add(s.id)
  }

  const startISO = window.start.toISOString()
  const endISO = window.end.toISOString()
  const prevStartISO = window.prevStart.toISOString()
  const prevEndISO = window.prevEnd.toISOString()

  function stateIdForScan(scan: NegeriScanRow): string | null {
    if (!scan.shop_id) return null
    const org = orgMap.get(scan.shop_id)
    if (!org || !org.state_id) return null
    return org.state_id
  }

  // ── Period partitioning ──────────────────────────────────────────────
  type StateAgg = {
    scans: number
    shops: Set<string>
    consumers: Set<string>
    points: number
    prevScans: number
  }
  const byState = new Map<string, StateAgg>()
  const activeStates = new Set<string>()

  // Per-shop aggregation (current period only)
  type ShopAgg = {
    stateId: string
    scans: number
    consumers: Set<string>
    prevScans: number
  }
  const byShop = new Map<string, ShopAgg>()

  let totalScans = 0
  const totalShops = new Set<string>()
  const totalConsumers = new Set<string>()
  let totalPoints = 0

  for (const scan of scans) {
    const stId = stateIdForScan(scan)
    if (!stId) continue
    if (!allowedStateIds.has(stId)) continue
    const at = scan.scanned_at
    if (!at) continue

    const inCurrent = at >= startISO && at < endISO
    const inPrev = at >= prevStartISO && at < prevEndISO

    if (inCurrent) {
      activeStates.add(stId)
      let agg = byState.get(stId)
      if (!agg) {
        agg = { scans: 0, shops: new Set(), consumers: new Set(), points: 0, prevScans: 0 }
        byState.set(stId, agg)
      }
      agg.scans++
      if (scan.shop_id) agg.shops.add(scan.shop_id)
      if (scan.consumer_id) agg.consumers.add(scan.consumer_id)
      agg.points += scan.points_amount || 0

      totalScans++
      if (scan.shop_id) totalShops.add(scan.shop_id)
      if (scan.consumer_id) totalConsumers.add(scan.consumer_id)
      totalPoints += scan.points_amount || 0

      if (scan.shop_id) {
        let sa = byShop.get(scan.shop_id)
        if (!sa) {
          sa = { stateId: stId, scans: 0, consumers: new Set(), prevScans: 0 }
          byShop.set(scan.shop_id, sa)
        }
        sa.scans++
        if (scan.consumer_id) sa.consumers.add(scan.consumer_id)
      }
    } else if (inPrev) {
      let agg = byState.get(stId)
      if (!agg) {
        agg = { scans: 0, shops: new Set(), consumers: new Set(), points: 0, prevScans: 0 }
        byState.set(stId, agg)
      }
      agg.prevScans++
      if (scan.shop_id) {
        const sa = byShop.get(scan.shop_id)
        if (sa) sa.prevScans++
      }
    }
  }

  // ── KPIs ─────────────────────────────────────────────────────────────
  let topNegeri = '—'
  let topNegeriScans = 0
  for (const [stId, agg] of byState.entries()) {
    if (agg.scans > topNegeriScans) {
      topNegeriScans = agg.scans
      topNegeri = stateLabel(stateMap, stId)
    }
  }

  const totalStates = hasNegeri
    ? 1
    : hasRegion
      ? states.filter((s) => s.region_id === regionId).length
      : states.length

  const kpis: NegeriKpis = {
    totalStatesActive: activeStates.size,
    totalStates,
    totalShops: totalShops.size,
    totalScans,
    totalConsumers: totalConsumers.size,
    totalPoints,
    avgScansPerShop: totalShops.size > 0 ? totalScans / totalShops.size : 0,
    topNegeri,
    topNegeriScans,
  }

  // ── State ranking ────────────────────────────────────────────────────
  let ranking: StateRankRow[] = [...byState.entries()]
    .filter(([, agg]) => agg.scans > 0)
    .map(([stId, agg]) => ({
      rank: 0,
      stateId: stId,
      negeri: stateLabel(stateMap, stId),
      shops: agg.shops.size,
      scans: agg.scans,
      consumers: agg.consumers.size,
      points: agg.points,
      avgPerShop: agg.shops.size > 0 ? agg.scans / agg.shops.size : 0,
      growth: growthPct(agg.scans, agg.prevScans),
    }))
    .sort((a, b) => b.scans - a.scans)

  if (searchLc) ranking = ranking.filter((r) => r.negeri.toLowerCase().includes(searchLc))
  ranking = ranking.map((r, i) => ({ ...r, rank: i + 1 }))

  // ── Top shops per negeri ─────────────────────────────────────────────
  const shopsByState = new Map<string, TopShopRow[]>()
  for (const [shopId, sa] of byShop.entries()) {
    const org = orgMap.get(shopId)
    const negeri = stateLabel(stateMap, sa.stateId)
    if (searchLc && !negeri.toLowerCase().includes(searchLc)) continue
    const name = org
      ? `${org.org_name}${org.branch ? ` (${org.branch})` : ''}`
      : shopId.slice(0, 8)
    const row: TopShopRow = {
      stateId: sa.stateId,
      negeri,
      shopId,
      shopName: name,
      contactPhone: org?.contact_phone || '—',
      scans: sa.scans,
      consumers: sa.consumers.size,
      avgPerShop: sa.consumers.size > 0 ? sa.scans / sa.consumers.size : sa.scans,
      growth: growthPct(sa.scans, sa.prevScans),
    }
    const list = shopsByState.get(sa.stateId) || []
    list.push(row)
    shopsByState.set(sa.stateId, list)
  }

  const topShops: TopShopRow[] = []
  for (const [, list] of shopsByState.entries()) {
    list.sort((a, b) => b.scans - a.scans)
    topShops.push(...list.slice(0, topShopsPerState))
  }
  topShops.sort((a, b) => (a.negeri === b.negeri ? b.scans - a.scans : a.negeri.localeCompare(b.negeri)))

  // ── Selected month trend, respecting region/negeri filter ────────────
  const monthlyTrend: MonthlyTrendRow[] = []
  const monthlyByState: MonthlyByStateRow[] = []

  const monthParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', timeZone: REPORTING_TIME_ZONE,
  }).formatToParts(window.start)
  const key = `${monthParts.find((part) => part.type === 'year')?.value}-${monthParts.find((part) => part.type === 'month')?.value}`
  const label = new Intl.DateTimeFormat('en-MY', {
    month: 'short', year: 'numeric', timeZone: REPORTING_TIME_ZONE,
  }).format(window.start)

  let mScans = 0
  const mShops = new Set<string>()
  const mConsumers = new Set<string>()

  // per-state buckets for the selected reporting month
  const perState = new Map<string, { scans: number; shops: Set<string>; consumers: Set<string> }>()

  for (const scan of scans) {
    if (!scan.scanned_at || scan.scanned_at < startISO || scan.scanned_at >= endISO) continue
    const stId = stateIdForScan(scan)
    if (!stId || !allowedStateIds.has(stId)) continue

    mScans++
    if (scan.shop_id) mShops.add(scan.shop_id)
    if (scan.consumer_id) mConsumers.add(scan.consumer_id)

    let ps = perState.get(stId)
    if (!ps) {
      ps = { scans: 0, shops: new Set(), consumers: new Set() }
      perState.set(stId, ps)
    }
    ps.scans++
    if (scan.shop_id) ps.shops.add(scan.shop_id)
    if (scan.consumer_id) ps.consumers.add(scan.consumer_id)
  }

  monthlyTrend.push({ monthKey: key, monthLabel: label, scans: mScans, shops: mShops.size, consumers: mConsumers.size })

  for (const [stId, ps] of perState.entries()) {
    monthlyByState.push({
      monthKey: key,
      monthLabel: label,
      stateId: stId,
      negeri: stateLabel(stateMap, stId),
      scans: ps.scans,
      shops: ps.shops.size,
      consumers: ps.consumers.size,
    })
  }

  return { kpis, ranking, topShops, monthlyTrend, monthlyByState }
}
