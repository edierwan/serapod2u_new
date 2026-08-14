/**
 * Display-only spelling repair for product group tabs.
 *
 * Master data spells the cartridge group "Catridge" (product_groups.group_name).
 * That value is a real key: it is stored on every product, echoed by the Quick
 * Order catalog resolver, and compared against elsewhere — so it is corrected
 * for the reader only, never rewritten in the database or in filter state.
 *
 * Matching is case-insensitive and whitespace-tolerant; anything not listed is
 * returned untouched, so a newly added group needs no code change.
 */

const CORRECTED_GROUP_NAMES: Record<string, string> = {
  catridge: 'Cartridge',
}

export function groupDisplayName(groupName: string): string {
  const key = groupName.trim().toLowerCase()
  return CORRECTED_GROUP_NAMES[key] || groupName
}
