'use client'

import { Bot, History, KeyRound } from 'lucide-react'
import { formatDate } from './client-api'

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
  if (!governance) return <div className="p-6 text-sm text-gray-500">Loading technical access…</div>
  return <section className="rounded-xl border border-gray-200 bg-white">
    <div className="border-b p-4"><h2 className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4" />Service identities</h2>
      <p className="text-sm text-gray-500">Workers, integrations and webhooks are modelled separately from human administrators. Credentials are never displayed and are not rotated automatically.</p></div>
    <div className="divide-y">{identities.map(s => <div key={s.id} className="grid gap-2 p-4 text-sm md:grid-cols-4">
      <div><div className="font-medium">{s.name}</div><div className="text-xs text-gray-500">{KIND_LABELS[s.identity_kind] || s.identity_kind} · {s.owner_team}</div></div>
      <div className="text-xs text-gray-600 md:col-span-2">{s.purpose}<div className="text-gray-400">Scope: {s.scope_description}</div></div>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1"><KeyRound className="h-3 w-3" />{s.credential_type.replace(/_/g, ' ')}{s.credential_reference ? <code className="ml-1 text-gray-500">{s.credential_reference}</code> : null}</div>
        {s.credential_configured === true && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Configured</span>}
        {s.credential_configured === false && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Not configured here</span>}
        <div className="text-gray-500">Last used: {formatDate(s.last_used_at)}</div>
        <div className="text-gray-500">Status: {s.status}</div>
      </div>
    </div>)}</div>
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
  return <section className="rounded-xl border border-gray-200 bg-white">
    <div className="border-b p-4">
      <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" />Legacy compatibility</h2>
      <p className="text-sm text-gray-500">Legacy role levels are compatibility metadata only: they never make anyone staff and never override a Security &amp; Access decision.
        {legacy.readOnly
          ? ' Legacy authorization stores are read-only in this environment.'
          : ' Legacy authorization stores are still writable in this environment (Settings → Authorization); they become read-only at cutover.'}</p>
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
  </section>
}
