const MONEY_SCALE = 100

/** Normalize a database NUMERIC(12,2) value without introducing fractional cents. */
export function normalizeBaseCost(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * MONEY_SCALE) / MONEY_SCALE
}

export function stockCountImpactCents(quantityChange: number, baseCost: unknown): number | null {
  const normalizedCost = normalizeBaseCost(baseCost)
  if (!Number.isSafeInteger(quantityChange) || normalizedCost === null) return null
  const cents = Math.round(normalizedCost * MONEY_SCALE)
  const impact = quantityChange * cents
  return Number.isSafeInteger(impact) ? impact : null
}

export function stockCountImpact(quantityChange: number, baseCost: unknown): number | null {
  const cents = stockCountImpactCents(quantityChange, baseCost)
  return cents === null ? null : cents / MONEY_SCALE
}

export function sumStockCountImpacts(
  rows: Array<{ quantityChange: number; baseCost: unknown }>,
): number {
  const cents = rows.reduce((total, row) => {
    const impact = stockCountImpactCents(row.quantityChange, row.baseCost)
    return total + (impact ?? 0)
  }, 0)
  return cents / MONEY_SCALE
}
