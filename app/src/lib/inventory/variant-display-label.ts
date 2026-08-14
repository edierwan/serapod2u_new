/**
 * View Inventory variant identity line.
 *
 * Warehouse variant names carry the packaging prefix from master data
 * ("Fruity Cellera Cartridge [ Lychee Blackcurrant ]"). Rendered in full, that
 * prefix repeats the parent Product on every row and pushes the part operators
 * actually read — the flavour — off to the right. The inventory row therefore
 * shows the bracketed flavour plus the variant Product Code, with the
 * distributor-facing Alternative Name below it.
 *
 * Both the code and the alternative name are VARIANT-level master data
 * (product_variants.product_code / product_variants.alternative_name), the same
 * values the Product Management > Variants table shows. They are deliberately
 * not products.product_code, which is the parent product's code and identical
 * across every flavour.
 *
 * Pure and framework-free so the labelling can be unit tested directly.
 */

/** Trailing "[ … ]" segment of a master-data variant name. */
const BRACKETED_FLAVOUR = /\[([^[\]]*)\]\s*$/

export const NO_VARIANT_LABEL = '[ No variant ]'

/**
 * "Fruity Cellera Cartridge [ Lychee Blackcurrant ]" → "[ Lychee Blackcurrant ]".
 * Variant names without a bracketed flavour (e.g. "Durian") are bracketed as-is
 * so every inventory row reads the same way.
 */
export function variantFlavourLabel(variantName?: string | null): string {
  const name = (variantName || '').trim()
  if (!name) return NO_VARIANT_LABEL

  const match = name.match(BRACKETED_FLAVOUR)
  const flavour = (match ? match[1] : name).trim()
  return flavour ? `[ ${flavour} ]` : NO_VARIANT_LABEL
}

/**
 * The same flavour without the brackets: "Lychee Blackcurrant". Used where the
 * flavour is already the row's leading, bolded identity (the Quick Order
 * catalog), so the brackets add noise instead of separation. Missing variant
 * names still read "No variant" rather than rendering blank.
 */
export function variantFlavourName(variantName?: string | null): string {
  return variantFlavourLabel(variantName).replace(/^\[\s*|\s*\]$/g, '')
}

/**
 * Flavour plus the master-data variant Product Code:
 * "[ Lychee Blackcurrant ] - LB". Variants with no Product Code show the
 * flavour alone rather than a dangling separator.
 */
export function variantIdentityLabel(
  variantName?: string | null,
  variantProductCode?: string | null,
): string {
  const flavour = variantFlavourLabel(variantName)
  const code = (variantProductCode || '').trim()
  return code ? `${flavour} - ${code}` : flavour
}

/**
 * "Alternative: Banana Milk", matching the Product Management > Variants table.
 * Returns null when master data carries no alternative name, so the line is
 * omitted entirely instead of rendering an empty label.
 */
export function variantAlternativeLabel(alternativeName?: string | null): string | null {
  const alternative = (alternativeName || '').trim()
  return alternative ? `Alternative: ${alternative}` : null
}
