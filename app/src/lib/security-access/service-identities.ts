/**
 * Presentation model for Technical Access → Service identities: groups the
 * registered non-human identities by their module (sa_service_identities.
 * owner_team) and describes credential and lifecycle state as two separate
 * dimensions. Metadata only — no credential value ever reaches this module.
 */

export interface ServiceIdentity {
  id: string
  identity_key?: string
  name: string
  identity_kind: string
  owner_team?: string | null
  status: string
  credential_type?: string | null
  credential_reference?: string | null
  /** true/false = env var NAME present/absent on this server; null = nothing to check. */
  credential_configured?: boolean | null
  last_used_at?: string | null
  [key: string]: any
}

export const SERVICE_KINDS: Record<string, string> = {
  agent: 'Agent API', cron_worker: 'Scheduled Worker', queue_worker: 'Queue Worker',
  integration: 'Integration', webhook: 'Webhook', application_server: 'Application Server',
}

/** Known modules, in display order. Keys are the normalised owner_team. */
const KNOWN_MODULES: Array<{ id: string; name: string }> = [
  { id: 'supplychain', name: 'Supply Chain' },
  { id: 'customergrowth', name: 'Customer & Growth' },
  { id: 'ecommerce', name: 'E-Commerce' },
  { id: 'platform', name: 'Platform' },
  { id: 'security', name: 'Security' },
]
export const OTHER_MODULE = { id: 'other', name: 'Other' }

export const moduleKey = (team?: string | null) => (team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function serviceKindLabel(kind: string) {
  return SERVICE_KINDS[kind] ?? (kind ? kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unspecified')
}

export type CredentialState = 'configured' | 'missing' | 'not_applicable' | 'not_tracked'

export const CREDENTIAL_STATES: Record<CredentialState, { label: string; short: string; help: string; tone: string }> = {
  configured: { label: 'Configured here', short: 'configured here', help: 'The credential variable is set on this server. This does not prove the service is healthy.', tone: 'bg-emerald-50 text-emerald-700' },
  missing: { label: 'Not configured here', short: 'not configured here', help: 'The credential variable is not set on this server. It may be configured where the service actually runs.', tone: 'bg-amber-50 text-amber-800' },
  not_applicable: { label: 'No credential', short: 'no credential', help: 'This service does not use a credential.', tone: 'bg-gray-100 text-gray-600' },
  not_tracked: { label: 'Managed elsewhere', short: 'managed elsewhere', help: 'No credential variable is registered, so it cannot be checked from this server.', tone: 'bg-gray-100 text-gray-600' },
}

export function credentialState(s: ServiceIdentity): CredentialState {
  if (s.credential_type === 'none') return 'not_applicable'
  if (s.credential_configured === true) return 'configured'
  if (s.credential_configured === false) return 'missing'
  return 'not_tracked'
}

export const LIFECYCLE: Record<string, { label: string; dot: string }> = {
  active: { label: 'Active', dot: 'bg-emerald-500' },
  disabled: { label: 'Disabled', dot: 'bg-amber-500' },
  retired: { label: 'Retired', dot: 'bg-gray-400' },
}
export const lifecycleLabel = (status: string) => LIFECYCLE[status]?.label ?? (status ? status[0].toUpperCase() + status.slice(1) : 'Unknown')

export interface ServiceGroup {
  id: string
  name: string
  services: ServiceIdentity[]
  credentials: Partial<Record<CredentialState, number>>
  lifecycle: Record<string, number>
}

/**
 * Groups by module. Known modules keep their order; any other named module
 * follows alphabetically; services with no module go to "Other". Empty
 * groups are never returned.
 */
export function groupServices(services: ServiceIdentity[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>()
  for (const s of services) {
    const key = moduleKey(s.owner_team)
    const known = KNOWN_MODULES.find(m => m.id === key)
    const meta = known ?? (key ? { id: key, name: String(s.owner_team).trim() } : OTHER_MODULE)
    let g = groups.get(meta.id)
    if (!g) { g = { id: meta.id, name: meta.name, services: [], credentials: {}, lifecycle: {} }; groups.set(meta.id, g) }
    g.services.push(s)
    const c = credentialState(s)
    g.credentials[c] = (g.credentials[c] ?? 0) + 1
    g.lifecycle[s.status] = (g.lifecycle[s.status] ?? 0) + 1
  }
  const rank = (id: string) => {
    const i = KNOWN_MODULES.findIndex(m => m.id === id)
    return i >= 0 ? i : id === OTHER_MODULE.id ? KNOWN_MODULES.length + 1 : KNOWN_MODULES.length
  }
  return Array.from(groups.values())
    .map(g => ({ ...g, services: [...g.services].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}

export interface ServiceFilter { query: string; kind: string; credential: 'all' | 'missing' }

/** Search matches service name, module and service type. */
export function filterServices(services: ServiceIdentity[], f: ServiceFilter) {
  const q = f.query.trim().toLowerCase()
  return services.filter(s =>
    (f.credential === 'all' || credentialState(s) === 'missing')
    && (f.kind === 'all' || s.identity_kind === f.kind)
    && (!q || `${s.name} ${s.owner_team ?? ''} ${serviceKindLabel(s.identity_kind)}`.toLowerCase().includes(q)))
}
