export interface StockMovementHistoryValues {
  quantity_before: number
  quantity_change: number
  quantity_after: number
  unit_cost: number | null
  total_cost: number | null
}

export interface StockMovementConfigurationValues {
  stock_config_id?: string | null
  config_code?: string | null
  config_label?: string | null
  stock_sku?: string | null
  volume_ml?: number | null
  packaging?: string | null
  stock_config_status?: string | null
}

export interface StockConfigurationMetadata {
  id: string
  config_code?: string | null
  config_label?: string | null
  stock_sku?: string | null
  volume_ml?: number | null
  packaging?: string | null
  status?: string | null
}

const packagingLabel = (packaging: string | null | undefined): string | null => {
  if (packaging === 'new_box') return 'New Box'
  if (packaging === 'old_box') return 'Old Box'
  return null
}

/**
 * Resolve report metadata only through the movement's persisted configuration
 * identity. Quantity, sign, row order, and product imagery are deliberately
 * excluded from configuration labelling.
 */
export const resolveStockMovementConfiguration = <T extends StockMovementConfigurationValues>(
  movement: T,
  configuration: StockConfigurationMetadata | null = null,
): T & StockMovementConfigurationValues & {
  configuration_display_label: string
  is_legacy_configuration: boolean
} => {
  const stockConfigId = movement.stock_config_id ?? null
  const matchingConfiguration =
    stockConfigId && configuration?.id === stockConfigId ? configuration : null

  if (!stockConfigId) {
    return {
      ...movement,
      stock_config_id: null,
      configuration_display_label: 'Legacy / Unclassified',
      is_legacy_configuration: true,
    }
  }

  const configCode = matchingConfiguration?.config_code ?? movement.config_code ?? null
  const configLabel = matchingConfiguration?.config_label ?? movement.config_label ?? null
  const stockSku = matchingConfiguration?.stock_sku ?? movement.stock_sku ?? null
  const volumeMl = matchingConfiguration?.volume_ml ?? movement.volume_ml ?? null
  const packaging = matchingConfiguration?.packaging ?? movement.packaging ?? null
  const stockConfigStatus =
    matchingConfiguration?.status ?? movement.stock_config_status ?? null
  const dimensions = [
    volumeMl ? `${volumeMl}ml` : null,
    packagingLabel(packaging),
  ].filter((value): value is string => Boolean(value))

  return {
    ...movement,
    config_code: configCode,
    config_label: configLabel,
    stock_sku: stockSku,
    volume_ml: volumeMl,
    packaging,
    stock_config_status: stockConfigStatus,
    configuration_display_label:
      configCode === 'UNCLASSIFIED'
        ? 'Legacy / Unclassified'
        : configLabel?.trim() || dimensions.join(' · ') || stockSku || 'Unknown configuration',
    is_legacy_configuration: configCode === 'UNCLASSIFIED',
  }
}

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Movement history is an audit trail, so its closing balance must come from
 * the same movement as its opening balance and delta. This also provides a
 * deterministic read-time correction for legacy rows whose closing balance
 * was overwritten by the old running-balance trigger.
 */
export const historicalQuantityAfter = (
  quantityBefore: unknown,
  quantityChange: unknown,
): number => {
  const before = finiteNumber(quantityBefore) ?? 0
  const change = finiteNumber(quantityChange) ?? 0
  return before + change
}

/**
 * Prefer the immutable cost captured on the movement. A current variant base
 * cost must never replace historical cost.
 */
export const historicalUnitCost = (unitCost: unknown): number | null =>
  finiteNumber(unitCost)

/**
 * stock_movements.total_cost is currently stored as an absolute value. Apply
 * the movement direction at the reporting boundary. Using the stored numeric
 * total avoids recalculating from a rounded display value.
 */
export const signedMovementTotal = (
  quantityChange: unknown,
  totalCost: unknown,
): number | null => {
  const change = finiteNumber(quantityChange)
  const total = finiteNumber(totalCost)
  if (change === null || total === null) return null
  if (change === 0) return 0
  return Math.sign(change) * Math.abs(total)
}

export const formatSignedMovementImpact = (value: unknown): string | null => {
  const total = finiteNumber(value)
  if (total === null) return null
  const sign = total > 0 ? '+' : total < 0 ? '-' : ''
  return `RM ${sign}${Math.abs(total).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export const resolveStockMovementHistoryValues = <T extends StockMovementHistoryValues>(
  movement: T,
): T => ({
  ...movement,
  quantity_after: historicalQuantityAfter(movement.quantity_before, movement.quantity_change),
  unit_cost: historicalUnitCost(movement.unit_cost),
  total_cost: signedMovementTotal(movement.quantity_change, movement.total_cost),
})
