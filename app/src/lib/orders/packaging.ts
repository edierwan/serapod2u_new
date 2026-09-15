/**
 * Order packaging conversions (Cases ↔ Boxes ↔ Pcs).
 *
 * The transactional quantity for H2M orders and warehouse receiving is always
 * CASES. Boxes and pieces are derived for display only — nothing here changes
 * a stored quantity.
 *
 * Sources (reused, not re-invented):
 *   - Cases per Box: the same resolution Create Order and QR generation use —
 *     `order_items.units_per_case || orders.units_per_case || 100`
 *     (`units_per_case` is the legacy internal name for "cases per box"; see
 *     CreateOrderView and /api/qr-batches/generate).
 *   - Pcs per Case: the centralized pack-size rule in `lib/returns/format`
 *     (`getUnitsPerCase`) — a configured product pack size > 1 wins, otherwise
 *     Cellera Hero/Zero = 4 pcs per case.
 *
 * Current Cellera configuration: 4 pcs / case, 100 cases / box, 400 pcs / box.
 */
import { getUnitsPerCase } from '@/lib/returns/format'

/** Fallback cases-per-box used by Create Order and QR generation. */
export const DEFAULT_CASES_PER_BOX = 100

function positiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** Cases per Box for an order line: item override → order setting → 100. */
export function resolveCasesPerBox(
  itemCasesPerBox?: number | null,
  orderCasesPerBox?: number | null,
): number {
  return positiveInt(itemCasesPerBox) ?? positiveInt(orderCasesPerBox) ?? DEFAULT_CASES_PER_BOX
}

/**
 * Pieces per Case for a product, or null when the pack size is unknown
 * (resolves to 1) so callers can hide a meaningless "pcs" figure.
 */
export function resolvePcsPerCase(
  productName: string | null | undefined,
  productPackSize?: number | null,
): number | null {
  const pcs = getUnitsPerCase(productName, productPackSize)
  return pcs > 1 ? pcs : null
}

export interface BoxSplit {
  fullBoxes: number
  looseCases: number
}

/** Split a case quantity into full boxes plus remaining loose cases. */
export function splitCasesIntoBoxes(cases: number, casesPerBox: number): BoxSplit {
  const qty = Math.max(0, Math.floor(Number(cases) || 0))
  const perBox = positiveInt(casesPerBox) ?? DEFAULT_CASES_PER_BOX
  return { fullBoxes: Math.floor(qty / perBox), looseCases: qty % perBox }
}

export function casesToPcs(cases: number, pcsPerCase: number): number {
  return Math.max(0, Math.floor(Number(cases) || 0)) * pcsPerCase
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export const formatCases = (cases: number) => plural(cases, 'case', 'cases')
export const formatPcs = (pcs: number) => `${pcs.toLocaleString()} pcs`

/**
 * Box estimate label, matching the Create Order "Box / Boxes" wording:
 *   8,000 cases @100 → "80 Boxes"
 *   850 cases @100   → "8 Boxes + 50 Cases"
 *   50 cases @100    → "0 Boxes + 50 Cases"
 */
export function formatBoxSplit({ fullBoxes, looseCases }: BoxSplit): string {
  const boxes = plural(fullBoxes, 'Box', 'Boxes')
  return looseCases > 0 ? `${boxes} + ${plural(looseCases, 'Case', 'Cases')}` : boxes
}

export function formatBoxEstimate(cases: number, casesPerBox: number): string {
  return formatBoxSplit(splitCasesIntoBoxes(cases, casesPerBox))
}

export interface PackagingLine {
  cases: number
  casesPerBox: number
  /** null when the product's pack size is unknown */
  pcsPerCase: number | null
}

export interface PackagingTotals {
  cases: number
  boxes: BoxSplit
  /** null when any contributing line has an unknown pack size */
  pcs: number | null
}

/**
 * Aggregate several order lines. When every line shares one cases-per-box the
 * summed cases are split once (so loose cases from different lines combine into
 * boxes); otherwise each line is split on its own box size and summed.
 */
export function summarizePackaging(lines: PackagingLine[]): PackagingTotals {
  const cases = lines.reduce((sum, l) => sum + Math.max(0, Math.floor(Number(l.cases) || 0)), 0)
  const boxSizes = new Set(lines.map((l) => resolveCasesPerBox(l.casesPerBox)))

  let boxes: BoxSplit
  if (boxSizes.size <= 1) {
    boxes = splitCasesIntoBoxes(cases, boxSizes.values().next().value ?? DEFAULT_CASES_PER_BOX)
  } else {
    boxes = lines.reduce<BoxSplit>((acc, l) => {
      const s = splitCasesIntoBoxes(l.cases, l.casesPerBox)
      return { fullBoxes: acc.fullBoxes + s.fullBoxes, looseCases: acc.looseCases + s.looseCases }
    }, { fullBoxes: 0, looseCases: 0 })
  }

  const pcs = lines.every((l) => l.pcsPerCase)
    ? lines.reduce((sum, l) => sum + casesToPcs(l.cases, l.pcsPerCase as number), 0)
    : null

  return { cases, boxes, pcs }
}

/**
 * Packaging for an order-level case total (e.g. Remaining Ordered) so boxes and
 * pcs always agree with the case figure shown. Uses the order's pack sizes when
 * every line shares them; otherwise falls back to the per-line breakdown.
 */
export function packagingForTotal(cases: number, lines: PackagingLine[], fallback: PackagingTotals): PackagingTotals {
  const qty = Math.max(0, Math.floor(Number(cases) || 0))
  const boxSizes = new Set(lines.map((l) => resolveCasesPerBox(l.casesPerBox)))
  const pcsSizes = new Set(lines.map((l) => l.pcsPerCase ?? null))
  if (lines.length === 0 || boxSizes.size !== 1 || pcsSizes.size !== 1) return { ...fallback, cases: qty }
  const pcsPerCase = pcsSizes.values().next().value ?? null
  return {
    cases: qty,
    boxes: splitCasesIntoBoxes(qty, boxSizes.values().next().value as number),
    pcs: pcsPerCase ? casesToPcs(qty, pcsPerCase) : null,
  }
}

/** One-line summary: "300 cases • 3 Boxes • 1,200 pcs". */
export function formatPackagingLine(totals: PackagingTotals): string {
  const parts = [formatCases(totals.cases), formatBoxSplit(totals.boxes)]
  if (totals.pcs !== null) parts.push(formatPcs(totals.pcs))
  return parts.join(' • ')
}
