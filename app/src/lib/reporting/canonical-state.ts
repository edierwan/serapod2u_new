/**
 * Canonical Negeri (Malaysia state) identity for reporting.
 *
 * The `states` table can hold more than one row for the same real state — the
 * staging/production data currently has two "Selangor" rows with different
 * `region_id` values, and organizations are split across both. Reporting keyed
 * on the raw `states.id` therefore produced two "Selangor" dropdown entries,
 * each showing only half of the state's shops and scans.
 *
 * Everything in the Shop-by-Negeri report is keyed on a canonical state key
 * instead, so duplicate rows are *combined* rather than hidden. The canonical
 * key reuses the Malaysia state normalization the map and the state flags
 * already rely on (`getStateFromCapturedLocation`), which is alias tolerant
 * ("Penang" / "Pulau Pinang") as well as case and spacing tolerant.
 *
 * No database row is modified: this is purely a read-side grouping.
 */

import { getStateFromCapturedLocation } from '@/lib/roadtour/visit-region'

export interface CanonicalStateRowInput {
  id: string
  state_name: string
  region_id: string | null
}

export interface CanonicalState {
  /** Stable canonical identity, also used as the Malaysia map key. */
  key: string
  /** Label shown in the UI — taken from the database rows, not invented. */
  name: string
  /** Every underlying `states.id` that resolves to this canonical state. */
  stateIds: string[]
  /** Every non-null `region_id` seen across the underlying rows. */
  regionIds: string[]
}

/**
 * Canonical key for a state name. Known Malaysian states collapse onto their
 * normalized label; anything unknown falls back to a trimmed, whitespace
 * collapsed, lower-cased form so casing and padding still group together.
 */
export function canonicalStateKey(name: string | null | undefined): string {
  const known = getStateFromCapturedLocation(name)
  if (known) return known
  const trimmed = (typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ')
  return trimmed.toLowerCase()
}

/**
 * Group raw `states` rows into one entry per logical Negeri.
 * Order follows the incoming rows, so a caller that queried
 * `.order('state_name')` keeps an alphabetical dropdown.
 */
export function buildCanonicalStates(rows: CanonicalStateRowInput[]): CanonicalState[] {
  const byKey = new Map<string, CanonicalState>()

  for (const row of rows || []) {
    const key = canonicalStateKey(row?.state_name)
    if (!key) continue

    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        key,
        name: (row.state_name || '').trim() || key,
        stateIds: [],
        regionIds: [],
      }
      byKey.set(key, entry)
    }
    if (row.id && !entry.stateIds.includes(row.id)) entry.stateIds.push(row.id)
    if (row.region_id && !entry.regionIds.includes(row.region_id)) entry.regionIds.push(row.region_id)
  }

  return [...byKey.values()]
}

/** canonical key -> canonical state */
export function canonicalStateIndex(rows: CanonicalStateRowInput[]): Map<string, CanonicalState> {
  return new Map(buildCanonicalStates(rows).map((state) => [state.key, state]))
}

/** raw `states.id` -> canonical key */
export function canonicalKeyByStateId(rows: CanonicalStateRowInput[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const state of buildCanonicalStates(rows)) {
    for (const id of state.stateIds) map.set(id, state.key)
  }
  return map
}

/**
 * Resolve whatever the caller passed as the "negeri" filter to a canonical key.
 * Accepts a canonical key, a raw `states.id` (older saved links / bookmarks) or
 * a plain state name. Returns null for "all"/empty.
 */
export function resolveCanonicalStateSelection(
  selection: string | null | undefined,
  rows: CanonicalStateRowInput[],
): string | null {
  const value = (selection || '').trim()
  if (!value || value === 'all') return null

  const byId = canonicalKeyByStateId(rows)
  const fromId = byId.get(value)
  if (fromId) return fromId

  const key = canonicalStateKey(value)
  return key || null
}

/** True when a canonical state has any underlying row in the given region. */
export function canonicalStateInRegion(state: CanonicalState, regionId: string): boolean {
  return state.regionIds.includes(regionId)
}
