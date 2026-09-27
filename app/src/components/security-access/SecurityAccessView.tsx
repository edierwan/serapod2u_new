'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, KeyRound, Search, ShieldCheck, UserRoundCog, UsersRound } from 'lucide-react'

type Tab = 'overview' | 'people' | 'roles' | 'audit'
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'people', label: 'People & Access' },
  { id: 'roles', label: 'Roles & Policies' }, { id: 'audit', label: 'Audit & Diagnostics' },
]

export default function SecurityAccessView({ userProfile }: { userProfile: any }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [simulation, setSimulation] = useState<any>(null)
  const [simulating, setSimulating] = useState(false)
  const [form, setForm] = useState({ actorId: userProfile.id, permission: 'inventory.stock_count.view', resourceType: 'stock_count', organizationId: userProfile.organization_id || '', warehouseId: '' })
  useEffect(() => { fetch('/api/security-access/overview', { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => setData({ schemaReady: false, error: 'Unable to load Security & Access data.' })) }, [])
  const permissions = useMemo(() => (data?.permissions || []).filter((p: any) => !query || `${p.permission_key} ${p.module} ${p.resource} ${p.action}`.toLowerCase().includes(query.toLowerCase())), [data, query])

  async function simulate(e: React.FormEvent) {
    e.preventDefault(); setSimulating(true); setSimulation(null)
    const response = await fetch('/api/security-access/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: form.actorId, permission: form.permission, resource: { type: form.resourceType, organizationId: form.organizationId || undefined, warehouseId: form.warehouseId || undefined } }) })
    setSimulation(await response.json()); setSimulating(false)
  }

  if (!data) return <div className="p-8 text-sm text-gray-500">Loading Security & Access…</div>
  return <div className="h-full overflow-y-auto p-6 lg:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div><div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-orange-500"/><h1 className="text-2xl font-semibold text-gray-950">Security & Access</h1></div><p className="mt-1 text-sm text-gray-600">Enterprise roles, permissions, typed scopes, and authorization diagnostics.</p></div>
      {!data.schemaReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.error} The UI is intentionally read-only until the additive migration is reviewed and applied.</div>}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === t.id ? 'border-orange-500 text-orange-700' : 'border-transparent text-gray-500'}`}>{t.label}</button>)}</div>

      {tab === 'overview' && <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">{[
          ['Business identities', data.metrics?.businessIdentities, UsersRound], ['Active role assignments', data.metrics?.activeAssignments, UserRoundCog], ['Shadow mismatches', data.metrics?.shadowMismatches, Activity],
        ].filter((x: any[]) => typeof x[1] === 'number').map(([label, value, Icon]: any) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-5"><Icon className="h-5 w-5 text-orange-500"/><div className="mt-3 text-3xl font-semibold">{value}</div><div className="text-sm text-gray-600">{label}</div></div>)}</div>
        <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Authorization Migration Status</h2></div><div className="divide-y">{(data.modes || []).map((m: any) => <div key={m.permission_key} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><code>{m.permission_key}</code><div className="flex items-center gap-2">{m.enforcementReady && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Enforcement ready</span>}<span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${m.mode === 'SHADOW' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{m.mode.replaceAll('_', ' ')}</span></div></div>)}</div></section>
        {data.retention && <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Decision Log Retention</h2><p className="text-sm text-gray-500">Ordinary shadow decisions are kept {data.retention.retention_days} days. Enforced, security-sensitive, policy-error and pre-classification decisions are never purged automatically.</p></div><div className="grid gap-4 p-4 text-sm sm:grid-cols-3"><div><span className="text-gray-500">Oldest ordinary shadow decision</span><div>{data.retention.oldest_ordinary_shadow ? new Date(data.retention.oldest_ordinary_shadow).toLocaleString() : '—'}</div></div><div><span className="text-gray-500">Eligible for purge now</span><div>{data.retention.eligible_for_purge}</div></div><div><span className="text-gray-500">Last retention run</span><div>{data.retention.last_run ? `${new Date(data.retention.last_run.run_at).toLocaleString()} · ${data.retention.last_run.deleted_count} removed` : 'Not run yet'}</div></div></div><div className="flex flex-wrap gap-2 border-t p-4">{Object.entries(data.retention.by_class || {}).map(([cls, n]: any) => <span key={cls} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{cls.replaceAll('_', ' ')} · {n}</span>)}</div></section>}
      </div>}

      {tab === 'people' && <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Business identities</h2><p className="text-sm text-gray-500">Access-focused view. User Management remains the writable identity source.</p></div><div className="divide-y">{(data.people || []).map((p: any) => { const memberships = p.membership || []; const assignments = memberships.flatMap((m: any) => m.assignments || []); return <div key={p.id} className="grid gap-3 p-4 md:grid-cols-4"><div><div className="font-medium">{p.full_name || p.email}</div><div className="text-xs text-gray-500">{p.email}</div></div><div className="text-sm"><span className="text-gray-500">Legacy role</span><div>{p.role_code || '—'}</div></div><div className="text-sm"><span className="text-gray-500">Business roles</span><div>{assignments.map((a: any) => a.role?.name).filter(Boolean).join(', ') || 'Legacy only'}</div></div><div className="text-sm"><span className="text-gray-500">Scopes</span><div>{assignments.flatMap((a: any) => a.scopes || []).map((s: any) => s.scope?.display_name).filter(Boolean).join(', ') || '—'}</div></div></div> })}</div></section>}

      {tab === 'roles' && <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Business Roles</h2><p className="text-sm text-gray-500">New model only; legacy roles are unchanged.</p></div><div className="divide-y">{(data.roles || []).map((r: any) => <div key={r.id} className="p-4"><div className="flex justify-between"><span className="font-medium">{r.name}</span><span className="text-xs uppercase text-gray-500">{r.source} · {r.status}</span></div><div className="mt-2 text-xs text-gray-600">{(r.permissions || []).map((x: any) => x.permission?.permission_key).filter(Boolean).join(' · ') || 'No permissions'}</div></div>)}</div></section><section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Permission Catalog</h2><div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search module, resource, action, or key" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"/></div></div><div className="max-h-[560px] divide-y overflow-auto">{permissions.map((p: any) => <div key={p.id} className="p-4"><code className="text-sm">{p.permission_key}</code><div className="mt-1 text-xs text-gray-500">{p.source} · {p.status}</div></div>)}</div></section></div>}

      {tab === 'audit' && <div className="space-y-6"><section className="rounded-xl border border-gray-200 bg-white p-5"><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-orange-500"/><h2 className="font-semibold">Access Simulator / Explain Access</h2></div><p className="mt-1 text-sm text-gray-500">Uses the canonical evaluator in non-mutating, non-logging explain mode.</p><form onSubmit={simulate} className="mt-4 grid gap-3 md:grid-cols-2">{[
          ['User ID','actorId'],['Permission','permission'],['Resource type','resourceType'],['Organization ID','organizationId'],['Warehouse ID','warehouseId'],
        ].map(([label,key]) => <label key={key} className="text-xs font-medium text-gray-600">{label}<input value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label>)}<button disabled={simulating || !data.schemaReady} className="self-end rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{simulating ? 'Evaluating…' : 'Explain access'}</button></form>{simulation && <pre className="mt-4 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">{JSON.stringify(simulation, null, 2)}</pre>}</section><section className="rounded-xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Shadow Decision Differences</h2></div><div className="divide-y">{(data.decisions || []).map((d: any) => <div key={d.id} className="grid gap-2 p-4 text-sm md:grid-cols-4"><code>{d.permission_key}</code><span>{d.comparison}</span><span>{d.reason_code}</span><span className="text-gray-500">{new Date(d.occurred_at).toLocaleString()}</span></div>)}</div></section></div>}
    </div>
  </div>
}
