'use client'

import { useMemo, useState } from 'react'
import { Clock, Plus, ShieldOff, UserRound } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import { callApi, formatDate, one, SOURCE_LABELS, toIso } from './client-api'

interface Props {
  data: any
  onChanged: () => void
}

/**
 * People & Access: business identities, organization memberships and role
 * assignments (with source, scope and expiry), plus grant / revoke through the
 * audited governance functions. Names first; identifiers only in tooltips.
 */
export default function PeopleAccessPanel({ data, onChanged }: Props) {
  const people: any[] = data.people || []
  const roles: any[] = (data.roles || []).filter((r: any) => r.source !== 'legacy' && r.status === 'active')
  const scopes: any[] = data.scopeDefinitions || []
  const orgName = useMemo(() => new Map((data.organizations || []).map((o: any) => [o.id, o.org_name])), [data.organizations])
  const [query, setQuery] = useState('')
  const [showTemporaryOnly, setShowTemporaryOnly] = useState(false)
  const [form, setForm] = useState({ userId: '', roleId: '', organizationId: '', scopeId: '', until: '', reason: '' })
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = people.filter(p => {
    const text = `${p.full_name || ''} ${p.email || ''} ${p.role_code || ''}`.toLowerCase()
    if (query && !text.includes(query.toLowerCase())) return false
    if (!showTemporaryOnly) return true
    return (p.membership || []).some((m: any) => (m.assignments || []).some((a: any) => a.status === 'active' && a.effective_until))
  })
  const person = people.find(p => p.id === form.userId)
  const memberships: any[] = (person?.membership || []).filter((m: any) => m.status === 'active')
  const scopeOptions = scopes.filter(s => !form.organizationId || s.organization_id === form.organizationId)
    .filter(s => s.scope_type !== 'own_record')
    .map(s => ({ value: s.id, label: s.display_name, description: s.scope_type.replace(/_/g, ' ') }))

  async function grant() {
    setBusy(true); setMessage(null)
    const result = await callApi('/api/security-access/assignments', { body: {
      action: 'grant', userId: form.userId, roleId: form.roleId, organizationId: form.organizationId,
      scopeIds: form.scopeId ? [form.scopeId] : [], effectiveUntil: toIso(form.until), reason: form.reason,
    } })
    setBusy(false)
    if (!result.ok) { setMessage({ tone: 'error', text: result.error || 'Unable to grant access' }); return }
    setMessage({ tone: 'ok', text: 'Access granted and recorded in the access change log.' })
    setForm({ userId: '', roleId: '', organizationId: '', scopeId: '', until: '', reason: '' })
    onChanged()
  }

  async function revoke(assignmentId: string, label: string) {
    const reason = window.prompt(`Reason for revoking ${label}?`)
    if (!reason || reason.trim().length < 5) return
    const result = await callApi('/api/security-access/assignments', { body: { action: 'revoke', assignmentId, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Access revoked.' } : { tone: 'error', text: result.error || 'Unable to revoke' })
    if (result.ok) onChanged()
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4">
        <h2 className="font-semibold">Grant a business role</h2>
        <p className="text-sm text-gray-500">Access is granted to an existing business membership and always carries a scope. You cannot grant access to yourself; conflicting duties are checked automatically.</p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <SearchableSelect label="Person" value={form.userId} onChange={v => setForm({ ...form, userId: v, organizationId: '', scopeId: '' })}
          options={people.filter(p => p.id !== data.viewerId).map(p => ({ value: p.id, label: p.full_name || p.email, description: p.email, keywords: p.role_code }))} placeholder="Choose a person" />
        <SearchableSelect label="Business role" value={form.roleId} onChange={v => setForm({ ...form, roleId: v })}
          options={roles.map(r => ({ value: r.id, label: r.name, description: r.description || undefined }))} placeholder="Choose a role" />
        <SearchableSelect label="Membership organization" value={form.organizationId} onChange={v => setForm({ ...form, organizationId: v, scopeId: '' })}
          options={memberships.map(m => ({ value: m.organization_id, label: String(orgName.get(m.organization_id) || 'Organization'), description: m.is_primary ? 'Primary membership' : m.membership_type }))}
          placeholder={form.userId ? 'Choose a membership' : 'Choose a person first'} disabled={!form.userId} />
        <SearchableSelect label="Scope" value={form.scopeId} onChange={v => setForm({ ...form, scopeId: v })} options={scopeOptions}
          placeholder={form.organizationId ? 'Choose a scope' : 'Choose a membership first'} disabled={!form.organizationId} />
        <label className="text-sm"><span className="text-gray-600">Ends (optional — temporary access)</span>
          <input type="datetime-local" value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label className="text-sm"><span className="text-gray-600">Reason</span>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Why is this access needed?" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <div className="flex items-center gap-3 border-t p-4">
        <button disabled={busy || !form.userId || !form.roleId || !form.organizationId || !form.scopeId || form.reason.trim().length < 5}
          onClick={grant} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          <Plus className="h-4 w-4" />Grant access</button>
        {message && <span className={`text-sm ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</span>}
      </div>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div><h2 className="font-semibold">Identities, memberships and role assignments</h2>
          <p className="text-sm text-gray-500">Lifecycle access is derived from HR and User Management facts; leavers lose business access automatically.</p></div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showTemporaryOnly} onChange={e => setShowTemporaryOnly(e.target.checked)} />Temporary access only</label>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people" className="rounded-lg border px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="divide-y">
        {rows.map(p => <div key={p.id} className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <UserRound className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{p.full_name || p.email}</span>
            <span className="text-xs text-gray-500">{p.email}</span>
            {!p.is_active && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Inactive</span>}
            <span className="text-xs text-gray-400" title="Legacy role code (compatibility input only)">Legacy role: {p.role_code || '—'}</span>
          </div>
          {(p.membership || []).map((m: any) => <div key={m.id} className="ml-7 mt-2 rounded-lg bg-gray-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {String(orgName.get(m.organization_id) || one(p.organization)?.org_name || 'Organization')} · {m.status}{m.is_primary ? ' · primary' : ''}
            </div>
            <div className="mt-2 space-y-1.5">
              {(m.assignments || []).length === 0 && <div className="text-sm text-gray-500">No role assignments.</div>}
              {(m.assignments || []).map((a: any) => {
                const source = SOURCE_LABELS[a.source] ?? SOURCE_LABELS.manual
                const scopeNames = (a.scopes || []).map((s: any) => s.scope?.display_name).filter(Boolean).join(', ') || '—'
                const expired = a.effective_until && new Date(a.effective_until) <= new Date()
                return <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={a.status === 'active' && !expired ? 'font-medium text-gray-900' : 'text-gray-400 line-through'}>{a.role?.name || 'Role'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${source.tone}`} title={source.help}>{source.label}</span>
                    <span className="text-xs text-gray-500">Scope: {scopeNames}</span>
                    {a.effective_until && <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3 w-3" />{expired ? 'Expired' : 'Until'} {formatDate(a.effective_until)}</span>}
                    {a.status !== 'active' && <span className="text-xs text-gray-400">{a.status}</span>}
                  </div>
                  {a.status === 'active' && p.id !== data.viewerId && <button onClick={() => revoke(a.id, a.role?.name || 'this role')}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-white"><ShieldOff className="h-3 w-3" />Revoke</button>}
                </div>
              })}
            </div>
          </div>)}
          {(p.membership || []).length === 0 && <div className="ml-7 mt-1 text-sm text-gray-500">No business membership (consumer or not yet onboarded).</div>}
        </div>)}
        {rows.length === 0 && <div className="p-6 text-sm text-gray-500">No matching people.</div>}
      </div>
    </section>
  </div>
}
