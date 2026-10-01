'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ModuleFilterSelect, SearchInput, ShowMore, useLimit } from './ui'
import { classifyPermission } from '@/lib/security-access/modules'
import { comparisonLabel, modeLabel, permissionLabel, reasonLabel, resourceTypeLabel, type DirectoryOrganization } from '@/lib/security-access/labels'

interface DecisionLogProps {
  decisions: any[]
  actors: any[]
  people: any[]
  organizations: DirectoryOrganization[]
  /** Business roles, to name the roles that matched a decision. */
  roles?: any[]
  /** Starting filter (e.g. opened from Overview → Review differences). */
  initialFilter?: 'all' | 'differences'
}

const DIFFERENCE = (comparison: string) => !['MATCH_ALLOW', 'MATCH_DENY'].includes(comparison)

export default function DecisionLog({ decisions, actors, people, organizations, roles = [], initialFilter = 'all' }: DecisionLogProps) {
  const [filter, setFilter] = useState<'all' | 'differences'>(initialFilter)
  const [open, setOpen] = useState<string | null>(null)
  const [technical, setTechnical] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState('all')
  const page = useLimit(25)
  const orgById = useMemo(() => new Map(organizations.map(o => [o.id, o.org_name])), [organizations])
  const roleName = useMemo(() => {
    const byId = new Map<string, string>(); const byKey = new Map<string, string>()
    for (const r of roles) { if (r.id) byId.set(r.id, r.name); if (r.role_key) byKey.set(r.role_key, r.name) }
    return (a: any) => a.roleName ?? byId.get(a.roleId) ?? byKey.get(a.roleKey) ?? (a.roleKey ? String(a.roleKey).replace(/[-_]/g, ' ') : 'Unnamed role')
  }, [roles])
  const userById = useMemo(() => {
    const map = new Map<string, { name: string; role?: string }>()
    for (const p of people) map.set(p.id, { name: p.full_name || p.email, role: p.role_code })
    for (const a of actors) map.set(a.id, { name: a.full_name || a.email, role: a.role_code })
    return map
  }, [people, actors])
  const q = query.trim().toLowerCase()
  const rows = (filter === 'differences' ? decisions.filter(d => DIFFERENCE(d.comparison)) : decisions)
    .filter(d => moduleFilter === 'all' || classifyPermission(d.permission_key).groupId === moduleFilter)
    .filter(d => !q || `${permissionLabel(d.permission_key).label} ${d.permission_key} ${userById.get(d.actor_id)?.name ?? ''} ${comparisonLabel(d.comparison).label}`.toLowerCase().includes(q))

  const place = (d: any) => {
    const scopes: any[] = Array.isArray(d.resolved_scopes) ? d.resolved_scopes : []
    const shown = (scopes.some(s => s.matched) ? scopes.filter(s => s.matched) : scopes)
      .map(s => `${s.scopeType === 'warehouse' ? 'Warehouse' : 'Org'}: ${orgById.get(s.scopeValue) ?? 'Unlisted'}`)
    return Array.from(new Set(shown)).join(' · ') || '—'
  }
  const matchedRoles = (d: any) => Array.from(new Set((Array.isArray(d.matched_assignments) ? d.matched_assignments : []).map(roleName)))
  const pill = (value: string | null) => value
    ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${value === 'ALLOW' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{value}</span>
    : <span className="text-xs text-gray-400">—</span>

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-semibold">Authorization Decisions</h2>
          <p className="text-sm text-gray-500">Most recent recorded decisions. Legacy and new Security & Access outcomes side by side.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <SearchInput value={query} onChange={v => { setQuery(v); page.reset() }} placeholder="Search user or permission" label="Search decisions" />
        <ModuleFilterSelect value={moduleFilter} onChange={v => { setModuleFilter(v); page.reset() }} available={decisions.map(d => classifyPermission(d.permission_key).groupId)} />
        <div className="flex rounded-lg border p-0.5 text-xs font-medium">
          {(['all', 'differences'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 ${filter === f ? 'bg-gray-950 text-white' : 'text-gray-600'}`}>
              {f === 'all' ? 'All' : 'Differences only'}
            </button>
          ))}
        </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">{q || moduleFilter !== 'all' ? 'No decisions match these filters.' : filter === 'differences' ? 'No differences between legacy and new decisions.' : 'No decisions recorded yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2">Time</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th><th className="px-3 py-2">Organization / Warehouse</th>
                <th className="px-3 py-2">Legacy</th><th className="px-3 py-2">New S&A</th><th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.slice(0, page.limit).map(d => {
                const user = userById.get(d.actor_id)
                const cmp = comparisonLabel(d.comparison)
                const expanded = open === d.id
                return (
                  <Fragment key={d.id}>
                    <tr className="cursor-pointer align-top hover:bg-gray-50" onClick={() => setOpen(expanded ? null : d.id)}>
                      <td className="px-3 py-1.5 text-gray-400">
                        <button type="button" onClick={e => { e.stopPropagation(); setOpen(expanded ? null : d.id) }} aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} details of ${permissionLabel(d.permission_key).label} for ${user?.name ?? 'unknown user'}`}
                          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                          {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{new Date(d.occurred_at).toLocaleString()}</td>
                      <td className="px-3 py-1.5"><div className="whitespace-nowrap">{user?.name ?? 'Unknown user'}</div>{user?.role && <div className="text-xs text-gray-500">{user.role}</div>}</td>
                      <td className="min-w-[11rem] px-3 py-1.5">{permissionLabel(d.permission_key).label}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{resourceTypeLabel(d.resource_type)}</td>
                      <td className="px-3 py-1.5 text-gray-700">{place(d)}</td>
                      <td className="px-3 py-1.5">{pill(d.legacy_decision)}</td>
                      <td className="px-3 py-1.5">{pill(d.new_decision)}</td>
                      <td className="px-3 py-1.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cmp.tone}`}>{cmp.label}</span></td>
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-50/60">
                        <td />
                        <td colSpan={8} className="px-3 pb-4 pt-1">
                          <p className="text-sm text-gray-700">{reasonLabel(d.reason_code)}</p>
                          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <Fact term="Checked for">{user ? <>{user.name}{user.role && <span className="text-gray-500"> · {user.role}</span>}</> : 'Unknown user'}</Fact>
                            <Fact term="Granted by">{matchedRoles(d).join(', ') || <span className="text-gray-400">No matching role</span>}</Fact>
                            <Fact term="Where it applied">{place(d)}</Fact>
                            <Fact term="Mode when decided"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${modeLabel(d.migration_mode).tone}`}>{modeLabel(d.migration_mode).label}</span></Fact>
                          </dl>
                          <button type="button" onClick={() => setTechnical(technical === d.id ? null : d.id)} aria-expanded={technical === d.id}
                            className="mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                            {technical === d.id ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                            Technical reference (for support)
                          </button>
                          {technical === d.id && (
                            <dl className="mt-2 grid gap-2 rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                              <Tech term="Permission key" value={d.permission_key} />
                              <Tech term="Reason code" value={d.reason_code} />
                              <Tech term="Policy version" value={d.policy_version} />
                              <Tech term="Decision ID" value={d.id} />
                              <Tech term="Actor ID" value={d.actor_id} />
                              <Tech term="Resource ID" value={d.resource_id} />
                              <Tech term="Correlation ID" value={d.correlation_id} />
                              <Tech term="Assignment IDs" value={(Array.isArray(d.matched_assignments) ? d.matched_assignments : []).map((a: any) => a.assignmentId).join(', ')} />
                              <Tech term="Scope values" value={(Array.isArray(d.resolved_scopes) ? d.resolved_scopes : []).map((s: any) => `${s.scopeType}:${s.scopeValue}`).join(', ')} />
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <ShowMore shown={Math.min(page.limit, rows.length)} total={rows.length} onMore={page.more} />
        </div>
      )}
    </section>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{term}</dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  )
}

function Tech({ term, value }: { term: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-sans text-[11px] uppercase tracking-wide text-gray-400">{term}</dt>
      <dd className="break-all">{value || '—'}</dd>
    </div>
  )
}
