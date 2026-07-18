import { describe, expect, it } from 'vitest'
import { matchPastedOrder, normalizeOrderText, stripTrailingWhatsAppMarkers } from './quick-order-matcher'

const variants = [
  { id: 'lychee', variant_name: 'Lychee Blackcurrant', product_name: 'Cellera Hero', product_code: 'CEL-H', manufacturer_sku: 'SKU-001' },
  { id: 'mango-a', variant_name: 'Mango', product_name: 'Cellera Hero', product_code: 'CEL-H-M', manufacturer_sku: 'SKU-002' },
  { id: 'mango-b', variant_name: 'Mango', product_name: 'Cellera Zero', product_code: 'CEL-Z-M', manufacturer_sku: 'SKU-003' },
  { id: 'teh', variant_name: 'Teh Tarik', product_name: 'Cellera Hero', product_code: 'CEL-TEH', manufacturer_sku: 'SKU-TEH' },
  { id: 'keladi', variant_name: 'Keladi Cheese', product_name: 'Cellera Hero', product_code: 'CEL-KEL', manufacturer_sku: 'SKU-KEL' },
  { id: 'hazelnut', variant_name: 'Coffee Hazelnut', product_name: 'Cellera Zero', product_code: 'CEL-HAZ', manufacturer_sku: 'SKU-HAZ' },
  { id: 'banana', variant_name: 'Banana Milk', alternative_name: 'Banana Vanilla', product_name: 'Cellera Hero', product_code: 'CEL-BAN', manufacturer_sku: 'SKU-BAN' },
  { id: 'vanilla', variant_name: 'Vanilla Custard', product_name: 'Cellera Hero', product_code: 'CEL-VAN', manufacturer_sku: 'SKU-VAN' },
  // Code/SKU whose digits sit at the very end, used to prove digits inside an
  // authorized identifier are never mistaken for a quantity.
  { id: 'mint', variant_name: 'Mint', product_name: 'Cellera Zero', product_code: 'CEL-99', manufacturer_sku: 'SKU-77' },
]

