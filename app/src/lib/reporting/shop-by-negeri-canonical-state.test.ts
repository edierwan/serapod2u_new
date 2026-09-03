import { describe, expect, it } from 'vitest'

import {
  buildCanonicalStates,
  canonicalStateKey,
  resolveCanonicalStateSelection,
} from './canonical-state'
import {
  buildNegeriReport,
  selectCanonicalStates,
  type DateWindow,
  type NegeriOrgRow,
  type NegeriScanRow,
  type NegeriStateRow,
} from './shop-by-negeri'

// Mirrors the live data: two "Selangor" rows, one attached to Central Region
// and one with no region at all, with organizations split across both.
const SELANGOR_A = 'state-selangor-a'
const SELANGOR_B = 'state-selangor-b'
const JOHOR = 'state-johor'
const CENTRAL = 'region-central'

const states: NegeriStateRow[] = [
  { id: JOHOR, state_name: 'Johor', region_id: 'region-southern' },
  { id: SELANGOR_A, state_name: 'Selangor', region_id: CENTRAL },
  { id: SELANGOR_B, state_name: ' SELANGOR ', region_id: null },
]

const orgs: NegeriOrgRow[] = [
  { id: 'shop-a1', org_name: 'Shop A1', branch: null, state_id: SELANGOR_A, contact_name: null, contact_phone: null },
  { id: 'shop-b1', org_name: 'Shop B1', branch: null, state_id: SELANGOR_B, contact_name: null, contact_phone: null },
  { id: 'shop-b2', org_name: 'Shop B2', branch: null, state_id: SELANGOR_B, contact_name: null, contact_phone: null },
  { id: 'shop-j1', org_name: 'Shop J1', branch: null, state_id: JOHOR, contact_name: null, contact_phone: null },
]

const window: DateWindow = {
  start: new Date('2026-06-01T00:00:00.000Z'),
  end: new Date('2026-07-01T00:00:00.000Z'),
  prevStart: new Date('2026-05-01T00:00:00.000Z'),
  prevEnd: new Date('2026-06-01T00:00:00.000Z'),
}

function scan(id: string, shopId: string, consumerId: string, scannedAt: string): NegeriScanRow {
  return { id, consumer_id: consumerId, scanned_at: scannedAt, shop_id: shopId, points_amount: 10 }
}

const scans: NegeriScanRow[] = [
  scan('s1', 'shop-a1', 'c1', '2026-06-05T02:00:00.000Z'),
  scan('s2', 'shop-a1', 'c2', '2026-06-06T02:00:00.000Z'),
  scan('s3', 'shop-b1', 'c2', '2026-06-07T02:00:00.000Z'),
  scan('s4', 'shop-b2', 'c3', '2026-06-08T02:00:00.000Z'),
  // Same shop scanned twice — the shop must stay unique in the union.
  scan('s5', 'shop-b2', 'c4', '2026-06-09T02:00:00.000Z'),
  scan('s6', 'shop-j1', 'c5', '2026-06-10T02:00:00.000Z'),
]

describe('canonical state identity', () => {
  it('is case and spacing tolerant', () => {
    expect(canonicalStateKey('Selangor')).toBe(canonicalStateKey('SELANGOR'))
    expect(canonicalStateKey('Selangor')).toBe(canonicalStateKey('  Selangor  '))
  })

  it('collapses known aliases onto one identity', () => {
    expect(canonicalStateKey('Penang')).toBe(canonicalStateKey('Pulau Pinang'))
  })

  it('groups duplicate rows into one logical state that keeps both ids', () => {
    const canonical = buildCanonicalStates(states)
    const selangor = canonical.filter((s) => s.name.trim().toLowerCase() === 'selangor')

    expect(canonical).toHaveLength(2)
    expect(selangor).toHaveLength(1)
    expect(selangor[0].stateIds).toEqual([SELANGOR_A, SELANGOR_B])
    expect(selangor[0].regionIds).toEqual([CENTRAL])
  })

  it('resolves a selection given as a canonical key, a raw states.id or a name', () => {
    const key = canonicalStateKey('Selangor')
    expect(resolveCanonicalStateSelection(key, states)).toBe(key)
    expect(resolveCanonicalStateSelection(SELANGOR_A, states)).toBe(key)
    expect(resolveCanonicalStateSelection(SELANGOR_B, states)).toBe(key)
    expect(resolveCanonicalStateSelection('selangor', states)).toBe(key)
    expect(resolveCanonicalStateSelection('all', states)).toBeNull()
    expect(resolveCanonicalStateSelection('', states)).toBeNull()
  })

  it('shows a duplicated state once inside its region', () => {
    const central = selectCanonicalStates(states, CENTRAL, 'all')
    expect(central).toHaveLength(1)
    expect(central[0].stateIds).toEqual([SELANGOR_A, SELANGOR_B])
  })
})

