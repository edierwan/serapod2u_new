'use client'

import { useState } from 'react'
import { Store, MapPin } from 'lucide-react'
import ShopPerformanceTab from './ShopPerformanceTab'
import ShopByNegeriTab from './ShopByNegeriTab'

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
