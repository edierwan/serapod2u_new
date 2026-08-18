import {
  applyCategoryFilters,
  categoryRelationForRule,
  isCategoryAllowed,
  resolveDistributorCategoryRule,
  type ProgramCategoryRule,
} from '@/lib/orders/d2h-program-category-policy'
import {
  resolveSellableAvailability,
  resolveUnclassifiedVariantIds,
  type QuickOrderCatalogVariant,
} from '@/lib/orders/quick-order-catalog'
import { resolveSellerHqId } from '@/lib/orders/hq-fulfillment-warehouses'

const asSingle = <T>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] || null) : (value || null)

/**
 * Keeps rows whose product category is allowed by the distributor's program
 * rule. Group and subgroup are display-only here: every group/subgroup under an
 * allowed category is kept, so a new group under Vape needs no code change.
 */
export function filterStandardOrderCatalogRows(
  rows: any[],
  availableByVariant: Map<string, number>,
  unclassifiedVariantIds: Set<string>,
  categoryRule: ProgramCategoryRule | null,
): QuickOrderCatalogVariant[] {
  return rows.flatMap((row: any) => {
    const product = asSingle<any>(row.products)
    const category = asSingle<any>(product?.product_categories)
    if (!isCategoryAllowed(categoryRule, category)) return []

    const group = asSingle<any>(product?.product_groups)
    const distributorPrice = Number(row.distributor_price || 0)
    return [{
      id: row.id,
      product_id: row.product_id,
      product_name: product?.product_name || '',
      product_code: product?.product_code || '',
      variant_product_code: row.product_code || null,
      group_name: group?.group_name || 'Other',
      variant_name: row.variant_name,
      alternative_name: row.alternative_name || null,
      attributes: row.attributes || {},
      barcode: row.barcode || null,
      manufacturer_sku: row.manufacturer_sku || null,
      distributor_price: distributorPrice,
      available_qty: availableByVariant.get(row.id) || 0,
      inventory_classification: unclassifiedVariantIds.has(row.id) ? 'unclassified' as const : 'classified' as const,
      // Standard Order already refuses an unpriced variant when it is added to
      // the cart; the flag keeps the shared catalog shape honest.
      pricing_status: distributorPrice > 0 ? 'priced' as const : 'price_missing' as const,
    }]
  })
}

export async function resolveStandardOrderCatalog(
  supabase: any,
  admin: any,
  distributorId: string,
  requesterOrganizationId: string,
  fulfillmentWarehouseId: string,
): Promise<{
  variants: QuickOrderCatalogVariant[]
  inventoryOrganizationId: string
  fulfillmentWarehouseName: string | null
  restrictedToVape: boolean
  programCategoryKey: string | null
}> {
  const { data: requesterOrganization, error: requesterError } = await supabase
    .from('organizations')
    .select('id, parent_org_id, org_type_code')
    .eq('id', requesterOrganizationId)
    .single()
  if (requesterError || !requesterOrganization) throw new Error('Requester organization not found.')
  if (!['HQ', 'WH'].includes(requesterOrganization.org_type_code)) {
    throw new Error('Your organization is not authorized to create this D2H order.')
  }

  const hqOrganizationId = resolveSellerHqId(requesterOrganization)
  if (!hqOrganizationId) throw new Error('Unable to resolve the seller HQ organization.')

  const [{ data: distributor, error: distributorError }, { data: fulfillmentWarehouse, error: warehouseError }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id')
      .eq('id', distributorId)
      .eq('parent_org_id', hqOrganizationId)
      .eq('org_type_code', 'DIST')
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('id, org_name, org_type_code, parent_org_id, is_active')
      .eq('id', fulfillmentWarehouseId)
      .maybeSingle(),
  ])

  if (distributorError || !distributor) throw new Error('The selected distributor is not available in this HQ scope.')
  if (warehouseError || !fulfillmentWarehouse) throw new Error('The selected fulfillment warehouse was not found.')
  if (
    fulfillmentWarehouse.org_type_code !== 'WH'
    || fulfillmentWarehouse.is_active !== true
    || fulfillmentWarehouse.parent_org_id !== hqOrganizationId
  ) {
    throw new Error('The selected fulfillment warehouse is not an active warehouse under this HQ.')
  }

  const categoryRule = await resolveDistributorCategoryRule(admin, distributorId, hqOrganizationId)

  const variantsQuery = applyCategoryFilters(
    supabase
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
          category_id,
          ${categoryRelationForRule(categoryRule)},
          product_groups (group_name)
        )
      `)
      .eq('is_active', true)
      .eq('products.is_active', true),
    categoryRule,
  )

  const { data: rows, error: variantsError } = await variantsQuery.order('variant_name')
  if (variantsError) throw new Error('Unable to load the Standard Order catalog.')

  const restrictedToVape = categoryRule?.categoryKey === 'vape'
  const variantIds = (rows || []).map((row: any) => row.id)
  if (variantIds.length === 0) {
    return {
      variants: [],
      inventoryOrganizationId: fulfillmentWarehouse.id,
      fulfillmentWarehouseName: fulfillmentWarehouse.org_name,
      restrictedToVape,
      programCategoryKey: categoryRule?.categoryKey ?? null,
    }
  }

  const [{ data: inventory, error: inventoryError }, { data: configurations, error: configurationsError }, { data: eligibility }] = await Promise.all([
    supabase.from('product_inventory').select('variant_id, stock_config_id, quantity_on_hand, quantity_available')
      .eq('organization_id', fulfillmentWarehouse.id).in('variant_id', variantIds),
    supabase.from('inventory_stock_configurations')
      .select('id, config_code, volume_ml, packaging, status, allow_so, requires_repacking_before_sale').in('variant_id', variantIds),
    supabase.from('distributor_stock_config_eligibility').select('allow_50ml_new_box')
      .eq('distributor_org_id', distributorId).maybeSingle(),
  ])
  if (inventoryError || configurationsError) throw new Error('Unable to load current Standard Order inventory.')

  const availableByVariant = resolveSellableAvailability(
    inventory || [],
    configurations || [],
    eligibility?.allow_50ml_new_box === true,
  )
  const unclassifiedVariantIds = resolveUnclassifiedVariantIds(inventory || [], configurations || [], availableByVariant)

  const variants = filterStandardOrderCatalogRows(
    rows || [],
    availableByVariant,
    unclassifiedVariantIds,
    categoryRule,
  )

  return {
    variants,
    inventoryOrganizationId: fulfillmentWarehouse.id,
    fulfillmentWarehouseName: fulfillmentWarehouse.org_name,
    restrictedToVape,
    programCategoryKey: categoryRule?.categoryKey ?? null,
  }
}
