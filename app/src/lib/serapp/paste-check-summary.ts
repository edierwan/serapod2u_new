import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'

export type SerappAvailabilityBucket =
  | 'available'
  | 'partially_available'
  | 'out_of_stock'
  | 'unmatched_or_review'

export interface SerappPasteCheckSummary {
  bucket: SerappAvailabilityBucket
  label: string
  totalLines: number
  sectionHeaders: number
  matchedLines: number
  reviewLines: number
  outOfStockLines: number
  partialLines: number
  availableLines: number
}

/**
 * Collapse paste-match rows into the Serapp conversation availability buckets.
 * Section headers are informational and do not affect the order bucket.
 */
export function summarizeSerappPasteCheck(results: PasteMatchResult[]): SerappPasteCheckSummary {
  const productLines = results.filter(result => result.status !== 'section_header')
  const sectionHeaders = results.length - productLines.length

  let matchedLines = 0
  let reviewLines = 0
  let outOfStockLines = 0
  let partialLines = 0
  let availableLines = 0

  for (const result of productLines) {
    const needsReview = result.status === 'requires_review'
      || result.status === 'invalid_quantity'
      || result.status === 'missing_quantity'
      || result.status === 'not_found'
      || result.status === 'ambiguous'
      || result.status === 'suggestion'
      || result.status === 'duplicate'
      || !result.selectedVariantId

    if (needsReview) {
      reviewLines += 1
      continue
    }

    matchedLines += 1
    const outcome = result.inventoryOutcome
    if (outcome === 'no_available_stock' || outcome === 'inventory_unclassified') {
      outOfStockLines += 1
    } else if (outcome === 'insufficient_stock') {
      partialLines += 1
    } else {
      availableLines += 1
    }
  }

  let bucket: SerappAvailabilityBucket
  let label: string

  if (productLines.length === 0) {
    bucket = 'unmatched_or_review'
    label = 'Unmatched / Requires Review'
  } else if (reviewLines > 0) {
    bucket = 'unmatched_or_review'
    label = 'Unmatched / Requires Review'
  } else if (outOfStockLines === productLines.length) {
    bucket = 'out_of_stock'
    label = 'Out of Stock'
  } else if (partialLines > 0 || outOfStockLines > 0) {
    bucket = 'partially_available'
    label = 'Partially Available'
  } else if (availableLines === productLines.length) {
    bucket = 'available'
    label = 'Available'
  } else {
    bucket = 'unmatched_or_review'
    label = 'Unmatched / Requires Review'
  }

  return {
    bucket,
    label,
    totalLines: productLines.length,
    sectionHeaders,
    matchedLines,
    reviewLines,
    outOfStockLines,
    partialLines,
    availableLines,
  }
}
