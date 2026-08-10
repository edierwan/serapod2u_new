import { describe, expect, it } from 'vitest'
import { hasActiveCelleraProgram } from './d2h-product-program'
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
})

describe('D2H Standard Order catalog category policy', () => {
  const rows = [
    {
      id: 'vape-variant', product_id: 'vape-product', variant_name: 'Vape Variant', distributor_price: 10, is_active: true,
      products: { product_name: 'Vape Product', product_code: 'VAPE', is_active: true, product_categories: { is_active: true, is_vape: true } },
    },
    {
      id: 'chair-variant', product_id: 'chair-product', variant_name: 'Chair Variant', distributor_price: 20, is_active: true,
      products: { product_name: 'Camping Chair', product_code: 'CHAIR', is_active: true, product_categories: { is_active: true, is_vape: false } },
    },
  ]
  const availability = new Map([['vape-variant', 5], ['chair-variant', 3]])

  it('keeps only active vape-category products for Cellera distributors', () => {
    const catalog = filterStandardOrderCatalogRows(rows, availability, new Set(), true)
    expect(catalog.map(variant => variant.id)).toEqual(['vape-variant'])
    expect(catalog[0].available_qty).toBe(5)
  })

  it('keeps existing products for non-Cellera distributors', () => {
    const catalog = filterStandardOrderCatalogRows(rows, availability, new Set(), false)
    expect(catalog.map(variant => variant.id)).toEqual(['vape-variant', 'chair-variant'])
  })
})
