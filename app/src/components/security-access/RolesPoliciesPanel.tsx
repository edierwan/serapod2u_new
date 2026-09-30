'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PERMISSION_GROUP_ORDER, modeLabel, permissionLabel } from '@/lib/security-access/labels'
import { callApi } from './client-api'

interface Props {
  data: any
  governance: any | null
  onChanged: () => void
  /** Starting search (e.g. opened from Overview for one permission). */
  initialQuery?: string
}

const MODES = ['LEGACY_ENFORCED', 'SHADOW', 'NEW_ENFORCED', 'LEGACY_RETIRED'] as const

/**
 * Roles & Policies: business roles, the permission catalogue, migration
 * modes (with enforcement readiness), authority policies and typed scopes.
 */
export default function RolesPoliciesPanel({ data, governance, onChanged, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const readiness = useMemo(() => new Map((governance?.readiness || []).map((r: any) => [r.permission_key, r])), [governance])
  const permissions = (data.permissions || []).filter((p: any) => !query || `${permissionLabel(p.permission_key).label} ${p.permission_key}`.toLowerCase().includes(query.toLowerCase()))
  const modesByGroup = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const m of data.modes || []) {
      if (query && !`${permissionLabel(m.permission_key).label} ${m.permission_key}`.toLowerCase().includes(query.toLowerCase())) continue
      const group = permissionLabel(m.permission_key).group
      groups.set(group, [...(groups.get(group) || []), m])
    }
    const rank = (g: string) => { const i = PERMISSION_GROUP_ORDER.indexOf(g); return i < 0 ? PERMISSION_GROUP_ORDER.length : i }
    return Array.from(groups.entries()).sort(([a], [b]) => rank(a) - rank(b))
  }, [data.modes, query])

  async function changeMode(permissionKey: string, mode: string) {
    const reason = window.prompt(`Reason for moving ${permissionLabel(permissionKey).label} to ${modeLabel(mode).label}?`)
    if (!reason || reason.trim().length < 10) { setMessage({ tone: 'error', text: 'A reason of at least 10 characters is required.' }); return }
    const result = await callApi('/api/security-access/modes', { body: { permissionKey, mode, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Mode changed and audited.' } : { tone: 'error', text: result.error || 'Unable to change mode' })
    if (result.ok) onChanged()
  }

  return <div className="space-y-6">
    <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search permissions and operations" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm" /></div>
    {message && <div className={`rounded-lg p-3 text-sm ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}

    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h2 className="font-semibold">Operations and migration modes</h2>
        <p className="text-sm text-gray-500">Only operations whose every path is wired (server route and database backstop) can be enforced. A new-model denial never falls back to a legacy allow.</p></div>
      {modesByGroup.map(([group, modes]) => <div key={group}>
        <div className="border-b bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{group}</div>
        <div className="divide-y">{modes.map((m: any) => {
          const ready: any = readiness.get(m.permission_key)
          const mode = modeLabel(m.mode)
          return <div key={m.permission_key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-gray-900">{permissionLabel(m.permission_key).label}</div>
              <code className="text-[11px] text-gray-400">{m.permission_key}</code>
              {ready?.intentional_tightening && <div className="mt-1 text-xs text-amber-700" title="Expected difference when enforced">Tightening: {ready.intentional_tightening}</div>}
            </div>
            <div className="flex items-center gap-2">
              {ready ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" title={ready.notes}>Ready · {String(ready.database_backstop).replace(/_/g, ' ')}</span>
                : <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500" title="Not every path is wired for enforcement">Shadow only</span>}
              <span title={mode.help} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mode.tone}`}>{mode.label}</span>
              <select aria-label="Change mode" value="" onChange={e => e.target.value && changeMode(m.permission_key, e.target.value)} className="rounded-md border px-2 py-1 text-xs">
                <option value="">Change…</option>
                {MODES.filter(x => x !== m.mode).map(x => <option key={x} value={x} disabled={(x === 'NEW_ENFORCED' || x === 'LEGACY_RETIRED') && !ready}>{modeLabel(x).label}</option>)}
              </select>
            </div>
          </div>
        })}</div>
      </div>)}
    </section>

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b p-4"><h2 className="font-semibold">Business roles</h2>
          <p className="text-sm text-gray-500">Target roles are assigned in People & Access. Compatibility roles mirror legacy role definitions and are managed by the lifecycle.</p></div>
        <div className="max-h-[560px] divide-y overflow-auto">{(data.roles || []).map((r: any) => <div key={r.id} className="p-4">
          <div className="flex justify-between gap-2"><span className="font-medium">{r.name}</span>
            <span className="text-xs uppercase text-gray-500">{r.source === 'legacy' ? 'compatibility' : r.source} · {r.status}</span></div>
          {r.description && <div className="mt-1 text-xs text-gray-500">{r.description}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">{(r.permissions || []).map((x: any) => x.permission?.permission_key).filter(Boolean).map((key: string) =>
            <span key={key} title={key} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{permissionLabel(key).label}</span>)}
            {!(r.permissions || []).length && <span className="text-xs text-gray-500">No permissions</span>}</div>
        </div>)}</div>
      </section>
      <div className="space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b p-4"><h2 className="font-semibold">Authority policies</h2>
            <p className="text-sm text-gray-500">Approval limits (amount, currency, variance) evaluated against the trusted document. Permission alone is not approval authority.</p></div>
          <div className="divide-y">{(governance?.authorityPolicies || []).map((p: any) => <div key={p.id} className="p-4 text-sm">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-gray-500">{permissionLabel(p.permission_key).label} · {p.document_type} · {p.currency || 'any currency'} {p.min_amount ?? 0}–{p.max_amount ?? '∞'}</div></div>)}
            {governance && !(governance.authorityPolicies || []).length && <div className="p-4 text-sm text-gray-500">No approval thresholds are configured. None are documented in the current workflows, so existing workflow approval rules apply unchanged.</div>}
          </div>
        </section>
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b p-4"><h2 className="font-semibold">Scope definitions</h2><p className="text-sm text-gray-500">Typed scopes used by assignments. An empty scope never means global access.</p></div>
          <div className="max-h-72 divide-y overflow-auto">{(data.scopeDefinitions || []).map((s: any) => <div key={s.id} className="flex justify-between px-4 py-2 text-sm">
            <span>{s.display_name}</span><span className="text-xs text-gray-500">{s.scope_type.replace(/_/g, ' ')}</span></div>)}</div>
        </section>
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b p-4"><h2 className="font-semibold">Permission catalogue</h2></div>
          <div className="max-h-96 divide-y overflow-auto">{permissions.map((p: any) => <div key={p.id} className="p-3">
            <div className="text-sm font-medium text-gray-900">{permissionLabel(p.permission_key).label}</div>
            <div className="text-xs text-gray-500">{p.description}</div>
            <code className="text-[11px] text-gray-400">{p.permission_key}</code>
            {p.audit_sensitivity === 'security_sensitive' && <span className="ml-2 rounded bg-rose-50 px-1.5 text-[10px] text-rose-700">sensitive audit</span>}
          </div>)}</div>
        </section>
      </div>
    </div>
  </div>
}
