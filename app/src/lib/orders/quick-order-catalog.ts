import { insufficientStockAtWarehouseMessage } from '@/lib/orders/hq-fulfillment-warehouses'

export interface QuickOrderCatalogVariant {
  id: string
  product_id: string
  product_name: string
  /** Parent product code (products.product_code) — identical across flavours. */
  product_code: string
  /**
   * Variant-level master-data code (product_variants.product_code), the value
   * Product Management > Variants shows ("SC", "BV"). Distinct from
   * product_code above, which is the parent product's shared code.
   */
  variant_product_code: string | null
  group_name: string
  variant_name: string
  alternative_name: string | null
  attributes: Record<string, unknown>
  barcode: string | null
  manufacturer_sku: string | null
  distributor_price: number
  available_qty: number
  /**
   * The sellable balance behind {@link available_qty}, split so the operator
   * can see why the two differ. Quick Order sells from ONE configuration, so
   * these describe that configuration alone, not the flavour's warehouse-wide
   * total: on_hand_qty is its physical stock and reserved_qty the part already
   * committed to D2H/S2D orders that are submitted but not yet approved
   * (available = on hand - reserved, as product_inventory computes it).
   *
   * Without this split, a warehouse holding 10,514 cases with 10,460 reserved
   * by twelve submitted orders answered a 100-case line with a bare
   * "Insufficient - 54 available", and the only way to reconcile that against
   * View Inventory's 10,514 On Hand was to read the database.
   */
  on_hand_qty: number
  reserved_qty: number
  inventory_classification: 'classified' | 'unclassified'
  /**
   * Whether master data carries a Distributor Price for the variant. A variant
   * without one stays in the catalog so it can be found and named, but it can
   * never be ordered — see {@link filterQuickOrderCatalogRows}.
   */
  pricing_status: QuickOrderPricingStatus
}

export type QuickOrderPricingStatus = 'priced' | 'price_missing'

export interface QuickOrderCatalogRequestItem {
  variantId: string
  quantity: number
}

export const UNCLASSIFIED_INVENTORY_ORDER_MESSAGE =
  'Product matched, but its inventory configuration is still unclassified. Please classify the stock before submitting the order.'

export const MISSING_DISTRIBUTOR_PRICE_ORDER_MESSAGE =
  'Product matched, but no Distributor Price is maintained for it. Set the Distributor Price in Product Management > Variants before ordering.'

export function validateQuickOrderCatalogItems(
  items: QuickOrderCatalogRequestItem[],
  variants: QuickOrderCatalogVariant[],
  warehouseName?: string | null,
) {
  const catalogByVariant = new Map(variants.map(variant => [variant.id, variant]))
  if (items.some(item => !catalogByVariant.has(item.variantId))) {
    throw new Error('This product is not available in the distributor Quick Order catalog.')
  }

  return items.map(item => {
    const variant = catalogByVariant.get(item.variantId)!
    if (variant.pricing_status === 'price_missing') {
      throw new Error(MISSING_DISTRIBUTOR_PRICE_ORDER_MESSAGE)
    }
    if (variant.inventory_classification === 'unclassified') {
      throw new Error(UNCLASSIFIED_INVENTORY_ORDER_MESSAGE)
    }
    if (item.quantity > variant.available_qty) {
      throw new Error(insufficientStockAtWarehouseMessage(warehouseName || 'the selected warehouse', {
        available: variant.available_qty,
        onHand: variant.on_hand_qty,
        reserved: variant.reserved_qty,
      }))
    }
    return {
      variantId: item.variantId,
      quantity: item.quantity,
      availableQuantity: variant.available_qty,
      distributorPrice: variant.distributor_price,
    }
  })
}

interface QuickOrderCatalogRow {
  id: string
  product_id: string
  variant_name: string
  product_code?: string | null
  alternative_name?: string | null
  attributes?: Record<string, unknown> | null
  barcode?: string | null
  manufacturer_sku?: string | null
  distributor_price?: number | null
  is_active?: boolean | null
  products: any
}

interface SellableInventoryRow {
  variant_id: string
  stock_config_id: string | null
  quantity_on_hand?: number | null
  quantity_allocated?: number | null
  quantity_available: number | null
}

/** The sellable configuration a Quick Order line would be fulfilled from. */
export interface SellableStock {
  available: number
  onHand: number
  reserved: number
}

interface SellableConfigurationRow {
  id: string
  config_code?: string | null
  volume_ml: number | null
  packaging: string | null
  status: string
  allow_so: boolean
  requires_repacking_before_sale: boolean
}

