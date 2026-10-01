/**
 * Presentation model for Technical Access → Service identities: groups the
 * registered non-human identities by their module (sa_service_identities.
 * owner_team) and describes credential and lifecycle state as two separate
 * dimensions. Metadata only — no credential value ever reaches this module.
 */
import { classifyServiceTeam, groupByModule, moduleGroupName } from './modules'

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

/** Module grouping comes from the shared S&A taxonomy (modules.ts). */
export const moduleOfService = (s: { owner_team?: string | null }) => classifyServiceTeam(s.owner_team)

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
 * Groups by the shared module taxonomy (owner_team → module group). Unknown
 * teams stay visible under Other / Unmapped. Empty groups are never returned.
 */
export function groupServices(services: ServiceIdentity[]): ServiceGroup[] {
  return groupByModule(services, s => moduleOfService(s).groupId).map(g => {
    const credentials: ServiceGroup['credentials'] = {}
    const lifecycle: Record<string, number> = {}
    for (const s of g.items) {
      const c = credentialState(s)
      credentials[c] = (credentials[c] ?? 0) + 1
      lifecycle[s.status] = (lifecycle[s.status] ?? 0) + 1
    }
    return { id: g.id, name: g.name, credentials, lifecycle, services: [...g.items].sort((a, b) => a.name.localeCompare(b.name)) }
  })
}

export interface ServiceFilter { query: string; kind: string; credential: 'all' | 'missing' }

/** Search matches service name, module and service type. */
export function filterServices(services: ServiceIdentity[], f: ServiceFilter) {
  const q = f.query.trim().toLowerCase()
  return services.filter(s =>
    (f.credential === 'all' || credentialState(s) === 'missing')
    && (f.kind === 'all' || s.identity_kind === f.kind)
    && (!q || `${s.name} ${s.owner_team ?? ''} ${moduleGroupName(moduleOfService(s).groupId)} ${serviceKindLabel(s.identity_kind)}`.toLowerCase().includes(q)))
}
