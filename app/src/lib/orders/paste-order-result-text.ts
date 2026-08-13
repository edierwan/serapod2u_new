/**
 * Builds the WhatsApp reply an operator pastes back to the distributor after
 * reviewing a pasted order list.
 *
 * The reply mirrors the shape of the message that came in — a Title Case
 * product heading, then one "<flavour> <qty><mark>" line per entry, groups
 * separated by a blank line:
 *
 *   Cellera Hero
 *   corn 50✅
 *   kelapa 50❌
 *
 *   Cellera Zero
 *   almond 50✅
 *
 * The entry text is echoed exactly as the distributor wrote it (minus their own
 * status marks), not replaced with the resolved master-data flavour, so the
 * person reading the reply recognises their own list. The ✅/❌ is the system's
 * own verdict — a line is ✅ only when it resolved to a variant with enough
 * available stock to fulfil the quantity.
 *
 * Pure and framework-free so the exact output can be unit tested.
 */

import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'

export const AVAILABLE_MARK = '✅'
export const UNAVAILABLE_MARK = '❌'

/** Heading used for entries that never resolved to a product. */
export const UNMATCHED_HEADING = 'Unmatched'

interface ResultTextVariant {
  id: string
  product_name: string
}

/**
 * Capitalises the first letter of each word and leaves the rest of the word
 * alone, so "cellera hero" becomes "Cellera Hero" while "S.Line" and
 * "SERAPOD® TUMBLER" survive intact. A blunt lowercase-then-capitalise would
 * turn "S.Line" into "S.line".
 */
export function titleCaseHeading(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export interface PasteResultTextLine {
  /** Entry text as pasted, used verbatim in the reply. */
  name: string
  quantity: number | null
  available: boolean
  productName: string | null
}

export function buildPasteResultLines(
  results: PasteMatchResult[],
  variants: ResultTextVariant[],
  isAvailable: (result: PasteMatchResult) => boolean,
): PasteResultTextLine[] {
  const variantsById = new Map(variants.map(variant => [variant.id, variant]))
  return results.map(result => ({
    name: result.name,
    quantity: result.quantity,
    available: isAvailable(result),
    productName: result.selectedVariantId
      ? variantsById.get(result.selectedVariantId)?.product_name ?? null
      : null,
  }))
}

/**
 * Groups the reviewed lines by product in first-appearance order and renders
 * the reply text. Returns an empty string when there is nothing to report.
 */
export function buildPasteResultText(
  results: PasteMatchResult[],
  variants: ResultTextVariant[],
  isAvailable: (result: PasteMatchResult) => boolean,
): string {
  const lines = buildPasteResultLines(results, variants, isAvailable)
  if (lines.length === 0) return ''

  const groups = new Map<string, string[]>()
  for (const line of lines) {
    const heading = line.productName ? titleCaseHeading(line.productName) : UNMATCHED_HEADING
    const quantity = line.quantity ?? ''
    const mark = line.available ? AVAILABLE_MARK : UNAVAILABLE_MARK
    if (!groups.has(heading)) groups.set(heading, [])
    groups.get(heading)!.push(`${line.name} ${quantity}${mark}`.replace(/\s+/g, ' ').trim())
  }

  // Unmatched entries always trail the real products.
  const headings = [...groups.keys()].filter(heading => heading !== UNMATCHED_HEADING)
  if (groups.has(UNMATCHED_HEADING)) headings.push(UNMATCHED_HEADING)

  return headings
    .map(heading => [heading, ...groups.get(heading)!].join('\n'))
    .join('\n\n')
}
