import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, 'DistributorOrderView.tsx'), 'utf8')
const quickGrid = fs.readFileSync(path.resolve(__dirname, 'QuickOrderGrid.tsx'), 'utf8')
const preflight = fs.readFileSync(path.resolve(__dirname, '../../app/api/orders/d2h/preflight/route.ts'), 'utf8')
const catalogResolver = fs.readFileSync(path.resolve(__dirname, '../../lib/orders/quick-order-catalog.ts'), 'utf8')

describe('Distributor D2H Quick Order integration', () => {
  it('opens in Quick mode and preserves one shared item collection across mode switches', () => {
    expect(source).toContain("useState<'quick' | 'standard'>('quick')")
    expect(source).toContain("orderMode === 'quick' ? 'Switch to Standard' : 'Try Quick Order'")
    expect(source).toContain('items={orderItems}')
  })

  it('excludes zero quantities and preserves the existing D2H payload and allocation flow', () => {
    expect(source).toContain('orderItems.filter(item => item.qty > 0)')
    expect(source).toContain("order_type: 'D2H'")
    expect(source).toContain(".from('order_items')")
    expect(source).toContain(".rpc('allocate_inventory_for_order'")
  })

  it('uses server-authoritative active variants, stock, and distributor pricing', () => {
    expect(source).toContain("fetch('/api/orders/d2h/preflight'")
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
    expect(preflight).toContain('validateQuickOrderCatalogItems(items, catalog.variants)')
    expect(catalogResolver).toContain('This product is not available in the distributor Quick Order catalog.')
  })

  it('provides compact filtering, keyboard quantity entry, and reviewed paste handling', () => {
    expect(quickGrid).toContain('Show selected only')
    expect(quickGrid).toContain('Available only')
    expect(quickGrid).toContain("event.key === 'Enter' || event.key === 'ArrowDown'")
    expect(quickGrid).toContain('Apply reviewed quantities')
    expect(quickGrid).toContain('Combine duplicate entries')
  })
})
