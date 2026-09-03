import { describe, expect, it } from 'vitest'
import {
  matchPastedOrder,
  resolvePasteInventoryOutcome,
  type PasteMatchResult,
} from '@/components/orders/quick-order-matcher'
import {
  boxesForCases,
  buildPasteResultText,
  titleCaseEntry,
  titleCaseHeading,
  verificationStamp,
  withCanonicalCode,
} from './paste-order-result-text'

// 14 August 2026, 10:00 in Kuala Lumpur (UTC+8).
const stampedAt = new Date('2026-08-14T02:00:00Z')
const stamp = (cases: number) => [
  '🛡️ Verified by Serapod2U',
  `Total Cases : ${cases}`,
  `Total Box : ${boxesForCases(cases)}`,
  '14 August 2026 · 10:00 AM',
]

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
  it('groups by product in Title Case, states the unit, and stamps the reply', () => {
    const pasted = [
      'grape 100✅',
      'grape pudina 50✅',
      'corn 50✅',
      'strawberry cheesecake 200✅',
      'VANILLA TOBACCO 50✅',
      '',
      'cellera zero',
      'almond 50✅',
      'jackfruit 100✅',
    ].join('\n')

    const results = matchPastedOrder(pasted, catalog)
    expect(buildPasteResultText(results, catalog, available, stampedAt)).toBe(
      [
        'Cellera Hero (Cases)',
        '',
        'Grape (GR) 100 ✅',
        'Grape Pudina (GP) 50 ✅',
        'Corn (CO) 50 ❌',
        'Strawberry Cheesecake (SC) 200 ✅',
        'Vanilla Tobacco (VT) 50 ✅',
        '',
        'Cellera Zero (Cases)',
        '',
        'Almond (AL) 50 ✅',
        'Jackfruit (JAC) 100 ✅',
        '',
        ...stamp(550),
      ].join('\n'),
    )
  })

  it('marks a line the warehouse cannot fill, not the mark the sender wrote', () => {
    // The distributor optimistically wrote ✅; Corn has zero stock.
    const results = matchPastedOrder('corn 50✅', catalog)
    expect(buildPasteResultText(results, catalog, available, stampedAt)).toBe(
      ['Cellera Hero (Cases)', '', 'Corn (CO) 50 ❌', '', ...stamp(0)].join('\n'),
    )
  })

  it('sends unresolved entries to a trailing Unmatched group', () => {
    const results = matchPastedOrder('grape 100\nunicorn dust 20', catalog)
    expect(buildPasteResultText(results, catalog, available, stampedAt)).toBe(
      [
        'Cellera Hero (Cases)', '', 'Grape (GR) 100 ✅', '',
        'Unmatched (Cases)', '', 'Unicorn Dust 20 ❌', '',
        ...stamp(100),
      ].join('\n'),
    )
  })

  it('returns an empty string when there is nothing to report', () => {
    expect(buildPasteResultText([], catalog, available, stampedAt)).toBe('')
  })

  it('totals only the cases the warehouse will actually ship, in whole boxes', () => {
    // 550 fillable cases = 5 full boxes of 100 plus a part box.
    const reply = buildPasteResultText(
      matchPastedOrder('grape 5000\ngrape pudina 550\ncorn 50', catalog),
      catalog,
      available,
      stampedAt,
    )
    // Grape (5,000) and Grape Pudina (550) are in stock; Corn has none, so its
    // 50 cases are left out of both totals.
    expect(reply).toContain('Total Cases : 5,550')
    expect(reply).toContain('Total Box : 56')

    expect(boxesForCases(550)).toBe(6)
    expect(boxesForCases(500)).toBe(5)
    expect(boxesForCases(1)).toBe(1)
    expect(boxesForCases(0)).toBe(0)
  })

  it('keeps one canonical code when the sender already typed it', () => {
    const results = matchPastedOrder('strawberry cheesecake (sc) 249', catalog)
    expect(buildPasteResultText(results, catalog, available, stampedAt))
      .toContain('Strawberry Cheesecake (SC) 249 ✅')

    expect(withCanonicalCode('Strawberry Vanilla (sv)', 'SV')).toBe('Strawberry Vanilla (SV)')
    expect(withCanonicalCode('Jackfruit [JAC]', 'JAC')).toBe('Jackfruit (JAC)')
    expect(withCanonicalCode('Mint (CEL-99)', 'CEL-99')).toBe('Mint (CEL-99)')
    // A note the sender wrote that is not the code stays put.
    expect(withCanonicalCode('Grape Ice (urgent)', 'AN')).toBe('Grape Ice (urgent) (AN)')
    expect(withCanonicalCode('Unicorn Dust', null)).toBe('Unicorn Dust')
  })

  it('stamps Malaysian business time whatever the machine clock is set to', () => {
    // 23:30 UTC on 13 August is already 07:30 on 14 August in Kuala Lumpur.
    expect(verificationStamp(new Date('2026-08-13T23:30:00Z')))
      .toBe('🛡️ Verified by Serapod2U\n14 August 2026 · 7:30 AM')
  })

  it('capitalises headings without mangling casing inside a word', () => {
    expect(titleCaseHeading('cellera hero')).toBe('Cellera Hero')
    expect(titleCaseHeading('Cellera Zero')).toBe('Cellera Zero')
    expect(titleCaseHeading('Serapod Device S.Line')).toBe('Serapod Device S.Line')
    expect(titleCaseHeading('SERAPOD® TUMBLER')).toBe('SERAPOD® TUMBLER')
  })

  it('normalises shouted entry text to Title Case', () => {
    expect(titleCaseEntry('kelapa')).toBe('Kelapa')
    expect(titleCaseEntry('GRAPE PUDINA')).toBe('Grape Pudina')
    expect(titleCaseEntry('lychee   blackcurrant')).toBe('Lychee Blackcurrant')
  })
})