// A sales-order line is fulfilled from one configuration. Availability is
// therefore the largest eligible single balance, never the sum of 20NB+50NB.
// The winning configuration's on-hand and reserved balances come back with it
// so the UI can explain a shortfall instead of only asserting one.
export function resolveSellableStock(
  inventory: SellableInventoryRow[],
  configurations: SellableConfigurationRow[],
  allow50mlNewBox: boolean,
): Map<string, SellableStock> {
  const configs = new Map(configurations.map(config => [config.id, config]))
  const result = new Map<string, SellableStock>()

  for (const stock of inventory) {
    if (!stock.stock_config_id) continue
    const config = configs.get(stock.stock_config_id)
    if (!config || config.status !== 'active' || !config.allow_so || config.requires_repacking_before_sale) continue
    const isGeneric = config.volume_ml == null && config.packaging == null
    const is20nb = config.volume_ml === 20 && config.packaging === 'new_box'
    const is50nb = config.volume_ml === 50 && config.packaging === 'new_box' && allow50mlNewBox
    if (!isGeneric && !is20nb && !is50nb) continue

    const available = Number(stock.quantity_available || 0)
    const current = result.get(stock.variant_id)
    if (current && current.available >= available) continue
    const onHand = Number(stock.quantity_on_hand ?? available)
    const reserved = stock.quantity_allocated == null
      ? Math.max(0, onHand - available)
      : Number(stock.quantity_allocated)
    result.set(stock.variant_id, { available, onHand, reserved })
  }

  return result
}

/**
 * Variants whose only orderable stock is stranded in a Legacy/Unclassified
 * configuration.
 *
 * A residual Legacy/Unclassified balance on its own is a data-cleanup matter,
 * not an order blocker: a warehouse that carries, say, 10,514 units in 20NB and
 * 73 leftover units in UNCLASSIFIED can still fulfil the line entirely from
 * 20NB. Flagging those variants blocked Quick Order and the paste review with
 * "Inventory Unclassified" even though View Inventory showed healthy sellable
 * stock. So a variant counts as unclassified only when it has a positive
 * Legacy/Unclassified balance AND no sellable availability to draw from.
 */
export function resolveUnclassifiedVariantIds(
  inventory: SellableInventoryRow[],
  configurations: SellableConfigurationRow[],
  sellableByVariant: Map<string, SellableStock> = new Map(),
): Set<string> {
  const configs = new Map(configurations.map(config => [config.id, config]))
  return new Set(inventory.flatMap(stock => {
    const balance = Number(stock.quantity_on_hand ?? stock.quantity_available ?? 0)
    if (balance <= 0) return []
    if ((sellableByVariant.get(stock.variant_id)?.available || 0) > 0) return []
    const configCode = stock.stock_config_id ? configs.get(stock.stock_config_id)?.config_code || '' : 'UNCLASSIFIED'
    return /UNCLASSIFIED|LEGACY/i.test(configCode) ? [stock.variant_id] : []
  }))
}

const asSingle = <T>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] || null) : (value || null)

/**
 * The current Quick Order catalog policy. This is intentionally isolated so a
 * future Distributor -> Program -> Assigned Products resolver can replace it
 * without changing the Quick Order UI or paste workflow.
 *
 * A missing Distributor Price does NOT remove the variant from the catalog.
 * Dropping it made an active, in-stock flavour indistinguishable from one that
 * does not exist: pasting "Orange - 50" answered "Product Not Found" while
 * Product Management showed the variant right there, because Master Data >
 * Variants never displays the Distributor Price and nothing pointed at the
 * empty field. The variant is now carried with `pricing_status:
 * 'price_missing'` so it can be found and named, and every ordering path — the
 * catalog row, the paste review, and {@link validateQuickOrderCatalogItems} —
 * blocks it with the reason. Order submission stays closed either way: the D2H
 * preflight independently rejects any line whose distributor price is <= 0.
 */
export function filterQuickOrderCatalogRows(
  rows: QuickOrderCatalogRow[],
  stockByVariant: Map<string, SellableStock>,
  unclassifiedVariantIds: Set<string> = new Set(),
): QuickOrderCatalogVariant[] {
  return rows.flatMap(row => {
    const product = asSingle<any>(row.products)
    const category = asSingle<any>(product?.product_categories)
    const group = asSingle<any>(product?.product_groups)
    const stock = stockByVariant.get(row.id)
    const availableQty = stock?.available || 0
    const distributorPrice = Number(row.distributor_price || 0)

    if (
      row.is_active !== true
      || product?.is_active !== true
      || product?.is_discontinued === true
      || category?.is_active === false
      || category?.is_vape !== true
    ) return []

    return [{
      id: row.id,
      product_id: row.product_id,
      product_name: product.product_name || '',
      product_code: product.product_code || '',
      variant_product_code: row.product_code || null,
      group_name: group?.group_name || 'Other',
      variant_name: row.variant_name,
      alternative_name: row.alternative_name || null,
      attributes: row.attributes || {},
      barcode: row.barcode || null,
      manufacturer_sku: row.manufacturer_sku || null,
      distributor_price: distributorPrice,
      available_qty: availableQty,
      on_hand_qty: stock?.onHand ?? 0,
      reserved_qty: stock?.reserved ?? 0,
      inventory_classification: unclassifiedVariantIds.has(row.id) ? 'unclassified' : 'classified',
      pricing_status: distributorPrice > 0 ? 'priced' : 'price_missing',
    }]
  })
}

