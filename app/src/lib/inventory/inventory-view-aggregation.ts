/**
 * View Inventory aggregation — one summary row per organization + variant.
 *
 * The warehouse inventory detail (product_inventory / vw_inventory_on_hand) has
 * one row per stock configuration, so a single flavour at a single warehouse can
 * legitimately have four balance rows (20NB / 50NB / 50OB / Legacy). Rendering
 * those raw rows produced the reported defects:
 *   - four visually identical flavour rows,
 *   - the variant-level Incoming quantity repeated on every configuration,
 *   - a negative Total Value driven by movement-variance recomputation.
 *
 * This module collapses the configuration rows back to one authoritative summary
 * per (organization, variant) and derives the drill-down detail with the correct
 * per-configuration attribution:
 *   - Incoming is a VARIANT-level quantity. All new manufacturer ORD receipts
 *     land on 20ml New Box, so incoming is attributed to exactly ONE
 *     configuration (the 20NB config, or the ORD default) and surfaced once at
 *     the summary. It is never multiplied across configuration join rows.
 *   - Total Value uses the CURRENT balance: max(On Hand, 0) × unit/average cost.
 *     It is never derived from movement variance or a classification-out value,
 *     so clearing a Legacy balance can never drive inventory value negative.
 *
 * Pure and framework-free so the behaviour can be unit tested directly.
 */

export interface InventoryConfigRow {
  id: string
  organization_id?: string | null
  organization_name?: string | null
  organization_code?: string | null
  variant_id?: string | null
  variant_code?: string | null
  variant_name?: string | null
  variant_image_url?: string | null
  product_name?: string | null
  product_code?: string | null
  stock_config_id?: string | null
  config_code?: string | null
  config_label?: string | null
  stock_sku?: string | null
  volume_ml?: number | null
  packaging?: string | null
  default_for_ord?: boolean | null
  stock_config_status?: string | null
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  unit_cost?: number | null
  reorder_point?: number | null
  warehouse_location?: string | null
  updated_at?: string | null
}

export interface AggregatedConfig {
  /** Row id of the underlying balance row (stable React key). */
  id: string
  stockConfigId: string | null
  configCode: string | null
  stockSku: string | null
  /** Human label: e.g. "20ml · New Box" or "Legacy / Unclassified". */
  label: string
  volumeMl: number | null
  packaging: string | null
  lifecycleStatus: string | null
  isLegacy: boolean
  onHand: number
  allocated: number
  available: number
  incoming: number
  position: number
  unitCost: number | null
  value: number
}

export interface VariantInventorySummary {
  key: string
  organizationId: string | null
  organizationName: string | null
  organizationCode: string | null
  variantId: string | null
  variantCode: string | null
  variantName: string | null
  variantImageUrl: string | null
  productName: string | null
  productCode: string | null
  onHand: number
  allocated: number
  available: number
  incoming: number
  position: number
  unitCost: number | null
  value: number
  reorderPoint: number
  warehouseLocation: string | null
  /** Most recent balance update across the variant's configurations (ISO string). */
  updatedAt: string | null
  /** Configuration detail for the drill-down (zero Legacy hidden by default). */
  configs: AggregatedConfig[]
  /** Number of configuration rows hidden from the detail (zero Legacy/inactive). */
  hiddenConfigCount: number
  /** True when at least one configuration carries physical dimensions. */
  configuredVariant: boolean
}

/** Resolve incoming for a warehouse + variant. Returns the variant-level total. */
export type IncomingResolver = (
  organizationId: string | null | undefined,
  variantId: string | null | undefined,
) => number

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const normalizeCode = (value?: string | null): string => (value || '').trim().toUpperCase()

/**
 * A configuration is Legacy/Unclassified when it has no physical dimensions,
 * carries the UNCLASSIFIED code, or has no stock configuration identity at all.
 */
export function isLegacyConfigRow(row: InventoryConfigRow): boolean {
  if (normalizeCode(row.config_code) === 'UNCLASSIFIED') return true
  if (!row.stock_config_id) return true
  return (row.volume_ml === null || row.volume_ml === undefined) &&
    (row.packaging === null || row.packaging === undefined)
}

function configLabel(row: InventoryConfigRow): string {
  if (isLegacyConfigRow(row)) return 'Legacy / Unclassified'
  const volume = row.volume_ml ? `${row.volume_ml}ml` : null
  const packaging = row.packaging === 'new_box' ? 'New Box' : row.packaging === 'old_box' ? 'Old Box' : null
  const dimensions = [volume, packaging].filter(Boolean).join(' · ')
  return dimensions || row.config_label || 'Configuration'
}

