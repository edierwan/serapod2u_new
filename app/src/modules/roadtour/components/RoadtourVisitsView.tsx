'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getRoadtourLocationStatusLabel, type RoadtourLocationStatus } from '@/lib/roadtour/location-shared'
import { getStateFromCapturedLocation } from '@/lib/roadtour/visit-region'
import {
    AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
    Clock, Download, Eye, Footprints, Loader2, MapPin, RefreshCw, Route, Search, SlidersHorizontal,
    Store, X, XCircle
} from 'lucide-react'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import { toast } from '@/components/ui/use-toast'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'
import { formatVisitDateTime, formatVisitParticipantCsvValue, resolveVisitParticipantDisplay } from '@/modules/roadtour/lib/visit-tracking'
import { mergeVisitParticipants, type VisitParticipantMap } from '@/modules/roadtour/lib/visit-participants'
import {
    MONTH_TO_DATE_LABEL,
    canSelectNextMonth,
    monthCoverageLabel,
    normalizeMonthKey,
    reportingCutoffDate,
    resolveReportingMonth,
    shiftMonthKey,
} from '@/modules/roadtour/lib/reporting/month'
import { UNASSIGNED_AM_LABEL } from '@/modules/roadtour/lib/reporting/types'
import { applySort, nextSortState, type SortState } from '@/modules/roadtour/lib/reporting/tableSort'
import {
    buildUniqueShopRows,
    buildVisitSortColumns,
    hasLocationIssue,
    hasResolvedAccountManager,
    isCompletedVisit,
    visitOutcomeForRow,
    visitTieBreak,
    type VisitSortKey,
} from '@/modules/roadtour/lib/visit-log-table'
import {
    KpiDrilldownDialog,
    KpiDrilldownEmpty,
    KpiDrilldownValue,
    SortableHead,
} from './reporting/ui'
import { RoadtourStateFlag } from './RoadtourStateFlag'

interface RoadtourVisitsViewProps {
    userProfile: any
    onViewChange: (viewId: string) => void
}

interface OfficialVisit {
    id: string
    campaign_id: string
    campaign_name?: string
    account_manager_user_id: string
    user_name?: string
    user_phone?: string
    participant_name?: string | null
    participant_phone?: string | null
    shop_id: string
    shop_name?: string
    shop_branch?: string | null
    shop_address?: string | null
    shop_address_line2?: string | null
    shop_city?: string | null
    shop_state?: string | null
    shop_contact_phone?: string
    visit_date: string
    visit_status: string
    visit_outcome?: string | null
    notes: string | null
    created_at: string
    official_scan_event_id?: string | null
    visit_geo_label?: string | null
    visit_geo_city?: string | null
    visit_geo_state?: string | null
    visit_geo_full_address?: string | null
    visit_geolocation?: { lat?: number; lng?: number; accuracy?: number } | null
    visit_latitude?: number | null
    visit_longitude?: number | null
    visit_accuracy_m?: number | null
    visit_location_status?: RoadtourLocationStatus | null
    visit_location_error?: string | null
    visit_location_captured_at?: string | null
}

interface ScanEvent {
    id: string
    qr_code_id: string
    scanned_by_user_id: string | null
    consumer_name?: string
    consumer_phone?: string | null
    shop_id: string | null
    shop_name?: string
    scan_status: string
    points_awarded: number
    scan_time: string
    geolocation?: { lat?: number; lng?: number; accuracy?: number } | null
    geo_label?: string | null
    geo_full_address?: string | null
    latitude?: number | null
    longitude?: number | null
    accuracy_m?: number | null
    location_status?: RoadtourLocationStatus | null
    location_error?: string | null
    whatsapp_status?: 'sent' | 'delivered' | 'failed' | 'pending' | null
    whatsapp_error?: string | null
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/** Shared with RoadTour Reporting so the selected month follows the manager here too. */
const SHARED_REPORTING_MONTH_KEY = 'roadtour-reporting-month'

function readSharedReportingMonth(): string | null {
    if (typeof window === 'undefined') return null
    const fromUrl = new URLSearchParams(window.location.search).get('month')
    if (fromUrl) return fromUrl
    try {
        return window.sessionStorage.getItem(SHARED_REPORTING_MONTH_KEY)
    } catch {
        return null
    }
}


// Haversine distance in km between two lat/lng points.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const toRad = (v: number) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}





const initialsFor = (name: string | undefined | null) =>
    (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?'

const AVATAR_COLORS = ['bg-[var(--sera-orange)]/10 text-[var(--sera-orange-deep)]', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-[var(--sera-mist)] text-[var(--sera-charcoal)]', 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)]', 'bg-[var(--sera-mist)] text-pink-700']
const colorFor = (key: string) => AVATAR_COLORS[Math.abs([...key].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length]

function uniqueTextParts(parts: Array<string | null | undefined>) {
    const seen = new Set<string>()
    const ordered: string[] = []

    for (const part of parts) {
        const value = typeof part === 'string' ? part.trim() : ''
        if (!value) continue
        const normalized = value.toLowerCase()
        if (seen.has(normalized)) continue
        seen.add(normalized)
        ordered.push(value)
    }

    return ordered
}

function getAccuracyBadge(accuracyMeters?: number | null) {
    if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters)) {
        return {
            label: 'Not captured',
            className: 'border-slate-200 bg-slate-50 text-slate-600',
        }
    }

    if (accuracyMeters <= 30) {
        return {
            label: 'High accuracy',
            className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        }
    }

    if (accuracyMeters <= 100) {
        return {
            label: 'Medium accuracy',
            className: 'border-amber-200 bg-amber-50 text-amber-700',
        }
    }

    return {
        label: 'Low accuracy',
        className: 'border-rose-200 bg-rose-50 text-rose-700',
    }
}

function formatMeters(accuracyMeters?: number | null) {
    return typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)
        ? `${Math.round(accuracyMeters)}m`
        : null
}

