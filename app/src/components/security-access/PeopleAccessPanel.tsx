'use client'

import { useMemo, useState } from 'react'
import { Clock, Plus, ShieldOff, UserRound } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import { callApi, formatDate, one, SOURCE_LABELS, toIso } from './client-api'
import { DisclosurePanel, EmptyState, FilterChips, FOCUS, SearchInput, ShowMore, ToggleButton, useLimit } from './ui'

interface Props {
  data: any
  onChanged: () => void
}

type PersonFilter = 'all' | 'granted' | 'temporary' | 'inactive' | 'none'
const LIFECYCLE_SOURCES = new Set(['backfill', 'derived'])
const EMPTY_FORM = { userId: '', roleId: '', organizationId: '', scopeId: '', until: '', reason: '' }

const activeAssignments = (p: any) => (p.membership || []).flatMap((m: any) => (m.assignments || []).filter((a: any) => a.status === 'active'))
const isTemporary = (a: any) => a.status === 'active' && !!a.effective_until
const isGranted = (a: any) => !LIFECYCLE_SOURCES.has(a.source)

/**
 * People & Access: business identities, memberships and role assignments.
 * People are compact rows (collapsed); a person opens to their memberships,
 * with administrator-granted roles first and lifecycle-derived roles folded.
 * Grant / revoke use the audited governance functions unchanged.
 */