/**
 * Pick the single configuration row that receives the variant's incoming stock.
 * All new manufacturer ORD receipts use 20ml New Box, so incoming attaches to
 * the 20NB configuration; failing that, the ORD default; failing that, the sole
 * row of a non-configured (STD) variant. Returns null when it cannot be
 * attributed to one row (so incoming is never repeated across configurations).
 */
export function pickIncomingConfigRowId(rows: InventoryConfigRow[]): string | null {
  const twentyNewBox = rows.find((row) => normalizeCode(row.config_code) === '20NB')
  if (twentyNewBox) return twentyNewBox.id
  const ordDefault = rows.find((row) => row.default_for_ord === true)
  if (ordDefault) return ordDefault.id
  if (rows.length === 1) return rows[0].id
  return null
}

export interface AggregateOptions {
  /** Include zero-balance Legacy/inactive configurations in the detail list. */
  includeInactive?: boolean
}

export type InventorySummarySortColumn =
  | 'variant_code'
  | 'product_name'
  | 'location'
  | 'on_hand'
  | 'allocated'
  | 'available'
  | 'incoming'
  | 'position'
  | 'total_value'

export interface InventorySummaryFilterOptions {
  searchQuery?: string
  statusFilter?: 'all' | 'low_stock' | 'out_of_stock' | 'in_stock'
  valueRangeFilter?: 'all' | 'under_1000' | '1000_5000' | '5000_10000' | 'over_10000'
}

/**
 * Filter only after aggregation. In particular, a Stock SKU search may match
 * one configuration, but the returned row must retain the flavour's complete
 * totals rather than being re-aggregated from that one matching configuration.
 */
export function filterVariantInventorySummaries(
  summaries: VariantInventorySummary[],
  options: InventorySummaryFilterOptions,
): VariantInventorySummary[] {
  const search = (options.searchQuery || '').trim().toLowerCase()
  const status = options.statusFilter || 'all'
  const valueRange = options.valueRangeFilter || 'all'

  return summaries.filter((summary) => {
    const matchesSearch = !search || [
      summary.variantCode,
      summary.variantName,
      summary.productName,
      summary.productCode,
      summary.organizationName,
      summary.organizationCode,
      ...summary.configs.flatMap((config) => [
        config.stockSku,
        config.configCode,
        config.label,
      ]),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search))

    let matchesStatus = true
    if (status === 'low_stock') matchesStatus = summary.available > 0 && summary.available <= summary.reorderPoint
    else if (status === 'out_of_stock') matchesStatus = summary.available <= 0
    else if (status === 'in_stock') matchesStatus = summary.available > 0

    let matchesValue = true
    if (valueRange === 'under_1000') matchesValue = summary.value < 1000
    else if (valueRange === '1000_5000') matchesValue = summary.value >= 1000 && summary.value < 5000
    else if (valueRange === '5000_10000') matchesValue = summary.value >= 5000 && summary.value < 10000
    else if (valueRange === 'over_10000') matchesValue = summary.value >= 10000

    return matchesSearch && matchesStatus && matchesValue
  })
}

export function sortVariantInventorySummaries(
  summaries: VariantInventorySummary[],
  column: InventorySummarySortColumn | null,
  direction: 'asc' | 'desc',
): VariantInventorySummary[] {
  if (!column) return [...summaries]

  const value = (summary: VariantInventorySummary): string | number => {
    switch (column) {
      case 'variant_code': return summary.variantCode || ''
      case 'product_name': return summary.productName || ''
      case 'location': return summary.organizationName || ''
      case 'on_hand': return summary.onHand
      case 'allocated': return summary.allocated
      case 'available': return summary.available
      case 'incoming': return summary.incoming
      case 'position': return summary.position
      case 'total_value': return summary.value
    }
  }

  return [...summaries].sort((a, b) => {
    const aValue = value(a)
    const bValue = value(b)
    const comparison = typeof aValue === 'string' && typeof bValue === 'string'
      ? aValue.localeCompare(bValue)
      : Number(aValue) - Number(bValue)
    return direction === 'asc' ? comparison : -comparison
  })
}

export function paginateVariantInventorySummaries(
  summaries: VariantInventorySummary[],
  page: number,
  pageSize: number,
): VariantInventorySummary[] {
  const start = Math.max(0, page - 1) * pageSize
  return summaries.slice(start, start + pageSize)
}

/** Snapshot the exact summary rows consumed by the Excel writer. */
export function buildInventorySummaryExportRows(summaries: VariantInventorySummary[]) {
  return summaries.map((summary) => ({
    key: summary.key,
    productName: summary.productName,
    productCode: summary.productCode,
    variantName: summary.variantName,
    variantCode: summary.variantCode,
    organizationName: summary.organizationName,
    warehouseLocation: summary.warehouseLocation,
    onHand: summary.onHand,
    allocated: summary.allocated,
    available: summary.available,
    incoming: summary.incoming,
    position: summary.position,
    reorderPoint: summary.reorderPoint,
    unitCost: summary.unitCost,
    value: summary.value,
    updatedAt: summary.updatedAt,
  }))
}

