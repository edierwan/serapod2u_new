export interface QuickOrderCatalogVariant {
  id: string
  product_id: string
  product_name: string
  product_code: string
  group_name: string
  variant_name: string
  alternative_name: string | null
  attributes: Record<string, unknown>
  barcode: string | null
  manufacturer_sku: string | null
  distributor_price: number
  available_qty: number
}

export interface QuickOrderCatalogRequestItem {
  variantId: string
  quantity: number
}

export function validateQuickOrderCatalogItems(
  items: QuickOrderCatalogRequestItem[],
  variants: QuickOrderCatalogVariant[],
) {
  const catalogByVariant = new Map(variants.map(variant => [variant.id, variant]))
  if (items.some(item => !catalogByVariant.has(item.variantId))) {
    throw new Error('This product is not available in the distributor Quick Order catalog.')
  }

  return items.map(item => {
    const variant = catalogByVariant.get(item.variantId)!
    if (item.quantity > variant.available_qty) {
      throw new Error(`Insufficient stock: ${variant.available_qty} units are currently available for a selected variant.`)
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
  quantity_available: number | null
}

interface SellableConfigurationRow {
  id: string
  volume_ml: number | null
  packaging: string | null
  status: string
  allow_so: boolean
  requires_repacking_before_sale: boolean
}

// A sales-order line is fulfilled from one configuration. Availability is
// therefore the largest eligible single balance, never the sum of 20NB+50NB.
export function resolveSellableAvailability(
  inventory: SellableInventoryRow[],
  configurations: SellableConfigurationRow[],
  allow50mlNewBox: boolean,
): Map<string, number> {
  const configs = new Map(configurations.map(config => [config.id, config]))
  const result = new Map<string, number>()

  for (const stock of inventory) {
    if (!stock.stock_config_id) continue
    const config = configs.get(stock.stock_config_id)
    if (!config || config.status !== 'active' || !config.allow_so || config.requires_repacking_before_sale) continue
    const isGeneric = config.volume_ml == null && config.packaging == null
    const is20nb = config.volume_ml === 20 && config.packaging === 'new_box'
    const is50nb = config.volume_ml === 50 && config.packaging === 'new_box' && allow50mlNewBox
    if (!isGeneric && !is20nb && !is50nb) continue
    result.set(stock.variant_id, Math.max(result.get(stock.variant_id) || 0, Number(stock.quantity_available || 0)))
  }

  return result
}

const asSingle = <T>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] || null) : (value || null)

/**
 * The current Quick Order catalog policy. This is intentionally isolated so a
 * future Distributor -> Program -> Assigned Products resolver can replace it
 * without changing the Quick Order UI or paste workflow.
 */
export function filterQuickOrderCatalogRows(
  rows: QuickOrderCatalogRow[],
  availableByVariant: Map<string, number>,
): QuickOrderCatalogVariant[] {
  return rows.flatMap(row => {
    const product = asSingle<any>(row.products)
    const category = asSingle<any>(product?.product_categories)
    const group = asSingle<any>(product?.product_groups)
    const availableQty = availableByVariant.get(row.id) || 0
    const distributorPrice = Number(row.distributor_price || 0)

    if (
      row.is_active !== true
      || product?.is_active !== true
      || product?.is_discontinued === true
      || category?.is_active === false
      || category?.is_vape !== true
      || availableQty <= 0
      || distributorPrice <= 0
    ) return []

    return [{
      id: row.id,
      product_id: row.product_id,
      product_name: product.product_name || '',
      product_code: product.product_code || '',
      group_name: group?.group_name || 'Other',
      variant_name: row.variant_name,
      alternative_name: row.alternative_name || null,
      attributes: row.attributes || {},
      barcode: row.barcode || null,
      manufacturer_sku: row.manufacturer_sku || null,
      distributor_price: distributorPrice,
      available_qty: availableQty,
    }]
  })
}

export async function resolveQuickOrderCatalog(
  supabase: any,
  distributorId: string,
  requesterOrganizationId: string,
): Promise<{ variants: QuickOrderCatalogVariant[]; inventoryOrganizationId: string }> {
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

  let inventoryOrganizationId = requesterOrganization.id
  if (isHeadquarters) {
    const { data: warehouse } = await supabase
      .from('organizations')
      .select('id')
      .eq('parent_org_id', requesterOrganization.id)
      .eq('org_type_code', 'WH')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (warehouse) inventoryOrganizationId = warehouse.id
  }

  const { data: rows, error: variantsError } = await supabase
    .from('product_variants')
    .select(`
      id,
      product_id,
      variant_name,
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
  if (variantIds.length === 0) return { variants: [], inventoryOrganizationId }

  const [{ data: inventory, error: inventoryError }, { data: configurations, error: configurationsError }, { data: eligibility }] = await Promise.all([
    supabase.from('product_inventory').select('variant_id, stock_config_id, quantity_available')
      .eq('organization_id', inventoryOrganizationId).in('variant_id', variantIds),
    supabase.from('inventory_stock_configurations')
      .select('id, volume_ml, packaging, status, allow_so, requires_repacking_before_sale').in('variant_id', variantIds),
    supabase.from('distributor_stock_config_eligibility').select('allow_50ml_new_box')
      .eq('distributor_org_id', distributorId).maybeSingle(),
  ])
  if (inventoryError || configurationsError) throw new Error('Unable to load current Quick Order inventory.')

  const availableByVariant = resolveSellableAvailability(inventory || [], configurations || [], eligibility?.allow_50ml_new_box === true)
  return { variants: filterQuickOrderCatalogRows(rows || [], availableByVariant), inventoryOrganizationId }
}
