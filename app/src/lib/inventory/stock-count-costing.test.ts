import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeBaseCost,
  stockCountImpact,
  sumStockCountImpacts,
} from './stock-count-costing'

describe('Stock Count Base Cost costing', () => {
  it('selects the exact Variant Base Cost and does not accept a fallback value', () => {
    expect(normalizeBaseCost('14.00')).toBe(14)
    expect(normalizeBaseCost(null)).toBeNull()
  })

  it('keeps the worksheet source free of average-cost selection', () => {
    const component = readFileSync(
      new URL('../../components/inventory/StockAdjustmentView.tsx', import.meta.url),
      'utf8',
    )
    const catalog = readFileSync(
      new URL('./stock-count-catalog.ts', import.meta.url),
      'utf8',
    )
    expect(catalog).toContain('unitCost: normalizeBaseCost(variant.base_cost)')
    expect(component).not.toContain('item.average_cost')
    expect(catalog).not.toContain('average_cost')
  })

  it.each([
    [-6_415, -89_810],
    [3_000, 42_000],
    [3, 42],
    [-2_183, -30_562],
  ])('calculates a signed decimal-safe impact for %i units', (quantity, expected) => {
    expect(stockCountImpact(quantity, '14.00')).toBe(expected)
  })

  it('sums in integer cents instead of accumulating binary decimal drift', () => {
    expect(sumStockCountImpacts([
      { quantityChange: 3, baseCost: '0.10' },
      { quantityChange: 3, baseCost: '0.20' },
    ])).toBe(0.9)
  })
})
