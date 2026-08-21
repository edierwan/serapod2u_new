import { describe, expect, it } from 'vitest'
import {
  extractOrderLinesFromNaturalText,
  extractProductInquiry,
  normalizeToPasteText,
  resolveNaturalOrderPasteText,
} from './natural-order-text'

describe('extractOrderLinesFromNaturalText', () => {
  it('parses English qty-last and qty-first', () => {
    expect(extractOrderLinesFromNaturalText('banana vanilla 100')).toEqual([
      { name: 'banana vanilla', qty: 100 },
    ])
    expect(extractOrderLinesFromNaturalText('100 banana vanilla')).toEqual([
      { name: 'banana vanilla', qty: 100 },
    ])
    expect(extractOrderLinesFromNaturalText('need 50 guava')).toEqual([
      { name: 'guava', qty: 50 },
    ])
  })

  it('parses Malay casual lines', () => {
    expect(extractOrderLinesFromNaturalText('nak 30 mango')).toEqual([
      { name: 'mango', qty: 30 },
    ])
    expect(extractOrderLinesFromNaturalText('boleh order 20 tea zero')).toEqual([
      { name: 'tea zero', qty: 20 },
    ])
  })

  it('parses Arabic numerals with product names', () => {
    expect(extractOrderLinesFromNaturalText('موز 50')).toEqual([
      { name: 'موز', qty: 50 },
    ])
  })

  it('handles multiple products joined with and/dan', () => {
    expect(extractOrderLinesFromNaturalText('50 banana and 30 guava')).toEqual([
      { name: 'banana', qty: 50 },
      { name: 'guava', qty: 30 },
    ])
    expect(extractOrderLinesFromNaturalText('50 banana dan 30 guava')).toEqual([
      { name: 'banana', qty: 50 },
      { name: 'guava', qty: 30 },
    ])
  })

  it('normalizes to paste-check lines', () => {
    expect(normalizeToPasteText([{ name: 'BANANA VANILLA', qty: 100 }])).toBe('BANANA VANILLA - 100')
  })
})

describe('extractProductInquiry', () => {
  it('detects stock questions without quantity', () => {
    expect(extractProductInquiry('do you have banana vanilla')).toEqual({ name: 'banana vanilla' })
    expect(extractProductInquiry('ada stok mango tak')).toEqual({ name: 'mango' })
    expect(extractProductInquiry('mango hero available?')).toEqual({ name: 'mango hero' })
  })

  it('does not treat qty lines, intent words, or generic questions as inquiry-only', () => {
    expect(extractProductInquiry('banana 100')).toBeNull()
    expect(extractProductInquiry('بدي')).toBeNull()
    expect(extractProductInquiry('nak')).toBeNull()
    expect(extractProductInquiry('apa')).toBeNull()
    expect(extractProductInquiry('what')).toBeNull()
    expect(extractProductInquiry('شو')).toBeNull()
    expect(extractProductInquiry('Yes, it is right')).toBeNull()
    expect(extractProductInquiry('ok noted')).toBeNull()
  })
})

describe('resolveNaturalOrderPasteText', () => {
  it('returns paste text for casual single lines', () => {
    expect(resolveNaturalOrderPasteText('guava 200')).toBe('guava - 200')
    expect(resolveNaturalOrderPasteText('can you check 100 banana vanilla')).toBe('banana vanilla - 100')
  })
})
