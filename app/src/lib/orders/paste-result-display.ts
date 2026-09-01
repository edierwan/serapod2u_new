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

/**
 * Distributor-friendly SerApp labels (avoid technical "Matched").
 * Example: "50 available", "Only 20 available", "Out of stock".
 */
export function describeSerappLineAvailability(
  result: PasteMatchResult,
  selectedVariant?: MatchableVariant | null,
): string {
  if (result.status === 'section_header') {
    return `Section: ${result.sectionProductLine || result.name}`
  }
  if (result.status === 'requires_review') return 'Check the name'
  if (result.status === 'missing_quantity') {
    const variant = result.selectedVariantId
      ? result.candidates.find((candidate) => candidate.id === result.selectedVariantId)
      : result.candidates.length === 1
        ? result.candidates[0]
        : undefined
    if (variant && typeof variant.available_qty === 'number') {
      if (variant.available_qty <= 0) return 'Out of stock'
      return `Add qty · ${variant.available_qty} in stock`
    }
    if (variant) return 'Found · add qty'
    return 'Add qty'
  }
  if (result.status === 'invalid_quantity') return 'Check quantity'
  if (result.status === 'duplicate') return 'Duplicate line'
  if (result.status === 'ambiguous' && result.candidates.length > 1) {
    return `${result.candidates.length} options · pick below`
  }
  if (result.status === 'suggestion' && result.candidates.length === 1) {
    return 'Tap to confirm'
  }
  if (!result.selectedVariantId && result.candidates.length > 0) {
    return 'Pick below'
  }
  if (!result.selectedVariantId) return 'Not in catalog'

  const variant = selectedVariant
    ?? (result.selectedVariantId
      ? result.candidates.find(candidate => candidate.id === result.selectedVariantId)
      : undefined)

  const qty = result.quantity
  const outcome = result.inventoryOutcome ?? resolvePasteInventoryOutcome(qty, variant)

  if (outcome === 'no_available_stock') return 'Out of stock'
  if (outcome === 'insufficient_stock') {
    const available = variant?.available_qty
    if (typeof available === 'number') return `Only ${available} available`
    return 'Not enough stock'
  }
  if (outcome === 'inventory_unclassified') {
    return qty != null ? `${qty} · stock unclear` : 'Stock unclear'
  }
  if (outcome === 'matched') {
    return qty != null ? `${qty} available` : 'Available'
  }
  return 'Not found'
}

/**
 * Strip filler words that often leak into pasted product labels
 * (e.g. "available Vanilla Potato" → "Vanilla Potato").
 */
export function cleanSerappLineLabel(raw: string | null | undefined): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text
    .replace(/^(?:available|avail|in\s+stock|stock|stok)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim() || text
}
