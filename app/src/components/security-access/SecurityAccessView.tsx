'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ShieldCheck, UserRoundCog, UsersRound } from 'lucide-react'
import AccessSimulator from './AccessSimulator'
import DecisionLog from './DecisionLog'
import PeopleAccessPanel from './PeopleAccessPanel'
import RolesPoliciesPanel from './RolesPoliciesPanel'
import GovernancePanel from './GovernancePanel'
import TechnicalAccessPanel, { LegacyCompatibilityPanel } from './TechnicalAccessPanel'
import AccessChangeLog from './AccessChangeLog'
import { callApi } from './client-api'
import { PERMISSION_GROUP_ORDER, modeLabel, permissionLabel } from '@/lib/security-access/labels'

type Tab = 'overview' | 'people' | 'roles' | 'governance' | 'technical' | 'audit'
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'people', label: 'People & Access' },
  { id: 'roles', label: 'Roles & Policies' }, { id: 'governance', label: 'Governance' },
  { id: 'technical', label: 'Technical Access' }, { id: 'audit', label: 'Audit & Diagnostics' },
]

export default function SecurityAccessView({ userProfile }: { userProfile: any }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<any>(null)
  const [governance, setGovernance] = useState<any>(null)

  const load = useCallback(() => {
    fetch('/api/security-access/overview', { cache: 'no-store' }).then(r => r.json()).then(setData)
      .catch(() => setData({ schemaReady: false, error: 'Unable to load Security & Access data.' }))
    // Governance read model needs security.audit.view; absent → sections stay informational.
    callApi('/api/security-access/governance').then(r => setGovernance(r.ok ? r.data : null))
  }, [])
  useEffect(() => { load() }, [load])

  const modeSummary = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of data?.modes || []) counts[m.mode] = (counts[m.mode] || 0) + 1
    return counts
  }, [data])
  const modeGroups = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const m of data?.modes || []) {
      const group = permissionLabel(m.permission_key).group
      groups.set(group, [...(groups.get(group) || []), m])
    }
    const rank = (group: string) => { const i = PERMISSION_GROUP_ORDER.indexOf(group); return i < 0 ? PERMISSION_GROUP_ORDER.length : i }
    return Array.from(groups.entries()).sort(([a], [b]) => rank(a) - rank(b))
  }, [data])

  if (!data) return <div className="p-8 text-sm text-gray-500">Loading Security & Access…</div>
  return <div className="h-full overflow-y-auto p-6 lg:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div><div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-orange-500"/><h1 className="text-2xl font-semibold text-gray-950">Security & Access</h1></div><p className="mt-1 text-sm text-gray-600">Enterprise roles, permissions, typed scopes, governance and authorization diagnostics.</p></div>
      {!data.schemaReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.error} The UI is intentionally read-only until the additive migration is reviewed and applied.</div>}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === t.id ? 'border-orange-500 text-orange-700' : 'border-transparent text-gray-500'}`}>{t.label}</button>)}</div>

      {tab === 'overview' && <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">{[
          ['Business identities', data.metrics?.businessIdentities, UsersRound], ['Active role assignments', data.metrics?.activeAssignments, UserRoundCog], ['Shadow mismatches', data.metrics?.shadowMismatches, Activity],
        ].filter((x: any[]) => typeof x[1] === 'number').map(([label, value, Icon]: any) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-5"><Icon className="h-5 w-5 text-orange-500"/><div className="mt-3 text-3xl font-semibold">{value}</div><div className="text-sm text-gray-600">{label}</div></div>)}</div>
        <div className="flex flex-wrap gap-2">{Object.entries(modeSummary).map(([mode, n]) => <span key={mode} title={modeLabel(mode).help} className={`rounded-full px-3 py-1 text-xs font-semibold ${modeLabel(mode).tone}`}>{modeLabel(mode).label} · {n}</span>)}</div>
        <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Authorization Migration Status</h2><p className="text-sm text-gray-500">Which authorization model decides each operation. Hover a mode for what it means; change modes in Roles & Policies.</p></div>
          {modeGroups.map(([group, modes]) => <div key={group}><div className="border-b bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{group}</div><div className="divide-y">{modes.map((m: any) => { const mode = modeLabel(m.mode); return <div key={m.permission_key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><div><div className="font-medium text-gray-900">{permissionLabel(m.permission_key).label}</div><code className="text-[11px] text-gray-400">{m.permission_key}</code></div><div className="flex items-center gap-2">{m.enforcementReady && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" title="Every mutation path is wired to the enforcement contract and database backstop.">Enforcement ready</span>}<span title={mode.help} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mode.tone}`}>{m.mode.replaceAll('_', ' ')}</span></div></div> })}</div></div>)}
        </section>
        {data.retention && <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Decision Log Retention</h2><p className="text-sm text-gray-500">Ordinary shadow decisions are kept {data.retention.retention_days} days. Enforced, security-sensitive, policy-error and pre-classification decisions are never purged automatically.</p></div><div className="grid gap-4 p-4 text-sm sm:grid-cols-3"><div><span className="text-gray-500">Oldest ordinary shadow decision</span><div>{data.retention.oldest_ordinary_shadow ? new Date(data.retention.oldest_ordinary_shadow).toLocaleString() : '—'}</div></div><div><span className="text-gray-500">Eligible for purge now</span><div>{data.retention.eligible_for_purge}</div></div><div><span className="text-gray-500">Last retention run</span><div>{data.retention.last_run ? `${new Date(data.retention.last_run.run_at).toLocaleString()} · ${data.retention.last_run.deleted_count} removed` : 'Not run yet'}</div></div></div><div className="flex flex-wrap gap-2 border-t p-4">{Object.entries(data.retention.by_class || {}).map(([cls, n]: any) => <span key={cls} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{cls.replaceAll('_', ' ')} · {n}</span>)}</div></section>}
      </div>}

      {tab === 'people' && <PeopleAccessPanel data={data} onChanged={load} />}
      {tab === 'roles' && <RolesPoliciesPanel data={data} governance={governance} onChanged={load} />}
      {tab === 'governance' && <GovernancePanel data={data} governance={governance} />}
      {tab === 'technical' && <div className="space-y-4"><TechnicalAccessPanel governance={governance} /><LegacyCompatibilityPanel governance={governance} /></div>}
      {tab === 'audit' && <div className="space-y-6"><AccessSimulator userProfile={userProfile} people={data.people || []} actors={data.actors || []} permissions={data.permissions || []} organizations={data.organizations || []} disabled={!data.schemaReady} /><DecisionLog decisions={data.recentDecisions?.length ? data.recentDecisions : data.decisions || []} actors={data.actors || []} people={data.people || []} organizations={data.organizations || []} /><AccessChangeLog governance={governance} people={data.people || []} actors={data.actors || []} /></div>}
    </div>
  </div>
}
