/**
 * Sales Order line presentation — description text and display grouping.
 *
 * Supply Chain > Order Management > Sales Order (the detail/display page and
 * the SO PDF generated from it) used to print the parent Product Name followed
 * by the WHOLE master-data Variant Name:
 *
 *   "Cellera Zero" + "Zero Edition Novella [ Almond Corn ]"
 *     -> "Cellera Zero Zero Edition Novella [ Almond Corn ]"
 *
 * The middle words are the marketing range/series wording master data carries
 * on every variant ("Zero Edition Novella", "Fruity Cellera Cartridge",
 * "Deluxe Cellera Cartridge"). On an order line they restate the Product and
 * push the only part that identifies the line — the flavour — off to the right.
 * The SO line therefore reads:
 *
 *   "Cellera Zero - [ Almond Corn ]"
 *   "Cellera Hero - [ Honeydew ]"
 *
 * Everything here is presentation-only and pure. `products.product_name` and
 * `product_variants.variant_name` are never rewritten, and no quantity, price,
 * line total, product id or variant id is touched.
 *
 * Nothing is hard-coded per product: the flavour comes from the bracketed
 * segment master data already stores, and the family comes from the shared
 * classifier in `lib/returns/format`. A new flavour or a new range word needs
 * no code change here.
 *
 * `product_variants.alternative_name` is deliberately NOT consulted. It is the
 * distributor-facing marketing name (Almond Corn is sold as "Butterscotch
 * Coffee"); the SO must name the flavour that was actually ordered.
 */
import { classifyProductLine, getVariantDisplayName, type ProductLine } from '@/lib/returns/format'

/** The separator between the Product Name and the bracketed flavour. */
export const SO_DESCRIPTION_SEPARATOR = ' - '

/**
 * The flavour of a variant, re-bracketed for the SO line: "[ Almond Corn ]".
 *
 * The bracketed segment itself is read through the shared
 * `getVariantDisplayName`, which owns the "last non-empty [ … ] group, else the
 * whole name" rule. Only the brackets around the result are added here — the SO
 * line is the one surface that keeps them, because they visually separate the
 * flavour from the Product Name beside it.
 *
 * Returns null for a variant with no name, so the caller prints the Product
 * Name alone instead of an empty "[ ]".
 */
export function salesOrderVariantFlavour(variantName?: string | null): string | null {
  const flavour = getVariantDisplayName(variantName)
  return flavour ? `[ ${flavour} ]` : null
}

/**
 * The SO line description: "Cellera Zero - [ Almond Corn ]".
 *
 * Every part is optional master data, and each missing part removes itself
 * rather than printing a separator with nothing after it:
 *
 *   - no variant                  -> "Cellera Zero"
 *   - no Product Name             -> "[ Almond Corn ]"
 *   - flavour repeating the name  -> "Cellera Zero"   (never printed twice)
 *   - neither                     -> ""               (caller decides the fallback)
 *
 * A variant name master data stores without brackets keeps its own text inside
 * them ("Durian" -> "Cellera Hero - [ Durian ]"): there is no bracketed segment
 * to prefer, and dropping it would make two lines of the same Product read
 * identically.
 */
export function salesOrderLineDescription(
  productName?: string | null,
  variantName?: string | null,
): string {
  // Some master-data product names trail their own bracketed segment; it is the
  // variant's job to carry the flavour, so it is not repeated from the product.
  const product = (productName || '').replace(/\[[^[\]]*\]\s*$/, '').trim()
  const flavour = salesOrderVariantFlavour(variantName)

  if (!product) return flavour ?? ''
  if (!flavour) return product

  // "Cellera Hero" + "[ Cellera Hero ]" is one name, not two.
  const bare = flavour.slice(1, -1).trim().toLowerCase()
  if (bare === product.toLowerCase()) return product

  return `${product}${SO_DESCRIPTION_SEPARATOR}${flavour}`
}

/**
 * Display order of the product families on an SO: Hero first, then Zero, then
 * everything else. Devices (S.Box / S.Line) and unclassified products share the
 * last bucket and keep their own relative order inside it.
 */
const FAMILY_DISPLAY_ORDER: ProductLine[] = ['hero', 'zero']

/** Lower sorts first. Hero 0, Zero 1, any other family 2. */
export function salesOrderFamilyRank(productName?: string | null): number {
  const rank = FAMILY_DISPLAY_ORDER.indexOf(classifyProductLine(productName))
  return rank === -1 ? FAMILY_DISPLAY_ORDER.length : rank
}

/**
 * The SO line items in display order: all Hero rows, then all Zero rows, then
 * the rest.
 *
 * Presentation only. This never renumbers, reprices or re-persists anything —
 * the stored `order_items` sequence is untouched, and the totals are summed
 * from the same rows either way. A copy is returned so the caller's state array
 * is never mutated in place.
 *
 * The sort is stable (Array.prototype.sort is specified stable), so rows within
 * Hero keep the order they arrived in, and so do rows within Zero.
 */
export function sortSalesOrderLinesForDisplay<T>(
  items: readonly T[] | null | undefined,
  productNameOf: (item: T) => string | null | undefined,
): T[] {
  if (!items || items.length === 0) return []
  return [...items].sort((a, b) => salesOrderFamilyRank(productNameOf(a)) - salesOrderFamilyRank(productNameOf(b)))
}
