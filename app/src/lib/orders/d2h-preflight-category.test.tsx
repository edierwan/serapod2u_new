import { describe, expect, it } from 'vitest'
import {
  applyCategoryFilters,
  categoryRelationForRule,
  outsideProgramCategoryMessage,
  programCategoryRuleForCodes,
  variantIdsOutsideProgramCategory,
} from './d2h-program-category-policy'

const celleraRule = programCategoryRuleForCodes(['cellera'])!

const variant = (id: string, category: Record<string, unknown> | null) => ({
  id,
  distributor_price: 10,
  is_active: true,
  products: { is_active: true, category_id: category?.id ?? null, product_categories: category },
})

const vape = { id: 'cat-vape', is_active: true, is_vape: true }
const outdoor = { id: 'cat-outdoor', is_active: true, is_vape: false }
const petFood = { id: 'cat-petfood', is_active: true, is_vape: false }

describe('D2H preflight program category validation', () => {
  it('accepts Vape category variants for a Cellera distributor', () => {
    const variants = [variant('pod', vape), variant('device-box', vape), variant('device-line', vape)]
    expect(variantIdsOutsideProgramCategory(variants, celleraRule)).toEqual([])
  })

  it('rejects non-Vape category variants for a Cellera distributor', () => {
    const variants = [variant('pod', vape), variant('chair', outdoor), variant('kibble', petFood)]
    expect(variantIdsOutsideProgramCategory(variants, celleraRule)).toEqual(['chair', 'kibble'])
  })

  it('rejects variants whose Vape category is deactivated', () => {
    const variants = [variant('pod', { id: 'cat-vape', is_active: false, is_vape: true })]
    expect(variantIdsOutsideProgramCategory(variants, celleraRule)).toEqual(['pod'])
  })

  it('rejects variants with no category for a restricted distributor', () => {
    expect(variantIdsOutsideProgramCategory([variant('orphan', null)], celleraRule)).toEqual(['orphan'])
  })

  it('accepts every category when the distributor has no program restriction', () => {
    const variants = [variant('pod', vape), variant('chair', outdoor)]
    expect(variantIdsOutsideProgramCategory(variants, null)).toEqual([])
  })

  it('handles PostgREST array-shaped embeds', () => {
    const arrayShaped = [{
      id: 'chair',
      products: [{ is_active: true, product_categories: [outdoor] }],
    }]
    expect(variantIdsOutsideProgramCategory(arrayShaped, celleraRule)).toEqual(['chair'])
  })

  it('names the allowed category in the rejection message', () => {
    expect(outsideProgramCategoryMessage(celleraRule)).toContain('Vape')
  })
})

describe('D2H program category query construction', () => {
  it('uses an inner category join only for restricted distributors', () => {
    expect(categoryRelationForRule(celleraRule)).toContain('product_categories!inner')
    expect(categoryRelationForRule(null)).not.toContain('!inner')
  })

  it('applies the same category columns to the query that the in-memory rule checks', () => {
    const applied: Array<[string, boolean]> = []
    const query = { eq: (column: string, value: boolean) => { applied.push([column, value]); return query } }

    applyCategoryFilters(query, celleraRule)
    expect(applied).toEqual([
      ['products.product_categories.is_vape', true],
      ['products.product_categories.is_active', true],
    ])

    applied.length = 0
    applyCategoryFilters(query, null)
    expect(applied).toEqual([])
  })
})
