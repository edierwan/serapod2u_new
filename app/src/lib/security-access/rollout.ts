/**
 * Security & Access → Overview read model. Presentation only: groups the
 * current authorization modes by the existing permission groups
 * (labels.ts) and summarises recorded access differences. Nothing here
 * participates in an authorization decision.
 */
import { PERMISSION_GROUP_ORDER, permissionLabel } from './labels'

/** Overview wording for each migration mode (enum values unchanged). */
export const ROLLOUT_MODES: Record<string, { label: string; help: string; dot: string; text: string }> = {
  NEW_ENFORCED: {
    label: 'New Access Active',
    help: 'The new authorization model determines decisions.',
    dot: 'bg-emerald-500', text: 'text-emerald-700',
  },
  SHADOW: {
    label: 'Monitoring',
    help: 'Legacy access still determines decisions; the new model is evaluated for comparison.',
    dot: 'bg-blue-500', text: 'text-blue-700',
  },
  LEGACY_RETIRED: {
    label: 'Legacy Retired',
    help: 'The corresponding legacy authorization checks have been retired.',
    dot: 'bg-purple-500', text: 'text-purple-700',
  },
  LEGACY_ENFORCED: {
    label: 'Legacy Active',
    help: 'Legacy access determines decisions; the new model is not used for the outcome.',
    dot: 'bg-gray-400', text: 'text-gray-700',
  },
}

/** Column order: the three rollout columns first, then any other mode present. */
export const PRIMARY_ROLLOUT_MODES = ['NEW_ENFORCED', 'SHADOW', 'LEGACY_RETIRED'] as const

export function rolloutMode(mode: string) {
  return ROLLOUT_MODES[mode] ?? { label: mode, help: 'Unrecognised mode.', dot: 'bg-gray-400', text: 'text-gray-700' }
}

export interface ModeRow {
  permission_key: string
  mode: string
  enforcementReady?: boolean
}

export interface RolloutPermission {
  key: string
  label: string
  mode: string
  enforcementReady: boolean
}

export interface RolloutModule {
  name: string
  permissions: RolloutPermission[]
  counts: Record<string, number>
  total: number
}

export interface Rollout {
  modules: RolloutModule[]
  /** Every mode present, primary rollout modes first (never drops a mode). */
  columns: string[]
  totals: Record<string, number>
  total: number
}

export function aggregateRollout(modes: ModeRow[]): Rollout {
  const byGroup = new Map<string, RolloutPermission[]>()
  for (const m of modes) {
    const { label, group } = permissionLabel(m.permission_key)
    const list = byGroup.get(group) ?? []
    list.push({ key: m.permission_key, label, mode: m.mode, enforcementReady: Boolean(m.enforcementReady) })
    byGroup.set(group, list)
  }
  const rank = (group: string) => {
    const i = PERMISSION_GROUP_ORDER.indexOf(group)
    return i < 0 ? PERMISSION_GROUP_ORDER.length : i
  }
  const totals: Record<string, number> = {}
  const modules = Array.from(byGroup.entries())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, permissions]) => {
      const counts: Record<string, number> = {}
      for (const p of permissions) {
        counts[p.mode] = (counts[p.mode] ?? 0) + 1
        totals[p.mode] = (totals[p.mode] ?? 0) + 1
      }
      permissions.sort((a, b) => a.label.localeCompare(b.label))
      return { name, permissions, counts, total: permissions.length }
    })
  const extra = Object.keys(totals).filter(m => !(PRIMARY_ROLLOUT_MODES as readonly string[]).includes(m)).sort()
  return { modules, columns: [...PRIMARY_ROLLOUT_MODES, ...extra], totals, total: modes.length }
}

/** Case-insensitive match on module name, permission name or technical key. */
export function filterModules(modules: RolloutModule[], query: string): RolloutModule[] {
  const q = query.trim().toLowerCase()
  if (!q) return modules
  return modules.filter(m => m.name.toLowerCase().includes(q)
    || m.permissions.some(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)))
}

export interface DecisionRow {
  occurred_at: string
  permission_key: string
  comparison: string
}

export interface DifferenceSummary {
  /** Recorded legacy-vs-new differences (not MATCH_ALLOW / MATCH_DENY). */
  count: number
  /** Earliest and latest decision in the loaded sample. */
  from: string | null
  to: string | null
  /** The sample is the latest `sampleLimit` non-matching decisions (not a time window). */
  sampleSize: number
  capped: boolean
  /** Differences on permissions still in Monitoring / Legacy Active: review before enabling. */
  pending: number
  pendingPermissions: string[]
  /** Differences on permissions the new model already decides: historical. */
  historical: number
  byPermission: Record<string, number>
}

const isDifference = (comparison: string) => !['MATCH_ALLOW', 'MATCH_DENY'].includes(comparison)
const NOT_YET_ENFORCED = new Set(['SHADOW', 'LEGACY_ENFORCED'])

export function summarizeDifferences(decisions: DecisionRow[], modes: ModeRow[], sampleLimit: number): DifferenceSummary {
  const modeByKey = new Map(modes.map(m => [m.permission_key, m.mode]))
  const times = decisions.map(d => d.occurred_at).filter(Boolean).sort()
  const diffs = decisions.filter(d => isDifference(d.comparison))
  const byPermission: Record<string, number> = {}
  let pending = 0
  const pendingKeys = new Set<string>()
  for (const d of diffs) {
    byPermission[d.permission_key] = (byPermission[d.permission_key] ?? 0) + 1
    if (NOT_YET_ENFORCED.has(modeByKey.get(d.permission_key) ?? '')) {
      pending += 1
      pendingKeys.add(d.permission_key)
    }
  }
  return {
    count: diffs.length,
    from: times[0] ?? null,
    to: times[times.length - 1] ?? null,
    sampleSize: decisions.length,
    capped: decisions.length >= sampleLimit,
    pending,
    pendingPermissions: Array.from(pendingKeys).sort(),
    historical: diffs.length - pending,
    byPermission,
  }
}
