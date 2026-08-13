/**
 * Short product labels for the Quick Order grid.
 *
 * Master-data product names repeat the house/brand words on every row —
 * "Cellera Hero" / "Cellera Zero" in the Cartridge tab, "Serapod Device S.Line"
 * / "Serapod Device S.Box" in the Device tab. Inside one group that shared
 * prefix carries no information: what an operator actually reads is "Hero",
 * "Zero", "S.Line", "S.Box".
 *
 * The prefix is derived from the catalog rather than hard-coded, so a new
 * product line needs no code change: within each group, the longest run of
 * leading words shared by EVERY product in that group is dropped.
 *
 * Deliberate guards:
 *  - a group holding a single product keeps its full name (its "shared prefix"
 *    would be the whole name);
 *  - a prefix that would empty a name is not applied to any product in the
 *    group, so nothing ever renders blank.
 *
 * Consequence worth knowing: because the prefix must be shared by every product
 * in the group, adding one oddly-named product to a group (say "Hero Special"
 * under Cartridge) makes the shared prefix empty and every row in that group
 * falls back to its full name. That is a visible, safe degradation rather than
 * a wrong label.
 *
 * Display-only and pure — the underlying product_name is never modified.
 */

interface ShortNameInput {
  product_name: string
  group_name?: string
}

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean)

/** Longest run of leading words shared by every name in the list. */
function sharedLeadingWords(names: string[]): string[] {
  if (names.length < 2) return []

  const [first, ...rest] = names.map(words)
  const shared: string[] = []
  for (let index = 0; index < first.length; index += 1) {
    const word = first[index]
    // Case-insensitive so "SERAPOD Tumbler" and "Serapod Mat" still agree.
    if (!rest.every(name => name[index]?.toLowerCase() === word.toLowerCase())) break
    shared.push(word)
  }
  return shared
}

/**
 * Maps each product name to the label the Quick Order grid should show.
 * Products with no shared group prefix map to themselves, so callers can look
 * up unconditionally.
 */
export function resolveProductShortNames(rows: ShortNameInput[]): Map<string, string> {
  const namesByGroup = new Map<string, Set<string>>()
  for (const row of rows) {
    const group = row.group_name || 'Other'
    if (!row.product_name) continue
    if (!namesByGroup.has(group)) namesByGroup.set(group, new Set())
    namesByGroup.get(group)!.add(row.product_name)
  }

  const shortNames = new Map<string, string>()
  for (const names of namesByGroup.values()) {
    const list = [...names]
    const prefix = sharedLeadingWords(list)
    const shortened = list.map(name => words(name).slice(prefix.length).join(' '))
    // Never let the prefix consume a whole name — fall back for the group.
    const usable = prefix.length > 0 && shortened.every(Boolean)
    list.forEach((name, index) => shortNames.set(name, usable ? shortened[index] : name))
  }
  return shortNames
}
