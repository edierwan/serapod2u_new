'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────

interface SummaryRow {
  trust_level: string
  user_facing_outcome: string
  recovery_status: string
  total_scans: number
  last_24h: number
  last_7d: number
  first_seen: string
  last_seen: string
}

interface CandidateRow {
  id: string
  created_at: string
  raw_code: string
  parsed_order_no: string | null
  parsed_product_sku: string | null
  parsed_variant_code: string | null
  parsed_sequence: number | null
  parsed_hash_suffix: string | null
  trust_level: string
  hash_status: string
  lookup_result: string
  order_exists: boolean
  qr_exists: boolean
  user_facing_outcome: string
  points_outcome: string
  recovery_status: string
  consumer_phone: string | null
  consumer_name: string | null
  ip_address: string | null
  user_agent: string | null
  notes: string | null
  matched_order_no: string | null
  matched_order_id: string | null
  is_test_data: boolean
}

interface HourlyRow {
  hour: string
  trust_level: string
  user_facing_outcome: string
  scan_count: number
}

interface MonitorData {
  summary: SummaryRow[]
  candidates: CandidateRow[]
  hourly: HourlyRow[]
}

interface QrRecoveryMonitorViewProps {
  userProfile: any
  onViewChange: (view: string) => void
}

// ── Trust level display config ───────────────────────────────────

const TRUST_CONFIG: Record<string, { label: string; color: string; icon: typeof ShieldCheck; bg: string }> = {
  exact_match: { label: 'Exact Match', color: 'text-green-600', icon: ShieldCheck, bg: 'bg-green-50 dark:bg-green-900/30' },
  recovered_match: { label: 'Recovered Match', color: 'text-blue-600', icon: Shield, bg: 'bg-blue-50 dark:bg-blue-900/30' },
  valid_shape_unresolved: { label: 'Unresolved (Valid)', color: 'text-amber-600', icon: Clock, bg: 'bg-amber-50 dark:bg-amber-900/30' },
  valid_shape_bad_hash: { label: 'Bad Hash', color: 'text-red-600', icon: ShieldAlert, bg: 'bg-red-50 dark:bg-red-900/30' },
  invalid_shape: { label: 'Invalid Shape', color: 'text-gray-500', icon: XCircle, bg: 'bg-gray-50 dark:bg-gray-900/30' },
}

