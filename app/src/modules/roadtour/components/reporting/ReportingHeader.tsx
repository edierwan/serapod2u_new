'use client'

// One header for every RoadTour Reporting section: the shared month selector,
// a compact More Filters button and an optional export. Filters stay collapsed
// by default — the month is the only control a manager needs to touch.

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MONTH_TO_DATE_LABEL, monthCoverageLabel, type ReportingMonth } from '@/modules/roadtour/lib/reporting/month'
import type { ReportingFilters } from '@/modules/roadtour/lib/reporting/useMonthlyReporting'
import type { ReportingFilterOption } from '@/modules/roadtour/lib/reporting/types'

const ALL = '__all__'

interface Props {
    title: string
    description?: string
    month: ReportingMonth
    canGoForward: boolean
    onPreviousMonth: () => void
    onNextMonth: () => void
    filters: ReportingFilters
    onFiltersChange: (filters: ReportingFilters) => void
    onClearFilters: () => void
    activeFilterCount: number
    campaigns: ReportingFilterOption[]
    accountManagers: ReportingFilterOption[]
    regions: ReportingFilterOption[]
    onExport?: () => void
    exportDisabled?: boolean
}

export function ReportingHeader({
    title, description, month, canGoForward, onPreviousMonth, onNextMonth,
    filters, onFiltersChange, onClearFilters, activeFilterCount,
    campaigns, accountManagers, regions, onExport, exportDisabled,
}: Props) {
    const [filtersOpen, setFiltersOpen] = useState(false)

    return (
        <header className="min-w-0 space-y-4">
            <div>
                <div className="mb-3 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--sera-muted)]">
                    RoadTour Reporting
                </p>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--sera-ink)] sm:text-3xl">
                    {title}
                </h1>
                {description && (
                    <p className="mt-1.5 max-w-3xl text-sm text-[var(--sera-muted)]">{description}</p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-[var(--sera-line)] bg-white px-1 py-1">
                    <Button
                        type="button" variant="ghost" size="sm" className="h-8 w-8 p-0"
                        aria-label="Previous month" onClick={onPreviousMonth}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[9.5rem] text-center font-display text-sm font-semibold text-[var(--sera-ink)]">
                        {month.label}
                    </span>
                    <Button
                        type="button" variant="ghost" size="sm" className="h-8 w-8 p-0"
                        aria-label="Next month" onClick={onNextMonth} disabled={!canGoForward}
                        title={canGoForward ? undefined : 'Future months are not available'}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                {month.isCurrentMonth && (
                    <span className="inline-flex items-center rounded-full border border-[var(--sera-orange)]/25 bg-[var(--sera-orange)]/10 px-2.5 py-1 text-xs font-medium text-[var(--sera-orange-deep)]">
                        {MONTH_TO_DATE_LABEL}
                    </span>
                )}

                <span className="text-xs text-[var(--sera-muted)]">{monthCoverageLabel(month)}</span>

                <div className="ml-auto flex items-center gap-2">
                    <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                                <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                                More Filters
                                {activeFilterCount > 0 && (
                                    <span className="ml-1.5 rounded-full bg-[var(--sera-orange)]/15 px-1.5 text-[11px] font-semibold text-[var(--sera-orange-deep)]">
                                        {activeFilterCount}
                                    </span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 space-y-3">
                            <FilterSelect
                                label="Campaign" placeholder="All campaigns"
                                value={filters.campaignId} options={campaigns}
                                onChange={(value) => onFiltersChange({ ...filters, campaignId: value })}
                            />
                            <FilterSelect
                                label="Account Manager" placeholder="All account managers"
                                value={filters.accountManagerUserId} options={accountManagers}
                                onChange={(value) => onFiltersChange({ ...filters, accountManagerUserId: value })}
                            />
                            <FilterSelect
                                label="Region" placeholder="All regions"
                                value={filters.regionStateId} options={regions}
                                onChange={(value) => onFiltersChange({ ...filters, regionStateId: value })}
                            />
                            {activeFilterCount > 0 && (
                                <Button
                                    type="button" variant="ghost" size="sm" className="w-full"
                                    onClick={() => { onClearFilters(); setFiltersOpen(false) }}
                                >
                                    <X className="mr-1.5 h-3.5 w-3.5" />Clear filters
                                </Button>
                            )}
                        </PopoverContent>
                    </Popover>

                    {onExport && (
                        <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
                            <Download className="mr-1.5 h-3.5 w-3.5" />Export Report
                        </Button>
                    )}
                </div>
            </div>
        </header>
    )
}

function FilterSelect({ label, placeholder, value, options, onChange }: {
    label: string
    placeholder: string
    value: string | null
    options: ReportingFilterOption[]
    onChange: (value: string | null) => void
}) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--sera-muted)]">{label}</label>
            <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
                <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>{placeholder}</SelectItem>
                    {options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
