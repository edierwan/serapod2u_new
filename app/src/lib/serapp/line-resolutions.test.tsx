import { describe, expect, it } from 'vitest'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import {
  applySerappLineResolutions,
  applySerappQuantityResolutions,
  parseSerappLineResolutions,
  runSerappPasteCheck,
} from './line-resolutions'

const banana = {
  id: 'v-banana',
  product_id: 'p-hero',
  product_name: 'Cellera Hero',
  product_code: 'CEL-BAN',
  group_name: 'Cartridge',
  variant_name: 'Banana Vanilla',
  available_qty: 80,
  inventory_classification: 'classified' as const,
  distributor_price: 10,
}

const mango = {
  id: 'v-mango',
  product_id: 'p-hero',
  product_name: 'Cellera Hero',
  product_code: 'CEL-MAN',
  group_name: 'Cartridge',
  variant_name: 'Mango',
  available_qty: 20,
  inventory_classification: 'classified' as const,
  distributor_price: 11,
}

const tea = {
  id: 'v-tea',
  product_id: 'p-zero',
  product_name: 'Cellera Zero',
  product_code: 'CEL-TEA',
  group_name: 'Cartridge',
  variant_name: 'Tea',
  available_qty: 5,
  inventory_classification: 'classified' as const,
  distributor_price: 12,
}

function line(partial: Partial<PasteMatchResult> & Pick<PasteMatchResult, 'status'>): PasteMatchResult {
  return {
    line: 1,
    sourceLine: 1,
    raw: 'MANGO - 10',
    name: 'MANGO',
    normalizedName: 'MANGO',
    quantity: 10,
    candidates: [],
    ...partial,
  }
}

describe('parseSerappLineResolutions', () => {
  it('keeps the first valid pick per line', () => {
    expect(parseSerappLineResolutions([
      { line: 2, variantId: 'v-a' },
      { line: 2, variantId: 'v-b' },
      { line: 'x', variantId: 'v-c' },
      { line: 3, variantId: '  ' },
    ])).toEqual([{ line: 2, variantId: 'v-a' }])
  })
})

describe('applySerappLineResolutions', () => {
  it('lets the distributor pick an ambiguous candidate without changing other lines', () => {
    const results = applySerappLineResolutions(
      [
        line({
          status: 'ambiguous',
          candidates: [mango, banana],
        }),
        line({
          line: 2,
          status: 'matched',
          selectedVariantId: banana.id,
          quantity: 4,
          candidates: [banana],
        }),
      ],
      [banana, mango, tea],
      [{ line: 1, variantId: mango.id }],
    )

    expect(results[0]).toMatchObject({
      status: 'matched',
      selectedVariantId: mango.id,
      inventoryOutcome: 'matched',
    })
    expect(results[1].selectedVariantId).toBe(banana.id)
  })

  it('rejects an ambiguous pick that is not in the matcher candidates', () => {
    const [result] = applySerappLineResolutions(
      [line({ status: 'ambiguous', candidates: [mango] })],
      [banana, mango, tea],
      [{ line: 1, variantId: tea.id }],
    )
    expect(result.status).toBe('ambiguous')
    expect(result.selectedVariantId).toBeUndefined()
  })

  it('allows mapping a not-found line onto a real catalog item in the same section', () => {
    const [result] = applySerappLineResolutions(
      [line({
        status: 'not_found',
        raw: 'XYZFAKE - 10',
        name: 'XYZFAKE',
        sectionProductLine: 'Cellera Hero',
      })],
      [banana, mango, tea],
      [{ line: 1, variantId: banana.id }],
    )
    expect(result).toMatchObject({
      status: 'matched',
      selectedVariantId: banana.id,
    })
  })

  it('does not let a Hero not-found line pick a Zero product', () => {
    const [result] = applySerappLineResolutions(
      [line({
        status: 'not_found',
        sectionProductLine: 'Cellera Hero',
      })],
      [banana, mango, tea],
      [{ line: 1, variantId: tea.id }],
    )
    expect(result.status).toBe('not_found')
  })

  it('recomputes insufficient stock after a manual pick', () => {
    const [result] = applySerappLineResolutions(
      [line({
        status: 'suggestion',
        quantity: 50,
        candidates: [tea],
      })],
      [tea],
      [{ line: 1, variantId: tea.id }],
    )
    expect(result).toMatchObject({
      status: 'matched',
      selectedVariantId: tea.id,
      inventoryOutcome: 'insufficient_stock',
    })
  })
})

describe('applySerappQuantityResolutions', () => {
  it('fills missing quantity and marks the line matched', () => {
    const [result] = applySerappQuantityResolutions(
      [line({
        status: 'missing_quantity',
        quantity: null,
        selectedVariantId: tea.id,
        candidates: [tea],
      })],
      [tea],
      [{ line: 1, quantity: 3 }],
    )
    expect(result).toMatchObject({
      status: 'matched',
      quantity: 3,
      selectedVariantId: tea.id,
      inventoryOutcome: 'matched',
    })
  })
})

describe('runSerappPasteCheck', () => {
  it('keeps unmatched until a valid pick is applied', () => {
    const paste = 'HERO\nNOTAREALFLAVOUR - 10'
    const before = runSerappPasteCheck(paste, [banana, mango, tea])
    expect(before.summary.bucket).toBe('unmatched_or_review')

    const reviewLine = before.results.find(result => result.status === 'not_found')
    expect(reviewLine).toBeTruthy()

    const after = runSerappPasteCheck(paste, [banana, mango, tea], [
      { line: reviewLine!.line, variantId: banana.id },
    ])
    expect(after.summary.bucket).toBe('available')
    expect(after.summary.reviewLines).toBe(0)
  })
})
