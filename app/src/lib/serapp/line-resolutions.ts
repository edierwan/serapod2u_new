import type { PasteMatchResult, PasteMatchStatus } from '@/components/orders/quick-order-matcher'
import { matchPastedOrder, resolvePasteInventoryOutcome } from '@/components/orders/quick-order-matcher'
import { summarizeSerappPasteCheck } from '@/lib/serapp/paste-check-summary'

export interface SerappLineResolution {
  line: number
  variantId: string
}

export interface SerappQuantityResolution {
  line: number
  quantity: number
}

export interface SerappCatalogPriceRow {
  id: string
  product_id?: string
  product_name: string
  variant_name?: string
  available_qty?: number
  inventory_classification?: 'classified' | 'unclassified'
  distributor_price?: number
}

const RESOLVABLE_STATUSES = new Set<PasteMatchStatus>(['not_found', 'ambiguous', 'suggestion'])

export function parseSerappLineResolutions(raw: unknown): SerappLineResolution[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const parsed: SerappLineResolution[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const line = Number((entry as { line?: unknown }).line)
    const variantId = String((entry as { variantId?: unknown }).variantId || '').trim()
    if (!Number.isInteger(line) || line < 1 || !variantId) continue
    if (seen.has(line)) continue
    seen.add(line)
    parsed.push({ line, variantId })
  }
  return parsed
}

export function parseSerappQuantityResolutions(raw: unknown): SerappQuantityResolution[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const parsed: SerappQuantityResolution[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const line = Number((entry as { line?: unknown }).line)
    const quantity = Number((entry as { quantity?: unknown }).quantity)
    if (!Number.isInteger(line) || line < 1 || !Number.isFinite(quantity) || quantity <= 0) continue
    if (seen.has(line)) continue
    seen.add(line)
    parsed.push({ line, quantity: Math.floor(quantity) })
  }
  return parsed
}

/**
 * Apply explicit distributor picks onto matcher output.
 * Does not change auto-match rules. Invalid picks are ignored.
 */
export function applySerappLineResolutions<T extends SerappCatalogPriceRow>(
  results: PasteMatchResult[],
  variants: T[],
  resolutions: SerappLineResolution[],
): PasteMatchResult[] {
  if (resolutions.length === 0) return results
  const byId = new Map(variants.map(variant => [variant.id, variant]))
  const byLine = new Map(resolutions.map(item => [item.line, item.variantId]))

  return results.map((result) => {
    const variantId = byLine.get(result.line)
    if (!variantId || !RESOLVABLE_STATUSES.has(result.status)) return result

    const variant = byId.get(variantId)
    if (!variant) return result
    if (result.sectionProductLine && variant.product_name !== result.sectionProductLine) {
      return result
    }
    if (result.status !== 'not_found' && !result.candidates.some(candidate => candidate.id === variantId)) {
      return result
    }

    return {
      ...result,
      status: 'matched',
      selectedVariantId: variantId,
      inventoryOutcome: resolvePasteInventoryOutcome(result.quantity, variant),
    }
  })
}

/**
 * Apply distributor-entered quantities onto missing-qty paste lines.
 */
export function applySerappQuantityResolutions<T extends SerappCatalogPriceRow>(
  results: PasteMatchResult[],
  variants: T[],
  resolutions: SerappQuantityResolution[],
): PasteMatchResult[] {
  if (resolutions.length === 0) return results
  const byLine = new Map(resolutions.map((item) => [item.line, item.quantity]))
  const byId = new Map(variants.map((variant) => [variant.id, variant]))

  return results.map((result) => {
    const quantity = byLine.get(result.line)
    if (!quantity || result.status !== 'missing_quantity') return result

    const variantId = result.selectedVariantId
      || (result.candidates.length === 1 ? result.candidates[0].id : undefined)
    const variant = variantId ? byId.get(variantId) : undefined
    if (!variant) return { ...result, quantity }

    return {
      ...result,
      quantity,
      status: 'matched',
      selectedVariantId: variantId,
      inventoryOutcome: resolvePasteInventoryOutcome(quantity, variant),
    }
  })
}

export function estimateSerappMatchedValue(
  results: PasteMatchResult[],
  variants: SerappCatalogPriceRow[],
): number {
  const prices = new Map(variants.map(variant => [variant.id, variant.distributor_price || 0]))
  return results.reduce((sum, result) => {
    if (!result.selectedVariantId || !result.quantity || result.quantity <= 0) return sum
    if (result.status !== 'matched' && result.status !== 'alternative_match') return sum
    if (result.inventoryOutcome && result.inventoryOutcome !== 'matched') return sum
    return sum + result.quantity * (prices.get(result.selectedVariantId) || 0)
  }, 0)
}

export function runSerappPasteCheck<T extends SerappCatalogPriceRow>(
  pasteText: string,
  variants: T[],
  lineResolutions: SerappLineResolution[] = [],
  quantityResolutions: SerappQuantityResolution[] = [],
) {
  const matched = applySerappLineResolutions(
    matchPastedOrder(pasteText, variants),
    variants,
    lineResolutions,
  )
  const results = applySerappQuantityResolutions(matched, variants, quantityResolutions)
  return {
    results,
    summary: summarizeSerappPasteCheck(results),
    estimatedOrderValue: estimateSerappMatchedValue(results, variants),
  }
}

export function isSerappReviewLine(status: PasteMatchStatus): boolean {
  return RESOLVABLE_STATUSES.has(status)
}
