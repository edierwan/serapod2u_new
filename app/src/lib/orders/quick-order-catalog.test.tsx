import { describe, expect, it } from 'vitest'
import {
  filterQuickOrderCatalogRows,
  MISSING_DISTRIBUTOR_PRICE_ORDER_MESSAGE,
  resolveSellableStock,
  resolveUnclassifiedVariantIds,
  UNCLASSIFIED_INVENTORY_ORDER_MESSAGE,
  validateQuickOrderCatalogItems,
} from './quick-order-catalog'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'

/** A sellable balance nothing is holding — the ordinary case in these tests. */
const unreserved = (available: number) => ({ available, onHand: available, reserved: 0 })

const row = (id: string, productName: string, groupName: string, options: Record<string, unknown> = {}) => ({
  id,
  product_id: `product-${id}`,
  variant_name: `${productName} Flavour`,
  product_code: options.variant_product_code as string | undefined,
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
  const stock = new Map(rows.map(item => [item.id, unreserved(item.id === 'sline' ? 25 : 10)]))
  stock.set('no-stock', unreserved(0))
  const catalog = filterQuickOrderCatalogRows(rows, stock)

  it('includes active Product Master variants even when no sellable stock is available', () => {
    expect(catalog.map(item => item.product_name)).toEqual(['Cellera Hero', 'Cellera Zero', 'S.Box', 'S.Line', 'No Price', 'No Stock'])
    expect(catalog.find(item => item.id === 'no-stock')).toMatchObject({
      available_qty: 0,
      inventory_classification: 'classified',
      pricing_status: 'priced',
    })
  })

  it('excludes non-Vape, inactive, and discontinued products', () => {
    expect(catalog.map(item => item.id)).toEqual(['hero', 'zero', 'sbox', 'sline', 'no-price', 'no-stock'])
  })

  it('derives only Vape catalog groups and counts', () => {
    const counts = catalog.reduce<Record<string, number>>((result, item) => ({ ...result, [item.group_name]: (result[item.group_name] || 0) + 1 }), {})
    expect(counts).toEqual({ Cartridge: 3, Device: 3 })
  })

  // Production regression (2026-08-18): the active "Deluxe Cellera Cartridge
  // [Orange]" variant at Serapod Warehouse Balakong carried 3,259 sellable
  // cases but an empty Distributor Price. Dropping unpriced rows from the
  // catalog made "Orange - 50" report "Product Not Found" — a flavour visible
  // in Product Management reading as though it did not exist, with nothing
  // naming the empty field. Staging had a price, so localhost never showed it.
  it('keeps an unpriced variant findable and names the missing Distributor Price', () => {
    const orange = filterQuickOrderCatalogRows(
      [{ ...row('orange', 'Cellera Hero', 'Cartridge', { alternative_name: 'OREN' }), variant_name: 'Deluxe Cellera Cartridge [Orange]', distributor_price: null }],
      new Map([['orange', unreserved(3259)]]),
    )

    expect(orange[0]).toMatchObject({ pricing_status: 'price_missing', distributor_price: 0, available_qty: 3259 })
    expect(matchPastedOrder('Orange - 50', orange)[0]).toMatchObject({
      status: 'matched',
      selectedVariantId: 'orange',
      inventoryOutcome: 'price_not_set',
    })
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'orange', quantity: 50 }], orange))
      .toThrow(MISSING_DISTRIBUTOR_PRICE_ORDER_MESSAGE)
  })

  it('matches distributor shorthand against the variant Product Code, not the parent product code', () => {
    const cvRows = [row('cv', 'Cellera Hero', 'Cartridge', {
      variant_product_code: 'CV',
      product_code: 'CELVA9464',
    })]
    cvRows[0].variant_name = 'Deluxe Cellera Cartridge [ Corn Vanilla ]'
    const catalog = filterQuickOrderCatalogRows(cvRows, new Map([['cv', unreserved(2000)]]))

    // The two codes stay separate: product_code is the parent's, and the
    // variant-level code keeps its own field, which is what the labels read.
    // Paste matching resolves against both, so the shorthand still lands.
    expect(catalog[0].product_code).toBe('CELVA9464')
    expect(catalog[0].variant_product_code).toBe('CV')
    expect(matchPastedOrder('CV - 500', catalog)[0]).toMatchObject({
      status: 'matched',
      matchMethod: 'code_or_sku',
      selectedVariantId: 'cv',
    })
  })

  it('includes Alternative Name in the authorized catalog used by paste matching', () => {
    const alternativeRows = [row('banana', 'Banana Milk', 'Cartridge', { alternative_name: 'Banana Vanilla' })]
    const alternativeCatalog = filterQuickOrderCatalogRows(alternativeRows, new Map([['banana', unreserved(10)]]))

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
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'hero', quantity: 11 }], catalog, 'Serapod Warehouse Alma'))
      .toThrow('Insufficient available stock at Serapod Warehouse Alma')
  })

  it('keeps an unclassified variant matchable but blocks D2H submission', () => {
    const unclassifiedCatalog = filterQuickOrderCatalogRows(
      [row('guava', 'Cellera Hero', 'Cartridge')],
      new Map([['guava', unreserved(0)]]),
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

  // Production regression: Strawberry Corn at Serapod Warehouse Balakong held
  // 10,514 sellable units in 20NB plus a 73-unit residual in the phase_out
  // UNCLASSIFIED configuration. The residual alone flagged the whole variant,
  // so Quick Order and the paste review reported "Inventory Unclassified"
  // against stock that View Inventory showed as healthy and orderable.
  it('does not block a variant whose Legacy residual sits beside sellable stock', () => {
    const configurations = [
      { id: 'legacy', config_code: 'UNCLASSIFIED', volume_ml: null, packaging: null, status: 'phase_out', allow_so: true, requires_repacking_before_sale: false },
      { id: '20nb', config_code: '20NB', volume_ml: 20, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
    ]
    const inventory = [
      { variant_id: 'strawberry-corn', stock_config_id: '20nb', quantity_on_hand: 10514, quantity_available: 10514 },
      { variant_id: 'strawberry-corn', stock_config_id: 'legacy', quantity_on_hand: 73, quantity_available: 73 },
      { variant_id: 'stranded', stock_config_id: '20nb', quantity_on_hand: 0, quantity_available: 0 },
      { variant_id: 'stranded', stock_config_id: 'legacy', quantity_on_hand: 500, quantity_available: 500 },
    ]
    const sellable = resolveSellableStock(inventory, configurations, false)

    expect(sellable.get('strawberry-corn')?.available).toBe(10514)
    expect([...resolveUnclassifiedVariantIds(inventory, configurations, sellable)]).toEqual(['stranded'])

    const catalog = filterQuickOrderCatalogRows(
      [row('strawberry-corn', 'Cellera Hero', 'Cartridge')],
      sellable,
      resolveUnclassifiedVariantIds(inventory, configurations, sellable),
    )
    expect(catalog[0].inventory_classification).toBe('classified')
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'strawberry-corn', quantity: 50 }], catalog)).not.toThrow()
  })

  // Production 2026-08-19: Strawberry Corn at Serapod Warehouse Balakong held
  // 10,514 units in 20NB with 10,460 of them reserved by twelve submitted D2H
  // orders, so a 100-case paste line was correctly refused — but the review
  // said only "Insufficient / 54 available" beside a View Inventory screen
  // reading 10,514 On Hand, which read as a system fault. The catalog now
  // carries the split that explains it.
  it('reports how much of a sellable balance submitted orders already hold', () => {
    const configurations = [
      { id: '20nb', config_code: '20NB', volume_ml: 20, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
    ]
    const inventory = [
      { variant_id: 'strawberry-corn', stock_config_id: '20nb', quantity_on_hand: 10514, quantity_allocated: 10460, quantity_available: 54 },
    ]
    const stockByVariant = resolveSellableStock(inventory, configurations, false)

    expect(stockByVariant.get('strawberry-corn')).toEqual({ available: 54, onHand: 10514, reserved: 10460 })

    const catalog = filterQuickOrderCatalogRows(
      [row('strawberry-corn', 'Cellera Hero', 'Cartridge')],
      stockByVariant,
    )
    expect(catalog[0]).toMatchObject({ available_qty: 54, on_hand_qty: 10514, reserved_qty: 10460 })
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'strawberry-corn', quantity: 100 }], catalog, 'Serapod Warehouse Balakong'))
      .toThrow('54 of 10,514 cases are free — 10,460 are reserved by submitted orders awaiting approval.')
    expect(() => validateQuickOrderCatalogItems([{ variantId: 'strawberry-corn', quantity: 54 }], catalog, 'Serapod Warehouse Balakong'))
      .not.toThrow()
  })

  // A row without an explicit allocated column still has to describe itself,
  // because product_inventory.quantity_available is generated from the two.
  it('infers the reserved portion when only on-hand and available are known', () => {
    const configurations = [
      { id: '20nb', config_code: '20NB', volume_ml: 20, packaging: 'new_box', status: 'active', allow_so: true, requires_repacking_before_sale: false },
    ]
    const stockByVariant = resolveSellableStock(
      [{ variant_id: 'hero', stock_config_id: '20nb', quantity_on_hand: 300, quantity_available: 120 }],
      configurations,
      false,
    )
    expect(stockByVariant.get('hero')).toEqual({ available: 120, onHand: 300, reserved: 180 })
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

    expect(resolveSellableStock(inventory, configurations, false).get('hero')?.available).toBe(8)
    expect(resolveSellableStock(inventory, configurations, true).get('hero')?.available).toBe(12)
  })
})
