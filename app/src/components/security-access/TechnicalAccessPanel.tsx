'use client'

import { Bot, History, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { formatDate } from './client-api'
import { Collapsible, EmptyState, FilterChips, ToggleButton } from './ui'

const KIND_LABELS: Record<string, string> = {
  application_server: 'Application server', cron_worker: 'Scheduled worker', queue_worker: 'Queue worker',
  integration: 'Integration', webhook: 'Webhook', agent: 'Agent API',
}

/**
 * Technical Access: non-human service identities. Metadata only — the
 * credential is shown by environment variable NAME with a configured/missing
 * flag; secret values are never read into the UI or logs.
 */
export default function TechnicalAccessPanel({ governance }: { governance: any | null }) {
  const identities: any[] = governance?.serviceIdentities || []
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'missing'>('all')
  if (!governance) return <div className="p-6 text-sm text-gray-500">Loading technical access…</div>
  const missing = identities.filter(s => s.credential_configured === false).length
  const rows = filter === 'missing' ? identities.filter(s => s.credential_configured === false) : identities
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
      <div className="min-w-0"><h2 className="flex items-center gap-2 font-semibold text-gray-950"><Bot className="h-4 w-4" aria-hidden />Service identities</h2>
        <p className="text-sm text-gray-500">Workers, integrations and webhooks are modelled separately from human administrators. Credentials are never displayed and are not rotated automatically.</p></div>
      <FilterChips label="Show" value={filter} onChange={setFilter} items={[
        { id: 'all', label: 'All', count: identities.length },
        { id: 'missing', label: 'Credential not configured here', count: missing },
      ]} />
    </div>
    {rows.length === 0 && <EmptyState>{filter === 'missing' ? 'Every service identity has its credential configured.' : 'No service identities registered.'}</EmptyState>}
    <ul className="divide-y divide-gray-100">{rows.map(s => {
      const isOpen = open.has(s.id)
      return <li key={s.id}>
        <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <ToggleButton open={isOpen} onClick={() => toggle(s.id)} label={s.name}>
            <span className="min-w-0"><span className="block truncate font-medium text-gray-900">{s.name}</span>
              <span className="block truncate text-xs text-gray-500">{KIND_LABELS[s.identity_kind] || s.identity_kind} · {s.owner_team}</span></span>
          </ToggleButton>
          <div className="pl-6 text-xs text-gray-500 md:pl-0">Last used: {formatDate(s.last_used_at)}</div>
          <div className="flex items-center gap-2 pl-6 text-xs md:pl-0">
            {s.credential_configured === true && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Configured</span>}
            {s.credential_configured === false && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Not configured here</span>}
            <span className="text-gray-500">{s.status}</span>
          </div>
        </div>
        {isOpen && <dl className="grid gap-3 bg-gray-50/60 px-4 py-3 pl-10 text-xs sm:grid-cols-3">
          <div className="sm:col-span-2"><dt className="text-gray-400">Purpose</dt><dd className="text-gray-700">{s.purpose}</dd>
            <dt className="mt-2 text-gray-400">Scope</dt><dd className="text-gray-700">{s.scope_description}</dd></div>
          <div><dt className="text-gray-400">Credential</dt>
            <dd className="flex items-center gap-1 text-gray-700"><KeyRound className="h-3 w-3" aria-hidden />{s.credential_type.replace(/_/g, ' ')}</dd>
            {s.credential_reference && <dd><code className="text-gray-500">{s.credential_reference}</code></dd>}</div>
        </dl>}
      </li>
    })}</ul>
  </section>
}

/**
 * Legacy compatibility (read-only): the legacy role levels and department
 * overrides that Settings → Authorization used to edit, shown with the
 * compatibility role each maps to. Nothing here is writable; enterprise
 * access is granted through business roles.
 */
export function LegacyCompatibilityPanel({ governance }: { governance: any | null }) {
  const legacy = governance?.legacyCompatibility
  if (!legacy) return null
  return <Collapsible title="Legacy compatibility" meta={`${legacy.roles.length} legacy roles · read-only`}>
    <div className="border-b p-4">
      <p className="flex items-start gap-2 text-sm text-gray-500"><History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>Legacy role levels are compatibility metadata only: they never make anyone staff and never override a Security &amp; Access decision.
        {legacy.readOnly
          ? ' Legacy authorization stores are read-only in this environment.'
          : ' Legacy authorization stores are still writable in this environment (Settings → Authorization); they become read-only at cutover.'}</span></p>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Legacy role</th><th className="px-4 py-2">Level</th><th className="px-4 py-2">Compatibility role</th><th className="px-4 py-2">Permissions</th><th className="px-4 py-2">Holders</th></tr>
        </thead>
        <tbody className="divide-y">
          {legacy.roles.map((r: any) => <tr key={r.roleCode} className={r.isActive ? '' : 'text-gray-400'}>
            <td className="px-4 py-2">{r.roleName || r.roleCode} <code className="text-xs text-gray-400">{r.roleCode}</code>{r.isActive ? null : <span className="ml-1 text-xs">(inactive)</span>}</td>
            <td className="px-4 py-2">{r.roleLevel}</td>
            <td className="px-4 py-2">{r.compatRoleKey ? <code className="text-xs">{r.compatRoleKey}</code> : <span className="text-gray-400">—</span>}</td>
            <td className="px-4 py-2">{r.compatPermissions}</td>
            <td className="px-4 py-2">{r.compatAssignments}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="border-t p-4 text-xs text-gray-500">Departments with legacy permission overrides: {legacy.departmentsWithOverrides}</div>
  </Collapsible>
}
