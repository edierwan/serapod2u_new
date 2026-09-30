/**
 * Brand + category + group + subgroup + manufacturer identify a main-catalogue product, and its
 * differences live in variants. Outdoor store products share all five (chairs, tables and tents
 * from one supplier), so only their unique product name tells them apart.
 */
export function needsUniqueCombination(product: { outdoor_store?: boolean | null }) {
  return !product.outdoor_store
}
