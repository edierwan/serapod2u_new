import { describe, expect, it } from 'vitest'
import {
  salesOrderFamilyRank,
  salesOrderLineDescription,
  salesOrderVariantFlavour,
  sortSalesOrderLinesForDisplay,
} from './sales-order-line-presentation'

/**
 * Supply Chain > Order Management > Sales Order — the line description and the
 * display grouping. The SO line names the Product and the flavour and drops the
 * marketing range wording master data repeats inside every variant name; the
 * rows are grouped Hero before Zero.
 *
 * Presentation only: every case below also checks that nothing about the
 * quantities, prices or line order stored on the order has moved.
 */
describe('Sales Order line description', () => {
  it('reads "<Product Name> - [ Flavour ]", not the whole Variant Name', () => {
    expect(salesOrderLineDescription('Cellera Zero', 'Zero Edition Novella [ Almond Corn ]'))
      .toBe('Cellera Zero - [ Almond Corn ]')
  })

  it('formats Hero the same way', () => {
    expect(salesOrderLineDescription('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]'))
      .toBe('Cellera Hero - [ Honeydew ]')
    expect(salesOrderLineDescription('Cellera Hero', 'Deluxe Cellera Cartridge [ Strawberry Pudina ]'))
      .toBe('Cellera Hero - [ Strawberry Pudina ]')
    expect(salesOrderLineDescription('Cellera Hero', 'Deluxe Cellera Cartridge [ Banana Vanilla ]'))
      .toBe('Cellera Hero - [ Banana Vanilla ]')
  })

  it('never prints the marketing / series wording', () => {
    const marketing = [
      'Zero Edition Novella',
      'Zero Edition Trevia',
      'Fruity Cellera Cartridge',
      'Deluxe Cellera Cartridge',
    ]
    for (const range of marketing) {
      const description = salesOrderLineDescription('Cellera Zero', `${range} [ Mango Blackcurrant ]`)
      expect(description).toBe('Cellera Zero - [ Mango Blackcurrant ]')
      expect(description).not.toContain(range)
    }
    // The exact strings the old formatter produced are gone.
    expect(salesOrderLineDescription('Cellera Zero', 'Zero Edition Novella [ Almond Corn ]'))
      .not.toBe('Cellera Zero Zero Edition Novella [ Almond Corn ]')
    expect(salesOrderLineDescription('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]'))
      .not.toBe('Cellera Hero Fruity Cellera Cartridge [ Honeydew ]')
  })

  it('uses the ordered flavour, never the Alternative Name', () => {
    // Master data: Almond Corn is sold to distributors as "Butterscotch Coffee".
    // The SO must name what was ordered. The helper takes no alternative-name
    // argument at all, so there is nothing to swap in.
    const description = salesOrderLineDescription('Cellera Zero', 'Zero Edition Novella [ Almond Corn ]')
    expect(description).toContain('Almond Corn')
    expect(description).not.toContain('Butterscotch Coffee')
    expect(salesOrderLineDescription.length).toBe(2)
  })

  it('keeps the flavour master data brackets, whichever group carries it', () => {
    expect(salesOrderVariantFlavour('Zero Edition Novella [ Almond Corn ]')).toBe('[ Almond Corn ]')
    // A trailing empty group must not win over the real flavour.
    expect(salesOrderVariantFlavour('Cellera Zero [ Novella ] [ Buttercake ]')).toBe('[ Buttercake ]')
    expect(salesOrderVariantFlavour('  [Honeydew]  ')).toBe('[ Honeydew ]')
  })

  it('drops the half it has no data for instead of printing a dangling separator', () => {
    expect(salesOrderLineDescription('Cellera Hero', null)).toBe('Cellera Hero')
    expect(salesOrderLineDescription('Cellera Hero', '  ')).toBe('Cellera Hero')
    expect(salesOrderLineDescription(null, 'Deluxe Cellera Cartridge [ Grape ]')).toBe('[ Grape ]')
    expect(salesOrderLineDescription(null, null)).toBe('')
    for (const description of [
      salesOrderLineDescription('Cellera Hero', null),
      salesOrderLineDescription(null, 'Deluxe Cellera Cartridge [ Grape ]'),
    ]) {
      expect(description.trim().endsWith('-')).toBe(false)
      expect(description).not.toContain('[ ]')
      expect(description).not.toContain('undefined')
      expect(description).not.toContain('null')
    }
  })

  it('brackets a variant master data stored without any, and never doubles a name', () => {
    // Nothing better to show than the variant's own text — but two Durian-less
    // lines of the same Product must still read differently.
    expect(salesOrderLineDescription('Cellera Hero', 'Durian')).toBe('Cellera Hero - [ Durian ]')
    // A variant that merely repeats the Product is one name, not two.
    expect(salesOrderLineDescription('Cellera Hero', 'Cellera Hero')).toBe('Cellera Hero')
    expect(salesOrderLineDescription('Cellera Hero', '[ cellera hero ]')).toBe('Cellera Hero')
  })
})

