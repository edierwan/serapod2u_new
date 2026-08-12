import { describe, expect, it } from 'vitest'
import { activeProgramCodes, hasActiveCelleraProgram } from './d2h-product-program'
import {
  isCategoryAllowed,
  programCategoryRuleForCodes,
} from './d2h-program-category-policy'
import { filterStandardOrderCatalogRows } from './standard-order-catalog'

const ownerOrganizationId = 'hq-1'

describe('D2H distributor program policy', () => {
  it('restricts an active Cellera organization membership owned by the seller HQ', () => {
    expect(hasActiveCelleraProgram(
      [{ loyalty_program_id: 'cellera-1', owner_organization_id: ownerOrganizationId, status: 'active' }],
      [{ id: 'cellera-1', organization_id: ownerOrganizationId, code: 'cellera', active: true }],
      ownerOrganizationId,
    )).toBe(true)
  })

  it.each([
    ['inactive membership', 'inactive', 'cellera', true, ownerOrganizationId],
    ['inactive program', 'active', 'cellera', false, ownerOrganizationId],
    ['different program', 'active', 'ellbow', true, ownerOrganizationId],
    ['different HQ owner', 'active', 'cellera', true, 'hq-2'],
  ])('does not restrict for %s', (_label, membershipStatus, code, programActive, programOwner) => {
    expect(hasActiveCelleraProgram(
      [{ loyalty_program_id: 'program-1', owner_organization_id: ownerOrganizationId, status: membershipStatus }],
      [{ id: 'program-1', organization_id: programOwner, code, active: programActive }],
      ownerOrganizationId,
    )).toBe(false)
  })

  it('resolves the program codes the distributor is actively enrolled in', () => {
    expect(activeProgramCodes(
      [
        { loyalty_program_id: 'cellera-1', owner_organization_id: ownerOrganizationId, status: 'active' },
        { loyalty_program_id: 'other-1', owner_organization_id: ownerOrganizationId, status: 'inactive' },
      ],
      [
        { id: 'cellera-1', organization_id: ownerOrganizationId, code: 'cellera', active: true },
        { id: 'other-1', organization_id: ownerOrganizationId, code: 'ellbow', active: true },
      ],
      ownerOrganizationId,
    )).toEqual(['cellera'])
  })
})

describe('D2H program -> category mapping', () => {
  it('maps the Cellera program to the Vape category', () => {
    const rule = programCategoryRuleForCodes(['cellera'])
    expect(rule?.categoryKey).toBe('vape')
    expect(rule?.categoryFilters).toEqual([['is_vape', true], ['is_active', true]])
  })

  it('leaves distributors without a mapped program unrestricted', () => {
    expect(programCategoryRuleForCodes([])).toBeNull()
    expect(programCategoryRuleForCodes(['ellbow'])).toBeNull()
    expect(isCategoryAllowed(null, { is_vape: false, is_active: true })).toBe(true)
  })

  it('allows any active Vape category and rejects everything else', () => {
    const rule = programCategoryRuleForCodes(['cellera'])
    expect(isCategoryAllowed(rule, { id: 'vape', is_vape: true, is_active: true })).toBe(true)
    expect(isCategoryAllowed(rule, { id: 'outdoor', is_vape: false, is_active: true })).toBe(false)
    expect(isCategoryAllowed(rule, { id: 'vape-off', is_vape: true, is_active: false })).toBe(false)
    expect(isCategoryAllowed(rule, null)).toBe(false)
  })
})

describe('D2H Standard Order catalog category policy', () => {
  const vapeCategory = { id: 'cat-vape', is_active: true, is_vape: true }
  const outdoorCategory = { id: 'cat-outdoor', is_active: true, is_vape: false }
  const petFoodCategory = { id: 'cat-petfood', is_active: true, is_vape: false }

  // Every Vape row below sits under a different group/subgroup so the assertions
  // prove the rule is category-based, not a product or group allowlist.
  const rows = [
    {
      id: 'pod-variant', product_id: 'pod-product', variant_name: 'Pod Variant', distributor_price: 10, is_active: true,
      products: { product_name: 'Pod A', product_code: 'POD-A', is_active: true, category_id: 'cat-vape', product_categories: vapeCategory, product_groups: { group_name: 'Pod' } },
    },
    {
      id: 'device-box-variant', product_id: 'device-box-product', variant_name: 'Box Variant', distributor_price: 30, is_active: true,
      products: { product_name: 'Device Box', product_code: 'DEV-BOX', is_active: true, category_id: 'cat-vape', product_categories: vapeCategory, product_groups: { group_name: 'Device' } },
    },
    {
      id: 'device-line-variant', product_id: 'device-line-product', variant_name: 'Line Variant', distributor_price: 40, is_active: true,
      products: { product_name: 'Device Line', product_code: 'DEV-LINE', is_active: true, category_id: 'cat-vape', product_categories: vapeCategory, product_groups: { group_name: 'Device' } },
    },
    {
      id: 'chair-variant', product_id: 'chair-product', variant_name: 'Chair Variant', distributor_price: 20, is_active: true,
      products: { product_name: 'Camping Chair', product_code: 'CHAIR', is_active: true, category_id: 'cat-outdoor', product_categories: outdoorCategory, product_groups: { group_name: 'Camping' } },
    },
    {
      id: 'kibble-variant', product_id: 'kibble-product', variant_name: 'Kibble Variant', distributor_price: 15, is_active: true,
      products: { product_name: 'Dog Kibble', product_code: 'KIBBLE', is_active: true, category_id: 'cat-petfood', product_categories: petFoodCategory, product_groups: { group_name: 'Pet Food' } },
    },
  ]
  const availability = new Map([
    ['pod-variant', 5], ['device-box-variant', 7], ['device-line-variant', 9],
    ['chair-variant', 3], ['kibble-variant', 4],
  ])
  const celleraRule = programCategoryRuleForCodes(['cellera'])

  it('keeps every active Vape category product for a Cellera distributor, across all groups', () => {
    const catalog = filterStandardOrderCatalogRows(rows, availability, new Set(), celleraRule)
    expect(catalog.map(variant => variant.id))
      .toEqual(['pod-variant', 'device-box-variant', 'device-line-variant'])
    // Device group and its subgroup variants survive alongside the Pod group.
    expect(catalog.filter(variant => variant.group_name === 'Device').map(variant => variant.id))
      .toEqual(['device-box-variant', 'device-line-variant'])
    expect(catalog[0].available_qty).toBe(5)
  })

  it('excludes products outside the Vape category for a Cellera distributor', () => {
    const catalog = filterStandardOrderCatalogRows(rows, availability, new Set(), celleraRule)
    const excluded = rows
      .filter(row => row.products.product_categories.is_vape !== true)
      .map(row => row.id)
    expect(excluded).toEqual(['chair-variant', 'kibble-variant'])
    for (const id of excluded) {
      expect(catalog.map(variant => variant.id)).not.toContain(id)
    }
  })

  it('drops Vape products whose category has been deactivated', () => {
    const deactivated = [{
      ...rows[0],
      id: 'inactive-cat-variant',
      products: { ...rows[0].products, product_categories: { id: 'cat-vape', is_active: false, is_vape: true } },
    }]
    expect(filterStandardOrderCatalogRows(deactivated, availability, new Set(), celleraRule)).toEqual([])
  })

  it('keeps every product for distributors with no program category restriction', () => {
    const catalog = filterStandardOrderCatalogRows(rows, availability, new Set(), null)
    expect(catalog.map(variant => variant.id)).toEqual(rows.map(row => row.id))
  })
})