export default function PeopleAccessPanel({ data, onChanged }: Props) {
  const people: any[] = data.people || []
  const roles: any[] = (data.roles || []).filter((r: any) => r.source !== 'legacy' && r.status === 'active')
  const scopes: any[] = data.scopeDefinitions || []
  const orgName = useMemo(() => new Map((data.organizations || []).map((o: any) => [o.id, o.org_name])), [data.organizations])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PersonFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const page = useLimit(25)

  const stats = useMemo(() => {
    const s = { all: people.length, granted: 0, temporary: 0, inactive: 0, none: 0 }
    for (const p of people) {
      const active = activeAssignments(p)
      if (active.some(isGranted)) s.granted += 1
      if (active.some(isTemporary)) s.temporary += 1
      if (!p.is_active) s.inactive += 1
      if (!(p.membership || []).length) s.none += 1
    }
    return s
  }, [people])

  const q = query.trim().toLowerCase()
  const rows = people.filter(p => {
    const orgNames = (p.membership || []).map((m: any) => orgName.get(m.organization_id)).join(' ')
    const text = `${p.full_name || ''} ${p.email || ''} ${p.role_code || ''} ${orgNames}`.toLowerCase()
    if (q && !text.includes(q)) return false
    const active = activeAssignments(p)
    if (filter === 'granted') return active.some(isGranted)
    if (filter === 'temporary') return active.some(isTemporary)
    if (filter === 'inactive') return !p.is_active
    if (filter === 'none') return !(p.membership || []).length
    return true
  })

  const person = people.find(p => p.id === form.userId)
  const memberships: any[] = (person?.membership || []).filter((m: any) => m.status === 'active')
  const scopeOptions = scopes.filter(s => !form.organizationId || s.organization_id === form.organizationId)
    .filter(s => s.scope_type !== 'own_record')
    .map(s => ({ value: s.id, label: s.display_name, description: s.scope_type.replace(/_/g, ' ') }))

  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const startGrant = (userId = '') => {
    setForm({ ...EMPTY_FORM, userId })
    setMessage(null)
    setFormOpen(true)
    if (typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  async function grant() {
    setBusy(true); setMessage(null)
    const result = await callApi('/api/security-access/assignments', { body: {
      action: 'grant', userId: form.userId, roleId: form.roleId, organizationId: form.organizationId,
      scopeIds: form.scopeId ? [form.scopeId] : [], effectiveUntil: toIso(form.until), reason: form.reason,
    } })
    setBusy(false)
    if (!result.ok) { setMessage({ tone: 'error', text: result.error || 'Unable to grant access' }); return }
    setMessage({ tone: 'ok', text: 'Access granted and recorded in the access change log.' })
    setForm(EMPTY_FORM)
    setFormOpen(false)
    onChanged()
  }

  async function revoke(assignmentId: string, label: string) {
    const reason = window.prompt(`Reason for revoking ${label}?`)
    if (!reason || reason.trim().length < 5) return
    const result = await callApi('/api/security-access/assignments', { body: { action: 'revoke', assignmentId, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Access revoked.' } : { tone: 'error', text: result.error || 'Unable to revoke' })
    if (result.ok) onChanged()
  }

  return <div className="space-y-4">
    <DisclosurePanel title="Grant a business role" open={formOpen} onToggle={() => (formOpen ? setFormOpen(false) : startGrant())} actionLabel="Grant access"
      description="Access is granted to an existing business membership and always carries a scope. You cannot grant access to yourself; conflicting duties are checked automatically.">
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
      <div className="flex items-center gap-3 border-t border-gray-100 p-4">
        <button disabled={busy || !form.userId || !form.roleId || !form.organizationId || !form.scopeId || form.reason.trim().length < 5}
          onClick={grant} className={`inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${FOCUS}`}>
          <Plus className="h-4 w-4" aria-hidden />Grant access</button>
      </div>
    </DisclosurePanel>

    {message && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}

    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
        <div className="min-w-0"><h2 className="font-semibold text-gray-950">People and their access</h2>
          <p className="text-sm text-gray-500">Lifecycle access is derived from HR and User Management facts; leavers lose business access automatically.</p></div>
        <SearchInput value={query} onChange={v => { setQuery(v); page.reset() }} placeholder="Search name, email or organization" label="Search people" className="sm:w-72" />
      </div>
      <div className="border-b border-gray-100 px-4 py-2">
        <FilterChips label="Show" value={filter} onChange={v => { setFilter(v); page.reset() }} items={[
          { id: 'all', label: 'Everyone', count: stats.all },
          { id: 'granted', label: 'With granted roles', count: stats.granted },
          { id: 'temporary', label: 'Temporary access', count: stats.temporary },
          { id: 'inactive', label: 'Inactive', count: stats.inactive },
          { id: 'none', label: 'No membership', count: stats.none },
        ]} />
      </div>

      {rows.length === 0 && <EmptyState>{q ? `No people match “${query.trim()}”.` : 'No people in this view.'}</EmptyState>}
      <ul className="divide-y divide-gray-100">
        {rows.slice(0, page.limit).map(p => {
          const active = activeAssignments(p)
          const granted = active.filter(isGranted).length
          const lifecycle = active.length - granted
          const temporary = active.filter(isTemporary).length
          const primary = (p.membership || []).find((m: any) => m.is_primary) || (p.membership || [])[0]
          const isOpen = open.has(p.id)
          return <li key={p.id}>
            <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_auto]">
              <ToggleButton open={isOpen} onClick={() => toggle(p.id)} label={`${p.full_name || p.email}, ${active.length} active role${active.length === 1 ? '' : 's'}`}>
                <UserRound className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">{p.full_name || p.email}</span>
                  <span className="block truncate text-xs text-gray-500">{p.email}</span>
                </span>
              </ToggleButton>
              <div className="min-w-0 pl-6 text-xs text-gray-600 md:pl-0">
                <div className="truncate">{primary ? String(orgName.get(primary.organization_id) || one(p.organization)?.org_name || 'Organization') : 'No business membership'}</div>
                <div className="text-gray-400" title="Legacy role code (compatibility input only)">Legacy role: {p.role_code || '—'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs md:pl-0">
                {!p.is_active && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Inactive</span>}
                <span className={granted ? 'rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700' : 'text-gray-400'}>{granted} granted</span>
                <span className="text-gray-500">{lifecycle} lifecycle</span>
                {temporary > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><Clock className="h-3 w-3" aria-hidden />{temporary} temporary</span>}
              </div>
              <div className="pl-6 md:pl-0 md:text-right">
                {p.id !== data.viewerId && (p.membership || []).some((m: any) => m.status === 'active') && (
                  <button type="button" onClick={() => startGrant(p.id)} className={`inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}>
                    <Plus className="h-3 w-3" aria-hidden />Grant role<span className="sr-only"> to {p.full_name || p.email}</span>
                  </button>
                )}
              </div>
            </div>
            {isOpen && <PersonDetail person={p} orgName={orgName} viewerId={data.viewerId} onRevoke={revoke} />}
          </li>
        })}
      </ul>
      <ShowMore shown={Math.min(page.limit, rows.length)} total={rows.length} onMore={page.more} />
    </section>
  </div>
}

function PersonDetail({ person: p, orgName, viewerId, onRevoke }: {
  person: any; orgName: Map<any, any>; viewerId: string; onRevoke: (id: string, label: string) => void
}) {
  const [showLifecycle, setShowLifecycle] = useState<Set<string>>(new Set())
  if (!(p.membership || []).length) {
    return <p className="bg-gray-50/60 px-4 py-3 pl-10 text-sm text-gray-500">No business membership (consumer or not yet onboarded).</p>
  }
  return <div className="space-y-3 bg-gray-50/60 px-4 py-3 pl-10">
    {(p.membership || []).map((m: any) => {
      const list: any[] = m.assignments || []
      const granted = list.filter(isGranted)
      const lifecycle = list.filter(a => !isGranted(a))
      const lifecycleOpen = showLifecycle.has(m.id)
      return <div key={m.id} className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {String(orgName.get(m.organization_id) || one(p.organization)?.org_name || 'Organization')} · {m.status}{m.is_primary ? ' · primary' : ''}
        </div>
        {list.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No role assignments.</p>}
        {granted.length > 0 && <AssignmentList title="Granted roles" list={granted} personId={p.id} viewerId={viewerId} onRevoke={onRevoke} />}
        {lifecycle.length > 0 && <div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <ToggleButton open={lifecycleOpen} onClick={() => setShowLifecycle(prev => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
              label={`Lifecycle roles, ${lifecycle.length}`}>
              <span className="text-sm font-medium text-gray-700">Lifecycle roles</span>
              <span className="text-xs text-gray-400">{lifecycle.length}</span>
            </ToggleButton>
            <span className="hidden text-xs text-gray-400 sm:inline">Derived from HR / User Management facts</span>
          </div>
          {lifecycleOpen && <AssignmentList list={lifecycle} personId={p.id} viewerId={viewerId} onRevoke={onRevoke} hideSource />}
        </div>}
      </div>
    })}
  </div>
}

function AssignmentList({ title, list, personId, viewerId, onRevoke, hideSource }: {
  title?: string; list: any[]; personId: string; viewerId: string; onRevoke: (id: string, label: string) => void; hideSource?: boolean
}) {
  return <div>
    {title && <div className="px-3 pt-2 text-xs font-medium text-gray-500">{title}</div>}
    <ul className="divide-y divide-gray-50">{list.map((a: any) => {
      const source = SOURCE_LABELS[a.source] ?? SOURCE_LABELS.manual
      const scopeNames = (a.scopes || []).map((s: any) => s.scope?.display_name).filter(Boolean).join(', ') || '—'
      const expired = a.effective_until && new Date(a.effective_until) <= new Date()
      const current = a.status === 'active' && !expired
      return <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={current ? 'font-medium text-gray-900' : 'text-gray-400 line-through'}>{a.role?.name || 'Role'}</span>
          {!hideSource && <span className={`rounded-full px-2 py-0.5 text-[11px] ${source.tone}`} title={source.help}>{source.label}</span>}
          <span className="text-xs text-gray-500">Scope: {scopeNames}</span>
          {a.effective_until && <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3 w-3" aria-hidden />{expired ? 'Expired' : 'Until'} {formatDate(a.effective_until)}</span>}
          {a.status !== 'active' && <span className="text-xs text-gray-400">{a.status}</span>}
        </div>
        {a.status === 'active' && personId !== viewerId && <button type="button" onClick={() => onRevoke(a.id, a.role?.name || 'this role')}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-700 ${FOCUS}`}>
          <ShieldOff className="h-3 w-3" aria-hidden />Revoke<span className="sr-only"> {a.role?.name || 'role'}</span></button>}
      </li>
    })}</ul>
  </div>
}
