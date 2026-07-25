'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import { cn } from '@/lib/utils'

/** Serapod palette for all reporting tabs */
export const REPORTING_COLORS = {
  primary: '#e85d04',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  ink: '#141210',
  soft: '#2a2622',
  muted: '#9ca3af',
  slate: '#64748b',
  violet: '#7c3aed',
  cyan: '#0891b2',
  indigo: '#6366f1',
  pink: '#db2777',
  purple: '#7c3aed',
}

export const REPORTING_CHART_COLORS = [
  REPORTING_COLORS.primary,
  REPORTING_COLORS.ink,
  REPORTING_COLORS.warning,
  REPORTING_COLORS.success,
  REPORTING_COLORS.slate,
  REPORTING_COLORS.violet,
  REPORTING_COLORS.cyan,
  REPORTING_COLORS.danger,
]

export const REPORTING_PANEL_CLASS = 'sera-sc-panel overflow-hidden'

export function ReportingTabLoading({ label }: { label?: string }) {
  return <SeraLoadingState variant="section" label={label} />
}

export interface ReportingTabHeaderProps {
  icon: LucideIcon
  title: string
  description?: string
  period?: string
  onPeriodChange?: (value: string) => void
  periodOptions?: { value: string; label: string }[]
  periodIcon?: LucideIcon
  onRefresh?: () => void
  refreshing?: boolean
  actions?: ReactNode
  className?: string
}

/** Shared tab header — matches Operations / Overview chrome */
export function ReportingTabHeader({
  icon: Icon,
  title,
  description,
  period,
  onPeriodChange,
  periodOptions,
  periodIcon: PeriodIcon,
  onRefresh,
  refreshing,
  actions,
  className,
}: ReportingTabHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3', className)}>
      <div>
        <h2 className="text-lg font-semibold text-[var(--sera-ink)] flex items-center gap-2">
          <Icon className="h-5 w-5 text-[var(--sera-orange)]" strokeWidth={1.75} />
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-[var(--sera-muted)] mt-0.5">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {period !== undefined && onPeriodChange && periodOptions ? (
          <Select value={period} onValueChange={onPeriodChange}>
            <SelectTrigger className="w-[160px] h-9 text-sm bg-white border-[var(--sera-line)]">
              {PeriodIcon ? <PeriodIcon className="h-3.5 w-3.5 mr-1.5 text-[var(--sera-muted)]" /> : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {onRefresh ? (
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-[var(--sera-line)]"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
