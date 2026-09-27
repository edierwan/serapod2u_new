'use client'

import { useMemo } from 'react'
import { formatDate } from './client-api'
import { permissionLabel } from '@/lib/security-access/labels'

const ACTION_LABELS: Record<string, string> = {
  'assignment.granted': 'Access granted', 'assignment.revoked': 'Access revoked', 'assignment.derived': 'Lifecycle access derived',
  'legacy_authorization.locked': 'Legacy authorization locked',
  'access_request.submitted': 'Access requested', 'access_request.approved': 'Request approved', 'access_request.denied': 'Request denied',
  'access_request.cancelled': 'Request cancelled', 'access_request.expired': 'Request expired',
  'delegation.created': 'Delegation created', 'delegation.revoked': 'Delegation revoked',
  'access_review.created': 'Review started', 'access_review.completed': 'Review completed', 'access_review.retain': 'Review: retained',
  'access_review.revoke': 'Review: revoked', 'access_review.modify': 'Review: end date set',
  'lifecycle.joiner': 'Joiner', 'lifecycle.mover': 'Mover', 'lifecycle.leaver': 'Leaver',
  'migration_mode.changed': 'Migration mode changed', 'scope.defined': 'Scope defined', 'sod.mitigation_granted': 'SoD exception granted',
  'governance.maintenance': 'Expiry maintenance',
}

/** Append-only access change log and parity evidence. */
export default function AccessChangeLog({ governance, people, actors }: { governance: any | null; people: any[]; actors: any[] }) {
  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of [...people, ...actors]) map.set(p.id, p.full_name || p.email)
    return (id: string | null) => (id ? map.get(id) || 'Unknown user' : 'System')
  }, [people, actors])
  if (!governance) return null
  const parity: any[] = governance.shadowParity || []
  return <div className="space-y-6">
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h2 className="font-semibold">Parity evidence</h2>
        <p className="text-sm text-gray-500">Analytic check of every active business identity: legacy role definition vs Security & Access in the person's own organization. Observed shadow comparisons from the last 30 days follow.</p></div>
      <div className="grid gap-4 p-4 text-sm sm:grid-cols-3">
        <div><div className="text-2xl font-semibold">{governance.compatParity?.checked ?? 0}</div><div className="text-gray-500">identity × permission checks</div></div>
        <div><div className={`text-2xl font-semibold ${governance.compatParity?.legacyAllowNewDeny ? 'text-red-700' : ''}`}>{governance.compatParity?.legacyAllowNewDeny ?? 0}</div><div className="text-gray-500">legacy access missing in S&A</div></div>
        <div><div className="text-2xl font-semibold">{governance.compatParity?.legacyDenyNewAllow ?? 0}</div><div className="text-gray-500">explicit S&A grants beyond legacy</div></div>
      </div>
      <div className="max-h-72 divide-y overflow-auto border-t">{parity.map((p: any) => <div key={p.permission_key} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-xs">
        <span className="font-medium text-gray-800">{permissionLabel(p.permission_key).label}</span>
        <span className="text-gray-500">{p.total} decisions · {p.match_allow + p.match_deny} match · <span className={p.legacy_allow_new_deny ? 'text-amber-700' : ''}>{p.legacy_allow_new_deny} legacy-only</span> · {p.legacy_deny_new_allow} new-only · {p.other_mismatch} other</span>
      </div>)}{!parity.length && <div className="p-4 text-sm text-gray-500">No decisions recorded in the last 30 days.</div>}</div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b p-4"><h2 className="font-semibold">Access changes</h2><p className="text-sm text-gray-500">Append-only record of every grant, revocation, request, delegation, review, lifecycle event and mode change.</p></div>
      <div className="max-h-[480px] divide-y overflow-auto">{(governance.accessChanges || []).map((c: any) => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <div><span className="font-medium">{ACTION_LABELS[c.action] || c.action}</span>
          <span className="text-gray-500"> · {c.target_user_id ? `for ${nameOf(c.target_user_id)}` : c.entity_id && c.entity_type === 'sa_migration_mode' ? permissionLabel(c.entity_id).label : ''}</span>
          {c.reason && <div className="text-xs text-gray-500">“{c.reason}”</div>}</div>
        <div className="text-right text-xs text-gray-500">{nameOf(c.actor_id)}<div>{formatDate(c.occurred_at)}</div></div>
      </div>)}{!(governance.accessChanges || []).length && <div className="p-4 text-sm text-gray-500">No access changes recorded yet.</div>}</div>
    </section>
  </div>
}