/**
 * Collapse per-configuration balance rows into one summary per organization +
 * variant. Warehouse and distributor inventories remain separate because the
 * grouping key includes the organization id.
 */
export function aggregateVariantInventory(
  rows: InventoryConfigRow[],
  getIncoming: IncomingResolver,
  options: AggregateOptions = {},
): VariantInventorySummary[] {
  const includeInactive = options.includeInactive === true
  const groups = new Map<string, InventoryConfigRow[]>()

  for (const row of rows) {
    // Every row is keyed by organization + variant so identical flavours in
    // different organizations never merge.
    const key = `${row.organization_id ?? 'org'}::${row.variant_id ?? row.variant_code ?? row.id}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  const summaries: VariantInventorySummary[] = []

  for (const [key, groupRows] of groups) {
    const first = groupRows[0]
    const incomingTotal = num(getIncoming(first.organization_id, first.variant_id))
    const incomingRowId = incomingTotal > 0 ? pickIncomingConfigRowId(groupRows) : null

    let onHand = 0
    let allocated = 0
    let available = 0
    let value = 0
    let representativeUnitCost: number | null = null
    let reorderPoint = 0
    let configuredVariant = false
    let updatedAt: string | null = null

    const configs: AggregatedConfig[] = groupRows.map((row) => {
      const rowOnHand = num(row.quantity_on_hand)
      const rowAllocated = num(row.quantity_allocated)
      const rowAvailable = row.quantity_available === null || row.quantity_available === undefined
        ? rowOnHand - rowAllocated
        : num(row.quantity_available)
      const rowIncoming = row.id === incomingRowId ? incomingTotal : 0
      const unitCost = row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost)
      // Current-balance value only. Clearing a Legacy balance (On Hand → 0)
      // yields 0, never a negative movement-variance value.
      const rowValue = unitCost === null ? 0 : Math.max(0, rowOnHand) * unitCost
      const legacy = isLegacyConfigRow(row)

      onHand += rowOnHand
      allocated += rowAllocated
      available += rowAvailable
      value += rowValue
      if (unitCost !== null && representativeUnitCost === null) representativeUnitCost = unitCost
      reorderPoint = Math.max(reorderPoint, num(row.reorder_point))
      if (!legacy) configuredVariant = true
      if (row.updated_at && (updatedAt === null || row.updated_at > updatedAt)) updatedAt = row.updated_at

      return {
        id: row.id,
        stockConfigId: row.stock_config_id ?? null,
        configCode: row.config_code ?? null,
        stockSku: row.stock_sku ?? null,
        label: configLabel(row),
        volumeMl: row.volume_ml ?? null,
        packaging: row.packaging ?? null,
        lifecycleStatus: row.stock_config_status ?? null,
        isLegacy: legacy,
        onHand: rowOnHand,
        allocated: rowAllocated,
        available: rowAvailable,
        incoming: rowIncoming,
        position: rowAvailable + rowIncoming,
        unitCost,
        value: Number(rowValue.toFixed(2)),
      }
    })

    // Order: configured rows first (by volume then packaging), Legacy last.
    configs.sort((a, b) => {
      if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1
      const volumeDelta = (a.volumeMl ?? 0) - (b.volumeMl ?? 0)
      if (volumeDelta !== 0) return volumeDelta
      return (a.packaging ?? '').localeCompare(b.packaging ?? '')
    })

    // Hide zero Legacy/Unclassified (and other zero inactive rows) by default.
    const visibleConfigs = includeInactive
      ? configs
      : configs.filter((config) => !(config.isLegacy && config.onHand === 0 && config.allocated === 0 && config.incoming === 0))

    summaries.push({
      key,
      organizationId: first.organization_id ?? null,
      organizationName: first.organization_name ?? null,
      organizationCode: first.organization_code ?? null,
      variantId: first.variant_id ?? null,
      variantCode: first.variant_code ?? null,
      variantName: first.variant_name ?? null,
      variantImageUrl: first.variant_image_url ?? null,
      productName: first.product_name ?? null,
      productCode: first.product_code ?? null,
      onHand,
      allocated,
      available,
      incoming: incomingTotal,
      position: available + incomingTotal,
      unitCost: representativeUnitCost,
      value: Number(value.toFixed(2)),
      reorderPoint,
      warehouseLocation: first.warehouse_location ?? null,
      updatedAt,
      configs: visibleConfigs,
      hiddenConfigCount: configs.length - visibleConfigs.length,
      configuredVariant,
    })
  }

  return summaries
}
