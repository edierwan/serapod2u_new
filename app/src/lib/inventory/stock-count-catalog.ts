import { normalizeBaseCost } from './stock-count-costing'

export const STOCK_COUNT_UNGROUPED_ID = 'ungrouped'

export interface StockCountCatalogRow {
  inventoryId: string | null
  stockConfigId: string
  configCode: string
  stockSku: string
  configLabel: string
  volumeMl: number | null
  packagingVersion: string | null
  configStatus: string
  variantId: string
  productName: string
  productCode: string
  groupId: string
  groupName: string
  groupDescription: string | null
  brandLogoUrl: string | null
  variantName: string
  alternativeName: string | null
  variantCode: string
  manufacturerSku: string | null
  manualSku: string | null
  imageUrl: string | null
  systemQuantity: number
  quantityAllocated: number
  physicalCount: string
  note: string
  unitCost: number | null
  warehouseLocation: string | null
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

/**
 * Build the warehouse Stock Count catalog from configurations, then overlay
 * optional warehouse balances. A configuration does not need a
 * product_inventory row to be countable.
 */
export function buildStockCountCatalogRows(
  configurations: any[],
  warehouseBalances: any[],
): StockCountCatalogRow[] {
  const balancesByConfig = new Map<string, any>()
  for (const balance of warehouseBalances) {
    const configId = String(balance.stock_config_id || '')
    if (!configId) continue
    if (balancesByConfig.has(configId)) {
      throw new Error(`Duplicate inventory balance rows found for Stock Configuration ${configId}.`)
    }
    balancesByConfig.set(configId, balance)
  }

  const seenConfigs = new Set<string>()
  const rows = configurations.map((config) => {
    const stockConfigId = String(config.id || '')
    if (!stockConfigId) throw new Error('A Stock Configuration is missing its ID.')
    if (seenConfigs.has(stockConfigId)) throw new Error(`Duplicate Stock Configuration ${stockConfigId} in catalog.`)
    seenConfigs.add(stockConfigId)

    const variant: any = relation(config.product_variants)
    const product: any = relation(variant?.products)
    if (!variant?.id || !product?.id) {
      throw new Error(`Stock Configuration ${stockConfigId} is missing its active Product Variant relationship.`)
    }
    const group: any = relation(product.product_groups)
    const brand: any = relation(product.brands)
    const balance = balancesByConfig.get(stockConfigId)

    return {
      inventoryId: balance?.id || null,
      stockConfigId,
      configCode: config.config_code,
      stockSku: config.stock_sku,
      configLabel: config.config_label,
      volumeMl: config.volume_ml,
      packagingVersion: config.packaging,
      configStatus: config.status,
      variantId: variant.id,
      productName: product.product_name || 'Unnamed product',
      productCode: variant.product_code || '',
      groupId: group?.id || brand?.id || STOCK_COUNT_UNGROUPED_ID,
      groupName: group?.group_name || brand?.brand_name || 'Ungrouped',
      groupDescription: group?.group_description || null,
      brandLogoUrl: brand?.logo_url || null,
      variantName: variant.variant_name || 'Unnamed variant',
      alternativeName: variant.alternative_name || null,
      variantCode: variant.variant_code || '',
      manufacturerSku: variant.manufacturer_sku || null,
      manualSku: variant.manual_sku || null,
      imageUrl: variant.image_url || null,
      systemQuantity: Number(balance?.quantity_on_hand || 0),
      quantityAllocated: Number(balance?.quantity_allocated || 0),
      physicalCount: '',
      note: '',
      unitCost: normalizeBaseCost(variant.base_cost),
      warehouseLocation: balance?.warehouse_location || null,
    }
  })

  return rows.sort((a, b) =>
    `${a.groupName} ${a.productName} ${a.variantName} ${a.configLabel}`
      .localeCompare(`${b.groupName} ${b.productName} ${b.variantName} ${b.configLabel}`),
  )
}

export function stockCountRowHasActivity(row: Pick<StockCountCatalogRow, 'systemQuantity' | 'physicalCount' | 'note'>): boolean {
  return row.systemQuantity !== 0 || row.physicalCount.trim() !== '' || row.note.trim() !== ''
}

export function isStockCountCatalogRowVisible(row: StockCountCatalogRow, showInactive: boolean): boolean {
  const hasActivity = stockCountRowHasActivity(row)
  if (row.configCode === 'UNCLASSIFIED' && !hasActivity) return false
  if (row.configStatus === 'inactive') return showInactive
  if (row.configStatus === 'phase_out' && !hasActivity) return showInactive
  return true
}

export function matchesStockCountSearch(row: StockCountCatalogRow, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return true
  return [
    row.productName,
    row.variantName,
    row.alternativeName,
    row.productCode,
    row.variantCode,
    row.stockSku,
    row.configLabel,
    row.manufacturerSku,
    row.manualSku,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(query))
}
