'use client'

import { useCallback, useEffect, useState } from 'react'
import { Store, MapPin, Loader2 } from 'lucide-react'
import ShopPerformanceTab from './ShopPerformanceTab'
import ShopByNegeriTab from './ShopByNegeriTab'
import { resolveDefaultReportingPeriod, type ReportingPeriod } from '@/lib/reporting/reporting-period'

interface ShopReportsTabProps {
  userProfile: any
  chartGridColor: string
  chartTickColor: string
  isDark: boolean
}

type ShopReport = 'performance' | 'negeri'

const REPORTS: { id: ShopReport; label: string; description: string; icon: typeof Store }[] = [
  { id: 'performance', label: 'Shop Performance', description: 'Overall shop activity & scans', icon: Store },
  { id: 'negeri', label: 'Shop by Negeri', description: 'Performance by Malaysia state', icon: MapPin },
]

export default function ShopReportsTab({ userProfile, chartGridColor, chartTickColor, isDark }: ShopReportsTabProps) {
  const [report, setReport] = useState<ShopReport>('performance')
  const [periods, setPeriods] = useState<ReportingPeriod[]>([])
  const [periodKey, setPeriodKey] = useState<string | null>(null)
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [periodsError, setPeriodsError] = useState<string | null>(null)

  const fetchPeriods = useCallback(async (preserveSelection = true) => {
    setPeriodsLoading(true)
    setPeriodsError(null)
    try {
      const response = await fetch('/api/reporting/shop-performance/periods', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load reporting periods')
      const nextPeriods = (payload.periods || []) as ReportingPeriod[]
      setPeriods(nextPeriods)
      setPeriodKey((current) => {
        if (preserveSelection && current && nextPeriods.some((period) => period.key === current)) return current
        return resolveDefaultReportingPeriod(nextPeriods)
      })
    } catch (error: any) {
      setPeriodsError(error?.message || 'Unable to load reporting periods')
      setPeriods([])
      setPeriodKey(null)
    } finally {
      setPeriodsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchPeriods(false) }, [fetchPeriods])

  const selectedPeriod = periods.find((period) => period.key === periodKey) || null

  return (
    <div className="space-y-6">
      {/* Report selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {REPORTS.map((r) => {
          const Icon = r.icon
          const active = report === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setReport(r.id)}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                active
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                  : 'border-border bg-card/80 hover:border-blue-300 hover:bg-muted/40'
              }`}
              aria-pressed={active}
            >
              <div className={`p-2 rounded-lg ${active ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : ''}`}>{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.description}</p>
              </div>
            </button>
          )
        })}
      </div>

      {periodsLoading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading transaction periods...
        </div>
      ) : periodsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {periodsError}
        </div>
      ) : periods.length === 0 || !selectedPeriod ? (
        <div className="rounded-xl border bg-card/80 p-10 text-center text-sm text-muted-foreground">
          No transaction periods available.
        </div>
      ) : report === 'performance' ? (
        <ShopPerformanceTab
          userProfile={userProfile}
          chartGridColor={chartGridColor}
          chartTickColor={chartTickColor}
          isDark={isDark}
          periods={periods}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setPeriodKey}
          onRefreshPeriods={() => fetchPeriods(true)}
        />
      ) : (
        <ShopByNegeriTab
          userProfile={userProfile}
          chartGridColor={chartGridColor}
          chartTickColor={chartTickColor}
          isDark={isDark}
          periods={periods}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setPeriodKey}
          onRefreshPeriods={() => fetchPeriods(true)}
        />
      )}
    </div>
  )
}
