'use client'

import { useState } from 'react'
import { Store, MapPin } from 'lucide-react'
import ShopPerformanceTab from './ShopPerformanceTab'
import ShopByNegeriTab from './ShopByNegeriTab'
import { cn } from '@/lib/utils'

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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {REPORTS.map((r) => {
          const Icon = r.icon
          const active = report === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setReport(r.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/40 focus-visible:ring-offset-2',
                active
                  ? 'border-[var(--sera-orange)]/40 bg-[var(--sera-orange)]/8 shadow-sm'
                  : 'border-[var(--sera-line)] bg-white hover:border-[var(--sera-orange)]/25 hover:bg-[var(--sera-mist)]',
              )}
              aria-pressed={active}
            >
              <div className={cn(
                'p-2 rounded-lg',
                active ? 'bg-[var(--sera-orange)] text-white' : 'bg-[var(--sera-mist)] text-[var(--sera-muted)]',
              )}>
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className={cn('text-sm font-semibold', active ? 'text-[var(--sera-ink)]' : 'text-[var(--sera-ink-soft,#2a2622)]')}>{r.label}</p>
                <p className="text-xs text-[var(--sera-muted)]">{r.description}</p>
              </div>
            </button>
          )
        })}
      </div>

      {report === 'performance' ? (
        <ShopPerformanceTab
          userProfile={userProfile}
          chartGridColor={chartGridColor}
          chartTickColor={chartTickColor}
          isDark={isDark}
        />
      ) : (
        <ShopByNegeriTab
          userProfile={userProfile}
          chartGridColor={chartGridColor}
          chartTickColor={chartTickColor}
          isDark={isDark}
        />
      )}
    </div>
  )
}
