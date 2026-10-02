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
 * Category leads the other fields. After it changes, these chosen fields are no longer
 * used with the new category by any product and should be cleared. A category without
 * products keeps every choice, since its lists fall back to the full lists.
 */
export function fieldsToClearForCategory(
  links: ProductLink[],
  categoryId: string,
  selection: LinkSelection,
  fields: LinkField[] = ['brand_id', 'manufacturer_id'],
): LinkField[] {
  if (!categoryId) return []
  return fields.filter((field) => {
    const chosen = selection[field]
    if (!chosen) return false
    const linked = linkedValues(links, { category_id: categoryId }, field)
    return Boolean(linked && linked.size > 0 && !linked.has(chosen))
  })
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
