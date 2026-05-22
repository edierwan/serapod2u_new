'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadPostVisitImpact, type LoadImpactParams } from '@/modules/roadtour/lib/analytics/postVisitImpact'
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

export function useImpactDataset(companyId: string, initial?: Partial<ImpactFilters>) {
    const supabase = useMemo(() => createClient(), [])
    const [filters, setFilters] = useState<ImpactFilters>(() => {
        const w: ImpactWindow = initial?.windowDays ?? 7
        const d = defaultDateRange(w)
        return {
            windowDays: w,
            dateFrom: initial?.dateFrom ?? d.dateFrom,
            dateTo: initial?.dateTo ?? d.dateTo,
            campaignId: initial?.campaignId ?? null,
            accountManagerUserId: initial?.accountManagerUserId ?? null,
            regionStateId: initial?.regionStateId ?? null,
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

    return { dataset, loading, error, filters, setFilters, reload: load }
}
