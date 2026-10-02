import { describe, expect, it } from 'vitest'
import { chainedValues, fieldsToClearBelow, linkedValues, narrowOptions, type ProductLink } from '@/lib/products/linked-options'

const links: ProductLink[] = [
  { brand_id: 'b1', category_id: 'c1', manufacturer_id: 'm1', group_id: 'g1', subgroup_id: 's1' },
  { brand_id: 'b1', category_id: 'c2', manufacturer_id: 'm2', group_id: 'g2', subgroup_id: 's2' },
  { brand_id: 'b2', category_id: 'c1', manufacturer_id: 'm3', group_id: 'g1', subgroup_id: 's3' },
]

const ids = (set: Set<string> | null) => (set ? [...set].sort() : null)

describe('linkedValues', () => {
  it('does not narrow a field while nothing else is chosen', () => {
    expect(linkedValues(links, {}, 'brand_id')).toBeNull()
    expect(linkedValues(links, { brand_id: 'b1' }, 'brand_id')).toBeNull()
  })

  it('narrows every other field to what the chosen brand is used with', () => {
    expect(ids(linkedValues(links, { brand_id: 'b1' }, 'category_id'))).toEqual(['c1', 'c2'])
    expect(ids(linkedValues(links, { brand_id: 'b1' }, 'manufacturer_id'))).toEqual(['m1', 'm2'])
  })

  it('works from any starting field and combines all choices', () => {
    expect(ids(linkedValues(links, { manufacturer_id: 'm3' }, 'brand_id'))).toEqual(['b2'])
    expect(ids(linkedValues(links, { category_id: 'c1' }, 'brand_id'))).toEqual(['b1', 'b2'])
    expect(ids(linkedValues(links, { category_id: 'c1', brand_id: 'b1' }, 'manufacturer_id'))).toEqual(['m1'])
  })
})

describe('chainedValues', () => {
  it('lists every category, whatever is chosen below it', () => {
    expect(chainedValues(links, { brand_id: 'b2', manufacturer_id: 'm3' }, 'category_id')).toBeNull()
  })

  it('narrows brand by category only, so a chosen manufacturer never locks the brand list', () => {
    expect(ids(chainedValues(links, { category_id: 'c1', manufacturer_id: 'm3' }, 'brand_id'))).toEqual(['b1', 'b2'])
  })

  it('narrows manufacturer by category and brand', () => {
    expect(ids(chainedValues(links, { category_id: 'c1', brand_id: 'b1' }, 'manufacturer_id'))).toEqual(['m1'])
    expect(ids(chainedValues(links, { category_id: 'c1' }, 'manufacturer_id'))).toEqual(['m1', 'm3'])
  })

  it('leaves group and subgroup to their category/group hierarchy', () => {
    expect(chainedValues(links, { category_id: 'c1', brand_id: 'b1', manufacturer_id: 'm1' }, 'group_id')).toBeNull()
    expect(chainedValues(links, { group_id: 'g1', brand_id: 'b1' }, 'subgroup_id')).toBeNull()
  })
})

describe('fieldsToClearBelow', () => {
  it('clears a brand and manufacturer the new category is never used with', () => {
    expect(fieldsToClearBelow(links, { category_id: 'c2', brand_id: 'b2', manufacturer_id: 'm3' }, 'category_id')).toEqual(['brand_id', 'manufacturer_id'])
  })

  it('clears only the manufacturer when the new brand is not used with it', () => {
    expect(fieldsToClearBelow(links, { category_id: 'c1', brand_id: 'b2', manufacturer_id: 'm1' }, 'brand_id')).toEqual(['manufacturer_id'])
  })

  it('keeps choices that are still linked', () => {
    expect(fieldsToClearBelow(links, { category_id: 'c1', brand_id: 'b1', manufacturer_id: 'm1' }, 'category_id')).toEqual([])
  })

  it('keeps every choice for a category without products', () => {
    expect(fieldsToClearBelow(links, { category_id: 'c9', brand_id: 'b1', manufacturer_id: 'm1' }, 'category_id')).toEqual([])
  })

  it('never clears anything above the changed field', () => {
    expect(fieldsToClearBelow(links, { category_id: 'c2', brand_id: 'b2', manufacturer_id: 'm3' }, 'manufacturer_id')).toEqual([])
  })
})

describe('narrowOptions', () => {
  const options = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]

  it('lists only the linked options', () => {
    expect(narrowOptions(options, new Set(['c1']))).toEqual({ options: [{ id: 'c1' }], narrowed: true })
  })

  it('keeps the current choice listed even when it is not linked', () => {
    expect(narrowOptions(options, new Set(['c1']), 'c3').options).toEqual([{ id: 'c1' }, { id: 'c3' }])
  })

  it('stays narrowed when the current choice is the only linked option', () => {
    expect(narrowOptions(options, new Set(['c1']), 'c1')).toEqual({ options: [{ id: 'c1' }], narrowed: true })
  })

  it('falls back to the full list when nothing is linked, so a new combination stays possible', () => {
    expect(narrowOptions(options, new Set())).toEqual({ options, narrowed: false })
    expect(narrowOptions(options, new Set(), 'c2')).toEqual({ options, narrowed: false })
  })

  it('leaves the list alone when there is no filter', () => {
    expect(narrowOptions(options, null)).toEqual({ options, narrowed: false })
  })
})
