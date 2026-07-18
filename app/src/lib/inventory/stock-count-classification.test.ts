import { describe, expect, it } from 'vitest'
import {
  buildInitialClassificationGroups,
  computeClassificationEntry,
  summarizeClassificationRound,
  type ClassificationRoundGroupInput,
} from './stock-count-classification'

describe('buildInitialClassificationGroups', () => {
  const rowsFor = (variantId: string, legacyQuantity: number) => [
    { variantId, productName: 'Cellera', variantName: variantId, configCode: 'UNCLASSIFIED', systemQuantity: legacyQuantity },
    { variantId, productName: 'Cellera', variantName: variantId, configCode: '50OB', systemQuantity: 0 },
    { variantId, productName: 'Cellera', variantName: variantId, configCode: '20NB', systemQuantity: 0 },
    { variantId, productName: 'Cellera', variantName: variantId, configCode: '50NB', systemQuantity: 0 },
  ]

  it('excludes completed Legacy-zero variants from the next classification export', () => {
    const groups = buildInitialClassificationGroups([
      ...rowsFor('Banana Milk', 0),
      ...rowsFor('Butterscotch Cream', 0),
      ...rowsFor('Deferred Flavour', 100),
    ])

    expect(groups.map(group => group.variantId)).toEqual(['Deferred Flavour'])
  })

  it('keeps deferred positive-Legacy variants and orders all three targets', () => {
    const [group] = buildInitialClassificationGroups(rowsFor('Deferred Flavour', 120))

    expect(group.legacyRow.systemQuantity).toBe(120)
    expect(group.targetRows.map(row => row.configCode)).toEqual(['20NB', '50NB', '50OB'])
  })
})

describe('computeClassificationEntry', () => {
  it('classifies legacy 100 into 40/35/25 with zero variance', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '35' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.classifiedTotal).toBe(100)
    expect(result.variance).toBe(0)
    expect(result.complete).toBe(true)
    expect(result.countedTargets).toBe(3)
  })

  it('classifies legacy 100 into a total of 98 with a genuine -2 variance', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '33' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.classifiedTotal).toBe(98)
    expect(result.variance).toBe(-2)
    expect(result.complete).toBe(true)
  })

  it('is incomplete when any target is blank, and never guesses the blank as zero', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.complete).toBe(false)
    // A partially-filled flavour is still SELECTED (it blocks posting) but not
    // complete — it must never be silently ignored.
    expect(result.selected).toBe(true)
    expect(result.countedTargets).toBe(2)
    // Classified total only reflects entered counts — the blank row is not
    // folded in as 0, so this total is informational only until complete.
    expect(result.classifiedTotal).toBe(65)
  })

  it('is incomplete with zero targets (no 20NB/50NB/50OB catalog rows yet)', () => {
    const result = computeClassificationEntry(100, [])
    expect(result.complete).toBe(false)
    expect(result.countedTargets).toBe(0)
    expect(result.classifiedTotal).toBe(0)
  })

  it('is NOT selected when all three targets are blank (deferred to a later round)', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '' },
      { configCode: '50NB', physicalCount: '' },
      { configCode: '50OB', physicalCount: '' },
    ])
    // A deferred flavour must not consume its Legacy balance: not selected, not
    // complete, and — critically — its variance is never added to the round.
    expect(result.selected).toBe(false)
    expect(result.complete).toBe(false)
    expect(result.countedTargets).toBe(0)
  })

  it('treats an explicit 0 in every target as counted, complete, and selected', () => {
    const result = computeClassificationEntry(0, [
      { configCode: '20NB', physicalCount: '0' },
      { configCode: '50NB', physicalCount: '0' },
      { configCode: '50OB', physicalCount: '0' },
    ])
    expect(result.selected).toBe(true)
    expect(result.complete).toBe(true)
    expect(result.classifiedTotal).toBe(0)
    expect(result.variance).toBe(0)
    expect(result.totalInventory).toBe(0)
  })

  it('a single explicit 0 selects the flavour (an explicit 0 is a real count)', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '0' },
      { configCode: '50NB', physicalCount: '' },
      { configCode: '50OB', physicalCount: '' },
    ])
    expect(result.selected).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.countedTargets).toBe(1)
  })

  it('never double-counts legacy 100 + physical 40/35/25 as 200 — total inventory is 100', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '35' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.classifiedTotal).toBe(100)
    expect(result.variance).toBe(0)
    expect(result.complete).toBe(true)
    // The legacy balance is the source, not an additional layer. After
    // classification the legacy is cleared to zero and all 100 units
    // are on the three target configs. Total inventory = 100, not 200.
    expect(result.totalInventory).toBe(100)
  })

  it('legacy 100 + physical 40/35/25 produces totalInventory 100, not 200 — regression guard', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '35' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.totalInventory).toBe(100)
    // Explicitly assert the sum is NEVER the double-counted value
    expect(result.totalInventory).not.toBe(200)
  })

  it('incomplete classification has totalInventory equal to legacy system quantity', () => {
    const result = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '' },
      { configCode: '50OB', physicalCount: '25' },
    ])
    expect(result.complete).toBe(false)
    // Nothing has been posted yet so the legacy balance hasn't been touched
    expect(result.totalInventory).toBe(100)
  })
})

