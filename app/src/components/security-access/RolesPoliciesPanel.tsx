'use client'

import { useMemo, useState } from 'react'
import { modeLabel, permissionLabel } from '@/lib/security-access/labels'
import { buildRollout, classifyPermission, OTHER_GROUP, ROLLOUT_HIERARCHY } from '@/lib/security-access/rollout'
import { callApi } from './client-api'
import PermissionTree from './PermissionTree'
import { EmptyState, Feedback, FilterChips, SearchInput, SectionTabs, ShowMore, ToggleButton, useLimit } from './ui'

interface Props {
  data: any
  governance: any | null
  onChanged: () => void
  /** Starting search (e.g. opened from Overview for one permission). */
  initialQuery?: string
}

const MODES = ['LEGACY_ENFORCED', 'SHADOW', 'NEW_ENFORCED', 'LEGACY_RETIRED'] as const
type Section = 'modes' | 'roles' | 'scopes' | 'catalogue' | 'authority'
const GROUP_NAME = new Map<string, string>([...ROLLOUT_HIERARCHY.map(g => [g.id, g.name] as [string, string]), [OTHER_GROUP.id, 'Other']])

/**
 * Roles & Policies: migration modes (with enforcement readiness), business
 * roles, typed scopes, the permission catalogue and authority policies — one
 * section at a time, grouped and collapsed like the Overview.
 */
