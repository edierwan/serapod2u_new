import { describe, expect, it } from 'vitest'
import {
  buildInitialClassificationGroups,
  computeClassificationEntry,
  evaluateClassificationPostable,
  summarizeClassificationRound,
} from './stock-count-classification'

describe('Initial Classification eligibility and postable guards', () => {
  it('includes only flavours with remaining Legacy/Unclassified balance', () => {
    const groups = buildInitialClassificationGroups([
      { variantId: 'a', productName: 'P', variantName: 'A', configCode: 'UNCLASSIFIED', systemQuantity: 100 },
      { variantId: 'a', productName: 'P', variantName: 'A', configCode: '20NB', systemQuantity: 0 },
      { variantId: 'b', productName: 'P', variantName: 'B', configCode: 'UNCLASSIFIED', systemQuantity: 0 },
      { variantId: 'b', productName: 'P', variantName: 'B', configCode: '20NB', systemQuantity: 40 },
    ])
    expect(groups.map((g) => g.variantId)).toEqual(['a'])
    expect(groups[0].legacyRow.systemQuantity).toBe(100)
  })

  it('allows Legacy 100 → physical target 1,100 as variance +1,000', () => {
    const entry = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '500' },
      { configCode: '50NB', physicalCount: '400' },
      { configCode: '50OB', physicalCount: '200' },
    ])
    expect(entry.complete).toBe(true)
    expect(entry.selected).toBe(true)
    expect(entry.classifiedTotal).toBe(1100)
    expect(entry.variance).toBe(1000)
    expect(entry.totalInventory).toBe(1100)

    const postable = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        requestedTotal: 1100,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        liveOnHand: 100,
        liveAllocated: 0,
      }]]),
    )
    expect(postable).toEqual({ ok: true })

    const summary = summarizeClassificationRound([{
      legacySystemQuantity: 100,
      unitCost: 10,
      targets: [
        { configCode: '20NB', physicalCount: '500' },
        { configCode: '50NB', physicalCount: '400' },
        { configCode: '50OB', physicalCount: '200' },
      ],
    }])
    expect(summary.selectedLegacyTotal).toBe(100)
    expect(summary.selectedTargetTotal).toBe(1100)
    expect(summary.netVariance).toBe(1000)
    expect(summary.estimatedValue).toBe(10000)
  })

  it('allows Legacy 100 → physical target 80 as variance -20', () => {
    const entry = computeClassificationEntry(100, [
      { configCode: '20NB', physicalCount: '40' },
      { configCode: '50NB', physicalCount: '30' },
      { configCode: '50OB', physicalCount: '10' },
    ])
    expect(entry.classifiedTotal).toBe(80)
    expect(entry.variance).toBe(-20)
    expect(entry.totalInventory).toBe(80)

    const postable = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        requestedTotal: 80,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        liveOnHand: 100,
        liveAllocated: 0,
      }]]),
    )
    expect(postable).toEqual({ ok: true })
  })

  it('blocks allocated Legacy inventory with the product/flavour name', () => {
    const result = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        requestedTotal: 100,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        liveOnHand: 100,
        liveAllocated: 1,
      }]]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('classification_allocated_blocks_post')
    expect(result.message).toContain('Cellera Zero [Buttercake]')
    expect(result.message).toContain('1 allocated unit')
    expect(result.message).not.toMatch(/auto-clear|delete|move the allocation/i)
  })

  it('blocks already fully classified flavours in a stale draft', () => {
    const result = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        requestedTotal: 1100,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        liveOnHand: 0,
        liveAllocated: 0,
      }]]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('classification_already_fully_classified')
    expect(result.message).toContain('already been fully classified')
    expect(result.message).toContain('Download a new Initial Classification template')
  })

  it('treats a successful prior classification as non-repeatable (live UNC gone)', () => {
    // After a successful post, UNC on_hand is 0. Re-opening a draft / retrying
    // the same flavour must fail the already-fully-classified guard — the same
    // protection that keeps posting idempotent at the session layer.
    const retry = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        requestedTotal: 1100,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Hero',
        variantName: 'Keladi Cheese',
        liveOnHand: 0,
        liveAllocated: 0,
      }]]),
    )
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.code).toBe('classification_already_fully_classified')
  })

  it('ignores deferred flavours and allows a valid selected flavour', () => {
    const result = evaluateClassificationPostable(
      [
        {
          variantId: 'deferred',
          productName: 'P',
          variantName: 'D',
          requestedTotal: 0,
          selected: false,
        },
        {
          variantId: 'ok',
          productName: 'P',
          variantName: 'OK',
          requestedTotal: 80,
          selected: true,
        },
      ],
      new Map([
        ['deferred', { variantId: 'deferred', productName: 'P', variantName: 'D', liveOnHand: 50, liveAllocated: 2 }],
        ['ok', { variantId: 'ok', productName: 'P', variantName: 'OK', liveOnHand: 100, liveAllocated: 0 }],
      ]),
    )
    expect(result).toEqual({ ok: true })
  })
})
