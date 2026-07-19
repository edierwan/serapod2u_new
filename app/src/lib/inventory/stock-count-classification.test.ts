import { describe, expect, it } from 'vitest'
import {
  buildInitialClassificationGroups,
  evaluateClassificationPostable,
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

  it('blocks already fully classified flavours with the required wording', () => {
    const result = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        requestedTotal: 10,
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

  it('blocks requested totals that exceed the live remaining Legacy balance', () => {
    const result = evaluateClassificationPostable(
      [{
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        requestedTotal: 150,
        selected: true,
      }],
      new Map([['v1', {
        variantId: 'v1',
        productName: 'Cellera Zero',
        variantName: 'Buttercake',
        liveOnHand: 100,
        liveAllocated: 0,
      }]]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('classification_exceeds_legacy')
    expect(result.message).toContain('requests 150')
    expect(result.message).toContain('only 100 remain')
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
