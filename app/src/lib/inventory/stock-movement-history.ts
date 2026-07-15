export interface StockMovementHistoryValues {
  quantity_before: number
  quantity_change: number
  quantity_after: number
  unit_cost: number | null
  total_cost: number | null
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
