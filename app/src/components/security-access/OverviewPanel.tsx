'use client'

import { useMemo } from 'react'
import { Activity, AlertTriangle, ArrowRight, UserRoundCog, UsersRound } from 'lucide-react'
import { aggregateRollout, summarizeDifferences, type ModeRow } from '@/lib/security-access/rollout'
import PermissionTree from './PermissionTree'
import { FOCUS } from './ui'

/** The Overview API loads the latest 100 non-matching decisions (overview/route.ts). */
export const DIFFERENCE_SAMPLE_LIMIT = 100

export type OverviewTarget =
  | { tab: 'people' }
  | { tab: 'audit'; differencesOnly: boolean }
  | { tab: 'roles'; query: string }

interface Props {
  data: any
  onNavigate: (target: OverviewTarget) => void
}

const fmtDate = (value: string | null) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function periodText(from: string | null, to: string | null) {
  const a = fmtDate(from)
  const b = fmtDate(to)
  if (!a || !b) return null
  return a === b ? a : `${a} – ${b}`
}

function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 rounded text-sm font-medium text-orange-600 hover:text-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
      {children}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

function SummaryCard({ icon: Icon, title, value, caption, action }: {
  icon: any; title: string; value: number | null; caption: React.ReactNode; action: React.ReactNode
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
        <Icon className="h-4 w-4 text-orange-500" aria-hidden />{title}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-3xl font-semibold leading-none text-gray-950">{value ?? '—'}</div>
          <div className="mt-1.5 text-xs text-gray-500">{caption}</div>
        </div>
        {action}
      </div>
    </div>
  )
}

export default function OverviewPanel({ data, onNavigate }: Props) {
  const modes: ModeRow[] = data?.modes || []
  const rollout = useMemo(() => aggregateRollout(modes), [modes])
  const diffs = useMemo(
    () => summarizeDifferences(data?.decisions || [], modes, DIFFERENCE_SAMPLE_LIMIT),
    [data, modes],
  )
  const period = periodText(diffs.from, diffs.to)
  const metrics = data?.metrics || {}
  const differenceCount = typeof metrics.shadowMismatches === 'number' ? metrics.shadowMismatches : diffs.count

  const sampleNote = diffs.capped ? ` · latest ${DIFFERENCE_SAMPLE_LIMIT} non-matching decisions` : ''
  const reviewDifferences = () => onNavigate({ tab: 'audit', differencesOnly: true })

  return (
    <div className="space-y-5">
      {/* 1. Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={UsersRound} title="Business identities"
          value={typeof metrics.businessIdentities === 'number' ? metrics.businessIdentities : null}
          caption="Active organization memberships"
          action={<LinkButton onClick={() => onNavigate({ tab: 'people' })}>View people</LinkButton>} />
        <SummaryCard icon={UserRoundCog} title="Role assignments"
          value={typeof metrics.activeAssignments === 'number' ? metrics.activeAssignments : null}
          caption="Active assignments"
          action={<LinkButton onClick={() => onNavigate({ tab: 'people' })}>View assignments</LinkButton>} />
        <SummaryCard icon={Activity} title="Access differences" value={differenceCount}
          caption={period ? <>Recorded {period}{sampleNote}</> : 'No differences recorded'}
          action={<LinkButton onClick={reviewDifferences}>Review differences</LinkButton>} />
      </div>

      {/* 2. Attention: only differences on permissions not yet enforced are actionable */}
      {diffs.pending > 0 ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <div className="text-sm font-semibold text-amber-900">Needs attention</div>
              <p className="text-sm text-amber-900/80">
                {diffs.pending} access difference{diffs.pending === 1 ? '' : 's'} recorded{period ? ` (${period})` : ''} for {diffs.pendingPermissions.length} permission{diffs.pendingPermissions.length === 1 ? '' : 's'} still in Monitoring. Review them before enabling those permissions.
              </p>
            </div>
          </div>
          <button type="button" onClick={reviewDifferences}
            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
            Review differences<ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : diffs.count > 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-600">
          Access differences recorded{period ? ` (${period})` : ''}: {diffs.count}. All are on permissions where the new model already decides; nothing is waiting for review before enabling.
        </p>
      ) : null}

      {/* 3. Rollout by module: Main group → Subgroup → Permission */}
      <PermissionTree
        rollout={rollout}
        title="Access rollout by module"
        description="Permissions per authorization mode. Open a group for its areas and permissions; change modes in Roles & Policies."
        renderDetails={p => (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
            <span className="text-gray-500" title="Readiness: every operation path is wired to the new model, so the permission can be enabled. Separate from the current mode.">
              {p.enforcementReady ? 'Ready to enable' : 'Not marked ready'}
            </span>
            {diffs.byPermission[p.key] ? (
              <span className="text-amber-700">{diffs.byPermission[p.key]} difference{diffs.byPermission[p.key] === 1 ? '' : 's'}</span>
            ) : null}
            <button type="button" onClick={() => onNavigate({ tab: 'roles', query: p.key })}
              className={`rounded font-medium text-orange-600 hover:text-orange-700 ${FOCUS}`}>
              Change mode<span className="sr-only"> for {p.label}</span>
            </button>
          </div>
        )}
      />

      {/* Retention diagnostics stay available but out of the way. */}
      {data?.retention && (
        <details className="rounded-xl border border-gray-200 bg-white text-sm">
          <summary className="cursor-pointer px-4 py-2.5 font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Decision log retention</summary>
          <div className="space-y-3 border-t border-gray-100 p-4">
            <p className="text-gray-500">Ordinary monitoring decisions are kept {data.retention.retention_days} days. Enforced, security-sensitive, policy-error and pre-classification decisions are never purged automatically.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><span className="text-gray-500">Oldest ordinary decision</span><div>{data.retention.oldest_ordinary_shadow ? new Date(data.retention.oldest_ordinary_shadow).toLocaleString() : '—'}</div></div>
              <div><span className="text-gray-500">Eligible for purge now</span><div>{data.retention.eligible_for_purge}</div></div>
              <div><span className="text-gray-500">Last retention run</span><div>{data.retention.last_run ? `${new Date(data.retention.last_run.run_at).toLocaleString()} · ${data.retention.last_run.deleted_count} removed` : 'Not run yet'}</div></div>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}
