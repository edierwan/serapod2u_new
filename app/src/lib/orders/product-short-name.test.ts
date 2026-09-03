import { describe, expect, it } from 'vitest'
import { resolveProductShortNames } from './product-short-name'

const rows = [
  { product_name: 'Cellera Hero', group_name: 'Catridge' },
  { product_name: 'Cellera Zero', group_name: 'Catridge' },
  { product_name: 'Serapod Device S.Line', group_name: 'Device' },
  { product_name: 'Serapod Device S.Box', group_name: 'Device' },
]

describe('Quick Order product short names', () => {
  it('drops the words every product in the group shares', () => {
    const short = resolveProductShortNames(rows)
    expect(short.get('Cellera Hero')).toBe('Hero')
    expect(short.get('Cellera Zero')).toBe('Zero')
    expect(short.get('Serapod Device S.Line')).toBe('S.Line')
    expect(short.get('Serapod Device S.Box')).toBe('S.Box')
  })

  it('keeps a lone product in its group intact', () => {
    const short = resolveProductShortNames([{ product_name: 'Ellbow Cat Treat', group_name: 'Cat Treat' }])
    expect(short.get('Ellbow Cat Treat')).toBe('Ellbow Cat Treat')
  })

  it('keeps full names when the group shares no leading words', () => {
    const short = resolveProductShortNames([
      { product_name: 'Moonchair Highback', group_name: 'Camping' },
      { product_name: 'Serapod Camping Mat', group_name: 'Camping' },
    ])
    expect(short.get('Moonchair Highback')).toBe('Moonchair Highback')
    expect(short.get('Serapod Camping Mat')).toBe('Serapod Camping Mat')
  })

  // "Cellera" alone would be emptied by the "Cellera" prefix, so the whole
  // group falls back rather than rendering a blank Product cell.
  it('never lets the shared prefix empty a name', () => {
    const short = resolveProductShortNames([
      { product_name: 'Cellera', group_name: 'Catridge' },
      { product_name: 'Cellera Hero', group_name: 'Catridge' },
    ])
    expect(short.get('Cellera')).toBe('Cellera')
    expect(short.get('Cellera Hero')).toBe('Cellera Hero')
  })

  it('compares words case-insensitively but keeps the original casing', () => {
    const short = resolveProductShortNames([
      { product_name: 'SERAPOD Tumbler', group_name: 'Camping' },
      { product_name: 'Serapod Camping Mat', group_name: 'Camping' },
    ])
    expect(short.get('SERAPOD Tumbler')).toBe('Tumbler')
    expect(short.get('Serapod Camping Mat')).toBe('Camping Mat')
  })

  it('scopes the prefix to the group, so tab switching never relabels', () => {
    const short = resolveProductShortNames(rows)
    // Device names share nothing with Cartridge names; each group is
    // shortened independently and the map is the same for the "All" tab.
    expect(short.size).toBe(4)
    expect(short.get('Cellera Hero')).toBe('Hero')
  })

  it('ignores rows with no product name', () => {
    expect(resolveProductShortNames([{ product_name: '', group_name: 'Catridge' }]).size).toBe(0)
  })
})
