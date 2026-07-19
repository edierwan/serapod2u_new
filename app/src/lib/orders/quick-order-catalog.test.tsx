import { describe, expect, it } from 'vitest'
import {
  filterQuickOrderCatalogRows,
  resolveSellableAvailability,
  resolveUnclassifiedVariantIds,
  UNCLASSIFIED_INVENTORY_ORDER_MESSAGE,
  validateQuickOrderCatalogItems,
} from './quick-order-catalog'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'

const row = (id: string, productName: string, groupName: string, options: Record<string, unknown> = {}) => ({
  id,
  product_id: `product-${id}`,
  variant_name: `${productName} Flavour`,
  alternative_name: options.alternative_name as string | undefined,
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

  it('includes active Product Master variants even when no sellable stock is available', () => {
    expect(catalog.map(item => item.product_name)).toEqual(['Cellera Hero', 'Cellera Zero', 'S.Box', 'S.Line', 'No Stock'])
    expect(catalog.find(item => item.id === 'no-stock')).toMatchObject({
      available_qty: 0,
      inventory_classification: 'classified',
    })
  })

  it('excludes non-Vape, inactive, discontinued, and unpriced products', () => {
    expect(catalog.map(item => item.id)).toEqual(['hero', 'zero', 'sbox', 'sline', 'no-stock'])
  })

  it('derives only Vape catalog groups and counts', () => {
    const counts = catalog.reduce<Record<string, number>>((result, item) => ({ ...result, [item.group_name]: (result[item.group_name] || 0) + 1 }), {})
    expect(counts).toEqual({ Cartridge: 3, Device: 2 })
  })

  it('includes Alternative Name in the authorized catalog used by paste matching', () => {
    const alternativeRows = [row('banana', 'Banana Milk', 'Cartridge', { alternative_name: 'Banana Vanilla' })]
    const alternativeCatalog = filterQuickOrderCatalogRows(alternativeRows, new Map([['banana', 10]]))

    expect(alternativeCatalog[0].alternative_name).toBe('Banana Vanilla')
    expect(matchPastedOrder('BANANA VANILLA - 100', alternativeCatalog)[0])
      .toMatchObject({ status: 'alternative_match', selectedVariantId: 'banana' })
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

  it('keeps an unclassified variant matchable but blocks D2H submission', () => {
    const unclassifiedCatalog = filterQuickOrderCatalogRows(
      [row('guava', 'Cellera Hero', 'Cartridge')],
      new Map([['guava', 0]]),
      new Set(['guava']),
    )

    expect(matchPastedOrder('CELLERA HERO FLAVOUR - 300', unclassifiedCatalog)[0]).toMatchObject({
      selectedVariantId: 'guava',
      inventoryOutcome: 'inventory_unclassified',
    })
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'guava', quantity: 300 }], unclassifiedCatalog))
      .toThrow(UNCLASSIFIED_INVENTORY_ORDER_MESSAGE)
  })

  it('detects only positive Legacy/Unclassified inventory balances', () => {
    const configurations = [
      { id: 'legacy', config_code: 'UNCLASSIFIED', volume_ml: null, packaging: null, status: 'phase_out', allow_so: false, requires_repacking_before_sale: false },
      { id: '20nb', config_code: '20NB', volume_ml: 20, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
    ]
    const inventory = [
      { variant_id: 'guava', stock_config_id: 'legacy', quantity_on_hand: 300, quantity_available: 300 },
      { variant_id: 'mango', stock_config_id: 'legacy', quantity_on_hand: 0, quantity_available: 0 },
      { variant_id: 'mango', stock_config_id: '20nb', quantity_on_hand: 20, quantity_available: 20 },
    ]

    expect([...resolveUnclassifiedVariantIds(inventory, configurations)]).toEqual(['guava'])
  })

  it('uses one eligible configuration per line and never exposes old-box stock', () => {
    const inventory = [
      { variant_id: 'hero', stock_config_id: '20nb', quantity_available: 8 },
      { variant_id: 'hero', stock_config_id: '50nb', quantity_available: 12 },
      { variant_id: 'hero', stock_config_id: '50ob', quantity_available: 99 },
    ]
    const configurations = [
      { id: '20nb', volume_ml: 20, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
      { id: '50nb', volume_ml: 50, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
      { id: '50ob', volume_ml: 50, packaging: 'old_box', status: 'active', allow_so: false, requires_repacking_before_sale: true },
    ]

    expect(resolveSellableAvailability(inventory, configurations, false).get('hero')).toBe(8)
    expect(resolveSellableAvailability(inventory, configurations, true).get('hero')).toBe(12)
  })
})
