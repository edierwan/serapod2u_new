import { describe, expect, it } from 'vitest'
import { matchPastedOrder, normalizeOrderText, stripTrailingWhatsAppMarkers } from './quick-order-matcher'

const variants = [
  { id: 'lychee', variant_name: 'Lychee Blackcurrant', product_name: 'Cellera Hero', product_code: 'CEL-H', manufacturer_sku: 'SKU-001' },
  { id: 'mango-a', variant_name: 'Mango', product_name: 'Cellera Hero', product_code: 'CEL-H-M', manufacturer_sku: 'SKU-002' },
  { id: 'mango-b', variant_name: 'Mango', product_name: 'Cellera Zero', product_code: 'CEL-Z-M', manufacturer_sku: 'SKU-003' },
  { id: 'teh', variant_name: 'Teh Tarik', product_name: 'Cellera Hero', product_code: 'CEL-TEH', manufacturer_sku: 'SKU-TEH' },
  { id: 'keladi', variant_name: 'Keladi Cheese', product_name: 'Cellera Hero', product_code: 'CEL-KEL', manufacturer_sku: 'SKU-KEL' },
  { id: 'hazelnut', variant_name: 'Coffee Hazelnut', product_name: 'Cellera Zero', product_code: 'CEL-HAZ', manufacturer_sku: 'SKU-HAZ' },
  { id: 'banana', variant_name: 'Banana Milk', product_name: 'Cellera Hero', product_code: 'CEL-BAN', manufacturer_sku: 'SKU-BAN' },
  { id: 'vanilla', variant_name: 'Vanilla Custard', product_name: 'Cellera Hero', product_code: 'CEL-VAN', manufacturer_sku: 'SKU-VAN' },
]

describe('Quick Order paste matching', () => {
  it('normalizes case and spacing and accepts supported separators', () => {
    expect(normalizeOrderText('  lychee   blackcurrant ')).toBe('LYCHEE BLACKCURRANT')
    const results = matchPastedOrder('lychee   blackcurrant - 200\nSKU-001: 3\nCEL-H\t4\nLychee Blackcurrant  5', variants)
    expect(results.map(result => result.status)).toEqual(['matched', 'duplicate', 'duplicate', 'duplicate'])
    expect(results.map(result => result.quantity)).toEqual([200, 3, 4, 5])
  })

  it('never silently chooses ambiguous or unknown names', () => {
    const results = matchPastedOrder('MANGO - 10\nGUAVA - 2', variants)
    expect(results[0]).toMatchObject({ status: 'ambiguous', selectedVariantId: undefined })
    expect(results[0].candidates).toHaveLength(2)
    expect(results[1]).toMatchObject({ status: 'not_found', selectedVariantId: undefined })
  })

  it('smart-matches unique full-word keywords deterministically', () => {
    const results = matchPastedOrder('TEH - 200\nKELADI - 30\nHAZELNUT - 4\nBANANA MILK - 5', variants)
    expect(results.map(result => result.status)).toEqual(['smart_match', 'smart_match', 'smart_match', 'matched'])
    expect(results.map(result => result.selectedVariantId)).toEqual(['teh', 'keladi', 'hazelnut', 'banana'])
    expect(results[0]).toMatchObject({ raw: 'TEH - 200', quantity: 200, matchMethod: 'keyword' })
  })

  it('keeps multiple keyword matches ambiguous', () => {
    const result = matchPastedOrder('MANGO - 10', variants)[0]
    expect(result).toMatchObject({ status: 'ambiguous', selectedVariantId: undefined })
    expect(result.candidates.map(candidate => candidate.id)).toEqual(['mango-a', 'mango-b'])
  })

  it('returns ranked typo suggestions without auto-selection', () => {
    const result = matchPastedOrder('VANILA CUSTAD - 7', variants)[0]
    expect(result).toMatchObject({ status: 'suggestion', selectedVariantId: undefined, quantity: 7, matchMethod: 'fuzzy' })
    expect(result.candidates[0].id).toBe('vanilla')
    expect(result.candidates.length).toBeLessThanOrEqual(3)
  })

  it('prioritizes exact Product Code and SKU matches', () => {
    const results = matchPastedOrder('CEL-TEH - 2\nSKU-KEL: 3', variants)
    expect(results.map(result => result.matchMethod)).toEqual(['code_or_sku', 'code_or_sku'])
    expect(results.map(result => result.selectedVariantId)).toEqual(['teh', 'keladi'])
  })

  it('ignores trailing WhatsApp markers without using them as match status', () => {
    const text = 'LYCHEE BLACKCURRANT - 200 ❌\nGUAVA - 300✅\nMANGO -1000✅\nTEH TARIK 500❌'
    const results = matchPastedOrder(text, variants)
    expect(results.map(result => result.quantity)).toEqual([200, 300, 1000, 500])
    expect(results.map(result => result.raw)).toEqual(text.split('\n'))
    expect(results[2]).toMatchObject({ name: 'MANGO', status: 'ambiguous' })
    expect(results[3]).toMatchObject({ name: 'TEH TARIK', selectedVariantId: 'teh' })
  })

  it('parses all 21 WhatsApp-formatted lines with correct quantities', () => {
    const whatsappList = [
      'LYCHEE BLACKCURRANT - 200 ❌',
      'GUAVA - 300✅',
      'MANGO -1000✅',
      'TEH TARIK 500❌',
      'HONEYDEW -200❌',
      'KELADI - 300 ✔',
      'HAZELNUT: 150✖',
      'BANANA MILK 100 ☑️',
      'VANILA CUSTAD - 75✅',
      'STRAWBERRY BUBBLEGUM -250❌',
      'CULTURED MILK 125✔',
      'VANILLA CUSTARD - 90 ✖',
      'COFFEE HAZELNUT\t80☑️',
      'CEL-TEH -60✅',
      'SKU-KEL 55❌',
      'MANGO 45✔',
      'TEH - 35✖',
      'KELADI 25☑️',
      'BANANA MILK -15✅',
      'HAZELNUT 10❌',
      'LYCHEE BLACKCURRANT 5✔',
    ].join('\n')

    const results = matchPastedOrder(whatsappList, variants)
    expect(results).toHaveLength(21)
    expect(results.map(result => result.quantity)).toEqual([
      200, 300, 1000, 500, 200, 300, 150, 100, 75, 250, 125, 90, 80, 60, 55, 45, 35, 25, 15, 10, 5,
    ])
    expect(results.map(result => result.raw)).toEqual(whatsappList.split('\n'))
  })

  it('strips only recognized trailing markers and preserves identifier characters', () => {
    expect(stripTrailingWhatsAppMarkers('SKU-✔-123 - 20✅')).toBe('SKU-✔-123 - 20')
    expect(stripTrailingWhatsAppMarkers('CODE✖VALUE - 10❌')).toBe('CODE✖VALUE - 10')
    expect(stripTrailingWhatsAppMarkers('SKU-CHECK-☑')).toBe('SKU-CHECK-☑')
  })

  it('reports invalid quantities and duplicates for review', () => {
    const results = matchPastedOrder('LYCHEE BLACKCURRANT - zero\nMANGO - 2\n mango : 3\nMANGO - 0', variants)
    expect(results.map(result => result.status)).toEqual(['invalid_quantity', 'ambiguous', 'duplicate', 'invalid_quantity'])
  })
})
