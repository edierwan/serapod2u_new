'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Briefcase, ChevronDown, ChevronRight, HelpCircle, HeartHandshake,
  Landmark, Search, ShieldCheck, Truck, UserRoundCog, UsersRound,
} from 'lucide-react'
import {
  aggregateRollout, filterRollout, rolloutMode, summarizeDifferences,
  type ModeRow, type RolloutNode, type RolloutPermission,
} from '@/lib/security-access/rollout'

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

function ModeStatus({ mode, short }: { mode: string; short?: boolean }) {
  const m = rolloutMode(mode)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${m.text}`} title={m.help}>
      <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden />{short ? m.shortLabel : m.label}
    </span>
  )
}

const GROUP_ICONS: Record<string, any> = {
  supply_chain: Truck, customer_growth: HeartHandshake, hr_payroll: Briefcase,
  finance: Landmark, platform_security: ShieldCheck, reporting: BarChart3,
}

function ToggleButton({ open, onClick, label, children }: { open: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`${label}, ${open ? 'collapse' : 'expand'}`}
      className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />}
      {children}
    </button>
  )
}

function CountCells({ node, columns, strong }: { node: RolloutNode; columns: string[]; strong?: boolean }) {
  return <>{columns.map(mode => (
    <td key={mode} className={`px-3 py-1.5 text-right tabular-nums ${node.counts[mode] ? `${strong ? 'font-semibold' : 'font-medium'} ${rolloutMode(mode).text}` : 'text-gray-300'}`}>
      {node.counts[mode] ?? 0}
    </td>
  ))}</>
}

function PermissionRow({ p, indent, columns, diffs, onNavigate }: {
  p: RolloutPermission; indent: string; columns: string[]; diffs?: number; onNavigate: (t: OverviewTarget) => void
}) {
  return (
    <tr className="border-t border-gray-50">
      <th scope="row" className={`py-1.5 pr-4 text-left font-normal ${indent}`}>
        <div className="text-sm text-gray-900">{p.label}</div>
        <code className="text-[11px] text-gray-400">{p.key}</code>
      </th>
      {columns.map(mode => (
        <td key={mode} className="px-3 py-1.5 text-right">
          {p.mode === mode ? <ModeStatus mode={mode} short /> : <span className="sr-only">no</span>}
        </td>
      ))}
      <td className="px-4 py-1.5 text-right text-xs">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
          <span className="text-gray-500" title="Readiness: every operation path is wired to the new model, so the permission can be enabled. Separate from the current mode.">
            {p.enforcementReady ? 'Ready to enable' : 'Not marked ready'}
          </span>
          {diffs ? <span className="text-amber-700">{diffs} difference{diffs === 1 ? '' : 's'}</span> : null}
          <button type="button" onClick={() => onNavigate({ tab: 'roles', query: p.key })}
            className="rounded font-medium text-orange-600 hover:text-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
            Change mode<span className="sr-only"> for {p.label}</span>
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function OverviewPanel({ data, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  // Expansion outside search, and a separate one while searching, so clearing
  // the search restores what was open before.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = useState<Set<string>>(new Set())

  const modes: ModeRow[] = data?.modes || []
  const rollout = useMemo(() => aggregateRollout(modes), [modes])
  const filtered = useMemo(() => filterRollout(rollout, query), [rollout, query])
  const searching = query.trim().length > 0
  const view = filtered.rollout
  useEffect(() => { setSearchOpen(new Set(filtered.autoOpen)) }, [filtered])
  const expanded = searching ? searchOpen : open
  const diffs = useMemo(
    () => summarizeDifferences(data?.decisions || [], modes, DIFFERENCE_SAMPLE_LIMIT),
    [data, modes],
  )
  const period = periodText(diffs.from, diffs.to)
  const metrics = data?.metrics || {}
  const differenceCount = typeof metrics.shadowMismatches === 'number' ? metrics.shadowMismatches : diffs.count

  const toggle = (id: string) => (searching ? setSearchOpen : setOpen)(prev => {
    const next = new Set(prev)
    if (next.has(id)) {
      // Closing a group also closes its subgroups.
      for (const key of Array.from(next)) if (key === id || key.startsWith(`${id}/`)) next.delete(key)
    } else next.add(id)
    return next
  })
  const collapseAll = () => (searching ? setSearchOpen : setOpen)(new Set())

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
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm" aria-labelledby="rollout-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
          <div>
            <h2 id="rollout-heading" className="font-semibold text-gray-950">Access rollout by module</h2>
            <p className="text-sm text-gray-500">Permissions per authorization mode. Open a group for its areas and permissions; change modes in Roles &amp; Policies.</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <span className="sr-only">Search modules or permissions</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search modules"
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-9 pr-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" />
            </label>
            <button type="button" onClick={collapseAll} disabled={expanded.size === 0}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-default disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              Collapse all
            </button>
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs text-gray-500">
          {view.columns.map(mode => (
            <div key={mode} className="flex items-baseline gap-1.5">
              <dt className="shrink-0 whitespace-nowrap"><ModeStatus mode={mode} /></dt>
              <dd>{rolloutMode(mode).help}</dd>
            </div>
          ))}
        </dl>

        {searching && view.total > 0 && (
          <p className="border-b border-gray-100 bg-orange-50/40 px-4 py-1.5 text-xs text-gray-600" role="status">
            Showing {view.total} of {rollout.total} permissions matching “{query.trim()}”. Counts reflect the filtered results.
          </p>
        )}

        {rollout.total === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No permissions are registered in this environment yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Permissions per module by authorization mode</caption>
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th scope="col" className="px-4 py-2">Module</th>
                  {view.columns.map(mode => (
                    <th key={mode} scope="col" className="w-32 px-3 py-2 text-right"><ModeStatus mode={mode} /></th>
                  ))}
                  <th scope="col" className="w-44 px-4 py-2 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.length === 0 && (
                  <tr><td colSpan={view.columns.length + 2} className="px-4 py-6 text-center text-sm text-gray-500">No modules or permissions match “{query.trim()}”.</td></tr>
                )}
                {view.groups.map(g => {
                  const Icon = GROUP_ICONS[g.id] ?? HelpCircle
                  const gOpen = expanded.has(g.id)
                  return (
                    <Fragment key={g.id}>
                      <tr className="border-t border-gray-100 bg-gray-50/70">
                        <th scope="row" className="px-4 py-2 text-left">
                          <ToggleButton open={gOpen} onClick={() => toggle(g.id)} label={`${g.name}, ${g.total} permission${g.total === 1 ? '' : 's'}`}>
                            <Icon className="h-4 w-4 text-gray-500" aria-hidden />
                            <span className="font-semibold text-gray-900">{g.name}</span>
                            <span className="text-xs font-normal text-gray-400">{g.total} permission{g.total === 1 ? '' : 's'}</span>
                          </ToggleButton>
                        </th>
                        <CountCells node={g} columns={view.columns} strong />
                        <td />
                      </tr>
                      {gOpen && g.children.map(c => {
                        const cOpen = expanded.has(c.id)
                        return (
                          <Fragment key={c.id}>
                            <tr className="border-t border-gray-100">
                              <th scope="row" className="py-1.5 pl-10 pr-4 text-left">
                                <ToggleButton open={cOpen} onClick={() => toggle(c.id)} label={`${g.name}: ${c.name}, ${c.total} permission${c.total === 1 ? '' : 's'}`}>
                                  <span className="font-medium text-gray-800">{c.name}</span>
                                  <span className="text-xs font-normal text-gray-400">{c.total}</span>
                                </ToggleButton>
                              </th>
                              <CountCells node={c} columns={view.columns} />
                              <td />
                            </tr>
                            {cOpen && c.permissions.map(p => (
                              <PermissionRow key={p.key} p={p} indent="pl-[5.5rem]" columns={view.columns} diffs={diffs.byPermission[p.key]} onNavigate={onNavigate} />
                            ))}
                          </Fragment>
                        )
                      })}
                      {gOpen && g.permissions.map(p => (
                        <PermissionRow key={p.key} p={p} indent="pl-16" columns={view.columns} diffs={diffs.byPermission[p.key]} onNavigate={onNavigate} />
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold text-gray-900">
                  <th scope="row" className="px-4 py-2 text-left">
                    {searching ? 'Filtered total' : 'Total'} <span className="text-xs font-normal text-gray-400">{view.total} permission{view.total === 1 ? '' : 's'}</span>
                  </th>
                  {view.columns.map(mode => (
                    <td key={mode} className="px-3 py-2 text-right tabular-nums">{view.totals[mode] ?? 0}</td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

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