describe('Sales Order line grouping', () => {
  const line = (product: string, flavour: string, qty: number, unitPrice: number) => ({
    product: { product_name: product },
    variant: { variant_name: flavour },
    qty,
    unit_price: unitPrice,
    line_total: qty * unitPrice,
  })
  const productNameOf = (item: { product: { product_name: string } }) => item.product.product_name

  // The stored order deliberately interleaves the two families.
  const stored = [
    line('Cellera Zero', 'Zero Edition Novella [ Almond Corn ]', 100, 14),
    line('Cellera Hero', 'Deluxe Cellera Cartridge [ Banana Vanilla ]', 200, 32),
    line('Cellera Zero', 'Zero Edition Trevia [ Mango Blackcurrant ]', 300, 14),
    line('Cellera Hero', 'Fruity Cellera Cartridge [ Corn Vanilla ]', 400, 32),
    line('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]', 500, 32),
    line('Cellera Zero', 'Zero Edition Novella [ Anggur ]', 600, 14),
  ]

  it('ranks Hero first, Zero second, every other family last', () => {
    expect(salesOrderFamilyRank('Cellera Hero')).toBe(0)
    expect(salesOrderFamilyRank('Cellera Zero')).toBe(1)
    expect(salesOrderFamilyRank('Serapod Device S.Box')).toBe(2)
    expect(salesOrderFamilyRank('Serapod Tumbler')).toBe(2)
    expect(salesOrderFamilyRank(null)).toBe(2)
    expect(salesOrderFamilyRank('Cellera Hero')).toBeLessThan(salesOrderFamilyRank('Cellera Zero'))
  })

  it('shows every Hero row before the first Zero row', () => {
    const sorted = sortSalesOrderLinesForDisplay(stored, productNameOf)
    const families = sorted.map((item) => salesOrderFamilyRank(productNameOf(item)))
    expect(families).toEqual([0, 0, 0, 1, 1, 1])

    const lastHero = families.lastIndexOf(0)
    const firstZero = families.indexOf(1)
    expect(lastHero).toBeLessThan(firstZero)
  })

  it('is stable: each family keeps the order it was stored in', () => {
    const sorted = sortSalesOrderLinesForDisplay(stored, productNameOf)
    const flavoursOf = (product: string, items: typeof stored) =>
      items.filter((item) => item.product.product_name === product).map((item) => item.variant.variant_name)

    expect(flavoursOf('Cellera Hero', sorted)).toEqual(flavoursOf('Cellera Hero', stored))
    expect(flavoursOf('Cellera Zero', sorted)).toEqual(flavoursOf('Cellera Zero', stored))
  })

  it('puts other families after Zero, in their own stored order', () => {
    const mixed = [
      line('Serapod Device S.Box', 'SERAPOD SONAR NEO', 5, 100),
      ...stored,
      line('Serapod Device S.Line', 'SERAPOD SONAR', 6, 120),
    ]
    const sorted = sortSalesOrderLinesForDisplay(mixed, productNameOf)
    expect(sorted.map((item) => salesOrderFamilyRank(productNameOf(item))))
      .toEqual([0, 0, 0, 1, 1, 1, 2, 2])
    expect(sorted.slice(-2).map(productNameOf)).toEqual(['Serapod Device S.Box', 'Serapod Device S.Line'])
  })

  it('leaves the caller array untouched and re-sorts nothing in place', () => {
    const snapshot = stored.map(productNameOf)
    sortSalesOrderLinesForDisplay(stored, productNameOf)
    expect(stored.map(productNameOf)).toEqual(snapshot)
  })

  it('changes no quantity, price, amount, case total or order total', () => {
    const sorted = sortSalesOrderLinesForDisplay(stored, productNameOf)
    const cases = (items: typeof stored) => items.reduce((sum, item) => sum + item.qty, 0)
    const amount = (items: typeof stored) => items.reduce((sum, item) => sum + item.line_total, 0)

    expect(sorted).toHaveLength(stored.length)
    expect(cases(sorted)).toBe(cases(stored))
    expect(amount(sorted)).toBe(amount(stored))
    // The same row objects, not rebuilt copies: ids, prices and variant ids
    // cannot drift.
    for (const item of stored) expect(sorted).toContain(item)
    for (const item of sorted) {
      const original = stored.find((row) => row === item)!
      expect(item.qty).toBe(original.qty)
      expect(item.unit_price).toBe(original.unit_price)
      expect(item.line_total).toBe(original.line_total)
    }
  })

  it('handles an empty or absent line list', () => {
    expect(sortSalesOrderLinesForDisplay([], productNameOf)).toEqual([])
    expect(sortSalesOrderLinesForDisplay(null, productNameOf)).toEqual([])
    expect(sortSalesOrderLinesForDisplay(undefined, productNameOf)).toEqual([])
  })
})
