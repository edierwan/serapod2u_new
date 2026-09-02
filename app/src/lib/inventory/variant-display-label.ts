/**
 * View Inventory variant identity line.
 *
 * Warehouse variant names carry the packaging prefix from master data
 * ("Fruity Cellera Cartridge [ Lychee Blackcurrant ]"). Rendered in full, that
 * prefix repeats the parent Product on every row and pushes the part operators
 * actually read — the flavour — off to the right. The inventory row therefore
 * shows the flavour plus the variant Product Code, with the distributor-facing
 * Alternative Name below it.
 *
 * The agreed identity structure is
 * "{Product Name} / {Variant or Flavour Name} – {Product Code}". Screens that
 * already print the Product separately render only the variant half of it; see
 * `variantIdentityLabel` vs `productVariantIdentityLabel`.
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

export const NO_VARIANT_LABEL = 'No variant'

/**
 * The separator that precedes a variant Product Code everywhere it is shown:
 * an en dash, matching the agreed
 * "{Product Name} / {Variant} – {Product Code}" identity structure.
 */
export const CODE_SEPARATOR = ' – '

/** The separator between a Product and its variant in a combined identity. */
export const PRODUCT_SEPARATOR = ' / '

/**
 * "Fruity Cellera Cartridge [ Lychee Blackcurrant ]" → "Lychee Blackcurrant".
 *
 * The flavour is returned as plain text. Master data brackets the flavour
 * inside the variant name; that bracketing is a storage artefact, not the
 * presentation, so it is stripped here and never re-added.
 */
export function variantFlavourLabel(variantName?: string | null): string {
  const name = (variantName || '').trim()
  if (!name) return NO_VARIANT_LABEL

  const match = name.match(BRACKETED_FLAVOUR)
  const flavour = (match ? match[1] : name).trim()
  return flavour || NO_VARIANT_LABEL
}

/**
 * The flavour as plain text - identical to `variantFlavourLabel` now that the
 * bracket presentation is gone. Kept as its own name because the Quick Order
 * catalog reads for "the flavour name", not "the flavour label".
 */
export function variantFlavourName(variantName?: string | null): string {
  return variantFlavourLabel(variantName)
}

/**
 * Flavour plus the master-data variant Product Code:
 * "Lychee Blackcurrant – LB". Variants with no Product Code show the flavour
 * alone rather than a dangling separator.
 *
 * This is the VARIANT half of the identity only. Every screen using it already
 * prints the Product on its own line or in its own column directly above or
 * beside it, so repeating the Product here would duplicate it. Where a single
 * combined string is needed instead, use `productVariantIdentityLabel`.
 */
export function variantIdentityLabel(
  variantName?: string | null,
  variantProductCode?: string | null,
): string {
  const flavour = variantFlavourLabel(variantName)
  const code = (variantProductCode || '').trim()
  return code ? `${flavour}${CODE_SEPARATOR}${code}` : flavour
}

/**
 * The full agreed identity in one string:
 * "Cellera Hero / Strawberry Corn – SC".
 *
 * Product Name first, then the flavour, then the variant Product Code. Used
 * where a row renders ONE combined label rather than a separate Product line
 * (the Quick Order catalog's combined mode and the Create Order variant
 * picker). Every part is optional master data:
 *
 * - no Product Name  → "Strawberry Corn – SC"
 * - no variant       → "Cellera Hero – SC"
 * - no Product Code  → "Cellera Hero / Strawberry Corn"
 * - flavour that merely repeats the Product is not printed twice
 */
