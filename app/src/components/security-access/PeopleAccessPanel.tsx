'use client'

import { useMemo, useState } from 'react'
import { Clock, Plus, ShieldOff, UserRound } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import { callApi, formatDate, one, toIso } from './client-api'
import { DisclosurePanel, EmptyState, FilterChips, FOCUS, SearchInput, ShowMore, ToggleButton, useLimit } from './ui'
import {
  CROSS_MODULE, MODULE_FILTER_OPTIONS, OTHER_MODULE, classifyRole, groupByModule, moduleGroupName, roleInModule, type RoleModules,
} from '@/lib/security-access/modules'

interface Props {
  data: any
  onChanged: () => void
}

type PersonFilter = 'all' | 'granted' | 'temporary' | 'inactive' | 'none'
type AccessKind = 'granted' | 'automatic' | 'legacy'

const AUTOMATIC_SOURCES = new Set(['backfill', 'derived'])
const EMPTY_FORM = { userId: '', organizationId: '', module: 'all', roleId: '', scopeId: '', until: '', reason: '' }

/** Where automatic access comes from (sa_role_assignments.source). */
const AUTOMATIC_SOURCE: Record<string, string> = {
  derived: 'Managed by HR / User Management',
  backfill: 'Set up from the legacy role during migration',
}

const activeAssignments = (p: any) => (p.membership || []).flatMap((m: any) => (m.assignments || []).filter((a: any) => a.status === 'active'))
const isTemporary = (a: any) => a.status === 'active' && !!a.effective_until
const isLegacyRole = (a: any) => one(a.role)?.source === 'legacy'
const accessKind = (a: any): AccessKind => (isLegacyRole(a) ? 'legacy' : AUTOMATIC_SOURCES.has(a.source) ? 'automatic' : 'granted')
const isGranted = (a: any) => accessKind(a) === 'granted'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * People & Access: person → organization membership → access. Each
 * membership separates explicitly Granted access, Automatic (lifecycle)
 * access and Legacy compatibility access; within each, roles are grouped by
 * the shared S&A module taxonomy (display only — never an authorization
 * boundary). Grant / revoke use the audited governance functions unchanged.
 */
