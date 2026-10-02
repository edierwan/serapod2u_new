export const LINK_FIELDS = ['brand_id', 'category_id', 'manufacturer_id', 'group_id', 'subgroup_id'] as const

export type LinkField = (typeof LINK_FIELDS)[number]
export type ProductLink = Partial<Record<LinkField, string | null>>
export type LinkSelection = Partial<Record<LinkField, string>>

/** Brand/category/manufacturer/group/subgroup of every product; [] when it cannot be read. */
export async function loadProductLinks(supabase: any): Promise<ProductLink[]> {
  const pageSize = 1000
  const links: ProductLink[] = []
  try {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('products')
        .select('brand_id, category_id, manufacturer_id, group_id, subgroup_id')
        .order('id')
        .range(from, from + pageSize - 1)
      if (error) throw error
      links.push(...(data || []))
      if (!data || data.length < pageSize) break
    }
    return links
  } catch (error) {
    // Without links every dropdown simply shows its full list.
    console.error('Error fetching product links:', error)
    return []
  }
}

/**
 * Values of `field` that existing products pair with every other selected field.
 * Returns null when nothing else is selected, i.e. the field is not narrowed.
 */
export function linkedValues(links: ProductLink[], selection: LinkSelection, field: LinkField): Set<string> | null {
  const others = LINK_FIELDS.filter((other) => other !== field && selection[other])
  if (others.length === 0) return null
  const values = new Set<string>()
  for (const link of links) {
    const value = link[field]
    if (value && others.every((other) => link[other] === selection[other])) values.add(value)
  }
  return values
}

/**
 * Category leads, then brand, then manufacturer. Each list is narrowed only by the fields
 * above it, so any field can be reopened and changed without the lower ones locking it.
 */
export const LINK_CHAIN: LinkField[] = ['category_id', 'brand_id', 'manufacturer_id']

function upstreamSelection(field: LinkField, selection: LinkSelection, chain: LinkField[]): LinkSelection {
  const upstream: LinkSelection = {}
  for (const above of chain.slice(0, Math.max(chain.indexOf(field), 0))) {
    if (selection[above]) upstream[above] = selection[above]
  }
  return upstream
}

/** Values of `field` that existing products pair with the fields above it in the chain. */
export function chainedValues(
  links: ProductLink[],
  selection: LinkSelection,
  field: LinkField,
  chain: LinkField[] = LINK_CHAIN,
): Set<string> | null {
  return linkedValues(links, upstreamSelection(field, selection, chain), field)
}

/**
 * After `changed` is set, the fields below it whose current choice no product pairs with
 * the fields above them any more. Choices are kept when nothing is linked, since those
 * lists fall back to the full lists.
 */
export function fieldsToClearBelow(
  links: ProductLink[],
  selection: LinkSelection,
  changed: LinkField,
  chain: LinkField[] = LINK_CHAIN,
): LinkField[] {
  const start = chain.indexOf(changed)
  if (start < 0) return []
  const working: LinkSelection = { ...selection }
  const cleared: LinkField[] = []
  for (const field of chain.slice(start + 1)) {
    const chosen = working[field]
    if (!chosen) continue
    const linked = chainedValues(links, working, field, chain)
    if (linked && linked.size > 0 && !linked.has(chosen)) {
      delete working[field]
      cleared.push(field)
    }
  }
  return cleared
}

/**
 * Narrows a dropdown to the linked options. The current choice always stays listed so
 * it is never dropped silently, and when existing products link nothing the full list
 * is kept so a new combination can still be entered.
 */
export function narrowOptions<T extends { id: string }>(
  options: T[],
  allowed: Set<string> | null,
  selectedId?: string,
): { options: T[]; narrowed: boolean } {
  if (!allowed || !options.some((option) => allowed.has(option.id))) return { options, narrowed: false }
  const linked = options.filter((option) => allowed.has(option.id) || option.id === selectedId)
  return { options: linked, narrowed: linked.length < options.length }
}