export function productVariantIdentityLabel(
  productName?: string | null,
  variantName?: string | null,
  variantProductCode?: string | null,
): string {
  const product = (productName || '').trim()
  const flavour = variantFlavourLabel(variantName)
  const hasFlavour = Boolean((variantName || '').trim())
  const code = (variantProductCode || '').trim()

  const duplicate = product && hasFlavour && product.toLowerCase() === flavour.toLowerCase()

  let identity: string
  if (!product) identity = hasFlavour ? flavour : NO_VARIANT_LABEL
  else if (!hasFlavour || duplicate) identity = product
  else identity = `${product}${PRODUCT_SEPARATOR}${flavour}`

  return code ? `${identity}${CODE_SEPARATOR}${code}` : identity
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

/**
 * Full variant name plus the master-data variant Product Code:
 * "Deluxe Cellera Cartridge [ Strawberry Corn ] – SC".
 *
 * The brackets here belong to `product_variants.variant_name` as master data
 * stores it; only the separator before the code is ours.
 *
 * Used by administration panels (Inventory Settings) that identify a variant by
 * its complete master-data name rather than by the bracketed flavour alone.
 * The code is `product_variants.product_code` — the Product Code column of
 * Product Management > Variants. There is deliberately NO fallback to
 * `product_variants.variant_code` or to the parent `products.product_code`: a
 * variant with no Product Code shows its name alone, never a dangling
 * separator and never a code that means something else.
 */
export function variantNameWithProductCode(
  variantName?: string | null,
  variantProductCode?: string | null,
): string {
  const name = (variantName || '').trim()
  const code = (variantProductCode || '').trim()
  if (!name) return code ? `${NO_VARIANT_LABEL}${CODE_SEPARATOR}${code}` : NO_VARIANT_LABEL
  return code ? `${name}${CODE_SEPARATOR}${code}` : name
}

/**
 * Packaging words that master data repeats on every cartridge variant name
 * ("Deluxe Cellera Cartridge [ Hazelnut ]"). They restate the parent Product,
 * so a picker that already prints the Product ahead of the variant gains
 * nothing from them.
 */
const CELLERA_PACKAGING = /\bCellera\s+Cartridges?\b/i

/**
 * "Deluxe Cellera Cartridge [ Hazelnut ]" → "Deluxe Hazelnut".
 *
 * The dropped words come from the pattern, never from a hard-coded list of
 * ranges, so "Fruity Cellera Cartridge [ Grape ]" shortens to "Fruity Grape"
 * without a code change. Names that carry no packaging phrase, and names the
 * phrase would consume entirely ("Cellera Cartridge"), keep their full master-
 * data text rather than rendering short-but-meaningless.
 *
 * The master-data brackets around the flavour are dropped with them: they are
 * storage punctuation, and the agreed identity structure carries no brackets.
 * The range word is deliberately kept - "Deluxe" and "Fruity" are what tell two
 * otherwise identical flavours apart.
 *
 * Display-only: `product_variants.variant_name` itself is never rewritten.
 */
export function variantShortName(variantName?: string | null): string {
  const name = (variantName || '').trim()
  if (!name) return NO_VARIANT_LABEL

  const short = name
    .replace(CELLERA_PACKAGING, ' ')
    .replace(BRACKETED_FLAVOUR, (_full, flavour: string) => flavour.trim())
    .replace(/\s+/g, ' ')
    .trim()
  return short || name
}

/**
 * Create Order's "Select Variant" option text, after the Product name and
 * before the price: "Deluxe [ Hazelnut ] – HA", or with the variant's
 * attribute text when master data carries one: "Deluxe [ Hazelnut ] (5%) – HA".
 *
 * The code is `product_variants.product_code` — the Product Code column of
 * Product Management > Variants — and there is deliberately no fallback to
 * `variant_code`, `manufacturer_sku` or the parent `products.product_code`.
 * A variant with no Product Code ends at the name, never at a dangling "-".
 */
export function variantSelectorLabel(
  variantName?: string | null,
  variantProductCode?: string | null,
  attributeText?: string | null,
): string {
  const short = variantShortName(variantName)
  const attribute = (attributeText || '').trim()
  const base = attribute ? `${short} (${attribute})` : short
  const code = (variantProductCode || '').trim()
  return code ? `${base}${CODE_SEPARATOR}${code}` : base
}

/**
 * The selected order-item card keeps the full master-data variant name and
 * joins the variant Product Code onto it:
 * "Deluxe Cellera Cartridge [ Hazelnut ] – HA".
 *
 * Same authoritative code as `variantSelectorLabel`, and the same rule for a
 * missing one: the name alone, never a trailing separator.
 */
export function variantNameWithProductCodeBullet(
  variantName?: string | null,
  variantProductCode?: string | null,
): string {
  const name = (variantName || '').trim() || NO_VARIANT_LABEL
  const code = (variantProductCode || '').trim()
  return code ? `${name}${CODE_SEPARATOR}${code}` : name
}
