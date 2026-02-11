'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Users, Zap, Clock, BarChart3, TrendingUp,
  Bot, AlertCircle, CheckCircle2, Loader2, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'

// ── Types ────────────────────────────────────────────────────────

interface UsageSummary {
  totalRequests: number
  successCount: number
  errorCount: number
  offlineCount: number
  successRate: number
  totalTokens: number
  avgResponseMs: number
  uniqueUsers: number
}

interface DailyStat {
  date: string
  requests: number
  success: number
  errors: number
  tokens: number
}

interface ModuleStat {
  module: string
  requests: number
  success: number
  errors: number
  avgMs: number
}

interface UserStat {
  userId: string
  userName: string
  requests: number
  success: number
  errors: number
  lastUsed: string
}

interface ProviderStat {
  provider: string
  requests: number
  success: number
  errors: number
}

interface ErrorLog {
  id: string
  provider: string
  module: string
  model: string | null
  errorMessage: string
  status: string
  responseMs: number
  userId: string
  userName: string
  createdAt: string
}

interface UsageData {
  period: string
  days: number
  summary: UsageSummary
  dailyStats: DailyStat[]
  moduleStats: ModuleStat[]
  userStats: UserStat[]
  providerStats: ProviderStat[]
  errorLogs: ErrorLog[]
}

// ── Helpers ──────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  hr: 'HR',
  finance: 'Finance',
  'supply-chain': 'Supply Chain',
  'customer-growth': 'Customer & Growth',
  unknown: 'Other',
}

const PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  ollama: 'Ollama',
  moltbot: 'Moltbot',
  openai: 'OpenAI',
}

const MODULE_COLORS: Record<string, string> = {
  hr: 'bg-violet-500',
  finance: 'bg-emerald-500',
  'supply-chain': 'bg-blue-500',
  'customer-growth': 'bg-amber-500',
  unknown: 'bg-gray-400',
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-MY', { month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-MY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getMaxValue(data: DailyStat[], key: 'requests' | 'tokens'): number {
  return Math.max(...data.map(d => d[key]), 1)
}

// ── Component ────────────────────────────────────────────────────

interface AiUsageDashboardProps {
  organizationId: string
}

