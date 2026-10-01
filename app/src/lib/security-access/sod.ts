/**
 * Presentation model for Governance → Segregation of Duties. Rules are grouped
 * by the module of the step they protect (right_key: the approval / release
 * side), using the same module hierarchy as the Overview. Read-only.
 */
import { OTHER_GROUP, ROLLOUT_HIERARCHY, classifyPermission } from './rollout'

export interface SodRule {
  id: string
  rule_key?: string
  name: string
  description?: string | null
  rule_kind: string
  left_key: string
  right_key: string
  document_type?: string | null
  enforcement: string
  status: string
  effective_from?: string | null
  effective_until?: string | null
}
export interface SodViolation { id: string; rule_id: string; user_id: string; document_type?: string | null; detected_at: string; outcome: string }
export interface SodMitigation { id: string; rule_id: string; status: string }

export const RULE_KINDS: Record<string, { label: string; help: string }> = {
  same_document: { label: 'Same document', help: 'One person may not do both steps on the same document.' },
  permission_conflict: { label: 'Holding both', help: 'One person should not hold both permissions at all.' },
  role_conflict: { label: 'Role conflict', help: 'One person should not hold both roles.' },
}
export const ruleKindLabel = (kind: string) => RULE_KINDS[kind]?.label ?? kind.replace(/_/g, ' ')

export const ENFORCEMENT: Record<string, { label: string; tone: string; help: string }> = {
  enforce: { label: 'Blocks', tone: 'bg-red-50 text-red-700', help: 'The conflicting step is refused.' },
  monitor: { label: 'Monitors', tone: 'bg-amber-50 text-amber-800', help: 'The step is allowed and the conflict is recorded for review.' },
}
export const enforcementOf = (value: string) => ENFORCEMENT[value] ?? { label: value, tone: 'bg-gray-100 text-gray-600', help: '' }

export const OUTCOMES: Record<string, { label: string; tone: string }> = {
  blocked: { label: 'Blocked', tone: 'bg-red-50 text-red-700' },
  allowed_monitor: { label: 'Allowed · recorded', tone: 'bg-amber-50 text-amber-800' },
  allowed_mitigated: { label: 'Allowed · approved exception', tone: 'bg-blue-50 text-blue-700' },
}
export const outcomeOf = (value: string) => OUTCOMES[value] ?? { label: value.replace(/_/g, ' '), tone: 'bg-gray-100 text-gray-600' }

export const humanize = (value?: string | null) => (value ? value.replace(/_/g, ' ') : '')

export interface SodGroup {
  id: string
  name: string
  rules: SodRule[]
  enforced: number
  monitored: number
  conflicts: number
}

export function groupSodRules(rules: SodRule[], conflictsByRule: Map<string, number>): SodGroup[] {
  const order = [...ROLLOUT_HIERARCHY.map(g => ({ id: g.id, name: g.name })), OTHER_GROUP]
  const groups = new Map<string, SodGroup>()
  for (const r of rules) {
    const id = classifyPermission(r.right_key || '').groupId
    const meta = order.find(o => o.id === id) ?? OTHER_GROUP
    let g = groups.get(meta.id)
    if (!g) { g = { id: meta.id, name: meta.name, rules: [], enforced: 0, monitored: 0, conflicts: 0 }; groups.set(meta.id, g) }
    g.rules.push(r)
    if (r.enforcement === 'enforce') g.enforced++
    else if (r.enforcement === 'monitor') g.monitored++
    g.conflicts += conflictsByRule.get(r.id) ?? 0
  }
  return order.map(o => groups.get(o.id)).filter((g): g is SodGroup => !!g)
    .map(g => ({ ...g, rules: [...g.rules].sort((a, b) => a.name.localeCompare(b.name)) }))
}