export default function PeopleAccessPanel({ data, onChanged }: Props) {
  const people: any[] = data.people || []
  const allRoles: any[] = useMemo(() => data.roles || [], [data.roles])
  const grantableRoles: any[] = allRoles.filter((r: any) => r.source !== 'legacy' && r.status === 'active')
  const scopes: any[] = data.scopeDefinitions || []
  const orgName = useMemo(() => new Map((data.organizations || []).map((o: any) => [o.id, o.org_name])), [data.organizations])
  const roleModules = useMemo(() => new Map<string, RoleModules>(allRoles.map((r: any) => [r.id, classifyRole(r)])), [allRoles])
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

  // ── Grant flow: Person → Membership → Module filter → Role → Scope → Reason
  const eligibleMemberships = (userId: string): any[] =>
    ((people.find(p => p.id === userId)?.membership) || []).filter((m: any) => m.status === 'active')
  const memberships: any[] = form.userId ? eligibleMemberships(form.userId) : []
  const roleOptions = grantableRoles.filter(r => roleInModule(r, form.module, roleModules.get(r.id)))
  const scopeOptions = scopes.filter(s => !!form.organizationId && s.organization_id === form.organizationId && s.scope_type !== 'own_record')
  // Never submit a selection that is no longer offered (stale after a filter change).
  const roleValid = roleOptions.some(r => r.id === form.roleId)
  const scopeValid = scopeOptions.some(s => s.id === form.scopeId)
  const membershipValid = memberships.some(m => m.organization_id === form.organizationId)

  const pickPerson = (userId: string) => {
    const eligible = userId ? eligibleMemberships(userId) : []
    // Exactly one eligible membership is selected for you; never a default HQ.
    setForm({ ...EMPTY_FORM, userId, organizationId: eligible.length === 1 ? eligible[0].organization_id : '' })
  }
  const pickModule = (module: string) => setForm(f => ({
    ...f, module, roleId: grantableRoles.some(r => r.id === f.roleId && roleInModule(r, module, roleModules.get(r.id))) ? f.roleId : '',
  }))

  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const startGrant = (userId = '') => {
    pickPerson(userId)
    setMessage(null)
    setFormOpen(true)
    if (typeof window !== 'undefined') { try { window.scrollTo?.({ top: 0, behavior: 'smooth' }) } catch { /* not supported */ } }
  }

  async function grant() {
    if (!roleValid || !scopeValid || !membershipValid) return
    setBusy(true); setMessage(null)
    const result = await callApi('/api/security-access/assignments', { body: {
      action: 'grant', userId: form.userId, roleId: form.roleId, organizationId: form.organizationId,
      scopeIds: [form.scopeId], effectiveUntil: toIso(form.until), reason: form.reason,
    } })
    setBusy(false)
    if (!result.ok) { setMessage({ tone: 'error', text: result.error || 'Unable to grant access' }); return }
    setMessage({ tone: 'ok', text: 'Access granted and recorded in the access change log.' })
    setForm(EMPTY_FORM)
    setFormOpen(false)
    onChanged()
  }

  async function revoke(assignment: any) {
    const name = one(assignment.role)?.name || 'this role'
    const automatic = accessKind(assignment) !== 'granted'
    const reason = window.prompt(automatic
      ? `${name} is automatic access (${AUTOMATIC_SOURCE[assignment.source] ?? 'lifecycle'}). Revoking overrides the automatic rule for this person; it will not be re-added automatically. Reason for revoking?`
      : `Reason for revoking ${name}?`)
    if (!reason || reason.trim().length < 5) return
    const result = await callApi('/api/security-access/assignments', { body: { action: 'revoke', assignmentId: assignment.id, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Access revoked.' } : { tone: 'error', text: result.error || 'Unable to revoke' })
    if (result.ok) onChanged()
  }

  const selectedPerson = people.find(p => p.id === form.userId)
  const moduleSelect = [{ id: 'all', name: 'All modules' }, ...MODULE_FILTER_OPTIONS, CROSS_MODULE, OTHER_MODULE]
    .filter(m => m.id === 'all' || grantableRoles.some(r => roleInModule(r, m.id, roleModules.get(r.id))))

  return <div className="space-y-4">
    <DisclosurePanel title="Grant a business role" open={formOpen} onToggle={() => (formOpen ? setFormOpen(false) : startGrant())} actionLabel="Grant access"
      description="Access is granted to one organization membership and always carries a scope. Module only narrows the role list; it never grants module-wide access.">
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <SearchableSelect label="Person" value={form.userId} onChange={pickPerson}
          options={people.filter(p => p.id !== data.viewerId).map(p => ({ value: p.id, label: p.full_name || p.email, description: p.email, keywords: p.role_code }))} placeholder="Choose a person" />
        <div>
          <SearchableSelect label="Membership organization" value={form.organizationId} onChange={v => setForm({ ...form, organizationId: v, scopeId: '' })}
            options={memberships.map(m => ({ value: m.organization_id, label: String(orgName.get(m.organization_id) || 'Organization'), description: m.is_primary ? 'Primary membership' : m.membership_type }))}
            placeholder={!form.userId ? 'Choose a person first' : memberships.length ? 'Choose a membership' : 'No active membership'} disabled={!form.userId || memberships.length === 0} />
          {form.userId && memberships.length === 1 && <p className="mt-1 text-xs text-gray-500">Their only active membership — selected for you.</p>}
          {form.userId && memberships.length === 0 && <p role="alert" className="mt-1 text-xs text-amber-800">
            {selectedPerson?.full_name || 'This person'} has no active organization membership, so a business role cannot be granted. Memberships come from HR / User Management.</p>}
          {memberships.length > 1 && !form.organizationId && <p className="mt-1 text-xs text-gray-500">{memberships.length} active memberships — choose the one this access is for.</p>}
        </div>
        <label className="text-sm"><span className="text-gray-600">Module (filters the role list)</span>
          <select value={form.module} onChange={e => pickModule(e.target.value)} aria-label="Module filter"
            className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 ${FOCUS}`}>
            {moduleSelect.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></label>
        <SearchableSelect label="Business role" value={roleValid ? form.roleId : ''} onChange={v => setForm({ ...form, roleId: v })}
          options={roleOptions.map(r => {
            const cls = roleModules.get(r.id)
            const tags = cls?.crossModule ? cls.modules.map(moduleGroupName).join(', ') : (cls?.related || []).map(moduleGroupName).join(', ')
            return { value: r.id, label: r.name, description: [r.description, tags && `Also: ${tags}`].filter(Boolean).join(' · ') || undefined, group: cls ? moduleGroupName(cls.groupId) : undefined }
          })}
          placeholder={roleOptions.length ? 'Choose a role' : 'No roles in this module'} />
        <SearchableSelect label="Scope" value={scopeValid ? form.scopeId : ''} onChange={v => setForm({ ...form, scopeId: v })}
          options={scopeOptions.map(s => ({ value: s.id, label: s.display_name, description: s.scope_type.replace(/_/g, ' ') }))}
          placeholder={form.organizationId ? 'Choose a scope' : 'Choose a membership first'} disabled={!form.organizationId} />
        <label className="text-sm"><span className="text-gray-600">Ends (optional — temporary access)</span>
          <input type="datetime-local" value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label className="text-sm md:col-span-3"><span className="text-gray-600">Reason</span>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Why is this access needed?" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 p-4">
        <button disabled={busy || !form.userId || !membershipValid || !roleValid || !scopeValid || form.reason.trim().length < 5}
          onClick={grant} className={`inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${FOCUS}`}>
          <Plus className="h-4 w-4" aria-hidden />Grant access</button>
        <span className="text-xs text-gray-500">You cannot grant access to yourself. Scope, separation of duties and your own authority are checked when you submit.</span>
      </div>
    </DisclosurePanel>

    {message && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}

    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
        <div className="min-w-0"><h2 className="font-semibold text-gray-950">People and their access</h2>
          <p className="text-sm text-gray-500">Granted access is given by an administrator. Automatic access follows HR and User Management; leavers lose business access automatically.</p></div>
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
          const count = (k: AccessKind) => active.filter((a: any) => accessKind(a) === k).length
          const temporary = active.filter(isTemporary).length
          const primary = (p.membership || []).find((m: any) => m.is_primary) || (p.membership || [])[0]
          const isOpen = open.has(p.id)
          return <li key={p.id}>
            <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_auto]">
              <ToggleButton open={isOpen} onClick={() => toggle(p.id)} label={`${p.full_name || p.email}, ${active.length} active role${active.length === 1 ? '' : 's'}`}>
                <UserRound className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">{p.full_name || p.email}</span>
                  <span className="block truncate text-xs text-gray-500">{p.email}</span>
                </span>
              </ToggleButton>
              <div className="min-w-0 pl-6 text-xs text-gray-600 md:pl-0">
                <div className="truncate">{primary ? String(orgName.get(primary.organization_id) || one(p.organization)?.org_name || 'Organization') : 'No business membership'}
                  {(p.membership || []).length > 1 && <span className="text-gray-400"> +{(p.membership || []).length - 1} more</span>}</div>
                <div className="text-gray-400" title="Legacy role code (compatibility input only)">Legacy role: {p.role_code || '—'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs md:pl-0">
                {!p.is_active && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Inactive</span>}
                <span className={count('granted') ? 'rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700' : 'text-gray-400'}>{count('granted')} granted</span>
                <span className="text-gray-500">{count('automatic')} automatic</span>
                {count('legacy') > 0 && <span className="text-gray-400">{count('legacy')} legacy</span>}
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
            {isOpen && <PersonDetail person={p} orgName={orgName} roleModules={roleModules} canRevoke={p.id !== data.viewerId} onRevoke={revoke} />}
          </li>
        })}
      </ul>
      <ShowMore shown={Math.min(page.limit, rows.length)} total={rows.length} onMore={page.more} />
    </section>
  </div>
}

const SECTIONS: Array<{ kind: AccessKind; title: string; help: string }> = [
  { kind: 'granted', title: 'Granted access', help: 'Given by a Security & Access administrator or an approved request.' },
  { kind: 'automatic', title: 'Automatic access', help: 'Follows HR / User Management facts; added and removed by the lifecycle.' },
  { kind: 'legacy', title: 'Legacy access', help: 'Compatibility roles mirroring the legacy role code.' },
]

function PersonDetail({ person: p, orgName, roleModules, canRevoke, onRevoke }: {
  person: any; orgName: Map<any, any>; roleModules: Map<string, RoleModules>; canRevoke: boolean; onRevoke: (a: any) => void
}) {
  // Toggled ids; granted sections and their modules start open, the rest folded.
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const flip = (id: string) => setToggled(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  if (!(p.membership || []).length) {
    return <p className="bg-gray-50/60 px-4 py-3 pl-10 text-sm text-gray-500">No business membership (consumer or not yet onboarded).</p>
  }
  return <div className="space-y-3 bg-gray-50/60 px-4 py-3 md:pl-10">
    {(p.membership || []).map((m: any) => {
      const list: any[] = m.assignments || []
      return <div key={m.id} className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {String(orgName.get(m.organization_id) || one(p.organization)?.org_name || 'Organization')} · {m.status}{m.is_primary ? ' · primary' : ''}
        </div>
        {list.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No role assignments.</p>}
        {SECTIONS.map(section => {
          const items = list.filter(a => accessKind(a) === section.kind)
          if (!items.length) return null
          const sectionId = `${m.id}/${section.kind}`
          const startsOpen = section.kind === 'granted'
          const sectionOpen = startsOpen !== toggled.has(sectionId)
          const groups = groupByModule(items, a => roleModules.get(one(a.role)?.id)?.groupId ?? OTHER_MODULE.id)
          return <div key={section.kind} className="border-t border-gray-100 first:border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 px-3 py-2">
              <ToggleButton open={sectionOpen} onClick={() => flip(sectionId)} label={`${section.title}, ${items.length}`}>
                <span className="text-sm font-semibold text-gray-800">{section.title}</span>
                <span className="text-xs text-gray-400">{plural(items.length, 'role')} · {plural(groups.length, 'module')}</span>
              </ToggleButton>
              <span className="hidden text-xs text-gray-400 sm:inline">{section.help}</span>
            </div>
            {sectionOpen && <ul className="pb-1">{groups.map(g => {
              const gid = `${sectionId}/${g.id}`
              const gOpen = startsOpen !== toggled.has(gid)
              return <li key={g.id}>
                <div className="flex items-center gap-2 bg-gray-50/70 py-1.5 pl-8 pr-3">
                  <ToggleButton open={gOpen} onClick={() => flip(gid)} label={`${section.title}: ${g.name}, ${plural(g.items.length, 'role')}`}>
                    <span className="whitespace-nowrap text-sm font-medium text-gray-800">{g.name}</span>
                    <span className="text-xs text-gray-400">{g.items.length}</span>
                  </ToggleButton>
                  {!gOpen && <span className="hidden min-w-0 truncate text-xs text-gray-400 md:inline">{g.items.map(a => one(a.role)?.name).filter(Boolean).join(', ')}</span>}
                </div>
                {gOpen && <AssignmentList list={g.items} kind={section.kind} roleModules={roleModules} canRevoke={canRevoke} onRevoke={onRevoke} />}
              </li>
            })}</ul>}
          </div>
        })}
      </div>
    })}
  </div>
}

function AssignmentList({ list, kind, roleModules, canRevoke, onRevoke }: {
  list: any[]; kind: AccessKind; roleModules: Map<string, RoleModules>; canRevoke: boolean; onRevoke: (a: any) => void
}) {
  return <ul className="divide-y divide-gray-50">{list.map((a: any) => {
    const role = one(a.role)
    const cls = roleModules.get(role?.id)
    const scopeNames = (a.scopes || []).map((s: any) => one(s.scope)?.display_name).filter(Boolean).join(', ') || '—'
    const expired = a.effective_until && new Date(a.effective_until) <= new Date()
    const current = a.status === 'active' && !expired
    const tags = cls?.crossModule ? cls.modules : cls?.related || []
    return <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 pl-14 pr-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={current ? 'font-medium text-gray-900' : 'text-gray-400 line-through'}>{role?.name || 'Role'}</span>
        {tags.length > 0 && <span className="text-[11px] text-gray-400" title="Other modules this role's permissions touch">also {tags.map(moduleGroupName).join(', ')}</span>}
        <span className="text-xs text-gray-500">Scope: {scopeNames}</span>
        {a.source === 'access_request' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">Approved request</span>}
        {kind !== 'granted' && AUTOMATIC_SOURCE[a.source] && <span className="text-[11px] text-gray-400">{AUTOMATIC_SOURCE[a.source]}</span>}
        {a.effective_until && <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3 w-3" aria-hidden />{expired ? 'Expired' : 'Until'} {formatDate(a.effective_until)}</span>}
        {a.status !== 'active' && <span className="text-xs text-gray-400">{a.status}</span>}
      </div>
      {a.status === 'active' && canRevoke && <button type="button" onClick={() => onRevoke(a)}
        title={kind === 'granted' ? undefined : 'Overrides the automatic rule for this person'}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-700 ${FOCUS}`}>
        <ShieldOff className="h-3 w-3" aria-hidden />Revoke<span className="sr-only"> {role?.name || 'role'}</span></button>}
    </li>
  })}</ul>
}