describe('buildNegeriReport with duplicate state rows', () => {
  it('produces one Selangor ranking row covering both underlying ids', () => {
    const report = buildNegeriReport({ scans, orgs, states, window })
    const selangorRows = report.ranking.filter((r) => r.negeri.trim().toLowerCase() === 'selangor')

    expect(selangorRows).toHaveLength(1)
    const [selangor] = selangorRows
    expect(selangor.stateIds).toEqual([SELANGOR_A, SELANGOR_B])
    // union of unique shops across both ids: shop-a1, shop-b1, shop-b2
    expect(selangor.shops).toBe(3)
    // all scans across both ids
    expect(selangor.scans).toBe(5)
    // unique consumers across both ids: c1, c2, c3, c4 (c2 scanned in both)
    expect(selangor.consumers).toBe(4)
    expect(selangor.points).toBe(50)
    expect(selangor.avgPerShop).toBeCloseTo(5 / 3)
  })

  it('does not let duplicate rows inflate the Total States denominator', () => {
    const report = buildNegeriReport({ scans, orgs, states, window })
    expect(report.kpis.totalStates).toBe(2)
    expect(report.kpis.totalStatesActive).toBe(2)
  })

  it('combines both ids when the logical state is selected', () => {
    const key = canonicalStateKey('Selangor')
    const report = buildNegeriReport({ scans, orgs, states, negeriId: key, window })

    expect(report.ranking).toHaveLength(1)
    expect(report.ranking[0].shops).toBe(3)
    expect(report.ranking[0].scans).toBe(5)
    expect(report.kpis.totalShops).toBe(3)
    expect(report.kpis.totalScans).toBe(5)
    expect(report.kpis.totalConsumers).toBe(4)
    expect(report.kpis.totalStates).toBe(1)
    // The whole state's shops are reachable, not just one id's half.
    expect(report.topShops.map((s) => s.shopId).sort()).toEqual(['shop-a1', 'shop-b1', 'shop-b2'])
    expect(report.monthlyByState).toHaveLength(1)
    expect(report.monthlyByState[0].scans).toBe(5)
  })

  it('selecting either raw states.id still returns the combined result', () => {
    const viaKey = buildNegeriReport({ scans, orgs, states, negeriId: canonicalStateKey('Selangor'), window })
    for (const legacyId of [SELANGOR_A, SELANGOR_B]) {
      const viaId = buildNegeriReport({ scans, orgs, states, negeriId: legacyId, window })
      expect(viaId.kpis).toEqual(viaKey.kpis)
      expect(viaId.ranking).toEqual(viaKey.ranking)
    }
  })

  it('keeps a region filter on a state whose duplicate carries the region', () => {
    const report = buildNegeriReport({ scans, orgs, states, regionId: CENTRAL, window })
    expect(report.ranking).toHaveLength(1)
    expect(report.ranking[0].negeri.trim().toLowerCase()).toBe('selangor')
    expect(report.ranking[0].scans).toBe(5)
    expect(report.kpis.totalStates).toBe(1)
  })

  it('still filters the ranking by the free-text negeri search', () => {
    const report = buildNegeriReport({ scans, orgs, states, search: 'joh', window })
    expect(report.ranking.map((r) => r.negeri)).toEqual(['Johor'])
  })
})
