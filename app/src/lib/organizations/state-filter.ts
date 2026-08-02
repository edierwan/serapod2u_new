/**
 * Pure helpers for the Organizations "State" filter.
 *
 * State options are derived from the organizations already loaded into the
 * view (each org carries `states.state_name` from the Supabase join), so the
 * dropdown always reflects the states actually present in the records instead
 * of a hardcoded list. Organizations with a blank/null state are grouped under
 * a dedicated "No state" option.
 */

/** Sentinel value meaning "no state restriction". */
export const ALL_STATES_VALUE = 'all'

/** Sentinel value matching organizations that have a blank/null state. */
export const NO_STATE_VALUE = '__no_state__'

/** Label shown for the {@link NO_STATE_VALUE} option. */
export const NO_STATE_LABEL = 'No state'

/** Minimal shape needed to derive/match a state; a subset of Organization. */
export interface StateFilterableOrganization {
  states?: { state_name?: string | null } | null
}

export interface StateFilterOption {
  value: string
  label: string
}

/** Normalizes a raw state name into a trimmed string (empty when missing). */
function normalizeStateName(org: StateFilterableOrganization): string {
  return (org.states?.state_name ?? '').trim()
}

/**
 * Builds the ordered list of state filter options from the loaded orgs.
 * - "All States" is always first.
 * - Concrete states are unique and alphabetically sorted.
 * - "No state" is appended only when some org actually lacks a state.
 */
export function deriveStateOptions(
  organizations: StateFilterableOrganization[]
): StateFilterOption[] {
  const names = new Set<string>()
  let hasBlank = false

  for (const org of organizations) {
    const name = normalizeStateName(org)
    if (name) {
      names.add(name)
    } else {
      hasBlank = true
    }
  }

  const options: StateFilterOption[] = [{ value: ALL_STATES_VALUE, label: 'All States' }]

  for (const name of Array.from(names).sort((a, b) => a.localeCompare(b))) {
    options.push({ value: name, label: name })
  }

  if (hasBlank) {
    options.push({ value: NO_STATE_VALUE, label: NO_STATE_LABEL })
  }

  return options
}

/** Returns true when an org passes the current state filter selection. */
export function matchesStateFilter(
  org: StateFilterableOrganization,
  filterState: string
): boolean {
  if (filterState === ALL_STATES_VALUE) return true

  const name = normalizeStateName(org)
  if (filterState === NO_STATE_VALUE) return name === ''

  return name === filterState
}
