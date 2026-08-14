/**
 * Builds the WhatsApp reply an operator pastes back to the distributor after
 * reviewing a pasted order list.
 *
 * The reply mirrors the shape of the message that came in — a Title Case
 * product heading stating the unit, then one "<Flavour> (<Code>) <qty> <mark>"
 * line per entry, groups separated by a blank line, and a closing verification
 * stamp:
 *
 *   Cellera Hero (Cases)
 *
 *   Corn (CO) 50 ❌
 *   Kelapa (KEL) 50 ✅
 *
 *   Cellera Zero (Cases)
 *
 *   Almond (AL) 50 ✅
 *
 *   🛡️ Verified by Serapod2U
 *   Total Cases : 100
 *   Total Box : 1
 *   14 August 2026 · 10:00 AM
 *
 * The entry text is the distributor's own wording (minus their status marks),
 * not the resolved master-data flavour, so the person reading the reply
 * recognises their own list — only its casing is normalised to Title Case. The
 * variant Product Code in brackets comes from master data and states which
 * variant the entry actually resolved to, so both sides agree on the item. The
 * ✅/❌ is the system's own verdict: a line is ✅ only when it resolved to a
 * variant with enough available stock to fulfil the quantity.
 *
 * Pure and framework-free — the stamp's clock is injected — so the exact output
 * can be unit tested.
 */

import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'

export const AVAILABLE_MARK = '✅'
export const UNAVAILABLE_MARK = '❌'

/** Heading used for entries that never resolved to a product. */
export const UNMATCHED_HEADING = 'Unmatched'

/** Quantities in this reply are cases, stated once per product heading. */
export const UNIT_SUFFIX = '(Cases)'

export const VERIFIED_STAMP = '🛡️ Verified by Serapod2U'

/** Shipping carton capacity: 100 cases fill one box (a part box is still a box). */
export const CASES_PER_BOX = 100

export const boxesForCases = (cases: number) => Math.ceil(cases / CASES_PER_BOX)

export interface ReplyTotals {
  cases: number
  boxes: number
}

/**
 * "14 August 2026 · 10:00 AM", stamped in Malaysian business time regardless of
 * where the operator's machine is set, so the reply reads as one clock to the
 * distributor receiving it.
 */
const STAMP_TIME_ZONE = 'Asia/Kuala_Lumpur'

export function verificationStamp(now: Date, totals?: ReplyTotals): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: STAMP_TIME_ZONE,
  }).format(now)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: STAMP_TIME_ZONE,
  }).format(now)
  const totalLines = totals
    ? [`Total Cases : ${totals.cases.toLocaleString('en-US')}`, `Total Box : ${totals.boxes.toLocaleString('en-US')}`]
    : []
  return [VERIFIED_STAMP, ...totalLines, `${date} · ${time}`].join('\n')
}

interface ResultTextVariant {
  id: string
  product_name: string
  variant_product_code?: string | null
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

/**
 * Title Case for the distributor's own entry text: unlike
 * {@link titleCaseHeading} this also lowers the rest of the word, so a list
 * shouted in caps ("GRAPE PUDINA") comes back as "Grape Pudina" instead of
 * being echoed verbatim. Product headings keep their master-data casing.
 */
export function titleCaseEntry(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(word => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ')
}

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')

/**
 * Distributors increasingly paste the code themselves ("Strawberry Vanilla (sv)
 * 249"), and the reply appends the master-data code — so the entry's own copy of
 * it is dropped first, leaving one canonical "(SV)" instead of "(sv) (SV)".
 * Only a bracketed token equal to the resolved code is removed; any other
 * bracketed note the sender wrote is left alone.
 */
export function withCanonicalCode(entryText: string, productCode: string | null): string {
  if (!productCode) return entryText
  const token = new RegExp(`\\s*[([]\\s*${escapeForRegExp(productCode)}\\s*[)\\]]`, 'gi')
  return `${entryText.replace(token, '')} (${productCode})`.replace(/\s+/g, ' ').trim()
}

export interface PasteResultTextLine {
  /** Entry text as pasted, used verbatim in the reply. */
  name: string
  quantity: number | null
  available: boolean
  productName: string | null
  /** Variant Product Code of the resolved variant, null when unresolved. */
  productCode: string | null
}

export function buildPasteResultLines(
  results: PasteMatchResult[],
  variants: ResultTextVariant[],
  isAvailable: (result: PasteMatchResult) => boolean,
): PasteResultTextLine[] {
  const variantsById = new Map(variants.map(variant => [variant.id, variant]))
  return results.map(result => {
    const variant = result.selectedVariantId ? variantsById.get(result.selectedVariantId) : undefined
    const code = (variant?.variant_product_code || '').trim()
    return {
      name: result.name,
      quantity: result.quantity,
      available: isAvailable(result),
      productName: variant?.product_name ?? null,
      productCode: code || null,
    }
  })
}

/**
 * Groups the reviewed lines by product in first-appearance order and renders
 * the reply text, closing with the verification stamp. Returns an empty string
 * when there is nothing to report — an unstamped empty reply rather than a
 * stamp vouching for nothing.
 */
export function buildPasteResultText(
  results: PasteMatchResult[],
  variants: ResultTextVariant[],
  isAvailable: (result: PasteMatchResult) => boolean,
  now: Date = new Date(),
): string {
  const lines = buildPasteResultLines(results, variants, isAvailable)
  if (lines.length === 0) return ''

  const groups = new Map<string, string[]>()
  for (const line of lines) {
    const heading = line.productName ? titleCaseHeading(line.productName) : UNMATCHED_HEADING
    const quantity = line.quantity ?? ''
    const mark = line.available ? AVAILABLE_MARK : UNAVAILABLE_MARK
    // "Mango Blackcurrant (MB) 171 ✅"; unresolved entries carry no code.
    const label = withCanonicalCode(titleCaseEntry(line.name), line.productCode)
    if (!groups.has(heading)) groups.set(heading, [])
    groups.get(heading)!.push(`${label} ${quantity} ${mark}`.replace(/\s+/g, ' ').trim())
  }

  // Cartons the distributor will actually receive, so lines the warehouse
  // cannot fill (❌) are excluded from both totals.
  const cases = lines.reduce((sum, line) => sum + (line.available ? line.quantity ?? 0 : 0), 0)
  const totals: ReplyTotals = { cases, boxes: boxesForCases(cases) }

  // Unmatched entries always trail the real products.
  const headings = [...groups.keys()].filter(heading => heading !== UNMATCHED_HEADING)
  if (groups.has(UNMATCHED_HEADING)) headings.push(UNMATCHED_HEADING)

  const body = headings
    .map(heading => [`${heading} ${UNIT_SUFFIX}`, '', ...groups.get(heading)!].join('\n'))
    .join('\n\n')

  return `${body}\n\n${verificationStamp(now, totals)}`
}