export async function resolveQuickOrderCatalog(
  supabase: any,
  distributorId: string,
  requesterOrganizationId: string,
  fulfillmentWarehouseId?: string | null,
): Promise<{ variants: QuickOrderCatalogVariant[]; inventoryOrganizationId: string; fulfillmentWarehouseName: string | null }> {
  const { data: requesterOrganization, error: requesterError } = await supabase
    .from('organizations')
    .select('id, parent_org_id, org_type_code')
    .eq('id', requesterOrganizationId)
    .single()
  if (requesterError || !requesterOrganization) throw new Error('Requester organization not found.')

  const isHeadquarters = requesterOrganization.org_type_code === 'HQ'
  const isWarehouse = requesterOrganization.org_type_code === 'WH'
  if (!isHeadquarters && !isWarehouse) throw new Error('Your organization is not authorized to create this D2H order.')

  const hqOrganizationId = isHeadquarters ? requesterOrganization.id : requesterOrganization.parent_org_id
  if (!hqOrganizationId) throw new Error('The warehouse is not linked to an HQ organization.')

  const { data: distributor, error: distributorError } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', distributorId)
    .eq('parent_org_id', hqOrganizationId)
    .eq('org_type_code', 'DIST')
    .eq('is_active', true)
    .maybeSingle()
  if (distributorError || !distributor) throw new Error('The selected distributor is not available in this HQ scope.')

  if (!fulfillmentWarehouseId) {
    throw new Error('A fulfillment warehouse is required.')
  }

  const { data: fulfillmentWarehouse, error: fulfillmentWarehouseError } = await supabase
    .from('organizations')
    .select('id, org_name, org_type_code, parent_org_id, is_active')
    .eq('id', fulfillmentWarehouseId)
    .maybeSingle()
  if (fulfillmentWarehouseError || !fulfillmentWarehouse) {
    throw new Error('The selected fulfillment warehouse was not found.')
  }
  if (
    fulfillmentWarehouse.org_type_code !== 'WH'
    || fulfillmentWarehouse.is_active !== true
    || fulfillmentWarehouse.parent_org_id !== hqOrganizationId
  ) {
    throw new Error('The selected fulfillment warehouse is not an active warehouse under this HQ.')
  }

  const inventoryOrganizationId = fulfillmentWarehouse.id
  const fulfillmentWarehouseName = fulfillmentWarehouse.org_name as string

  const { data: rows, error: variantsError } = await supabase
    .from('product_variants')
    .select(`
      id,
      product_id,
      variant_name,
      product_code,
      alternative_name,
      attributes,
      barcode,
      manufacturer_sku,
      distributor_price,
      is_active,
      products!inner (
        product_name,
        product_code,
        is_active,
        is_discontinued,
        category_id,
        product_categories!inner (id, is_active, is_vape),
        product_groups (group_name)
      )
    `)
    .eq('is_active', true)
    .eq('products.is_active', true)
    .eq('products.product_categories.is_vape', true)
    .eq('products.product_categories.is_active', true)

  if (variantsError) throw new Error('Unable to load the distributor Quick Order catalog.')
  const variantIds = (rows || []).map((row: QuickOrderCatalogRow) => row.id)
  if (variantIds.length === 0) {
    return { variants: [], inventoryOrganizationId, fulfillmentWarehouseName }
  }

  const [{ data: inventory, error: inventoryError }, { data: configurations, error: configurationsError }, { data: eligibility }] = await Promise.all([
    supabase.from('product_inventory').select('variant_id, stock_config_id, quantity_on_hand, quantity_allocated, quantity_available')
      .eq('organization_id', inventoryOrganizationId).in('variant_id', variantIds),
    supabase.from('inventory_stock_configurations')
      .select('id, config_code, volume_ml, packaging, status, allow_so, requires_repacking_before_sale').in('variant_id', variantIds),
    supabase.from('distributor_stock_config_eligibility').select('allow_50ml_new_box')
      .eq('distributor_org_id', distributorId).maybeSingle(),
  ])
  if (inventoryError || configurationsError) throw new Error('Unable to load current Quick Order inventory.')

  const stockByVariant = resolveSellableStock(inventory || [], configurations || [], eligibility?.allow_50ml_new_box === true)
  const unclassifiedVariantIds = resolveUnclassifiedVariantIds(inventory || [], configurations || [], stockByVariant)
  return {
    variants: filterQuickOrderCatalogRows(rows || [], stockByVariant, unclassifiedVariantIds),
    inventoryOrganizationId,
    fulfillmentWarehouseName,
  }
}
