import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  CONCENTRATION_INELIGIBLE_MESSAGES,
  evaluateConcentrationStockConfigEligibility,
  isConcentrationStockConfigEligible,
  readVariantRelations,
} from './concentration-stock-eligibility'
import { variantNameWithProductCode } from './variant-display-label'

const bulkEligibleRoute = readFileSync(
  new URL('../../app/api/inventory/stock-configurations/bulk-eligible/route.ts', import.meta.url),
  'utf8',
)
const bulkEnableRoute = readFileSync(
  new URL('../../app/api/inventory/stock-configurations/bulk-enable/route.ts', import.meta.url),
  'utf8',
)
const panel = readFileSync(
  new URL('../../components/products/BulkEnableStockConfigurationsPanel.tsx', import.meta.url),
  'utf8',
)

/** A Cellera cartridge product in a `concentration` group, as production has it. */
const cartridgeProduct = {
  is_active: true,
  is_vape: true,
  product_name: 'Cellera Hero',
  product_code: 'CELVA9464',
}

/** A Cellera-coded Device product in a `standard` group — the Issue 2 case. */
const deviceProduct = {
  is_active: true,
  is_vape: true,
  product_name: 'Serapod Device S.Line',
  product_code: 'CELVA2227',
}

describe('Inventory Settings — concentration stock eligibility', () => {
  it('excludes a Device whose group is standard, even though it is an active CEL-coded vape product', () => {
    const result = evaluateConcentrationStockConfigEligibility({
      variantIsActive: true,
      product: deviceProduct,
      groupStockConfigProfile: 'standard',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('group_profile_not_concentration')
  })

  it('includes a Flavour group configured for concentration', () => {
    expect(isConcentrationStockConfigEligible({
      variantIsActive: true,
      product: cartridgeProduct,
      groupStockConfigProfile: 'concentration',
    })).toBe(true)
  })

  it('includes a Cartridge group configured for concentration, whatever the group is named', () => {
    // Production spells this group "Catridge"; eligibility must not read names.
    expect(isConcentrationStockConfigEligible({
      variantIsActive: true,
      product: cartridgeProduct,
      groupStockConfigProfile: 'concentration',
    })).toBe(true)
  })

  it('fails closed for a product with no product group', () => {
    const result = evaluateConcentrationStockConfigEligibility({
      variantIsActive: true,
      product: cartridgeProduct,
      groupStockConfigProfile: null,
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('group_profile_not_concentration')
  })

  it('fails closed for an unrecognised group profile value', () => {
    expect(isConcentrationStockConfigEligible({
      variantIsActive: true,
      product: cartridgeProduct,
      groupStockConfigProfile: 'something_else',
    })).toBe(false)
  })

  it('excludes an inactive variant', () => {
    const result = evaluateConcentrationStockConfigEligibility({
      variantIsActive: false,
      product: cartridgeProduct,
      groupStockConfigProfile: 'concentration',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('variant_inactive')
  })

  it('excludes an active variant whose product is inactive', () => {
    const result = evaluateConcentrationStockConfigEligibility({
      variantIsActive: true,
      product: { ...cartridgeProduct, is_active: false },
      groupStockConfigProfile: 'concentration',
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('product_inactive_or_out_of_scope')
  })

  it('never infers eligibility from a CEL prefix or the word Cellera', () => {
    // Same name and code as an eligible product; only the group profile differs.
    expect(isConcentrationStockConfigEligible({
      variantIsActive: true,
      product: { ...cartridgeProduct, product_name: 'Cellera Hero', product_code: 'CELVA9464' },
      groupStockConfigProfile: 'standard',
    })).toBe(false)
  })

  it('reads the group profile through the nested PostgREST shape, object or array', () => {
    const asObject = readVariantRelations({
      products: { product_name: 'Cellera Hero', product_groups: { group_name: 'Catridge', stock_config_profile: 'concentration' } },
    })
    expect(asObject.groupStockConfigProfile).toBe('concentration')
    expect(asObject.groupName).toBe('Catridge')

    const asArray = readVariantRelations({
      products: [{ product_name: 'Cellera Hero', product_groups: [{ group_name: 'Catridge', stock_config_profile: 'concentration' }] }],
    })
    expect(asArray.groupStockConfigProfile).toBe('concentration')

    const noGroup = readVariantRelations({ products: { product_name: 'Orphan', product_groups: null } })
    expect(noGroup.groupStockConfigProfile).toBeNull()
  })
})

describe('Inventory Settings — variant display formatting', () => {
  it('appends the variant Product Code with a dash separator', () => {
    expect(variantNameWithProductCode('Deluxe Cellera Cartridge [ Strawberry Corn ]', 'SC'))
      .toBe('Deluxe Cellera Cartridge [ Strawberry Corn ] - SC')
  })

  it('shows the variant name alone when the Product Code is null or blank', () => {
    expect(variantNameWithProductCode('Rustic', null)).toBe('Rustic')
    expect(variantNameWithProductCode('Rustic', '   ')).toBe('Rustic')
    expect(variantNameWithProductCode('Rustic', undefined)).toBe('Rustic')
  })

  it('never falls back to variant_code or the parent product code', () => {
    const label = variantNameWithProductCode('Deluxe Cellera Cartridge [ Strawberry Corn ]', null)
    expect(label).not.toContain('DEL-198369')
    expect(label).not.toContain('CELVA9464')
  })
})

describe('Inventory Settings — bulk-eligible API contract', () => {
  it('derives eligibility from the product group stock_config_profile, not from naming', () => {
    expect(bulkEligibleRoute).toContain('stock_config_profile')
    expect(bulkEligibleRoute).toContain('isConcentrationStockConfigEligible')
    expect(bulkEligibleRoute).not.toMatch(/group_name\s*===/)
  })

  it('returns the variant-level Product Code and never the parent product code as a variant suffix', () => {
    expect(bulkEligibleRoute).toContain('variantProductCode: variant.product_code')
    expect(bulkEligibleRoute).not.toContain('variantCode:')
    expect(bulkEligibleRoute).not.toContain('productCode:')
  })
})

describe('Inventory Settings — bulk-enable POST protection', () => {
  it('re-validates every requested id against the same concentration rule', () => {
    expect(bulkEnableRoute).toContain('evaluateConcentrationStockConfigEligibility')
    expect(bulkEnableRoute).toContain('stock_config_profile')
  })

  it('rejects the whole payload before the RPC instead of partially enabling it', () => {
    const rejectIndex = bulkEnableRoute.indexOf('rejected.length > 0')
    const rpcIndex = bulkEnableRoute.indexOf("rpc('bulk_enable_variant_stock_configurations'")
    expect(rejectIndex).toBeGreaterThan(-1)
    expect(rpcIndex).toBeGreaterThan(rejectIndex)
    expect(bulkEnableRoute).toContain('status: 400')
  })

  it('sends the full requested id set to the RPC, never a silently filtered subset', () => {
    expect(bulkEnableRoute).toContain('p_variant_ids: requestedIds')
    expect(bulkEnableRoute).not.toContain('p_variant_ids: eligibleIds')
  })

  it('provides a reason message for every ineligibility reason it can return', () => {
    for (const reason of [
      'variant_not_found',
      'variant_inactive',
      'product_inactive_or_out_of_scope',
      'group_profile_not_concentration',
    ] as const) {
      expect(CONCENTRATION_INELIGIBLE_MESSAGES[reason]).toBeTruthy()
    }
  })
})

describe('Inventory Settings — panel wording and rendering', () => {
  it('renders the product name without the parent product code', () => {
    expect(panel).toContain('<TableCell>{variant.productName}</TableCell>')
    expect(panel).not.toContain('{variant.productCode}')
  })

  it('renders the variant through the shared formatter and never variant_code', () => {
    expect(panel).toContain('variantNameWithProductCode(variant.variantName, variant.variantProductCode)')
    expect(panel).not.toContain('{variant.variantCode}')
  })

  it('does not describe every Cellera vape variant as eligible', () => {
    expect(panel).not.toContain('Loading Cellera vape variants')
    expect(panel).not.toContain('No Cellera vape variants found.')
    expect(panel).toContain('flavour/cartridge')
  })

  it('confirms against eligible flavour/cartridge variants rather than bare "flavour(s)"', () => {
    expect(panel).toContain('eligible flavour/cartridge variant(s)')
  })
})
