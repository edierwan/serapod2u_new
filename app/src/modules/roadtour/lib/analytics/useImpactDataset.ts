'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadPostVisitImpact, type LoadImpactParams } from '@/modules/roadtour/lib/analytics/postVisitImpact'
import {
    DEFAULT_IMPACT_WINDOW_DAYS,
    normalizeImpactWindowDays,
} from '@/modules/roadtour/lib/analytics/windowDays'
import type { ImpactDataset, ImpactWindow } from '@/modules/roadtour/types/analytics'

export interface ImpactFilters {
    windowDays: ImpactWindow
    dateFrom: string | null
    dateTo: string | null
    campaignId: string | null
    accountManagerUserId: string | null
    regionStateId: string | null
}

export function defaultDateRange(windowDays: ImpactWindow): { dateFrom: string; dateTo: string } {
    const today = new Date()
    const to = today.toISOString().slice(0, 10)
    const from = new Date(today.getTime() - (windowDays - 1) * 86400000).toISOString().slice(0, 10)
    return { dateFrom: from, dateTo: to }
}

function readImpactFiltersFromUrl(): Partial<ImpactFilters> {
    if (typeof window === 'undefined') return {}

    const params = new URLSearchParams(window.location.search)
    const windowDays = params.get('windowDays')

    return {
        windowDays: windowDays === null ? undefined : normalizeImpactWindowDays(windowDays),
        dateFrom: params.get('dateFrom') || null,
        dateTo: params.get('dateTo') || null,
        campaignId: params.get('campaignId') || null,
        accountManagerUserId: params.get('accountManagerUserId') || null,
        regionStateId: params.get('regionStateId') || null,
    }
}

export function useImpactDataset(companyId: string, initial?: Partial<ImpactFilters>) {
    const supabase = useMemo(() => createClient(), [])
    const [filters, setFilters] = useState<ImpactFilters>(() => {
        const urlFilters = readImpactFiltersFromUrl()
        const w: ImpactWindow = normalizeImpactWindowDays(urlFilters.windowDays ?? initial?.windowDays ?? DEFAULT_IMPACT_WINDOW_DAYS)
        const d = defaultDateRange(w)
        return {
            windowDays: w,
            dateFrom: urlFilters.dateFrom ?? initial?.dateFrom ?? d.dateFrom,
            dateTo: urlFilters.dateTo ?? initial?.dateTo ?? d.dateTo,
            campaignId: urlFilters.campaignId ?? initial?.campaignId ?? null,
            accountManagerUserId: urlFilters.accountManagerUserId ?? initial?.accountManagerUserId ?? null,
            regionStateId: urlFilters.regionStateId ?? initial?.regionStateId ?? null,
        }
    })
    const [dataset, setDataset] = useState<ImpactDataset | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const params: LoadImpactParams = {
                supabase,
                companyId,
                windowDays: filters.windowDays,
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
                campaignId: filters.campaignId,
                accountManagerUserId: filters.accountManagerUserId,
                regionStateId: filters.regionStateId,
            }
            const ds = await loadPostVisitImpact(params)
            setDataset(ds)
        } catch (e: any) {
            console.error('[useImpactDataset] failed', e)
            setError(e?.message || 'Failed to load impact data')
            setDataset(null)
        } finally {
            setLoading(false)
        }
    }, [supabase, companyId, filters.windowDays, filters.dateFrom, filters.dateTo, filters.campaignId, filters.accountManagerUserId, filters.regionStateId])

    useEffect(() => { load() }, [load])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const params = new URLSearchParams(window.location.search)
        const entries: Record<string, string | null> = {
            windowDays: String(filters.windowDays),
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            campaignId: filters.campaignId,
            accountManagerUserId: filters.accountManagerUserId,
            regionStateId: filters.regionStateId,
        }

        for (const [key, value] of Object.entries(entries)) {
            if (value) {
                params.set(key, value)
            } else {
                params.delete(key)
            }
        }

        const nextQuery = params.toString()
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

        if (nextUrl !== currentUrl) {
            window.history.replaceState(window.history.state, '', nextUrl)
        }
    }, [filters.windowDays, filters.dateFrom, filters.dateTo, filters.campaignId, filters.accountManagerUserId, filters.regionStateId])

    return { dataset, loading, error, filters, setFilters, reload: load }
}
