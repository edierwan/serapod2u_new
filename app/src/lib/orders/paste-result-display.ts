import type { MatchableVariant, PasteMatchResult } from '@/components/orders/quick-order-matcher'
import { resolvePasteInventoryOutcome } from '@/components/orders/quick-order-matcher'

/**
 * Same result labels as Distributor Quick Order paste review (main branch).
 * SerApp reuses this so paste-check cards match the dashboard behaviour.
 */
export function describePasteMatchResult(
  result: PasteMatchResult,
  selectedVariant?: MatchableVariant | null,
): string {
  if (result.status === 'section_header') {
    return `Section: ${result.sectionProductLine || result.name}`
  }
  if (result.status === 'requires_review') {
    return 'Requires Review — Section Title With Quantity'
  }
  if (result.status === 'invalid_quantity') return 'Invalid Quantity'
  if (result.status === 'duplicate') return 'Duplicate'
  if (!result.selectedVariantId && result.candidates.length > 1) {
    return 'Multiple Matches — Selection Required'
  }
  if (!result.selectedVariantId && result.candidates.length === 1) {
    return 'Possible Match — Review Required'
  }

  const variant = selectedVariant
    ?? (result.selectedVariantId
      ? result.candidates.find(candidate => candidate.id === result.selectedVariantId)
      : undefined)

  const outcome = resolvePasteInventoryOutcome(result.quantity, variant)
  if (outcome === 'inventory_unclassified') return 'Matched — Inventory Unclassified'
  if (outcome === 'no_available_stock') return 'Matched — No Available Stock'
  if (outcome === 'insufficient_stock') return 'Matched — Insufficient Stock'
  if (outcome === 'matched') return 'Matched'
  return 'Product Not Found'
}
