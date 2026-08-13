import { describe, expect, it } from 'vitest'
import {
  matchPastedOrder,
  resolvePasteInventoryOutcome,
  type PasteMatchResult,
} from '@/components/orders/quick-order-matcher'
import { buildPasteResultText, titleCaseHeading } from './paste-order-result-text'

const variant = (
  id: string,
  productName: string,
  flavour: string,
  availableQty: number,
  alternativeName?: string,
) => ({
  id,
  product_name: productName,
  product_code: `CODE-${productName.replace(/\s+/g, '-')}`,
  variant_product_code: id.toUpperCase(),
  group_name: 'Catridge',
  variant_name: `Cellera Cartridge [ ${flavour} ]`,
  alternative_name: alternativeName ?? null,
  manufacturer_sku: `SKU-${id}`,
  available_qty: availableQty,
  inventory_classification: 'classified' as const,
})

// Mirrors the real Vape catalog closely enough to exercise grouping: two
// product lines, one flavour with no stock, one that resolves by alternative
// name ("strawberry cheesecake" -> Strawberry Corn).
const catalog = [
  variant('co', 'Cellera Hero', 'Corn', 0),
  variant('gr', 'Cellera Hero', 'Grape', 5505),
  variant('gp', 'Cellera Hero', 'Grape Pudina', 8545),
  variant('sc', 'Cellera Hero', 'Strawberry Corn', 10514, 'Strawberry Cheesecake'),
  variant('vt', 'Cellera Hero', 'Vanilla Tobacco', 5325),
  variant('al', 'Cellera Zero', 'Almond', 4856),
  variant('jac', 'Cellera Zero', 'Jackfruit', 5821),
]

const available = (result: PasteMatchResult) => {
  const selected = catalog.find(item => item.id === result.selectedVariantId)
  if (!selected) return false
  return resolvePasteInventoryOutcome(result.quantity, selected) === 'matched'
}

describe('WhatsApp reply text', () => {
  it('groups by product, marks each line, and separates groups with a blank line', () => {
    const pasted = [
      'grape 100✅',
      'grape pudina 50✅',
      'corn 50✅',
      'strawberry cheesecake 200✅',
      'vanilla tobacco 50✅',
      '',
      'cellera zero',
      'almond 50✅',
      'jackfruit 100✅',
    ].join('\n')

    const results = matchPastedOrder(pasted, catalog)
    expect(buildPasteResultText(results, catalog, available)).toBe(
      [
        'Cellera Hero',
        'grape 100✅',
        'grape pudina 50✅',
        'corn 50❌',
        'strawberry cheesecake 200✅',
        'vanilla tobacco 50✅',
        '',
        'Cellera Zero',
        'almond 50✅',
        'jackfruit 100✅',
      ].join('\n'),
    )
  })

  it('marks a line the warehouse cannot fill, not the mark the sender wrote', () => {
    // The distributor optimistically wrote ✅; Corn has zero stock.
    const results = matchPastedOrder('corn 50✅', catalog)
    expect(buildPasteResultText(results, catalog, available)).toBe('Cellera Hero\ncorn 50❌')
  })

  it('sends unresolved entries to a trailing Unmatched group', () => {
    const results = matchPastedOrder('grape 100\nunicorn dust 20', catalog)
    expect(buildPasteResultText(results, catalog, available)).toBe(
      'Cellera Hero\ngrape 100✅\n\nUnmatched\nunicorn dust 20❌',
    )
  })

  it('returns an empty string when there is nothing to report', () => {
    expect(buildPasteResultText([], catalog, available)).toBe('')
  })

  it('capitalises headings without mangling casing inside a word', () => {
    expect(titleCaseHeading('cellera hero')).toBe('Cellera Hero')
    expect(titleCaseHeading('Cellera Zero')).toBe('Cellera Zero')
    expect(titleCaseHeading('Serapod Device S.Line')).toBe('Serapod Device S.Line')
    expect(titleCaseHeading('SERAPOD® TUMBLER')).toBe('SERAPOD® TUMBLER')
  })
})