describe('Quick Order paste matching', () => {
  it('matches an exact bracket flavour from the official variant name before Alternative Name', () => {
    const productMasterVariants = [
      {
        id: 'guava',
        variant_name: 'Fruity Cellera Cartridge [ Guava ]',
        alternative_name: null,
        product_name: 'Cellera Hero',
        product_code: 'CELFR53922',
        manufacturer_sku: 'SKU-GUAVA',
        available_qty: 0,
        inventory_classification: 'unclassified' as const,
      },
      {
        id: 'guava-ice',
        variant_name: 'Fruity Cellera Cartridge [ Guava Ice ]',
        alternative_name: 'GUAVA',
        product_name: 'Cellera Hero',
        product_code: 'CEL-GUAVA-ICE',
        manufacturer_sku: 'SKU-GUAVA-ICE',
        available_qty: 20,
        inventory_classification: 'classified' as const,
      },
    ]

    expect(matchPastedOrder('GUAVA - 300', productMasterVariants)[0]).toMatchObject({
      status: 'matched',
      matchMethod: 'bracket_flavour',
      selectedVariantId: 'guava',
      inventoryOutcome: 'inventory_unclassified',
    })
    expect(matchPastedOrder('FRUITY CELLERA CARTRIDGE GUAVA - 1', productMasterVariants)[0])
      .toMatchObject({ matchMethod: 'exact_name', selectedVariantId: 'guava' })
    expect(matchPastedOrder('GUAVA - 300', [{ ...productMasterVariants[1], alternative_name: null }])[0]).toMatchObject({
      status: 'not_found',
      selectedVariantId: undefined,
    })
  })

  it('reports stock outcomes without changing the successful product match', () => {
    const stockVariants = [
      { ...variants[3], id: 'none', available_qty: 0, inventory_classification: 'classified' as const },
      { ...variants[4], id: 'low', available_qty: 2, inventory_classification: 'classified' as const },
      { ...variants[5], id: 'enough', available_qty: 10, inventory_classification: 'classified' as const },
    ]

    expect(matchPastedOrder('TEH TARIK - 1', stockVariants)[0].inventoryOutcome).toBe('no_available_stock')
    expect(matchPastedOrder('KELADI CHEESE - 3', stockVariants)[0].inventoryOutcome).toBe('insufficient_stock')
    expect(matchPastedOrder('COFFEE HAZELNUT - 3', stockVariants)[0].inventoryOutcome).toBe('matched')
  })

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

  it('resolves a case-insensitive complete Alternative Name with the required status', () => {
    const result = matchPastedOrder('BANANA VANILLA - 100', variants)[0]
    expect(result).toMatchObject({
      status: 'alternative_match',
      matchMethod: 'alternative_name',
      selectedVariantId: 'banana',
      quantity: 100,
    })
    expect(result.candidates[0].variant_name).toBe('Banana Milk')
  })

  it('keeps Product Code/SKU and official Variant Name ahead of Alternative Name', () => {
    const conflictingAlternatives = variants.map(variant => variant.id === 'banana'
      ? { ...variant, alternative_name: 'TEH TARIK' }
      : variant.id === 'vanilla'
        ? { ...variant, alternative_name: 'SKU-KEL' }
        : variant)

    expect(matchPastedOrder('TEH TARIK - 2', conflictingAlternatives)[0])
      .toMatchObject({ matchMethod: 'exact_name', selectedVariantId: 'teh' })
    expect(matchPastedOrder('SKU-KEL - 3', conflictingAlternatives)[0])
      .toMatchObject({ matchMethod: 'code_or_sku', selectedVariantId: 'keladi' })
  })

  it('normalizes multiple spaces and common separators for complete Alternative Name matching', () => {
    const multipleSpaces = matchPastedOrder('banana     vanilla - 4', variants)[0]
    const separatorDifference = matchPastedOrder('BANANA-VANILLA - 5', variants)[0]

    expect(multipleSpaces).toMatchObject({ status: 'alternative_match', selectedVariantId: 'banana' })
    expect(separatorDifference).toMatchObject({ status: 'alternative_match', selectedVariantId: 'banana' })
  })

  it('does not Alternative-match only one common word', () => {
    const result = matchPastedOrder('VANILLA - 3', variants)[0]
    expect(result.matchMethod).not.toBe('alternative_name')
    expect(result.selectedVariantId).not.toBe('banana')
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

describe('Quick Order multi-entry paste parsing', () => {
  it('splits a normal multiline list into one entry per line', () => {
    const text = 'LYCHEE BLACKCURRANT - 200\nTEH TARIK - 300\nKELADI - 100'
    const results = matchPastedOrder(text, variants)
    expect(results).toHaveLength(3)
    expect(results.map(result => result.line)).toEqual([1, 2, 3])
    expect(results.map(result => result.sourceLine)).toEqual([1, 2, 3])
    expect(results.map(result => result.quantity)).toEqual([200, 300, 100])
    expect(results.map(result => result.raw)).toEqual(text.split('\n'))
  })

  it('splits a WhatsApp list collapsed into one physical line', () => {
    const text = 'LYCHEE BLACKCURRANT - 200 ❌ GUAVA - 300✅ MANGO -1000✅ STRAWBERRY BUBBLEGUM - 300✅ MIX GRAPE -300✅ CULTURED MILK - 100✅ VANILLA TOBACCO - 100❌ STRAWBERRY CHEESECAKE - 600✅ TEH TARIK 500❌'
    const results = matchPastedOrder(text, variants)
    expect(results.map(result => result.quantity)).toEqual([200, 300, 1000, 300, 300, 100, 100, 600, 500])
    expect(results.map(result => result.name)).toEqual([
      'LYCHEE BLACKCURRANT', 'GUAVA', 'MANGO', 'STRAWBERRY BUBBLEGUM', 'MIX GRAPE',
      'CULTURED MILK', 'VANILLA TOBACCO', 'STRAWBERRY CHEESECAKE', 'TEH TARIK',
    ])
    // Every entry shares the same physical line but keeps a unique running index.
    expect(results.map(result => result.sourceLine)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(results.map(result => result.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // Multi-word names are preserved and the trailing status emoji is kept in raw.
    expect(results[3]).toMatchObject({ name: 'STRAWBERRY BUBBLEGUM', raw: 'STRAWBERRY BUBBLEGUM - 300✅' })
    // It must never collapse into a single record with Qty 500.
    expect(results).toHaveLength(9)
  })

  it('treats mixed status emojis purely as boundaries, not as acceptance', () => {
    const text = 'TEH - 5 ✅ KELADI - 3 ❌ HAZELNUT - 4 ✔️ BANANA MILK - 2 ✖️ MANGO - 1 ☑️'
    const results = matchPastedOrder(text, variants)
    expect(results.map(result => result.quantity)).toEqual([5, 3, 4, 2, 1])
    // The ❌/✖️ next to entries do not reject them; they still resolve normally.
    expect(results.map(result => result.selectedVariantId)).toEqual(['teh', 'keladi', 'hazelnut', 'banana', undefined])
    expect(results[4]).toMatchObject({ name: 'MANGO', status: 'ambiguous' })
  })

  it('normalizes mixed Unicode dash styles to a standard hyphen', () => {
    const text = 'TEH – 5 ✅ KELADI — 3 ✅ HAZELNUT − 4 ✅ BANANA MILK ― 2'
    const results = matchPastedOrder(text, variants)
    expect(results.map(result => result.quantity)).toEqual([5, 3, 4, 2])
    expect(results.map(result => result.selectedVariantId)).toEqual(['teh', 'keladi', 'hazelnut', 'banana'])
  })

  it('parses entries with a missing dash such as "TEH TARIK 500"', () => {
    const results = matchPastedOrder('TEH TARIK 500 ✅ KELADI 25', variants)
    expect(results.map(result => result.quantity)).toEqual([500, 25])
    expect(results.map(result => result.name)).toEqual(['TEH TARIK', 'KELADI'])
    expect(results.map(result => result.selectedVariantId)).toEqual(['teh', 'keladi'])
  })

  it('accepts tabs, colons and multiple spaces as separators within one line', () => {
    const results = matchPastedOrder('TEH:5 ✅ KELADI\t3 ✅ HAZELNUT   4', variants)
    expect(results.map(result => result.quantity)).toEqual([5, 3, 4])
    expect(results.map(result => result.name)).toEqual(['TEH', 'KELADI', 'HAZELNUT'])
  })

  it('keeps digits inside a Product Code/SKU out of the quantity', () => {
    // "SKU-77" and "CEL-99" end in digits; the trailing "5"/"10" is the quantity.
    const results = matchPastedOrder('SKU-77 5 ✅ CEL-99 10 ✅ SKU-001: 3', variants)
    expect(results.map(result => result.name)).toEqual(['SKU-77', 'CEL-99', 'SKU-001'])
    expect(results.map(result => result.quantity)).toEqual([5, 10, 3])
    expect(results.map(result => result.matchMethod)).toEqual(['code_or_sku', 'code_or_sku', 'code_or_sku'])
    expect(results.map(result => result.selectedVariantId)).toEqual(['mint', 'mint', 'lychee'])
  })

  it('isolates one malformed segment without rejecting the valid ones around it', () => {
    const results = matchPastedOrder('TEH - 5 ✅ ??? ✅ KELADI - 3', variants)
    expect(results.map(result => result.name)).toEqual(['TEH', '???', 'KELADI'])
    expect(results.map(result => result.status)).toEqual(['smart_match', 'invalid_quantity', 'smart_match'])
    expect(results.map(result => result.quantity)).toEqual([5, null, 3])
    // The unparsable segment is preserved for review; the valid ones still resolve.
    expect(results[0].selectedVariantId).toBe('teh')
    expect(results[2].selectedVariantId).toBe('keladi')
  })
})