export default function RolesPoliciesPanel({ data, governance, onChanged, initialQuery = '' }: Props) {
  const [section, setSection] = useState<Section>('modes')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const readiness = useMemo(() => new Map<string, any>((governance?.readiness || []).map((r: any) => [r.permission_key, r])), [governance])
  const roles: any[] = data.roles || []
  const scopes: any[] = data.scopeDefinitions || []
  const policies: any[] = governance?.authorityPolicies || []

  const modeRollout = useMemo(() => buildRollout((data.modes || []).map((m: any) => ({
    key: m.permission_key, label: permissionLabel(m.permission_key).label, mode: m.mode, enforcementReady: readiness.has(m.permission_key),
  }))), [data.modes, readiness])
  const modeByKey = useMemo(() => new Map<string, string>((data.modes || []).map((m: any) => [m.permission_key, m.mode])), [data.modes])
  const catalogue = useMemo(() => buildRollout((data.permissions || []).map((p: any) => ({
    key: p.permission_key, label: permissionLabel(p.permission_key).label, mode: modeByKey.get(p.permission_key) ?? 'UNREGISTERED', enforcementReady: false,
  }))), [data.permissions, modeByKey])
  const describe = useMemo(() => new Map<string, any>((data.permissions || []).map((p: any) => [p.permission_key, p])), [data.permissions])

  async function changeMode(permissionKey: string, mode: string) {
    const reason = window.prompt(`Reason for moving ${permissionLabel(permissionKey).label} to ${modeLabel(mode).label}?`)
    if (!reason || reason.trim().length < 10) { setMessage({ tone: 'error', text: 'A reason of at least 10 characters is required.' }); return }
    const result = await callApi('/api/security-access/modes', { body: { permissionKey, mode, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Mode changed and audited.' } : { tone: 'error', text: result.error || 'Unable to change mode' })
    if (result.ok) onChanged()
  }

  return <div className="space-y-4">
    <SectionTabs label="Roles & Policies sections" value={section} onChange={setSection} items={[
      { id: 'modes', label: 'Migration modes', count: modeRollout.total },
      { id: 'roles', label: 'Business roles', count: roles.length },
      { id: 'scopes', label: 'Scopes', count: scopes.length },
      { id: 'catalogue', label: 'Permission catalogue', count: catalogue.total },
      { id: 'authority', label: 'Authority policies', count: governance ? policies.length : null },
    ]} />
    <Feedback message={message} />

    {section === 'modes' && <PermissionTree
      rollout={modeRollout}
      initialQuery={initialQuery}
      searchPlaceholder="Search permissions"
      title="Operations and migration modes"
      description="Only operations whose every path is wired (server route and database backstop) can be enforced. A new-model denial never falls back to a legacy allow."
      renderSubtitle={p => {
        const tightening = readiness.get(p.key)?.intentional_tightening
        return tightening ? <div className="text-xs text-amber-700" title="Expected difference when enforced">Tightening: {tightening}</div> : null
      }}
      renderDetails={p => {
        const ready = readiness.get(p.key)
        return <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span className={ready ? 'text-emerald-700' : 'text-gray-500'} title={ready ? ready.notes : 'Not every path is wired for enforcement'}>
            {ready ? `Ready · ${String(ready.database_backstop).replace(/_/g, ' ')}` : 'Monitoring only'}
          </span>
          <select aria-label={`Change mode for ${p.label}`} value="" onChange={e => e.target.value && changeMode(p.key, e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100">
            <option value="">Change…</option>
            {MODES.filter(x => x !== p.mode).map(x => <option key={x} value={x} disabled={(x === 'NEW_ENFORCED' || x === 'LEGACY_RETIRED') && !ready}>{modeLabel(x).label}</option>)}
          </select>
        </div>
      }}
    />}

    {section === 'roles' && <BusinessRoles roles={roles} />}
    {section === 'scopes' && <Scopes scopes={scopes} />}

    {section === 'catalogue' && <PermissionTree
      rollout={catalogue}
      showModes={false}
      searchPlaceholder="Search permissions"
      title="Permission catalogue"
      description="Every operation Security & Access can decide, grouped like the Overview."
      renderSubtitle={p => describe.get(p.key)?.description ? <div className="text-xs text-gray-500">{describe.get(p.key).description}</div> : null}
      renderDetails={p => describe.get(p.key)?.audit_sensitivity === 'security_sensitive'
        ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700" title="Every decision is kept (never purged automatically).">Sensitive audit</span>
        : <span className="text-gray-400">Ordinary audit</span>}
    />}

    {section === 'authority' && <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-950">Authority policies</h2>
        <p className="text-sm text-gray-500">Approval limits (amount, currency, variance) evaluated against the trusted document. Permission alone is not approval authority.</p></div>
      {!governance && <EmptyState>Authority policies need the Security audit view.</EmptyState>}
      <div className="divide-y divide-gray-100">{policies.map((p: any) => <div key={p.id} className="px-4 py-2.5 text-sm">
        <div className="font-medium text-gray-900">{p.name}</div>
        <div className="text-xs text-gray-500">{permissionLabel(p.permission_key).label} · {p.document_type} · {p.currency || 'any currency'} {p.min_amount ?? 0}–{p.max_amount ?? '∞'}</div></div>)}</div>
      {governance && !policies.length && <EmptyState>No approval thresholds are configured. None are documented in the current workflows, so existing workflow approval rules apply unchanged.</EmptyState>}
    </section>}
  </div>
}

type RoleFilter = 'business' | 'compatibility' | 'all'

function BusinessRoles({ roles }: { roles: any[] }) {
  const [filter, setFilter] = useState<RoleFilter>('business')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const page = useLimit(25)
  const keysOf = (r: any): string[] => (r.permissions || []).map((x: any) => x.permission?.permission_key).filter(Boolean)
  const isCompat = (r: any) => r.source === 'legacy'
  const q = query.trim().toLowerCase()
  const rows = roles.filter(r => (filter === 'all' || (filter === 'compatibility') === isCompat(r))
    && (!q || `${r.name} ${r.role_key} ${r.description || ''} ${keysOf(r).map(k => `${k} ${permissionLabel(k).label}`).join(' ')}`.toLowerCase().includes(q)))
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
      <div className="min-w-0"><h2 className="font-semibold text-gray-950">Business roles</h2>
        <p className="text-sm text-gray-500">Target roles are assigned in People &amp; Access. Compatibility roles mirror legacy role definitions and are managed by the lifecycle.</p></div>
      <SearchInput value={query} onChange={v => { setQuery(v); page.reset() }} placeholder="Search roles or permissions" label="Search roles" />
    </div>
    <div className="border-b border-gray-100 px-4 py-2">
      <FilterChips label="Role type" value={filter} onChange={v => { setFilter(v); page.reset() }} items={[
        { id: 'business', label: 'Business roles', count: roles.filter(r => !isCompat(r)).length },
        { id: 'compatibility', label: 'Compatibility', count: roles.filter(isCompat).length },
        { id: 'all', label: 'All', count: roles.length },
      ]} />
    </div>
    {rows.length === 0 && <EmptyState>{q ? `No roles match “${query.trim()}”.` : 'No roles in this view.'}</EmptyState>}
    <ul className="divide-y divide-gray-100">
      {rows.slice(0, page.limit).map(r => {
        const keys = keysOf(r)
        const isOpen = open.has(r.id)
        const byGroup = new Map<string, string[]>()
        for (const k of keys) { const g = classifyPermission(k).groupId; byGroup.set(g, [...(byGroup.get(g) || []), k]) }
        return <li key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <ToggleButton open={isOpen} onClick={() => toggle(r.id)} label={`${r.name}, ${keys.length} permission${keys.length === 1 ? '' : 's'}`}>
              <span className="font-medium text-gray-900">{r.name}</span>
            </ToggleButton>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{keys.length} permission{keys.length === 1 ? '' : 's'}</span>
              {r.source !== 'template' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{isCompat(r) ? 'Compatibility' : 'Custom'}</span>}
              {r.status !== 'active' && <span className="text-gray-400">{r.status}</span>}
            </div>
          </div>
          {isOpen && <div className="space-y-2 bg-gray-50/60 px-4 pb-3 pl-10 pt-1">
            {r.description && <p className="text-sm text-gray-600">{r.description}</p>}
            {keys.length === 0 && <p className="text-sm text-gray-500">No permissions.</p>}
            {Array.from(byGroup.entries()).map(([g, ks]) => <div key={g}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{GROUP_NAME.get(g) || g} · {ks.length}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{ks.sort().map(k =>
                <span key={k} title={k} className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700">{permissionLabel(k).label}</span>)}</div>
            </div>)}
          </div>}
        </li>
      })}
    </ul>
    <ShowMore shown={Math.min(page.limit, rows.length)} total={rows.length} onMore={page.more} />
  </section>
}

function Scopes({ scopes }: { scopes: any[] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const s of scopes) {
      if (q && !`${s.display_name} ${s.scope_type}`.toLowerCase().includes(q)) continue
      map.set(s.scope_type, [...(map.get(s.scope_type) || []), s])
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [scopes, q])
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
      <div className="min-w-0"><h2 className="font-semibold text-gray-950">Scope definitions</h2>
        <p className="text-sm text-gray-500">Typed scopes used by assignments. An empty scope never means global access.</p></div>
      <SearchInput value={query} onChange={setQuery} placeholder="Search scopes" label="Search scopes" />
    </div>
    {groups.length === 0 && <EmptyState>{q ? `No scopes match “${query.trim()}”.` : 'No scopes defined.'}</EmptyState>}
    <ul className="divide-y divide-gray-100">{groups.map(([type, list]) => {
      const isOpen = q ? true : open.has(type)
      return <li key={type}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/70">
          <ToggleButton open={isOpen} onClick={() => toggle(type)} label={`${type.replace(/_/g, ' ')} scopes, ${list.length}`}>
            <span className="font-semibold capitalize text-gray-900">{type.replace(/_/g, ' ')}</span>
          </ToggleButton>
          <span className="text-xs text-gray-500">{list.length}</span>
        </div>
        {isOpen && <ScopeList list={list} />}
      </li>
    })}</ul>
  </section>
}

function ScopeList({ list }: { list: any[] }) {
  const page = useLimit(25)
  return <>
    <ul className="divide-y divide-gray-50">{list.slice(0, page.limit).map(s =>
      <li key={s.id} className="py-1.5 pl-10 pr-4 text-sm text-gray-800">{s.display_name}</li>)}</ul>
    <ShowMore shown={Math.min(page.limit, list.length)} total={list.length} onMore={page.more} />
  </>
}
