import { describe, expect, it } from 'vitest'
import { filterQuickOrderCatalogRows, validateQuickOrderCatalogItems } from './quick-order-catalog'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'

const row = (id: string, productName: string, groupName: string, options: Record<string, unknown> = {}) => ({
  id,
  product_id: `product-${id}`,
  variant_name: `${productName} Flavour`,
  attributes: {},
  barcode: null,
  manufacturer_sku: `SKU-${id}`,
  distributor_price: 32,
  is_active: true,
  products: {
    product_name: productName,
    product_code: `CODE-${id}`,
    is_active: true,
    is_discontinued: false,
    product_categories: { is_active: true, is_vape: true },
    product_groups: { group_name: groupName },
    ...options,
  },
})

describe('D2H Quick Order Vape catalog', () => {
  const rows = [
    row('hero', 'Cellera Hero', 'Cartridge'),
    row('zero', 'Cellera Zero', 'Cartridge'),
    row('sbox', 'S.Box', 'Device'),
    row('sline', 'S.Line', 'Device'),
    row('electronic', 'Electronic Speaker', 'Speaker', { product_categories: { is_active: true, is_vape: false } }),
    row('outdoor', 'Outdoor Camping', 'Camping', { product_categories: { is_active: true, is_vape: false } }),
    row('pet-food', 'Pet Food', 'Cat Treat', { product_categories: { is_active: true, is_vape: false } }),
    row('inactive-product', 'Inactive Vape', 'Cartridge', { is_active: false }),
    row('discontinued', 'Discontinued Vape', 'Device', { is_discontinued: true }),
    { ...row('inactive-variant', 'Inactive Variant', 'Device'), is_active: false },
    { ...row('no-price', 'No Price', 'Device'), distributor_price: 0 },
    row('no-stock', 'No Stock', 'Cartridge'),
  ]
  const stock = new Map(rows.map(item => [item.id, item.id === 'sline' ? 25 : 10]))
  stock.set('no-stock', 0)
  const catalog = filterQuickOrderCatalogRows(rows, stock)

  it('includes Cellera Hero, Cellera Zero, S.Box, and S.Line', () => {
    expect(catalog.map(item => item.product_name)).toEqual(['Cellera Hero', 'Cellera Zero', 'S.Box', 'S.Line'])
  })

  it('excludes non-Vape, inactive, discontinued, unavailable, and unpriced products', () => {
    expect(catalog.map(item => item.id)).toEqual(['hero', 'zero', 'sbox', 'sline'])
  })

  it('derives only Vape catalog groups and counts', () => {
    const counts = catalog.reduce<Record<string, number>>((result, item) => ({ ...result, [item.group_name]: (result[item.group_name] || 0) + 1 }), {})
    expect(counts).toEqual({ Cartridge: 2, Device: 2 })
  })

  it('prevents search, paste, and manual review sources from exposing non-Vape variants', () => {
    expect(catalog.filter(item => `${item.product_name} ${item.variant_name}`.toLowerCase().includes('electronic'))).toEqual([])
    expect(matchPastedOrder('Electronic Speaker Flavour - 2', catalog)[0]).toMatchObject({ status: 'not_found', candidates: [] })
    expect(catalog.some(item => item.id === 'electronic')).toBe(false)
  })

  it('rejects a manipulated non-catalog payload with the required message', () => {
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'electronic', quantity: 1 }], catalog))
      .toThrow('This product is not available in the distributor Quick Order catalog.')
  })

  it('preserves authoritative Quick catalog stock and price validation', () => {
    expect(validateQuickOrderCatalogItems([{ variantId: 'hero', quantity: 10 }], catalog)[0])
      .toMatchObject({ availableQuantity: 10, distributorPrice: 32 })
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'hero', quantity: 11 }], catalog)).toThrow('Insufficient stock')
  })
})