export default function AiUsageDashboard({ organizationId }: AiUsageDashboardProps) {
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState<UsageData | null>(null)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorFilter, setErrorFilter] = useState<string | null>(null) // provider or null for all
  const [errorPage, setErrorPage] = useState(1)
  const ERRORS_PER_PAGE = 10

  const loadUsage = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/settings/ai-usage?period=${period}`)
      if (!res.ok) {
        if (res.status === 403) {
          toast({ title: 'Access Denied', variant: 'destructive' })
          return
        }
        throw new Error('Failed to load usage data')
      }
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      console.error('Failed to load AI usage:', err)
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { loadUsage() }, [loadUsage])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No usage data available yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Usage will appear here once the AI assistant is used.</p>
        </CardContent>
      </Card>
    )
  }

  const { summary, dailyStats, moduleStats, userStats, providerStats } = data
  const maxRequests = getMaxValue(dailyStats, 'requests')
  const errorLogs = data.errorLogs ?? []

  // Filtered errors for modal
  const filteredErrors = errorFilter
    ? errorLogs.filter(e => e.provider === errorFilter)
    : errorLogs
  const totalErrorPages = Math.max(1, Math.ceil(filteredErrors.length / ERRORS_PER_PAGE))
  const pagedErrors = filteredErrors.slice((errorPage - 1) * ERRORS_PER_PAGE, errorPage * ERRORS_PER_PAGE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-violet-600" />
            AI Usage Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track AI assistant usage across all modules
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadUsage} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Requests"
          value={formatNumber(summary.totalRequests)}
          icon={<Activity className="h-4 w-4" />}
          color="text-blue-600"
          bgColor="bg-blue-50 dark:bg-blue-900/10"
        />
        <SummaryCard
          title="Success Rate"
          value={`${summary.successRate}%`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="text-emerald-600"
          bgColor="bg-emerald-50 dark:bg-emerald-900/10"
          trend={summary.successRate >= 95 ? 'up' : summary.successRate >= 80 ? 'flat' : 'down'}
        />
        <SummaryCard
          title="Avg Response"
          value={formatMs(summary.avgResponseMs)}
          icon={<Clock className="h-4 w-4" />}
          color="text-amber-600"
          bgColor="bg-amber-50 dark:bg-amber-900/10"
        />
        <SummaryCard
          title="Active Users"
          value={summary.uniqueUsers.toString()}
          icon={<Users className="h-4 w-4" />}
          color="text-violet-600"
          bgColor="bg-violet-50 dark:bg-violet-900/10"
        />
      </div>

      {/* Daily Activity Chart */}
      {dailyStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Activity</CardTitle>
            <CardDescription>Requests per day over the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-[2px] h-[140px]">
              {dailyStats.map((day) => {
                const height = Math.max((day.requests / maxRequests) * 100, 2)
                const errorHeight = day.errors > 0 ? Math.max((day.errors / maxRequests) * 100, 1) : 0
                const successHeight = height - errorHeight
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center justify-end relative group">
                    {/* Tooltip */}
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-popover border rounded-md px-2 py-1 text-xs shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                      <div className="font-medium">{formatDate(day.date)}</div>
                      <div>{day.requests} requests ({day.errors} errors)</div>
                    </div>
                    {/* Bar */}
                    <div className="w-full flex flex-col items-center">
                      {errorHeight > 0 && (
                        <div
                          className="w-full rounded-t bg-red-400 dark:bg-red-500/70 min-w-[4px]"
                          style={{ height: `${errorHeight}%`, minHeight: '1px' }}
                        />
                      )}
                      <div
                        className={`w-full ${errorHeight > 0 ? '' : 'rounded-t'} rounded-b bg-violet-500 dark:bg-violet-400/80 min-w-[4px]`}
                        style={{ height: `${successHeight}%`, minHeight: '2px' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {/* X-axis labels */}
            <div className="flex gap-[2px] mt-1">
              {dailyStats.map((day, i) => (
                <div key={day.date} className="flex-1 text-center">
                  {(i === 0 || i === dailyStats.length - 1 || i % Math.ceil(dailyStats.length / 7) === 0) && (
                    <span className="text-[10px] text-muted-foreground">{formatDate(day.date)}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Module & Provider Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Module Breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Usage by Module</CardTitle>
            <CardDescription>AI requests per module</CardDescription>
          </CardHeader>
          <CardContent>
            {moduleStats.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
            ) : (
              <div className="space-y-3">
                {moduleStats.sort((a, b) => b.requests - a.requests).map((mod) => {
                  const pct = summary.totalRequests > 0 ? (mod.requests / summary.totalRequests) * 100 : 0
                  return (
                    <div key={mod.module} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className={`h-2.5 w-2.5 rounded-full ${MODULE_COLORS[mod.module] ?? 'bg-gray-400'}`} />
                          <span className="font-medium">{MODULE_LABELS[mod.module] ?? mod.module}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{mod.requests} requests</span>
                          <span>{formatMs(mod.avgMs)} avg</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${MODULE_COLORS[mod.module] ?? 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider Breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Usage by Provider</CardTitle>
            <CardDescription>Requests per AI provider</CardDescription>
          </CardHeader>
          <CardContent>
            {providerStats.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
            ) : (
              <div className="space-y-4">
                {providerStats.sort((a, b) => b.requests - a.requests).map((prov) => {
                  const successRate = prov.requests > 0 ? Math.round((prov.success / prov.requests) * 100) : 0
                  return (
                    <div key={prov.provider} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{PROVIDER_LABELS[prov.provider] ?? prov.provider}</p>
                          <p className="text-xs text-muted-foreground">{prov.requests} requests</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={successRate >= 95 ? 'default' : successRate >= 80 ? 'secondary' : 'destructive'}
                          className={successRate >= 95
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : ''}
                        >
                          {successRate}% success
                        </Badge>
                        {prov.errors > 0 && (
                          <button
                            onClick={() => {
                              setErrorFilter(prov.provider)
                              setErrorPage(1)
                              setShowErrorModal(true)
                            }}
                            className="text-xs text-red-500 hover:text-red-700 hover:underline cursor-pointer font-medium transition-colors"
                            title={`View ${prov.errors} error details`}
                          >
                            {prov.errors} errors
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* User Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">User Activity</CardTitle>
          <CardDescription>AI usage per team member</CardDescription>
        </CardHeader>
        <CardContent>
          {userStats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No user data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">#</th>
                    <th className="pb-2 font-medium text-muted-foreground">User</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Requests</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Success</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Errors</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {userStats.slice(0, 20).map((user, i) => {
                    const successRate = user.requests > 0 ? Math.round((user.success / user.requests) * 100) : 0
                    return (
                      <tr key={user.userId} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-medium text-white">
                              {user.userName.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium">{user.userName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-mono">{user.requests}</td>
                        <td className="py-2.5 text-right">
                          <Badge
                            variant="outline"
                            className={successRate >= 95
                              ? 'text-emerald-600 border-emerald-200'
                              : successRate >= 80
                                ? 'text-amber-600 border-amber-200'
                                : 'text-red-600 border-red-200'}
                          >
                            {successRate}%
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right">
                          {user.errors > 0 ? (
                            <button
                              onClick={() => {
                                setErrorFilter(null)
                                setErrorPage(1)
                                setShowErrorModal(true)
                              }}
                              className="text-red-500 hover:text-red-700 hover:underline cursor-pointer font-mono transition-colors"
                              title="View error details"
                            >
                              {user.errors}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right text-xs text-muted-foreground">
                          {formatDateTime(user.lastUsed)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {userStats.length > 20 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Showing top 20 of {userStats.length} users
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty state for no data */}
      {summary.totalRequests === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Bot className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium text-lg mb-1">No AI usage recorded yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Usage data will appear here once team members start using AI assistants
              in HR, Finance, Supply Chain, or Customer & Growth modules.
            </p>
          </CardContent>
        </Card>
      )}

      {/* View All Errors button (if there are errors) */}
      {errorLogs.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            onClick={() => {
              setErrorFilter(null)
              setErrorPage(1)
              setShowErrorModal(true)
            }}
          >
            <AlertCircle className="h-4 w-4" />
            View All Errors ({errorLogs.length})
          </Button>
        </div>
      )}

      {/* ── Error Detail Modal ──────────────────────────────────── */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowErrorModal(false)}>
          <div className="bg-background border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  Error Details
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {filteredErrors.length} error{filteredErrors.length !== 1 ? 's' : ''}
                  {errorFilter ? ` from ${PROVIDER_LABELS[errorFilter] ?? errorFilter}` : ' across all providers'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Provider filter tabs */}
                <div className="flex gap-1">
                  <button
                    onClick={() => { setErrorFilter(null); setErrorPage(1) }}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      !errorFilter ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    All
                  </button>
                  {[...new Set(errorLogs.map(e => e.provider))].map(p => (
                    <button
                      key={p}
                      onClick={() => { setErrorFilter(p); setErrorPage(1) }}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        errorFilter === p ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      {PROVIDER_LABELS[p] ?? p}
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowErrorModal(false)} className="ml-2 p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {pagedErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No errors found for this filter.</p>
              ) : (
                <div className="space-y-3">
                  {pagedErrors.map((err, i) => (
                    <div key={err.id} className="rounded-lg border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              {err.status === 'offline' ? 'OFFLINE' : 'ERROR'}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {PROVIDER_LABELS[err.provider] ?? err.provider}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {MODULE_LABELS[err.module] ?? err.module}
                            </Badge>
                            {err.model && (
                              <span className="text-[10px] text-muted-foreground">model: {err.model}</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-red-700 dark:text-red-400 break-words">
                            {err.errorMessage}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDateTime(err.createdAt)}
                          </p>
                          {err.responseMs > 0 && (
                            <p className="text-[10px] text-muted-foreground">{formatMs(err.responseMs)}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 text-[11px] text-muted-foreground">
                        User: {err.userName}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer — Pagination */}
            {totalErrorPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Showing {(errorPage - 1) * ERRORS_PER_PAGE + 1}–{Math.min(errorPage * ERRORS_PER_PAGE, filteredErrors.length)} of {filteredErrors.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={errorPage <= 1}
                    onClick={() => setErrorPage(p => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs font-medium px-2">
                    {errorPage} / {totalErrorPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={errorPage >= totalErrorPages}
                    onClick={() => setErrorPage(p => Math.min(totalErrorPages, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  icon,
  color,
  bgColor,
  trend,
}: {
  title: string
  value: string
  icon: React.ReactNode
  color: string
  bgColor: string
  trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className={`h-8 w-8 rounded-lg ${bgColor} flex items-center justify-center ${color}`}>
            {icon}
          </div>
          {trend && (
            <div className={`flex items-center gap-0.5 text-xs ${
              trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
            }`}>
              {trend === 'up' && <ArrowUpRight className="h-3 w-3" />}
              {trend === 'down' && <ArrowDownRight className="h-3 w-3" />}
              {trend === 'flat' && <Minus className="h-3 w-3" />}
            </div>
          )}
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
      </CardContent>
    </Card>
  )
}