function getVisitCoordinates(visit: OfficialVisit) {
    const lat = visit.visit_latitude ?? visit.visit_geolocation?.lat ?? null
    const lng = visit.visit_longitude ?? visit.visit_geolocation?.lng ?? null
    const accuracy = visit.visit_accuracy_m ?? visit.visit_geolocation?.accuracy ?? null
    return {
        lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
        lng: typeof lng === 'number' && Number.isFinite(lng) ? lng : null,
        accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
    }
}

function formatVisitLocationDisplay(visit: OfficialVisit) {
    const coordinates = getVisitCoordinates(visit)
    const hasCoordinates = coordinates.lat !== null && coordinates.lng !== null
    const accuracyBadge = getAccuracyBadge(coordinates.accuracy)

    const shopSummary = uniqueTextParts([
        [visit.shop_city, visit.shop_state].filter(Boolean).join(', '),
        visit.shop_address,
        visit.shop_address_line2,
    ])[0] || null

    const reverseGeocodedSummary = uniqueTextParts([
        [visit.visit_geo_city, visit.visit_geo_state].filter(Boolean).join(', '),
        visit.visit_geo_full_address,
    ])[0] || null

    const readableLabel = visit.visit_location_status === 'resolved'
        ? visit.visit_geo_label?.trim() || null
        : null
    const title = readableLabel
        || reverseGeocodedSummary
        || shopSummary
        || (hasCoordinates ? 'Location captured' : 'Location unavailable')

    const capturedState = getStateFromCapturedLocation(visit.visit_geo_state)
        || getStateFromCapturedLocation(visit.visit_geo_full_address)
        || getStateFromCapturedLocation(visit.visit_geo_label)

    const metaParts: string[] = []
    const accuracyLabel = formatMeters(coordinates.accuracy)
    if (accuracyLabel) metaParts.push(accuracyLabel)

    if (hasCoordinates && !readableLabel && !shopSummary && !reverseGeocodedSummary) {
        metaParts.unshift('GPS available')
    }

    if (!hasCoordinates) {
        metaParts.push(visit.visit_location_error?.trim() || getRoadtourLocationStatusLabel(visit.visit_location_status, false))
    } else if (visit.visit_location_status && visit.visit_location_status !== 'resolved' && visit.visit_location_status !== 'captured') {
        metaParts.push(getRoadtourLocationStatusLabel(visit.visit_location_status, true))
    }

    return {
        title,
        capturedState,
        accuracyBadge,
        metaParts: uniqueTextParts(metaParts),
        coordinates,
    }
}

function accountManagerLabel(v: OfficialVisit): string {
    return hasResolvedAccountManager(v) ? (v.user_name as string) : UNASSIGNED_AM_LABEL
}

/** The columns sort on exactly the values the Visit Activity rows display. */
const VISIT_SORT_COLUMNS = buildVisitSortColumns<OfficialVisit>({
    participantName: (v) => {
        const display = resolveVisitParticipantDisplay(v.participant_name, v.participant_phone)
        return display.isPlaceholder ? null : display.primary
    },
    locationTitle: (v) => formatVisitLocationDisplay(v).title,
})

type VisitKpiKey = 'total' | 'uniqueShops' | 'completed' | 'locationIssues'

const VISIT_KPI_TITLE: Record<VisitKpiKey, string> = {
    total: 'Total Visits',
    uniqueShops: 'Unique Shops',
    completed: 'Completed Visits',
    locationIssues: 'Location Issues',
}

