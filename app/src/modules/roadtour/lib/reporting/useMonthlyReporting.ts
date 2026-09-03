'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
    normalizeImpactWindowDays,
    OFFICIAL_IMPACT_WINDOW_DAYS,
    type ImpactWindowDays,
} from './impactModel'
import {
    canSelectNextMonth,
    currentMonthKey,
    normalizeMonthKey,
    resolveReportingMonth,
    shiftMonthKey,
    type ReportingMonth,
} from './month'
import type { RoadtourReportingDataset } from './types'

/** The selected month follows the manager between the four reporting sections. */
const MONTH_STORAGE_KEY = 'roadtour-reporting-month'

export interface ReportingFilters {
    campaignId: string | null
    accountManagerUserId: string | null
    regionStateId: string | null
}

export const EMPTY_REPORTING_FILTERS: ReportingFilters = {
    campaignId: null,
    accountManagerUserId: null,
    regionStateId: null,
}

export function countActiveFilters(filters: ReportingFilters): number {
    return Object.values(filters).filter(Boolean).length
}

function readStoredMonth(): string | null {
    if (typeof window === 'undefined') return null
    const fromUrl = new URLSearchParams(window.location.search).get('month')
    if (fromUrl) return fromUrl
    try {
        return window.sessionStorage.getItem(MONTH_STORAGE_KEY)
    } catch {
        return null
    }
}

function readFiltersFromUrl(): ReportingFilters {
    if (typeof window === 'undefined') return EMPTY_REPORTING_FILTERS
    const params = new URLSearchParams(window.location.search)
    return {
        campaignId: params.get('campaignId') || null,
        accountManagerUserId: params.get('accountManagerUserId') || null,
        regionStateId: params.get('regionStateId') || null,
    }
}

export interface UseMonthlyReportingResult {
    month: ReportingMonth
    monthKey: string
    setMonthKey: (key: string) => void
    goToPreviousMonth: () => void
    goToNextMonth: () => void
    canGoForward: boolean
    filters: ReportingFilters
    setFilters: (next: ReportingFilters) => void
    clearFilters: () => void
    activeFilterCount: number
    windowDays: ImpactWindowDays
    setWindowDays: (days: number) => void
    dataset: RoadtourReportingDataset | null
    loading: boolean
    error: string | null
    reload: () => void
}

export function useMonthlyReporting(organizationId: string | null | undefined): UseMonthlyReportingResult {
    const [monthKey, setMonthKeyState] = useState<string>(() => normalizeMonthKey(readStoredMonth()))
    const [filters, setFiltersState] = useState<ReportingFilters>(readFiltersFromUrl)
    const [windowDays, setWindowDaysState] = useState<ImpactWindowDays>(OFFICIAL_IMPACT_WINDOW_DAYS)
    const [dataset, setDataset] = useState<RoadtourReportingDataset | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [reloadToken, setReloadToken] = useState(0)

    const month = useMemo(() => resolveReportingMonth(monthKey), [monthKey])

    const setMonthKey = useCallback((key: string) => {
        setMonthKeyState(normalizeMonthKey(key))
    }, [])

    const goToPreviousMonth = useCallback(() => {
        setMonthKeyState((current) => shiftMonthKey(current, -1))
    }, [])

    const goToNextMonth = useCallback(() => {
        setMonthKeyState((current) => (canSelectNextMonth(current) ? shiftMonthKey(current, 1) : current))
    }, [])

    const setFilters = useCallback((next: ReportingFilters) => setFiltersState(next), [])
    const clearFilters = useCallback(() => setFiltersState(EMPTY_REPORTING_FILTERS), [])
    const setWindowDays = useCallback((days: number) => setWindowDaysState(normalizeImpactWindowDays(days)), [])
    const reload = useCallback(() => setReloadToken((token) => token + 1), [])

    // Keep the URL and the session in step so a refresh, a shared link and a jump
    // to another reporting section all land on the same month.
    useEffect(() => {
        if (typeof window === 'undefined') return
        try {
            window.sessionStorage.setItem(MONTH_STORAGE_KEY, monthKey)
        } catch {
            // Session storage is unavailable in some privacy modes; the URL still carries the month.
        }

        const params = new URLSearchParams(window.location.search)
        const entries: Record<string, string | null> = {
            month: monthKey,
            campaignId: filters.campaignId,
            accountManagerUserId: filters.accountManagerUserId,
            regionStateId: filters.regionStateId,
        }
        for (const [key, value] of Object.entries(entries)) {
            if (value) params.set(key, value)
            else params.delete(key)
        }

        const query = params.toString()
        const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
        if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl)
    }, [monthKey, filters.campaignId, filters.accountManagerUserId, filters.regionStateId])

    useEffect(() => {
        if (!organizationId) {
            setLoading(false)
            setError('No organization is linked to this account.')
            return
        }

        let cancelled = false
        const params = new URLSearchParams({ month: monthKey, window: String(windowDays) })
        if (filters.campaignId) params.set('campaignId', filters.campaignId)
        if (filters.accountManagerUserId) params.set('accountManagerUserId', filters.accountManagerUserId)
        if (filters.regionStateId) params.set('regionStateId', filters.regionStateId)

        setLoading(true)
        setError(null)

        fetch(`/api/roadtour/reporting/monthly?${params.toString()}`, { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json().catch(() => null)
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || `Request failed with status ${response.status}`)
                }
                if (!cancelled) setDataset(payload.data as RoadtourReportingDataset)
            })
            .catch((cause: unknown) => {
                if (cancelled) return
                console.error('[useMonthlyReporting] load failed', cause)
                setDataset(null)
                setError(cause instanceof Error ? cause.message : 'Failed to load RoadTour reporting data.')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => { cancelled = true }
    }, [organizationId, monthKey, windowDays, filters.campaignId, filters.accountManagerUserId, filters.regionStateId, reloadToken])

    return {
        month,
        monthKey,
        setMonthKey,
        goToPreviousMonth,
        goToNextMonth,
        canGoForward: canSelectNextMonth(monthKey),
        filters,
        setFilters,
        clearFilters,
        activeFilterCount: countActiveFilters(filters),
        windowDays,
        setWindowDays,
        dataset,
        loading,
        error,
        reload,
    }
}

export { currentMonthKey }
