'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, GitBranch, KeyRound, Lock, Send, XCircle } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import { callApi, formatDate, toIso } from './client-api'
import { permissionLabel } from '@/lib/security-access/labels'

type Section = 'requests' | 'delegations' | 'reviews' | 'sod' | 'emergency'
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'requests', label: 'Access Requests' },
  { id: 'delegations', label: 'Delegations' },
  { id: 'reviews', label: 'Access Reviews' },
  { id: 'sod', label: 'Segregation of Duties' },
  { id: 'emergency', label: 'Emergency Access' },
]

const STATUS_TONE: Record<string, string> = {
  requested: 'bg-blue-50 text-blue-700', approved: 'bg-emerald-50 text-emerald-700', denied: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600', expired: 'bg-gray-100 text-gray-600', active: 'bg-emerald-50 text-emerald-700',
  revoked: 'bg-gray-100 text-gray-600', completed: 'bg-emerald-50 text-emerald-700', pending: 'bg-blue-50 text-blue-700',
  retain: 'bg-emerald-50 text-emerald-700', revoke: 'bg-red-50 text-red-700', modify: 'bg-amber-50 text-amber-800',
  enforce: 'bg-red-50 text-red-700', monitor: 'bg-amber-50 text-amber-800',
}
const Pill = ({ value }: { value: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[value] || 'bg-gray-100 text-gray-600'}`}>{value.replace(/_/g, ' ')}</span>

interface Props {
  data: any
  governance: any | null
}

/**
 * Governance: access requests (no self-approval; access granted only when
 * approved), scoped non-transitive delegations, access review campaigns (no
 * self-certification), segregation of duties, and emergency access status.
 */
export default function GovernancePanel({ data, governance }: Props) {
  const [section, setSection] = useState<Section>('requests')
  const people: any[] = data.people || []
  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of [...people, ...(data.actors || [])]) map.set(p.id, p.full_name || p.email)
    return (id: string | null | undefined) => (id ? map.get(id) || 'Unknown user' : '—')
  }, [people, data.actors])
  const orgName = useMemo(() => new Map((data.organizations || []).map((o: any) => [o.id, o.org_name])), [data.organizations])
  const roleName = useMemo(() => new Map((data.roles || []).map((r: any) => [r.id, r.name])), [data.roles])

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">{SECTIONS.map(s => <button key={s.id} onClick={() => setSection(s.id)}
      className={`rounded-full px-3 py-1.5 text-sm ${section === s.id ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{s.label}</button>)}</div>
    {section === 'requests' && <AccessRequests data={data} nameOf={nameOf} orgName={orgName} roleName={roleName} />}
    {section === 'delegations' && <Delegations data={data} nameOf={nameOf} orgName={orgName} />}
    {section === 'reviews' && <Reviews data={data} nameOf={nameOf} orgName={orgName} roleName={roleName} />}
    {section === 'sod' && <SegregationOfDuties nameOf={nameOf} />}
    {section === 'emergency' && <EmergencyAccess governance={governance} />}
  </div>
}

function useList(url: string) {
  const [state, setState] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const result = await callApi(url)
    if (result.ok) { setState(result.data); setError(null) } else setError(result.error || 'Unable to load')
  }, [url])
  useEffect(() => { reload() }, [reload])
  return { state, error, reload }
}

