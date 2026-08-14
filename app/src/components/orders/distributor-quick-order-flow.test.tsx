import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, 'DistributorOrderView.tsx'), 'utf8')
const quickGrid = fs.readFileSync(path.resolve(__dirname, 'QuickOrderGrid.tsx'), 'utf8')
const preflight = fs.readFileSync(path.resolve(__dirname, '../../app/api/orders/d2h/preflight/route.ts'), 'utf8')
const catalogResolver = fs.readFileSync(path.resolve(__dirname, '../../lib/orders/quick-order-catalog.ts'), 'utf8')
const standardCatalogResolver = fs.readFileSync(path.resolve(__dirname, '../../lib/orders/standard-order-catalog.ts'), 'utf8')
const programResolver = fs.readFileSync(path.resolve(__dirname, '../../lib/orders/d2h-product-program.ts'), 'utf8')
const categoryPolicy = fs.readFileSync(path.resolve(__dirname, '../../lib/orders/d2h-program-category-policy.ts'), 'utf8')

describe('Distributor D2H Quick Order integration', () => {
  it('opens in Quick mode and preserves one shared item collection across mode switches', () => {
    expect(source).toContain("useState<'quick' | 'standard'>('quick')")
    expect(source).toContain("orderMode === 'quick' ? 'Standard order' : 'Quick Order'")
    expect(source).toContain('items={orderItems}')
  })

  it('excludes zero quantities and submits through the atomic D2H allocate RPC', () => {
    expect(source).toContain('orderItems.filter(item => item.qty > 0)')
    expect(source).toContain("rpc('submit_and_allocate_d2h_order'")
    expect(source).toContain('p_fulfillment_warehouse_id: fulfillmentWarehouseId')
    expect(source).toContain('Fulfillment Warehouse')
  })

  it('uses server-authoritative active variants, stock, and distributor pricing', () => {
    expect(source).toContain("fetch('/api/orders/d2h/preflight'")
    expect(source).toContain('fulfillmentWarehouseId')
    expect(source).toContain('authoritativeItems.get(item.variant_id)!.distributorPrice')
    expect(preflight).toContain(".from('organizations')")
    expect(preflight).toContain(".eq('products.is_active', true)")
    expect(preflight).toContain('item.quantity > item.availableQuantity')
    expect(preflight).toContain('distributorPrice: Number(variant.distributor_price || 0)')
  })

  it('blocks both Quick and Standard D2H submission for unclassified inventory', () => {
    expect(preflight).toContain('resolveUnclassifiedVariantIds')
    expect(preflight).toContain('UNCLASSIFIED_INVENTORY_ORDER_MESSAGE')
    expect(catalogResolver).toContain('inventory_classification')
    expect(catalogResolver).toContain('throw new Error(UNCLASSIFIED_INVENTORY_ORDER_MESSAGE)')
  })

  it('uses a separate canonical Vape catalog only for Quick Order', () => {
    expect(source).toContain('variants={quickOrderVariants}')
    expect(source).toContain('const standardAvailableVariants = availableVariants.filter')
    expect(catalogResolver).toContain(".eq('products.product_categories.is_vape', true)")
    expect(catalogResolver).toContain("product_categories!inner (id, is_active, is_vape)")
    expect(preflight).toContain('validateQuickOrderCatalogItems(')
    expect(catalogResolver).toContain('This product is not available in the distributor Quick Order catalog.')
  })

  it('restricts the Standard Order catalog by the distributor program category rule', () => {
    expect(source).toContain("fetch('/api/orders/d2h/standard-order-catalog'")
    expect(programResolver).toContain(".from('loyalty_program_organization_memberships')")
    expect(programResolver).toContain(".from('loyalty_programs')")
    expect(programResolver).toContain(".eq('status', 'active')")
    expect(programResolver).toContain("CELLERA_PROGRAM_CODE = 'cellera'")
    expect(categoryPolicy).toContain('[CELLERA_PROGRAM_CODE]:')
    expect(categoryPolicy).toContain("categoryKey: 'vape'")
    expect(standardCatalogResolver).toContain('resolveDistributorCategoryRule(')
    expect(standardCatalogResolver).toContain('applyCategoryFilters(')
    expect(standardCatalogResolver).toContain('categoryRelationForRule(categoryRule)')
    // Category comes from products.category_id, not from group/subgroup.
    expect(standardCatalogResolver).toContain('category_id')
  })

  it('applies the same program category rule in preflight validation', () => {
    expect(preflight).toContain('resolveDistributorCategoryRule(')
    expect(preflight).toContain('variantIdsOutsideProgramCategory(')
    expect(preflight).toContain('outsideProgramCategoryMessage(')
    expect(preflight).toContain('product_categories(id, is_active, is_vape)')
  })

  it('provides compact filtering, keyboard quantity entry, and reviewed paste handling', () => {
    expect(quickGrid).toContain('label="Selected"')
    expect(quickGrid).toContain('label="In stock"')
    expect(quickGrid).toContain("event.key === 'Enter' || event.key === 'ArrowDown'")
    expect(quickGrid).toContain('Apply reviewed quantities')
    expect(quickGrid).toContain('Combine duplicate entries')
  })
})