export function RoadtourVisitsView({ userProfile }: RoadtourVisitsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    const [visits, setVisits] = useState<OfficialVisit[]>([])
    const [campaigns, setCampaigns] = useState<{ id: string; name: string; roadtour_run_id?: string | null }[]>([])
    const [references, setReferences] = useState<{ id: string; full_name: string }[]>([])
    const [runs, setRuns] = useState<RoadtourRun[]>([])

    // Filters
    const [runFilter, setRunFilter] = useState('all')
    const [campaignFilter, setCampaignFilter] = useState('all')
    const [referenceFilter, setReferenceFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')
    const [filtersOpen, setFiltersOpen] = useState(false)

    // The Visit Log follows the same month selection as the rest of RoadTour Reporting.
    const [monthKey, setMonthKey] = useState<string>(() => normalizeMonthKey(readSharedReportingMonth()))
    const month = useMemo(() => resolveReportingMonth(monthKey), [monthKey])
    const dateFrom = month.startDate
    const dateTo = reportingCutoffDate(month)

    useEffect(() => {
        if (typeof window === 'undefined') return
        try {
            window.sessionStorage.setItem(SHARED_REPORTING_MONTH_KEY, monthKey)
        } catch {
            // Session storage is unavailable in some privacy modes; the month still applies here.
        }
    }, [monthKey])

    const activeFilterCount = [runFilter, campaignFilter, referenceFilter, statusFilter]
        .filter((value) => value !== 'all').length

    // Pagination
    const [pageSize, setPageSize] = useState(25)
    const [page, setPage] = useState(1)

    // Sorting stays null until the user picks a column, so the default order is
    // whatever the query returned: visit_date DESC, created_at DESC.
    const [sort, setSort] = useState<SortState<VisitSortKey> | null>(null)
    const [kpiDrilldown, setKpiDrilldown] = useState<VisitKpiKey | null>(null)

    // Detail dialog
    const [detailOpen, setDetailOpen] = useState(false)
    const [detailVisit, setDetailVisit] = useState<OfficialVisit | null>(null)
    const [scans, setScans] = useState<ScanEvent[]>([])
    const [scansLoading, setScansLoading] = useState(false)

    // Participant names arrive in a second round trip, so a slower earlier load
    // must not overwrite the rows a newer one has already put on screen.
    const loadSequenceRef = useRef(0)

    /**
     * Resolve participants on the server.
     *
     * `users` is RLS-scoped to the viewer's own organization and a participant is
     * a shop or consumer account outside HQ, so the browser cannot read the user
     * a scan is linked to — it saw an empty embed and rendered a correctly linked
     * participant as "Unregistered Participant". The API route re-applies the same
     * organization scope and resolves the names with the service role, exactly as
     * RoadTour Reporting does.
     */
    const hydrateParticipants = useCallback(async (rows: OfficialVisit[], requestId: number) => {
        const visitIds = rows.filter((v) => v.official_scan_event_id).map((v) => v.id)
        if (visitIds.length === 0) return

        try {
            const response = await fetch('/api/roadtour/visits/participants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: companyId, visit_ids: visitIds }),
            })
            const payload = await response.json().catch(() => null)
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || `Participant lookup failed (${response.status})`)
            }
            if (requestId !== loadSequenceRef.current) return
            setVisits((current) => mergeVisitParticipants(current, payload.data as VisitParticipantMap))
        } catch (err) {
            // The rows already carry whatever the browser itself could read, so the
            // log stays usable and only the registered names are missing.
            console.warn('[RoadtourVisits] participant resolution skipped', err)
        }
    }, [companyId])

    const loadVisits = useCallback(async () => {
        const requestId = ++loadSequenceRef.current
        try {
            const isInitial = !refreshing
            if (isInitial) setLoading(true)
            let q = (supabase as any)
                .from('roadtour_official_visits')
                .select('*, roadtour_campaigns!inner(name, org_id), users:account_manager_user_id(full_name, phone), organizations:shop_id(org_name, branch, address, address_line2, contact_phone, city, states:state_id(state_name)), official_scan:official_scan_event_id(geo_label, geo_city, geo_state, geo_full_address, geolocation, latitude, longitude, accuracy_m, location_status, location_error, location_captured_at, consumer_phone, scanned_by_user_id, participant_user:scanned_by_user_id(full_name, phone))')
                .eq('roadtour_campaigns.org_id', companyId)
                .order('visit_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(500)

            if (campaignFilter !== 'all') q = q.eq('campaign_id', campaignFilter)
            else if (runFilter !== 'all') q = q.eq('roadtour_run_id', runFilter)
            if (referenceFilter !== 'all') q = q.eq('account_manager_user_id', referenceFilter)
            if (dateFrom) q = q.gte('visit_date', dateFrom)
            if (dateTo) q = q.lte('visit_date', dateTo)

            const { data, error } = await q
            if (error) throw error

            const normalized: OfficialVisit[] = (data || []).map((v: any) => ({
                ...v,
                campaign_name: v.roadtour_campaigns?.name || '—',
                user_name: v.users?.full_name || '—',
                user_phone: v.users?.phone || '',
                participant_name: v.official_scan?.participant_user?.full_name || null,
                participant_phone: v.official_scan?.participant_user?.phone || v.official_scan?.consumer_phone || null,
                shop_name: v.organizations?.org_name || '—',
                shop_branch: v.organizations?.branch || null,
                shop_address: v.organizations?.address || null,
                shop_address_line2: v.organizations?.address_line2 || null,
                shop_city: v.organizations?.city || null,
                shop_state: v.organizations?.states?.state_name || null,
                shop_contact_phone: v.organizations?.contact_phone || '',
                visit_geo_label: v.official_scan?.geo_label || null,
                visit_geo_city: v.official_scan?.geo_city || null,
                visit_geo_state: v.official_scan?.geo_state || null,
                visit_geo_full_address: v.official_scan?.geo_full_address || null,
                visit_geolocation: v.official_scan?.geolocation || null,
                visit_latitude: v.official_scan?.latitude ?? null,
                visit_longitude: v.official_scan?.longitude ?? null,
                visit_accuracy_m: v.official_scan?.accuracy_m ?? null,
                visit_location_status: v.official_scan?.location_status || null,
                visit_location_error: v.official_scan?.location_error || null,
                visit_location_captured_at: v.official_scan?.location_captured_at || null,
            }))
            setVisits(normalized)
            setLastUpdated(new Date())
            void hydrateParticipants(normalized, requestId)

            const { data: cData } = await (supabase as any)
                .from('roadtour_campaigns')
                .select('id, name, roadtour_run_id')
                .eq('org_id', companyId)
                .order('name')
            setCampaigns(cData || [])

            try {
                const runsData = await fetchRoadtourRuns(supabase, companyId)
                setRuns(runsData)
            } catch (runErr) {
                console.warn('[RoadtourVisits] runs load skipped', runErr)
            }

            // References = users who appear in any visit; fall back to org members eligible.
            const refMap = new Map<string, string>()
            for (const v of normalized) {
                if (v.account_manager_user_id) refMap.set(v.account_manager_user_id, v.user_name || '—')
            }
            setReferences(Array.from(refMap.entries()).map(([id, full_name]) => ({ id, full_name })))
        } catch (err: any) {
            console.error('[RoadtourVisits] load failed', err)
            toast({ title: 'Error', description: 'Failed to load visits.', variant: 'destructive' })
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [companyId, supabase, runFilter, campaignFilter, referenceFilter, dateFrom, dateTo, refreshing, hydrateParticipants])

    useEffect(() => { loadVisits() }, [loadVisits])

    const filtered = useMemo(() => {
        return visits.filter((v) => {
            if (statusFilter !== 'all' && v.visit_status !== statusFilter) return false
            if (searchTerm) {
                const term = searchTerm.toLowerCase()
                if (!v.user_name?.toLowerCase().includes(term)
                    && !v.participant_name?.toLowerCase().includes(term)
                    && !v.participant_phone?.toLowerCase().includes(term)
                    && !v.shop_name?.toLowerCase().includes(term)
                    && !v.campaign_name?.toLowerCase().includes(term)) return false
            }
            return true
        })
    }, [visits, statusFilter, searchTerm])

    // KPI metrics with trends (current window vs equivalent previous window)
    const metrics = useMemo(() => {
        const total = filtered.length
        const uniqueShops = new Set(filtered.map((v) => v.shop_id)).size
        const completed = filtered.filter(isCompletedVisit).length
        const completedPct = total > 0 ? (completed / total) * 100 : 0
        const locationIssues = filtered.filter(hasLocationIssue).length
        const locationIssuePct = total > 0 ? (locationIssues / total) * 100 : 0

        // Distance: per-reference, sum haversine between consecutive geolocated visits chronological
        const byRef = new Map<string, OfficialVisit[]>()
        for (const v of filtered) {
            if (!v.visit_geolocation?.lat || !v.visit_geolocation?.lng) continue
            const list = byRef.get(v.account_manager_user_id) || []
            list.push(v)
            byRef.set(v.account_manager_user_id, list)
        }
        let totalKm = 0
        for (const list of byRef.values()) {
            const sorted = [...list].sort((a, b) => (a.visit_date + a.created_at).localeCompare(b.visit_date + b.created_at))
            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1].visit_geolocation
                const cur = sorted[i].visit_geolocation
                if (prev?.lat != null && prev?.lng != null && cur?.lat != null && cur?.lng != null) {
                    totalKm += haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: cur.lat, lng: cur.lng })
                }
            }
        }

        return {
            total, uniqueShops, completed, completedPct,
            locationIssues, locationIssuePct,
            totalKm,
        }
    }, [filtered])

    // Distance between consecutive visits per same reference (chronological)
    const distanceByVisitId = useMemo(() => {
        const map = new Map<string, { km: number; level: 'low' | 'medium' | 'high' } | null>()
        const byRef = new Map<string, OfficialVisit[]>()
        for (const v of filtered) {
            const list = byRef.get(v.account_manager_user_id) || []
            list.push(v)
            byRef.set(v.account_manager_user_id, list)
        }
        for (const list of byRef.values()) {
            const sorted = [...list].sort((a, b) => (a.visit_date + a.created_at).localeCompare(b.visit_date + b.created_at))
            for (let i = 0; i < sorted.length; i++) {
                if (i === 0) { map.set(sorted[i].id, null); continue }
                const prev = sorted[i - 1].visit_geolocation
                const cur = sorted[i].visit_geolocation
                if (prev?.lat != null && prev?.lng != null && cur?.lat != null && cur?.lng != null) {
                    const km = haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: cur.lat, lng: cur.lng })
                    const level: 'low' | 'medium' | 'high' = km < 10 ? 'low' : km < 50 ? 'medium' : 'high'
                    map.set(sorted[i].id, { km, level })
                } else {
                    map.set(sorted[i].id, null)
                }
            }
        }
        return map
    }, [filtered])

    // The default order is the one the query already produced; a user-selected
    // column replaces it only for as long as that column is selected.
    const ordered = useMemo(() => (
        sort ? applySort(filtered, VISIT_SORT_COLUMNS[sort.key], sort.direction, visitTieBreak) : filtered
    ), [filtered, sort])

    // Pagination
    const totalEntries = ordered.length
    const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
    const safePage = Math.min(page, totalPages)
    const pageStart = (safePage - 1) * pageSize
    const pageItems = ordered.slice(pageStart, pageStart + pageSize)

    useEffect(() => { setPage(1) }, [pageSize, statusFilter, runFilter, campaignFilter, referenceFilter, searchTerm, dateFrom, dateTo, sort])

    const handleSort = (key: VisitSortKey) => {
        setSort((current) => nextSortState(current, key))
        setPage(1)
    }

    // Every drill-down list is derived from `filtered` with the same predicate
    // its KPI counts with, so a card can never disagree with its own dialog.
    const uniqueShopRows = useMemo(() => buildUniqueShopRows(filtered), [filtered])
    const drilldownVisits = useMemo(() => {
        if (kpiDrilldown === 'total') return filtered
        if (kpiDrilldown === 'completed') return filtered.filter(isCompletedVisit)
        if (kpiDrilldown === 'locationIssues') return filtered.filter(hasLocationIssue)
        return []
    }, [filtered, kpiDrilldown])
    const drilldownCount = kpiDrilldown === 'uniqueShops' ? uniqueShopRows.length : drilldownVisits.length

    const openDetail = async (visit: OfficialVisit) => {
        setDetailVisit(visit)
        setDetailOpen(true)
        setScansLoading(true)
        try {
            const { data, error } = await (supabase as any)
                .from('roadtour_scan_events')
                .select('*, users:scanned_by_user_id(full_name, phone), organizations:shop_id(org_name)')
                .eq('campaign_id', visit.campaign_id)
                .eq('account_manager_user_id', visit.account_manager_user_id)
                .eq('shop_id', visit.shop_id)
                .gte('scan_time', visit.visit_date + 'T00:00:00')
                .lt('scan_time', visit.visit_date + 'T23:59:59')
                .order('scan_time', { ascending: false })

            if (error) throw error
            setScans((data || []).map((s: any) => ({
                ...s,
                consumer_name: s.users?.full_name || s.consumer_phone || null,
                consumer_phone: s.users?.phone || s.consumer_phone || null,
                shop_name: s.organizations?.org_name || null,
            })))
        } catch {
            toast({ title: 'Error', description: 'Failed to load scan details.', variant: 'destructive' })
        } finally {
            setScansLoading(false)
        }
    }

    const handleRefresh = () => {
        setRefreshing(true)
        loadVisits()
    }

    const handleExport = () => {
        const headers = ['Date', 'Time', 'Account Manager', 'Participant', 'Shop', 'Campaign', 'Location', 'Distance (km)', 'Visit Status']
        const rows = filtered.map((v) => {
            const dist = distanceByVisitId.get(v.id)
            const status = visitOutcomeForRow(v)
            const locationDisplay = formatVisitLocationDisplay(v)
            const dateTime = formatVisitDateTime(v.visit_date, v.created_at)
            return [
                dateTime.dateLabel,
                dateTime.timeLabel,
                v.account_manager_user_id && v.user_name && v.user_name !== '—' ? v.user_name : UNASSIGNED_AM_LABEL,
                formatVisitParticipantCsvValue(v.participant_name, v.participant_phone),
                `${v.shop_name}${v.shop_branch ? ' - ' + v.shop_branch : ''}`,
                v.campaign_name || '',
                [locationDisplay.title, locationDisplay.accuracyBadge.label, ...locationDisplay.metaParts].filter(Boolean).join(' · '),
                dist ? dist.km.toFixed(1) : '',
                status.label,
            ]
        })
        const csv = [headers, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `roadtour-visit-log-${monthKey}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const rewardStatusColor: Record<string, string> = {
        opened: 'bg-amber-100 text-amber-700',
        success: 'bg-emerald-100 text-emerald-700',
        duplicate: 'bg-gray-100 text-gray-700',
        rejected: 'bg-red-100 text-red-700',
        invalid: 'bg-red-100 text-red-700',
        expired: 'bg-gray-100 text-gray-700',
    }

    const whatsappStatusConfig: Record<string, { icon: any; className: string; label: string }> = {
        sent: { icon: CheckCircle2, className: 'text-[var(--sera-orange)]', label: 'WhatsApp sent' },
        delivered: { icon: CheckCircle2, className: 'text-emerald-600', label: 'WhatsApp delivered' },
        failed: { icon: XCircle, className: 'text-red-600', label: 'WhatsApp failed' },
        pending: { icon: Clock, className: 'text-amber-600', label: 'WhatsApp pending' },
    }

    const hasScanCoordinates = (scan: ScanEvent) => scan.latitude != null && scan.longitude != null

    const getGeoScanSummary = (scan: ScanEvent) => {
        const label = scan.geo_label?.trim()
        if (label && scan.location_status === 'resolved') return `GeoLoc: ${label}`
        return `GeoLoc: ${getRoadtourLocationStatusLabel(scan.location_status, hasScanCoordinates(scan))}`
    }

    const getVisitGeoSummary = (visit: OfficialVisit) => {
        const label = visit.visit_geo_label?.trim()
        if (label && visit.visit_location_status === 'resolved') return label
        return getRoadtourLocationStatusLabel(visit.visit_location_status, Boolean(visit.visit_geolocation?.lat != null && visit.visit_geolocation?.lng != null))
    }

    if (loading) return <SeraLoadingState variant="page" />

    const lastUpdatedLabel = lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    return (
        <div className="sera-sc-page space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="sera-sc-header__bar mb-3 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--sera-muted)]">
                        RoadTour Reporting
                    </p>
                    <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--sera-ink)] sm:text-3xl">
                        <MapPin className="h-5 w-5 text-[var(--sera-orange)]" />
                        Visit Log
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                        Operational record of every official visit in the selected month, with location evidence and full visit detail.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        Last updated: {lastUpdatedLabel}
                        <button onClick={handleRefresh} className="ml-1 inline-flex items-center justify-center text-muted-foreground hover:text-foreground" title="Refresh">
                            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </span>
                    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
                        <Download className="h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            {/* Month selector, one search field, everything else under More Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-[var(--sera-line)] bg-white px-1 py-1">
                    <Button
                        type="button" variant="ghost" size="sm" className="h-8 w-8 p-0"
                        aria-label="Previous month"
                        onClick={() => setMonthKey((current) => shiftMonthKey(current, -1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[9.5rem] text-center font-display text-sm font-semibold text-[var(--sera-ink)]">
                        {month.label}
                    </span>
                    <Button
                        type="button" variant="ghost" size="sm" className="h-8 w-8 p-0"
                        aria-label="Next month"
                        disabled={!canSelectNextMonth(monthKey)}
                        title={canSelectNextMonth(monthKey) ? undefined : 'Future months are not available'}
                        onClick={() => setMonthKey((current) => (canSelectNextMonth(current) ? shiftMonthKey(current, 1) : current))}
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

                <div className="relative min-w-[16rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search account manager, participant, shop or campaign"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                    />
                </div>

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
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">RoadTour Event</label>
                            <Select value={runFilter} onValueChange={(v) => { setRunFilter(v); setCampaignFilter('all') }}>
                                <SelectTrigger><SelectValue placeholder="All Events" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Events</SelectItem>
                                    {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Campaign</label>
                            <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                                <SelectTrigger><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Campaigns</SelectItem>
                                    {campaigns
                                        .filter((c) => runFilter === 'all' || c.roadtour_run_id === runFilter)
                                        .map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Account Manager</label>
                            <Select value={referenceFilter} onValueChange={setReferenceFilter}>
                                <SelectTrigger><SelectValue placeholder="All Account Managers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Account Managers</SelectItem>
                                    {references.map((r) => <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Visit Status</label>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="official">Completed</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {activeFilterCount > 0 && (
                            <Button
                                type="button" variant="ghost" size="sm" className="w-full"
                                onClick={() => {
                                    setRunFilter('all'); setCampaignFilter('all')
                                    setReferenceFilter('all'); setStatusFilter('all')
                                    setFiltersOpen(false)
                                }}
                            >
                                <X className="mr-1.5 h-3.5 w-3.5" />Clear filters
                            </Button>
                        )}
                    </PopoverContent>
                </Popover>
            </div>

            {/* KPI Cards — four primary metrics; route distance lives in the detail and export. */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiCard
                    icon={<Footprints className="h-5 w-5 text-[var(--sera-orange)]" />}
                    iconBg="bg-[var(--sera-orange)]/10"
                    label="Total Visits"
                    value={<KpiDrilldownValue value={metrics.total} label="Total Visits" onOpen={() => setKpiDrilldown('total')} />}
                    sub={monthCoverageLabel(month)}
                />
                <KpiCard
                    icon={<Store className="h-5 w-5 text-emerald-600" />}
                    iconBg="bg-emerald-100"
                    label="Unique Shops"
                    value={<KpiDrilldownValue value={metrics.uniqueShops} label="Unique Shops" onOpen={() => setKpiDrilldown('uniqueShops')} />}
                    sub="distinct shops visited"
                />
                <KpiCard
                    icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                    iconBg="bg-emerald-100"
                    label="Completed Visits"
                    value={<KpiDrilldownValue value={metrics.completed} label="Completed Visits" onOpen={() => setKpiDrilldown('completed')} />}
                    sub={`${metrics.completedPct.toFixed(1)}% of total visits`}
                />
                <KpiCard
                    icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
                    iconBg="bg-amber-100"
                    label="Location Issues"
                    value={<KpiDrilldownValue value={metrics.locationIssues} label="Location Issues" onOpen={() => setKpiDrilldown('locationIssues')} />}
                    sub={`${metrics.locationIssuePct.toFixed(1)}% of total visits`}
                />
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Route className="h-3.5 w-3.5" />
                Estimated route distance this month: {metrics.totalKm.toFixed(1)} km — per-visit distance is in the visit detail and the export.
            </p>

            {/* Visit Activity Table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-base">Visit Activity</CardTitle>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Show</span>
                        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
                            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <span>entries</span>
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                <TableHead className="w-10 text-right">#</TableHead>
                                <SortableHead label="Visit Date / Time" sortKey="date" sort={sort} onSort={handleSort} />
                                <SortableHead label="Account Manager" sortKey="accountManager" sort={sort} onSort={handleSort} />
                                <SortableHead label="Participant" sortKey="participant" sort={sort} onSort={handleSort} />
                                <SortableHead label="Shop" sortKey="shop" sort={sort} onSort={handleSort} />
                                <SortableHead label="Campaign" sortKey="campaign" sort={sort} onSort={handleSort} />
                                <SortableHead label="Location Status" sortKey="locationStatus" sort={sort} onSort={handleSort} />
                                <SortableHead label="Visit Status" sortKey="visitStatus" sort={sort} onSort={handleSort} />
                                <TableHead className="text-right">Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                            {pageItems.length === 0 && (
                                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No visits found in {month.label}.</TableCell></TableRow>
                            )}
                            {pageItems.map((v, index) => {
                                const status = visitOutcomeForRow(v)
                                const locationDisplay = formatVisitLocationDisplay(v)
                                const dateTime = formatVisitDateTime(v.visit_date, v.created_at)
                                const participantDisplay = resolveVisitParticipantDisplay(v.participant_name, v.participant_phone)
                                const hasAccountManager = hasResolvedAccountManager(v)
                                const amLabel = accountManagerLabel(v)
                                const locColor = v.visit_location_status === 'resolved' ? 'text-emerald-600'
                                    : v.visit_location_status ? 'text-amber-600' : 'text-muted-foreground'
                                const statusBadge = status.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700'
                                    : status.tone === 'amber' ? 'bg-amber-100 text-amber-700'
                                        : status.tone === 'red' ? 'bg-red-100 text-red-700'
                                            : 'bg-slate-100 text-slate-700'
                                return (
                                    <TableRow key={v.id}>
                                        <TableCell className="text-right tabular-nums text-[11px] text-muted-foreground">{pageStart + index + 1}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <div className="font-medium">{dateTime.dateLabel}</div>
                                            <div className="text-[11px] text-muted-foreground">{dateTime.timeLabel}</div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${colorFor(v.account_manager_user_id || 'unassigned')}`}>{initialsFor(amLabel)}</div>
                                                <span className={`max-w-[9rem] font-medium ${hasAccountManager ? '' : 'text-amber-700'}`} title={amLabel}>{amLabel}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="max-w-[10rem]">
                                                <p className={`font-medium ${participantDisplay.isPlaceholder ? 'text-muted-foreground' : ''}`}>{participantDisplay.primary}</p>
                                                {participantDisplay.secondary && (
                                                    <p className="text-[11px] text-muted-foreground">{participantDisplay.secondary}</p>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="min-w-[8rem] max-w-[12rem]">
                                                <p className="font-medium">{v.shop_name}</p>
                                                {(v.shop_branch || v.shop_state) && (
                                                    <p className="text-[11px] text-muted-foreground">{[v.shop_branch, v.shop_state].filter(Boolean).join(', ')}</p>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{v.campaign_name}</TableCell>
                                        <TableCell>
                                            <div className="flex items-start gap-2">
                                                <RoadtourStateFlag stateName={locationDisplay.capturedState} size="md" fallback="placeholder" />
                                                <div className="min-w-0 max-w-[16rem] space-y-1">
                                                    <div className={`flex items-center gap-1 ${locColor}`}>
                                                        <span className="font-medium text-foreground" title={locationDisplay.title}>{locationDisplay.title}</span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                                                        <Badge variant="outline" className={`border px-1.5 py-0 text-[10px] ${locationDisplay.accuracyBadge.className}`}>
                                                            {locationDisplay.accuracyBadge.label}
                                                        </Badge>
                                                        {locationDisplay.metaParts.map((part) => (
                                                            <span key={part}>{part}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={`whitespace-nowrap ${statusBadge}`}>{status.label}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" variant="ghost" onClick={() => openDetail(v)}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
                {totalEntries > 0 && (
                    <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                            Showing {pageStart + 1} to {Math.min(pageStart + pageSize, totalEntries)} of {totalEntries} entries
                        </p>
                        <div className="flex items-center gap-1">
                            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let p: number
                                if (totalPages <= 5) p = i + 1
                                else if (safePage <= 3) p = i + 1
                                else if (safePage >= totalPages - 2) p = totalPages - 4 + i
                                else p = safePage - 2 + i
                                return (
                                    <Button key={p} variant={p === safePage ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)} className="w-9 h-8 p-0">
                                        {p}
                                    </Button>
                                )
                            })}
                            {totalPages > 5 && safePage < totalPages - 2 && (
                                <>
                                    <span className="px-1 text-muted-foreground">…</span>
                                    <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} className="w-9 h-8 p-0">{totalPages}</Button>
                                </>
                            )}
                            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            {/* KPI drill-downs — every row comes from the same `filtered` set the KPI counts. */}
            <KpiDrilldownDialog
                open={kpiDrilldown !== null}
                onOpenChange={(open) => { if (!open) setKpiDrilldown(null) }}
                title={kpiDrilldown
                    ? `${VISIT_KPI_TITLE[kpiDrilldown]} — ${drilldownCount} ${kpiDrilldown === 'uniqueShops'
                        ? (drilldownCount === 1 ? 'Shop' : 'Shops')
                        : (drilldownCount === 1 ? 'Visit' : 'Visits')}`
                    : ''}
                subtitle={monthCoverageLabel(month)}
            >
                {drilldownCount === 0 ? (
                    <KpiDrilldownEmpty message="No records for this metric." />
                ) : kpiDrilldown === 'uniqueShops' ? (
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                <TableHead className="w-10 text-right">#</TableHead>
                                <TableHead>Shop</TableHead>
                                <TableHead>Region/State</TableHead>
                                <TableHead>Latest Visit</TableHead>
                                <TableHead>Account Manager</TableHead>
                                <TableHead className="text-right">Visit Count</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                            {uniqueShopRows.map((shop, index) => (
                                <TableRow key={shop.shopId}>
                                    <TableCell className="text-right tabular-nums text-[11px] text-muted-foreground">{index + 1}</TableCell>
                                    <TableCell className="font-medium">{shop.shopName}</TableCell>
                                    <TableCell>{shop.region || '—'}</TableCell>
                                    <TableCell className="whitespace-nowrap">
                                        {formatVisitDateTime(shop.latestVisit.visit_date, shop.latestVisit.created_at).dateLabel}
                                    </TableCell>
                                    <TableCell>{accountManagerLabel(shop.latestVisit)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{shop.visitCount}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : kpiDrilldown === 'locationIssues' ? (
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                <TableHead className="w-10 text-right">#</TableHead>
                                <TableHead>Visit Date / Time</TableHead>
                                <TableHead>Account Manager</TableHead>
                                <TableHead>Shop</TableHead>
                                <TableHead>Location Status</TableHead>
                                <TableHead>Location Message</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                            {drilldownVisits.map((v, index) => {
                                const dateTime = formatVisitDateTime(v.visit_date, v.created_at)
                                return (
                                    <TableRow key={v.id}>
                                        <TableCell className="text-right tabular-nums text-[11px] text-muted-foreground">{index + 1}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <div className="font-medium">{dateTime.dateLabel}</div>
                                            <div className="text-[11px] text-muted-foreground">{dateTime.timeLabel}</div>
                                        </TableCell>
                                        <TableCell>{accountManagerLabel(v)}</TableCell>
                                        <TableCell className="font-medium">{v.shop_name}</TableCell>
                                        <TableCell className="text-amber-700">
                                            {getRoadtourLocationStatusLabel(v.visit_location_status, getVisitCoordinates(v).lat !== null && getVisitCoordinates(v).lng !== null)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {v.visit_location_error?.trim() || formatVisitLocationDisplay(v).title}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                ) : (
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-xs">
                                <TableHead className="w-10 text-right">#</TableHead>
                                <TableHead>Visit Date / Time</TableHead>
                                <TableHead>Account Manager</TableHead>
                                <TableHead>Participant</TableHead>
                                <TableHead>Shop</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Visit Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="[&>tr>td]:px-3 [&>tr>td]:py-2">
                            {drilldownVisits.map((v, index) => {
                                const dateTime = formatVisitDateTime(v.visit_date, v.created_at)
                                const participantDisplay = resolveVisitParticipantDisplay(v.participant_name, v.participant_phone)
                                return (
                                    <TableRow key={v.id}>
                                        <TableCell className="text-right tabular-nums text-[11px] text-muted-foreground">{index + 1}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <div className="font-medium">{dateTime.dateLabel}</div>
                                            <div className="text-[11px] text-muted-foreground">{dateTime.timeLabel}</div>
                                        </TableCell>
                                        <TableCell>{accountManagerLabel(v)}</TableCell>
                                        <TableCell className={participantDisplay.isPlaceholder ? 'text-muted-foreground' : ''}>
                                            {participantDisplay.primary}
                                        </TableCell>
                                        <TableCell className="font-medium">{v.shop_name}</TableCell>
                                        <TableCell>{v.campaign_name}</TableCell>
                                        <TableCell>{visitOutcomeForRow(v).label}</TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </KpiDrilldownDialog>

            {/* Detail Dialog */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Visit Details</DialogTitle>
                    </DialogHeader>
                    {detailVisit && (
                        <div className="space-y-4">
                            {(() => {
                                const locationDisplay = formatVisitLocationDisplay(detailVisit)
                                const participantDisplay = resolveVisitParticipantDisplay(detailVisit.participant_name, detailVisit.participant_phone)
                                return (
                                    <>
                                        <div className="rounded-lg border p-4">
                                            <Label className="text-sm font-semibold">Location</Label>
                                            <div className="mt-2 space-y-2 text-sm">
                                                <p className="font-medium">{locationDisplay.title}</p>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <Badge variant="outline" className={`border ${locationDisplay.accuracyBadge.className}`}>
                                                        {locationDisplay.accuracyBadge.label}
                                                    </Badge>
                                                    {locationDisplay.metaParts.map((part) => (
                                                        <span key={part}>{part}</span>
                                                    ))}
                                                </div>
                                                {(locationDisplay.coordinates.lat != null && locationDisplay.coordinates.lng != null) && (
                                                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs text-muted-foreground">
                                                        <div>
                                                            <p className="font-medium text-foreground">Latitude</p>
                                                            <p>{locationDisplay.coordinates.lat.toFixed(6)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-foreground">Longitude</p>
                                                            <p>{locationDisplay.coordinates.lng.toFixed(6)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-foreground">Accuracy</p>
                                                            <p>{formatMeters(locationDisplay.coordinates.accuracy) || 'Not captured'}</p>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-foreground">Captured at</p>
                                                            <p>{detailVisit.visit_location_captured_at ? new Date(detailVisit.visit_location_captured_at).toLocaleString() : '—'}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div><Label className="text-muted-foreground">Date</Label><p className="font-medium">{detailVisit.visit_date}</p></div>
                                            <div><Label className="text-muted-foreground">Campaign</Label><p className="font-medium">{detailVisit.campaign_name}</p></div>
                                            <div><Label className="text-muted-foreground">Reference</Label><p className="font-medium">{detailVisit.user_name}</p>{detailVisit.user_phone && <p className="text-xs text-muted-foreground">{detailVisit.user_phone}</p>}</div>
                                            <div><Label className="text-muted-foreground">Shop</Label><p className="font-medium">{detailVisit.shop_name}</p>{detailVisit.shop_contact_phone && <p className="text-xs text-muted-foreground">{detailVisit.shop_contact_phone}</p>}</div>
                                            <div><Label className="text-muted-foreground">User</Label><p className={`font-medium ${participantDisplay.isPlaceholder ? 'text-muted-foreground' : ''}`}>{participantDisplay.primary}</p>{participantDisplay.secondary && <p className="text-xs text-muted-foreground">{participantDisplay.secondary}</p>}</div>
                                            <div><Label className="text-muted-foreground">Status</Label><p className="font-medium">{detailVisit.visit_status}</p></div>
                                            <div><Label className="text-muted-foreground">Date Created</Label><p className="font-medium">{new Date(detailVisit.created_at).toLocaleString()}</p></div>
                                        </div>
                                    </>
                                )
                            })()}

                            <div>
                                <Label className="text-sm font-semibold">Scan Events</Label>
                                {scansLoading ? (
                                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                                ) : scans.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-2">No scan events for this visit.</p>
                                ) : (
                                    <div className="space-y-2 mt-2">
                                        {scans.map((s) => (
                                            <div key={s.id} className="rounded-lg border p-3 flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium">{s.consumer_name || 'Unknown'}</p>
                                                    {s.consumer_phone && s.consumer_phone !== s.consumer_name && <p className="text-xs text-muted-foreground">{s.consumer_phone}</p>}
                                                    <p className="text-xs text-muted-foreground">{new Date(s.scan_time).toLocaleString()}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{getGeoScanSummary(s)}</p>
                                                    {s.geo_full_address && <p className="text-xs text-muted-foreground mt-1">{s.geo_full_address}</p>}
                                                    <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
                                                        <p>Status: {getRoadtourLocationStatusLabel(s.location_status, hasScanCoordinates(s))}</p>
                                                        {(s.latitude != null && s.longitude != null) && (
                                                            <p>Coordinates: {s.latitude.toFixed(6)}, {s.longitude.toFixed(6)}{typeof s.accuracy_m === 'number' ? ` (${Math.round(s.accuracy_m)} m)` : ''}</p>
                                                        )}
                                                        {s.location_error && <p>Location error: {s.location_error}</p>}
                                                    </div>
                                                    {s.whatsapp_error && <p className="text-xs text-red-600 mt-1">{s.whatsapp_error}</p>}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {s.points_awarded > 0 && <span className="text-sm font-medium text-emerald-600">+{s.points_awarded} pts</span>}
                                                    {s.whatsapp_status && (() => {
                                                        const statusConfig = whatsappStatusConfig[s.whatsapp_status]
                                                        if (!statusConfig) return null
                                                        const StatusIcon = statusConfig.icon
                                                        return <StatusIcon className={`h-4 w-4 ${statusConfig.className}`} title={statusConfig.label} />
                                                    })()}
                                                    <Badge className={rewardStatusColor[s.scan_status] || ''}>{s.scan_status}</Badge>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

function KpiCard({ icon, iconBg, label, value, sub }: {
    icon: React.ReactNode
    iconBg: string
    label: string
    value: React.ReactNode
    sub?: string
}) {
    return (
        <Card>
            <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-1 text-2xl font-bold">{value}</p>
                        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>{icon}</div>
                </div>
            </CardContent>
        </Card>
    )
}