// ── Partial-classification round selection (confirmed incident) ──────────────
describe('summarizeClassificationRound — selection semantics', () => {
  const complete = (legacy: number): ClassificationRoundGroupInput => ({
    legacySystemQuantity: legacy,
    unitCost: 14,
    targets: [
      { configCode: '20NB', physicalCount: '50' },
      { configCode: '50NB', physicalCount: '40' },
      { configCode: '50OB', physicalCount: '30' },
    ],
  })
  const blank = (legacy: number): ClassificationRoundGroupInput => ({
    legacySystemQuantity: legacy,
    unitCost: 14,
    targets: [
      { configCode: '20NB', physicalCount: '' },
      { configCode: '50NB', physicalCount: '' },
      { configCode: '50OB', physicalCount: '' },
    ],
  })

  it('34 legacy flavours, only two selected 50/40/30 → net +40, NOT -3,160', () => {
    // Two selected complete flavours (legacy 100 each) + 32 deferred blanks
    // whose legacy balances sum to 3,200. The deferred balances must NOT be
    // charged as gross removal.
    const deferredLegacies = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    expect(deferredLegacies).toHaveLength(32)
    const groups = [complete(100), complete(100), ...deferredLegacies.map(blank)]

    const summary = summarizeClassificationRound(groups)

    expect(summary.totalFlavours).toBe(34)
    expect(summary.selectedFlavours).toBe(2)
    expect(summary.deferredFlavours).toBe(32)
    expect(summary.completeFlavours).toBe(2)
    expect(summary.partialFlavours).toBe(0)
    expect(summary.selectedLegacyTotal).toBe(200)
    expect(summary.selectedTargetTotal).toBe(240)
    // The whole point: +40, never -3,160.
    expect(summary.netVariance).toBe(40)
    expect(summary.netVariance).not.toBe(-3160)
    // 40 net units × RM14 base cost = RM560.
    expect(summary.estimatedValue).toBe(560)
  })

  it('per selected flavour genuine variance is +20 (120 target − 100 legacy)', () => {
    const single = summarizeClassificationRound([complete(100)])
    expect(single.netVariance).toBe(20)
    expect(single.selectedLegacyTotal).toBe(100)
    expect(single.selectedTargetTotal).toBe(120)
  })

  it('an all-blank session selects nothing (must be blocked upstream)', () => {
    const summary = summarizeClassificationRound([blank(100), blank(250), blank(3050)])
    expect(summary.selectedFlavours).toBe(0)
    expect(summary.completeFlavours).toBe(0)
    expect(summary.netVariance).toBe(0)
    expect(summary.selectedLegacyTotal).toBe(0)
  })

  it('a partially selected flavour is surfaced as a blocker, not silently dropped', () => {
    const partial: ClassificationRoundGroupInput = {
      legacySystemQuantity: 100,
      unitCost: 14,
      targets: [
        { configCode: '20NB', physicalCount: '50' },
        { configCode: '50NB', physicalCount: '' },
        { configCode: '50OB', physicalCount: '' },
      ],
    }
    const summary = summarizeClassificationRound([partial, complete(100), blank(100)])
    expect(summary.selectedFlavours).toBe(2) // partial + complete
    expect(summary.partialFlavours).toBe(1)
    expect(summary.completeFlavours).toBe(1)
    // Net variance counts ONLY the complete selected flavour; posting is blocked
    // by the partial until it is finished or cleared.
    expect(summary.netVariance).toBe(20)
  })

  it('explicit 0 in every target of a selected flavour is accepted as complete', () => {
    const zeros: ClassificationRoundGroupInput = {
      legacySystemQuantity: 0,
      unitCost: 14,
      targets: [
        { configCode: '20NB', physicalCount: '0' },
        { configCode: '50NB', physicalCount: '0' },
        { configCode: '50OB', physicalCount: '0' },
      ],
    }
    const summary = summarizeClassificationRound([zeros])
    expect(summary.selectedFlavours).toBe(1)
    expect(summary.completeFlavours).toBe(1)
    expect(summary.partialFlavours).toBe(0)
    expect(summary.netVariance).toBe(0)
  })

  it('a second round classifies two more flavours after the first two are cleared', () => {
    // After round 1 the two classified flavours have Legacy 0 and drop out of
    // classificationGroups (systemQuantity > 0 filter), so a fresh round only
    // sees the remaining flavours; select two of them.
    const round2 = summarizeClassificationRound([
      complete(100), complete(100),
      blank(100), blank(100), blank(100),
    ])
    expect(round2.selectedFlavours).toBe(2)
    expect(round2.deferredFlavours).toBe(3)
    expect(round2.netVariance).toBe(40)
    expect(round2.selectedLegacyTotal).toBe(200)
  })
})
