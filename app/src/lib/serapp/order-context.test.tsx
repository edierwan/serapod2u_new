import { describe, expect, it } from 'vitest'
import { SERAPP_ORDER_SOURCE_MARKER } from './constants'
import { buildSerappConfirmItems, buildSerappOrderNotes } from './order-context'
import type { QuickOrderCatalogVariant } from '@/lib/orders/quick-order-catalog'

const variants: QuickOrderCatalogVariant[] = [
  {
    id: 'v-banana',
    product_id: 'p-banana',
    product_name: 'Cellera Hero',
    product_code: 'CEL-BAN',
    variant_product_code: 'BAN',
    group_name: 'Cartridge',
    variant_name: 'Banana Milk',
    alternative_name: 'Banana Vanilla',
    attributes: {},
    barcode: null,
    manufacturer_sku: 'SKU-BAN',
    distributor_price: 10,
    available_qty: 100,
    on_hand_qty: 100,
    reserved_qty: 0,
    inventory_classification: 'classified',
    pricing_status: 'priced',
  },
  {
    id: 'v-tea',
    product_id: 'p-tea',
    product_name: 'Cellera Zero',
    product_code: 'CEL-TEA',
    variant_product_code: 'TEA',
    group_name: 'Cartridge',
    variant_name: 'Tea',
    alternative_name: null,
    attributes: {},
    barcode: null,
    manufacturer_sku: 'SKU-TEA',
    distributor_price: 12,
    available_qty: 40,
    on_hand_qty: 40,
    reserved_qty: 0,
    inventory_classification: 'classified',
    pricing_status: 'priced',
  },
]

describe('buildSerappConfirmItems', () => {
  it('includes fully available matched lines only by default for mixed results', () => {
    const { items, skipped } = buildSerappConfirmItems(
      [
        { status: 'section_header', quantity: null },
        {
          status: 'matched',
          selectedVariantId: 'v-banana',
          quantity: 20,
          inventoryOutcome: 'matched',
          raw: 'BANANA VANILLA - 20',
        },
        {
          status: 'matched',
          selectedVariantId: 'v-tea',
          quantity: 100,
          inventoryOutcome: 'insufficient_stock',
          raw: 'TEA - 100',
        },
        { status: 'requires_review', quantity: 5, selectedVariantId: undefined },
      ],
      variants,
      { acceptAvailableOnly: true },
    )

    expect(items).toEqual([
      expect.objectContaining({ variant_id: 'v-banana', qty: 20, unit_price: 10 }),
      expect.objectContaining({ variant_id: 'v-tea', qty: 40, unit_price: 12 }),
    ])
    expect(skipped).toBe(1)
  })

  it('combines duplicate variant lines into one qty', () => {
    const { items } = buildSerappConfirmItems(
      [
        {
          status: 'matched',
          selectedVariantId: 'v-banana',
          quantity: 10,
          inventoryOutcome: 'matched',
        },
        {
          status: 'matched',
          selectedVariantId: 'v-banana',
          quantity: 15,
          inventoryOutcome: 'matched',
        },
      ],
      variants,
    )

    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(25)
  })

  it('returns no items when everything needs review', () => {
    const { items, skipped } = buildSerappConfirmItems(
      [{ status: 'ambiguous', quantity: 10, selectedVariantId: undefined }],
      variants,
    )
    expect(items).toHaveLength(0)
    expect(skipped).toBe(1)
  })
})

describe('buildSerappOrderNotes', () => {
  it('embeds the Serapp source marker for Current Orders audit', () => {
    const notes = buildSerappOrderNotes({
      pasteText: 'HERO\nBANANA VANILLA - 100',
      distributorName: 'Demo Dist',
      warehouseName: 'HQ Warehouse',
    })
    expect(notes).toContain(SERAPP_ORDER_SOURCE_MARKER)
    expect(notes).toContain('Demo Dist')
    expect(notes).toContain('BANANA VANILLA - 100')
    expect(notes).not.toContain('Channel:')
  })

  it('adds an optional channel label without replacing the Serapp source marker', () => {
    const notes = buildSerappOrderNotes({
      pasteText: 'MANGO - 10',
      distributorName: 'Demo Dist',
      channelLabel: 'Telegram',
    })
    expect(notes).toContain(SERAPP_ORDER_SOURCE_MARKER)
    expect(notes).toContain('Channel: Telegram')
  })
})