function Feedback({ message }: { message: { tone: 'ok' | 'error'; text: string } | null }) {
  if (!message) return null
  return <div className={`rounded-lg p-3 text-sm ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>
}

function AccessRequests({ data, nameOf, orgName, roleName }: any) {
  const { state, error, reload } = useList('/api/security-access/access-requests')
  const [form, setForm] = useState({ targetUserId: '', roleId: '', organizationId: '', scopeId: '', until: '', reason: '' })
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const roles = (data.roles || []).filter((r: any) => r.source !== 'legacy' && r.status === 'active')
  const target = (data.people || []).find((p: any) => p.id === (form.targetUserId || data.viewerId))
  const memberships = (target?.membership || []).filter((m: any) => m.status === 'active')
  const scopeOptions = (data.scopeDefinitions || []).filter((s: any) => s.organization_id === form.organizationId && s.scope_type !== 'own_record')
    .map((s: any) => ({ value: s.id, label: s.display_name, description: s.scope_type.replace(/_/g, ' ') }))

  async function submit() {
    const result = await callApi('/api/security-access/access-requests', { body: {
      action: 'submit', targetUserId: form.targetUserId || undefined, roleId: form.roleId, organizationId: form.organizationId,
      scopeIds: form.scopeId ? [form.scopeId] : [], effectiveUntil: toIso(form.until), reason: form.reason,
    } })
    setMessage(result.ok ? { tone: 'ok', text: 'Request submitted. Nothing is granted until it is approved.' } : { tone: 'error', text: result.error || 'Unable to submit' })
    if (result.ok) { setForm({ targetUserId: '', roleId: '', organizationId: '', scopeId: '', until: '', reason: '' }); reload() }
  }
  async function act(body: any, ok: string) {
    const result = await callApi('/api/security-access/access-requests', { body })
    setMessage(result.ok ? { tone: 'ok', text: ok } : { tone: 'error', text: result.error || 'Unable to complete' })
    if (result.ok) reload()
  }

  return <div className="space-y-4">
    <Feedback message={message} />
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="font-semibold">Request access</h3>
        <p className="text-sm text-gray-500">Request a business role for yourself or a colleague. Temporary requests must end; the requester and the person receiving access cannot approve.</p></div>
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <SearchableSelect label="For" value={form.targetUserId} onChange={v => setForm({ ...form, targetUserId: v, organizationId: '', scopeId: '' })}
          options={(data.people || []).map((p: any) => ({ value: p.id, label: p.id === data.viewerId ? `${p.full_name || p.email} (me)` : p.full_name || p.email }))} placeholder="Myself" allowClear />
        <SearchableSelect label="Business role" value={form.roleId} onChange={v => setForm({ ...form, roleId: v })} options={roles.map((r: any) => ({ value: r.id, label: r.name }))} />
        <SearchableSelect label="Membership organization" value={form.organizationId} onChange={v => setForm({ ...form, organizationId: v, scopeId: '' })}
          options={memberships.map((m: any) => ({ value: m.organization_id, label: String(orgName.get(m.organization_id) || 'Organization') }))} />
        <SearchableSelect label="Scope" value={form.scopeId} onChange={v => setForm({ ...form, scopeId: v })} options={scopeOptions} disabled={!form.organizationId} />
        <label className="text-sm"><span className="text-gray-600">Ends (temporary access)</span>
          <input type="datetime-local" value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label className="text-sm"><span className="text-gray-600">Business justification</span>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <div className="border-t p-4"><button onClick={submit} disabled={!form.roleId || !form.organizationId || !form.scopeId || form.reason.trim().length < 10}
        className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><Send className="h-4 w-4" />Submit request</button></div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="font-semibold">{state?.canApprove ? 'All access requests' : 'My access requests'}</h3></div>
      {error && <div className="p-4 text-sm text-red-700">{error}</div>}
      <div className="divide-y">{(state?.requests || []).map((r: any) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <div className="font-medium">{roleName.get(r.role_id) || 'Role'} for {nameOf(r.target_user_id)}</div>
          <div className="text-xs text-gray-500">{orgName.get(r.organization_id) || 'Organization'} · requested by {nameOf(r.requester_id)} · {formatDate(r.created_at)}{r.effective_until ? ` · until ${formatDate(r.effective_until)}` : ''}</div>
          <div className="mt-1 text-xs text-gray-600">“{r.reason}”</div>
          {r.approver_id && <div className="text-xs text-gray-500">Decided by {nameOf(r.approver_id)} {r.decision_reason ? `— ${r.decision_reason}` : ''}</div>}
        </div>
        <div className="flex items-center gap-2"><Pill value={r.status} />
          {r.status === 'requested' && state?.canApprove && r.requester_id !== data.viewerId && r.target_user_id !== data.viewerId && <>
            <button onClick={() => act({ action: 'decide', requestId: r.id, approve: true }, 'Approved; access granted.')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white"><CheckCircle2 className="h-3 w-3" />Approve</button>
            <button onClick={() => { const reason = window.prompt('Reason for denial?') || ''; act({ action: 'decide', requestId: r.id, approve: false, reason }, 'Denied; nothing was granted.') }} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><XCircle className="h-3 w-3" />Deny</button></>}
          {r.status === 'requested' && r.requester_id === data.viewerId && <button onClick={() => act({ action: 'cancel', requestId: r.id }, 'Request cancelled.')} className="rounded-md border px-2 py-1 text-xs">Cancel</button>}
        </div>
      </div>)}
        {state && !(state.requests || []).length && <div className="p-4 text-sm text-gray-500">No access requests.</div>}</div>
    </section>
  </div>
}

function Delegations({ data, nameOf, orgName }: any) {
  const { state, error, reload } = useList('/api/security-access/delegations')
  const [form, setForm] = useState({ delegateId: '', organizationId: data.viewerOrganizationId || '', permission: '', until: '', reason: '' })
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  async function create() {
    const result = await callApi('/api/security-access/delegations', { body: {
      action: 'create', delegateId: form.delegateId, organizationId: form.organizationId, permissionKeys: [form.permission],
      effectiveUntil: toIso(form.until), reason: form.reason,
    } })
    setMessage(result.ok ? { tone: 'ok', text: 'Delegation created.' } : { tone: 'error', text: result.error || 'Unable to delegate' })
    if (result.ok) reload()
  }
  async function revoke(id: string) {
    const reason = window.prompt('Reason for revoking this delegation?')
    if (!reason || reason.trim().length < 5) return
    const result = await callApi('/api/security-access/delegations', { body: { action: 'revoke', delegationId: id, reason } })
    setMessage(result.ok ? { tone: 'ok', text: 'Delegation revoked.' } : { tone: 'error', text: result.error || 'Unable to revoke' })
    if (result.ok) reload()
  }
  return <div className="space-y-4">
    <Feedback message={message} />
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="flex items-center gap-2 font-semibold"><GitBranch className="h-4 w-4" />Delegate one of your permissions</h3>
        <p className="text-sm text-gray-500">Scoped and time-boxed. A delegate can never exceed what you currently hold, and cannot delegate onward.</p></div>
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <SearchableSelect label="Delegate" value={form.delegateId} onChange={v => setForm({ ...form, delegateId: v })}
          options={(data.people || []).filter((p: any) => p.id !== data.viewerId).map((p: any) => ({ value: p.id, label: p.full_name || p.email }))} />
        <SearchableSelect label="Organization" value={form.organizationId} onChange={v => setForm({ ...form, organizationId: v })}
          options={(data.organizations || []).map((o: any) => ({ value: o.id, label: o.org_name }))} />
        <SearchableSelect label="Permission" value={form.permission} onChange={v => setForm({ ...form, permission: v })}
          options={(data.permissions || []).filter((p: any) => !p.permission_key.startsWith('security.')).map((p: any) => ({ value: p.permission_key, label: permissionLabel(p.permission_key).label, group: permissionLabel(p.permission_key).group }))} />
        <label className="text-sm"><span className="text-gray-600">Ends</span>
          <input type="datetime-local" value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label className="text-sm md:col-span-2"><span className="text-gray-600">Reason</span>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <div className="border-t p-4"><button onClick={create} disabled={!form.delegateId || !form.organizationId || !form.permission || !form.until || form.reason.trim().length < 5}
        className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Create delegation</button></div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="font-semibold">{state?.canManage ? 'All delegations' : 'My delegations'}</h3></div>
      {error && <div className="p-4 text-sm text-red-700">{error}</div>}
      <div className="divide-y">{(state?.delegations || []).map((d: any) => <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div><div className="font-medium">{nameOf(d.delegator_id)} → {nameOf(d.delegate_id)}</div>
          <div className="text-xs text-gray-500">{(d.permission_keys || []).map((k: string) => permissionLabel(k).label).join(', ')} · {orgName.get(d.organization_id) || 'Organization'} · until {formatDate(d.effective_until)}</div>
          <div className="text-xs text-gray-600">“{d.reason}”</div></div>
        <div className="flex items-center gap-2"><Pill value={d.status} />
          {d.status === 'active' && <button onClick={() => revoke(d.id)} className="rounded-md border px-2 py-1 text-xs">Revoke</button>}</div>
      </div>)}
        {state && !(state.delegations || []).length && <div className="p-4 text-sm text-gray-500">No delegations.</div>}</div>
    </section>
  </div>
}

function Reviews({ data, nameOf, orgName, roleName }: any) {
  const { state, error, reload } = useList('/api/security-access/reviews')
  const [form, setForm] = useState({ name: '', organizationId: '', roleId: '', reviewerId: '', due: '' })
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  async function post(body: any, ok: string) {
    const result = await callApi('/api/security-access/reviews', { body })
    setMessage(result.ok ? { tone: 'ok', text: ok } : { tone: 'error', text: result.error || 'Unable to complete' })
    if (result.ok) reload()
  }
  const itemsByCampaign = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const i of state?.items || []) map.set(i.campaign_id, [...(map.get(i.campaign_id) || []), i])
    return map
  }, [state])
  return <div className="space-y-4">
    <Feedback message={message} />
    {state?.canManage && <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4" />Start an access review</h3>
        <p className="text-sm text-gray-500">Snapshots current assignments for certification. Reviewers retain, revoke or shorten access; nobody certifies their own access.</p></div>
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <label className="text-sm"><span className="text-gray-600">Name</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <SearchableSelect label="Organization (optional)" value={form.organizationId} onChange={v => setForm({ ...form, organizationId: v })} options={(data.organizations || []).map((o: any) => ({ value: o.id, label: o.org_name }))} allowClear />
        <SearchableSelect label="Role (optional)" value={form.roleId} onChange={v => setForm({ ...form, roleId: v })} options={(data.roles || []).map((r: any) => ({ value: r.id, label: r.name }))} allowClear />
        <SearchableSelect label="Reviewer" value={form.reviewerId} onChange={v => setForm({ ...form, reviewerId: v })} options={(data.people || []).map((p: any) => ({ value: p.id, label: p.full_name || p.email }))} />
        <label className="text-sm"><span className="text-gray-600">Due</span><input type="datetime-local" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <div className="border-t p-4"><button onClick={() => post({ action: 'create', name: form.name, organizationId: form.organizationId || null, roleId: form.roleId || null, reviewerId: form.reviewerId, dueAt: toIso(form.due) }, 'Review started.')}
        disabled={form.name.trim().length < 3 || !form.reviewerId} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Start review</button></div>
    </section>}
    {error && <div className="p-4 text-sm text-red-700">{error}</div>}
    {(state?.campaigns || []).map((c: any) => {
      const items = itemsByCampaign.get(c.id) || []
      const pending = items.filter((i: any) => i.decision === 'pending').length
      return <section key={c.id} className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div><h3 className="font-semibold">{c.name}</h3>
            <p className="text-xs text-gray-500">Reviewer {nameOf(c.reviewer_id)} · {items.length} items · {pending} pending{c.due_at ? ` · due ${formatDate(c.due_at)}` : ''}</p></div>
          <div className="flex items-center gap-2"><Pill value={c.status} />
            {c.status === 'active' && pending === 0 && <button onClick={() => post({ action: 'complete', campaignId: c.id }, 'Review completed.')} className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white">Complete</button>}</div>
        </div>
        <div className="divide-y">{items.map((i: any) => <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div><div className="font-medium">{nameOf(i.user_id)} — {i.snapshot?.role_name || roleName.get(i.role_id)}</div>
            <div className="text-xs text-gray-500">{orgName.get(i.snapshot?.organization_id) || ''} · {(i.snapshot?.scopes || []).map((s: any) => s.name).join(', ')}</div></div>
          <div className="flex items-center gap-2"><Pill value={i.decision} />
            {c.status === 'active' && i.decision === 'pending' && i.user_id !== data.viewerId && <>
              <button onClick={() => post({ action: 'decide', itemId: i.id, decision: 'retain' }, 'Retained.')} className="rounded-md border px-2 py-1 text-xs">Retain</button>
              <button onClick={() => { const reason = window.prompt('Reason for revoking?') || ''; post({ action: 'decide', itemId: i.id, decision: 'revoke', reason }, 'Revoked.') }} className="rounded-md border px-2 py-1 text-xs text-red-700">Revoke</button>
              <button onClick={() => { const until = window.prompt('New end date (YYYY-MM-DD)?'); const reason = window.prompt('Reason?') || ''; const iso = until ? toIso(`${until}T23:59`) : null; if (iso) post({ action: 'decide', itemId: i.id, decision: 'modify', reason, newEffectiveUntil: iso }, 'End date set.') }} className="rounded-md border px-2 py-1 text-xs">Set end date</button></>}
          </div>
        </div>)}</div>
      </section>
    })}
    {state && !(state.campaigns || []).length && <div className="rounded-xl border bg-white p-4 text-sm text-gray-500">No access review campaigns.</div>}
  </div>
}

function SegregationOfDuties({ nameOf }: any) {
  const { state, error } = useList('/api/security-access/sod')
  const ruleName = useMemo(() => new Map((state?.rules || []).map((r: any) => [r.id, r.name])), [state])
  return <div className="space-y-4">
    {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="font-semibold">Rules</h3>
        <p className="text-sm text-gray-500">Enforced rules block the conflicting step; monitored rules record the conflict for review without changing workflow authority. Only rules backed by documented business practice are enforced.</p></div>
      <div className="divide-y">{(state?.rules || []).map((r: any) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div><div className="font-medium">{r.name}</div><div className="text-xs text-gray-500">{r.description}</div>
          <div className="text-xs text-gray-400">{r.rule_kind.replace(/_/g, ' ')}{r.document_type ? ` · ${r.document_type.replace(/_/g, ' ')}` : ''}</div></div>
        <div className="flex gap-2"><Pill value={r.enforcement} /><Pill value={r.status} /></div>
      </div>)}</div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h3 className="font-semibold">Recent conflicts</h3></div>
      <div className="divide-y">{(state?.violations || []).map((v: any) => <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div><div className="font-medium">{String(ruleName.get(v.rule_id) || 'Rule')}</div>
          <div className="text-xs text-gray-500">{nameOf(v.user_id)} · {v.document_type ? `${v.document_type.replace(/_/g, ' ')} ` : ''}{formatDate(v.detected_at)}</div></div>
        <Pill value={v.outcome.replace('allowed_', '')} />
      </div>)}
        {state && !(state.violations || []).length && <div className="p-4 text-sm text-gray-500">No conflicts recorded.</div>}</div>
    </section>
  </div>
}

function EmergencyAccess({ governance }: { governance: any }) {
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
    <div className="flex items-start gap-3"><Lock className="mt-0.5 h-5 w-5 text-amber-700" />
      <div className="space-y-2 text-sm text-amber-900">
        <h3 className="font-semibold">Emergency access is not available</h3>
        <p>{governance?.emergencyAccess?.prerequisite || 'Multi-factor step-up authentication is required before emergency access can be enabled.'}</p>
        <p className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Break-glass access stays separate from Super Admin and, once enabled, will require a reason, a narrow scope, a short expiry, privileged-action logging and a post-use review.</p>
        <p className="flex items-center gap-2"><KeyRound className="h-4 w-4" />The database refuses to enable it while the prerequisite is unmet.</p>
      </div></div>
  </section>
}