const OUTCOME_BADGES: Record<string, { label: string; cls: string }> = {
  genuine: { label: 'Genuine', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  already_collected: { label: 'Already Collected', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  not_activated: { label: 'Not Activated', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  temporarily_unavailable: { label: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  invalid_code: { label: 'Invalid', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

const RECOVERY_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  none: { label: 'N/A', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  resolved: { label: 'Resolved', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

// ── Component ────────────────────────────────────────────────────

export default function QrRecoveryMonitorView({ userProfile, onViewChange }: QrRecoveryMonitorViewProps) {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'candidates' | 'log'>('overview')
  const [trustFilter, setTrustFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/qr-monitoring/stats')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Unknown error')
      setData(json.data)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived stats ──────────────────────────────────────────────

  const stats = useMemo(() => {
    if (!data?.summary) return null
    const totals = { total: 0, last24h: 0, last7d: 0, recovery_pending: 0, genuine: 0, unresolved: 0 }
    for (const row of data.summary) {
      totals.total += Number(row.total_scans)
      totals.last24h += Number(row.last_24h)
      totals.last7d += Number(row.last_7d)
      if (row.recovery_status === 'pending') totals.recovery_pending += Number(row.total_scans)
      if (row.user_facing_outcome === 'genuine') totals.genuine += Number(row.total_scans)
      if (row.trust_level === 'valid_shape_unresolved') totals.unresolved += Number(row.total_scans)
    }
    return totals
  }, [data?.summary])

  // ── Filtered candidates ────────────────────────────────────────

  const filteredCandidates = useMemo(() => {
    if (!data?.candidates) return []
    let items = data.candidates
    if (trustFilter !== 'all') {
      items = items.filter(c => c.trust_level === trustFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter(c =>
        c.raw_code.toLowerCase().includes(q) ||
        c.parsed_order_no?.toLowerCase().includes(q) ||
        c.parsed_product_sku?.toLowerCase().includes(q) ||
        c.consumer_phone?.toLowerCase().includes(q) ||
        c.consumer_name?.toLowerCase().includes(q)
      )
    }
    return items
  }, [data?.candidates, trustFilter, searchQuery])

  // ── Render ─────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading monitoring data...
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={fetchData} className="mt-3 text-sm text-primary hover:underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">QR Recovery Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Internal monitoring for QR verification attempts and recovery candidates.
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="Total Scans" value={stats.total} icon={Activity} />
          <StatCard label="Last 24h" value={stats.last24h} icon={Clock} />
          <StatCard label="Last 7 Days" value={stats.last7d} icon={Clock} />
          <StatCard label="Genuine" value={stats.genuine} icon={CheckCircle2} accent="text-green-600" />
          <StatCard label="Unresolved" value={stats.unresolved} icon={AlertTriangle} accent="text-amber-600" />
          <StatCard label="Recovery Queue" value={stats.recovery_pending} icon={ShieldAlert} accent="text-red-600" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['overview', 'candidates', 'log'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab === 'candidates' ? 'Recovery Candidates' : tab === 'log' ? 'Full Log' : 'Overview'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && data?.summary && (
        <OverviewTab summary={data.summary} />
      )}

      {(activeTab === 'candidates' || activeTab === 'log') && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search code, order, SKU, phone..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-card w-72 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <select
                value={trustFilter}
                onChange={e => setTrustFilter(e.target.value)}
                className="text-sm border border-border rounded-md px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Trust Levels</option>
                {Object.entries(TRUST_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredCandidates.length} {filteredCandidates.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-x-auto bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Order</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">SKU</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Seq</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trust</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Hash</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Outcome</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Recovery</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Consumer</th>
                  {activeTab === 'log' && (
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Raw Code</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={activeTab === 'log' ? 10 : 9} className="text-center py-12 text-muted-foreground">
                      No records found
                    </td>
                  </tr>
                ) : (
                  filteredCandidates.map(row => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                        {row.parsed_order_no ?? '-'}
                        {row.order_exists && <span className="ml-1 text-green-500" title="Order exists in DB">&#10003;</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{row.parsed_product_sku ?? '-'}</td>
                      <td className="px-3 py-2 text-center text-xs">{row.parsed_sequence ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <TrustBadge level={row.trust_level} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={cn(
                          'inline-block px-1.5 py-0.5 rounded text-xs font-medium',
                          row.hash_status === 'valid' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                          row.hash_status === 'invalid' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        )}>
                          {row.hash_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <OutcomeBadge outcome={row.user_facing_outcome} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <RecoveryBadge status={row.recovery_status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {row.consumer_name || row.consumer_phone || '-'}
                      </td>
                      {activeTab === 'log' && (
                        <td className="px-3 py-2 font-mono text-xs max-w-[200px] truncate" title={row.raw_code}>
                          {row.raw_code}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Activity; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', accent)} />
        {label}
      </div>
      <p className={cn('text-2xl font-semibold tabular-nums', accent || 'text-foreground')}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function TrustBadge({ level }: { level: string }) {
  const cfg = TRUST_CONFIG[level] ?? { label: level, color: 'text-gray-500', icon: XCircle, bg: 'bg-gray-50 dark:bg-gray-900/30' }
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium', cfg.bg, cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOME_BADGES[outcome] ?? { label: outcome, cls: 'bg-gray-100 text-gray-600' }
  return <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-medium', cfg.cls)}>{cfg.label}</span>
}

function RecoveryBadge({ status }: { status: string }) {
  const cfg = RECOVERY_STATUS_BADGES[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
  return <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-medium', cfg.cls)}>{cfg.label}</span>
}

function OverviewTab({ summary }: { summary: SummaryRow[] }) {
  // Group by trust_level
  const byTrust = useMemo(() => {
    const map = new Map<string, { total: number; last24h: number; last7d: number; outcomes: Map<string, number> }>()
    for (const row of summary) {
      const key = row.trust_level
      if (!map.has(key)) map.set(key, { total: 0, last24h: 0, last7d: 0, outcomes: new Map() })
      const entry = map.get(key)!
      entry.total += Number(row.total_scans)
      entry.last24h += Number(row.last_24h)
      entry.last7d += Number(row.last_7d)
      entry.outcomes.set(row.user_facing_outcome, (entry.outcomes.get(row.user_facing_outcome) ?? 0) + Number(row.total_scans))
    }
    return map
  }, [summary])

  const trustOrder = ['exact_match', 'recovered_match', 'valid_shape_unresolved', 'valid_shape_bad_hash', 'invalid_shape']

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Breakdown by Trust Level</h2>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {trustOrder.map(level => {
          const entry = byTrust.get(level)
          if (!entry) return null
          const cfg = TRUST_CONFIG[level] ?? { label: level, color: 'text-gray-500', icon: XCircle, bg: 'bg-gray-50' }
          const Icon = cfg.icon
          return (
            <div key={level} className={cn('border border-border rounded-lg p-4 space-y-3', cfg.bg)}>
              <div className="flex items-center gap-2">
                <Icon className={cn('h-5 w-5', cfg.color)} />
                <span className={cn('font-semibold text-sm', cfg.color)}>{cfg.label}</span>
                <span className="ml-auto text-lg font-bold tabular-nums">{entry.total.toLocaleString()}</span>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>24h: <b className="text-foreground">{entry.last24h.toLocaleString()}</b></span>
                <span>7d: <b className="text-foreground">{entry.last7d.toLocaleString()}</b></span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from(entry.outcomes.entries()).map(([outcome, count]) => (
                  <span key={outcome} className="text-xs text-muted-foreground">
                    {OUTCOME_BADGES[outcome]?.label ?? outcome}: {count}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
