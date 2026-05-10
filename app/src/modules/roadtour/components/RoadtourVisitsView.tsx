'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getRoadtourLocationStatusLabel, type RoadtourLocationStatus } from '@/lib/roadtour/location-shared'
import {
    AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight,
    Clock, Download, Eye, Footprints, Loader2, MapPin, RefreshCw, Route, Search, SlidersHorizontal,
    Store, Users, XCircle
} from 'lucide-react'
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts'
import { toast } from '@/components/ui/use-toast'

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

const REGION_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#06b6d4', '#ef4444', '#84cc16', '#f97316']

function formatLocalIsoDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
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

function todayIsoDate(): string {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return formatLocalIsoDate(d)
}

function isoDateAddDays(iso: string, days: number): string {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + days)
    return formatLocalIsoDate(d)
}

function formatTrendPct(curr: number, prev: number): { sign: '+' | '-'; value: string } | null {
    if (prev <= 0) return curr > 0 ? { sign: '+', value: '100%' } : null
    const pct = ((curr - prev) / prev) * 100
    if (!isFinite(pct) || Math.abs(pct) < 0.05) return null
    return { sign: pct >= 0 ? '+' : '-', value: `${Math.abs(pct).toFixed(0)}%` }
}

function formatShortDate(iso: string): string {
    try {
        const d = new Date(iso + 'T00:00:00')
        return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    } catch { return iso }
}

const initialsFor = (name: string | undefined | null) =>
    (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?'

const AVATAR_COLORS = ['bg-blue-100 text-blue-700', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-purple-100 text-purple-700', 'bg-sky-100 text-sky-700', 'bg-pink-100 text-pink-700']
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
        || shopSummary
        || reverseGeocodedSummary
        || (hasCoordinates ? 'Location captured' : 'Location unavailable')

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
        accuracyBadge,
        metaParts: uniqueTextParts(metaParts),
        coordinates,
    }
}

export function RoadtourVisitsView({ userProfile }: RoadtourVisitsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    const [visits, setVisits] = useState<OfficialVisit[]>([])
    const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
    const [references, setReferences] = useState<{ id: string; full_name: string }[]>([])

    // Filters
    const [campaignFilter, setCampaignFilter] = useState('all')
    const [referenceFilter, setReferenceFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')
    const [dateFrom, setDateFrom] = useState(isoDateAddDays(todayIsoDate(), -29))
    const [dateTo, setDateTo] = useState(todayIsoDate())

    // Visits Over Time toggle
    const [trendView, setTrendView] = useState<'day' | 'week'>('day')

    // Pagination
    const [pageSize, setPageSize] = useState(25)
    const [page, setPage] = useState(1)

    // Detail dialog
    const [detailOpen, setDetailOpen] = useState(false)
    const [detailVisit, setDetailVisit] = useState<OfficialVisit | null>(null)
    const [scans, setScans] = useState<ScanEvent[]>([])
    const [scansLoading, setScansLoading] = useState(false)

    const loadVisits = useCallback(async () => {
        try {
            const isInitial = !refreshing
            if (isInitial) setLoading(true)
            let q = (supabase as any)
                .from('roadtour_official_visits')
                .select('*, roadtour_campaigns!inner(name, org_id), users:account_manager_user_id(full_name, phone), organizations:shop_id(org_name, branch, address, address_line2, contact_phone, city, states:state_id(state_name)), official_scan:official_scan_event_id(geo_label, geo_city, geo_state, geo_full_address, geolocation, latitude, longitude, accuracy_m, location_status, location_error, location_captured_at)')
                .eq('roadtour_campaigns.org_id', companyId)
                .order('visit_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(500)

            if (campaignFilter !== 'all') q = q.eq('campaign_id', campaignFilter)
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

            const { data: cData } = await (supabase as any)
                .from('roadtour_campaigns')
                .select('id, name')
                .eq('org_id', companyId)
                .order('name')
            setCampaigns(cData || [])

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
    }, [companyId, supabase, campaignFilter, referenceFilter, dateFrom, dateTo, refreshing])

    useEffect(() => { loadVisits() }, [loadVisits])

    const filtered = useMemo(() => {
        return visits.filter((v) => {
            if (statusFilter !== 'all' && v.visit_status !== statusFilter) return false
            if (searchTerm) {
                const term = searchTerm.toLowerCase()
                if (!v.user_name?.toLowerCase().includes(term)
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
        const completed = filtered.filter((v) => (v.visit_status || '').toLowerCase().includes('complet')
            || (v.visit_status || '').toLowerCase() === 'official').length
        const completedPct = total > 0 ? (completed / total) * 100 : 0
        const locationIssues = filtered.filter((v) =>
            v.visit_location_status && !['resolved', 'success'].includes(String(v.visit_location_status))
        ).length
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

        // Previous window comparison (same length, immediately preceding)
        const fromIso = dateFrom || todayIsoDate()
        const toIso = dateTo || todayIsoDate()
        const fromDate = new Date(fromIso + 'T00:00:00')
        const toDate = new Date(toIso + 'T00:00:00')
        const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
        const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1)
        const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1))
        const prevFromIso = formatLocalIsoDate(prevFrom)
        const prevToIso = formatLocalIsoDate(prevTo)
        const inPrev = (v: OfficialVisit) => v.visit_date >= prevFromIso && v.visit_date <= prevToIso
        // Note: prev window may not be in current `visits` list because the load filter limits to selected window.
        // Trend remains best-effort and may show nothing when prev data is unavailable.
        const prevList = visits.filter(inPrev)
        const trendVisits = formatTrendPct(total, prevList.length)
        const trendShops = formatTrendPct(uniqueShops, new Set(prevList.map((v) => v.shop_id)).size)

        const prevLabel = `${formatShortDate(prevFromIso)} – ${formatShortDate(prevToIso)}`

        return {
            total, uniqueShops, completed, completedPct,
            locationIssues, locationIssuePct,
            totalKm,
            trendVisits, trendShops, prevLabel,
        }
    }, [filtered, visits, dateFrom, dateTo])

    // Visits Over Time
    const visitsOverTime = useMemo(() => {
        if (trendView === 'day') {
            const counts = new Map<string, number>()
            for (const v of filtered) counts.set(v.visit_date, (counts.get(v.visit_date) || 0) + 1)
            const fromIso = dateFrom || todayIsoDate()
            const toIso = dateTo || todayIsoDate()
            const points: { label: string; value: number }[] = []
            const fromDate = new Date(fromIso + 'T00:00:00')
            const toDate = new Date(toIso + 'T00:00:00')
            for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
                const iso = formatLocalIsoDate(d)
                points.push({ label: formatShortDate(iso), value: counts.get(iso) || 0 })
            }
            return points
        }
        // Week bucketing
        const counts = new Map<string, number>()
        for (const v of filtered) {
            const d = new Date(v.visit_date + 'T00:00:00')
            const dayOfWeek = d.getDay()
            // Monday-start week
            const diffToMon = (dayOfWeek + 6) % 7
            d.setDate(d.getDate() - diffToMon)
            const key = formatLocalIsoDate(d)
            counts.set(key, (counts.get(key) || 0) + 1)
        }
        return Array.from(counts.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => ({ label: `Wk ${formatShortDate(k)}`, value: v }))
    }, [filtered, dateFrom, dateTo, trendView])

    // Visits by Region (donut) — uses shop state
    const visitsByRegion = useMemo(() => {
        const counts = new Map<string, number>()
        for (const v of filtered) {
            const region = (v.shop_state || '').trim() || 'Unknown'
            counts.set(region, (counts.get(region) || 0) + 1)
        }
        const sorted = Array.from(counts.entries()).sort(([, a], [, b]) => b - a)
        // Group small slices into Others
        const top = sorted.slice(0, 4)
        const otherTotal = sorted.slice(4).reduce((s, [, c]) => s + c, 0)
        const arr = top.map(([name, value]) => ({ name, value }))
        if (otherTotal > 0) arr.push({ name: 'Others', value: otherTotal })
        return arr
    }, [filtered])

    // Top References list
    const topReferences = useMemo(() => {
        const counts = new Map<string, { id: string; name: string; count: number }>()
        for (const v of filtered) {
            const id = v.account_manager_user_id
            const name = v.user_name || '—'
            const cur = counts.get(id) || { id, name, count: 0 }
            cur.count += 1
            counts.set(id, cur)
        }
        return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5)
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

    // Pagination
    const totalEntries = filtered.length
    const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize))
    const safePage = Math.min(page, totalPages)
    const pageStart = (safePage - 1) * pageSize
    const pageItems = filtered.slice(pageStart, pageStart + pageSize)

    useEffect(() => { setPage(1) }, [pageSize, statusFilter, campaignFilter, referenceFilter, searchTerm, dateFrom, dateTo])

    const openDetail = async (visit: OfficialVisit) => {
        setDetailVisit(visit)
        setDetailOpen(true)
        setScansLoading(true)
        try {
            const { data, error } = await (supabase as any)
                .from('roadtour_scan_events')
                .select('*, users:scanned_by_user_id(full_name), organizations:shop_id(org_name)')
                .eq('campaign_id', visit.campaign_id)
                .eq('account_manager_user_id', visit.account_manager_user_id)
                .eq('shop_id', visit.shop_id)
                .gte('scan_time', visit.visit_date + 'T00:00:00')
                .lt('scan_time', visit.visit_date + 'T23:59:59')
                .order('scan_time', { ascending: false })

            if (error) throw error
            setScans((data || []).map((s: any) => ({
                ...s,
                consumer_name: s.users?.full_name || null,
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
        const headers = ['Date/Time', 'Reference', 'Shop', 'Campaign', 'Location', 'Distance (km)', 'Outcome', 'Status']
        const rows = filtered.map((v) => {
            const dist = distanceByVisitId.get(v.id)
            const locationDisplay = formatVisitLocationDisplay(v)
            return [
                `${v.visit_date} ${new Date(v.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
                v.user_name || '',
                `${v.shop_name}${v.shop_branch ? ' - ' + v.shop_branch : ''}`,
                v.campaign_name || '',
                [locationDisplay.title, locationDisplay.accuracyBadge.label, ...locationDisplay.metaParts].filter(Boolean).join(' · '),
                dist ? dist.km.toFixed(1) : '',
                v.visit_outcome || (v.visit_status === 'official' ? 'Completed' : v.visit_status),
                v.visit_status,
            ]
        })
        const csv = [headers, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `roadtour-visits-${dateFrom}_${dateTo}.csv`
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
        sent: { icon: CheckCircle2, className: 'text-blue-600', label: 'WhatsApp sent' },
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

    const visitOutcomeForRow = (v: OfficialVisit): { label: string; tone: 'emerald' | 'amber' | 'red' | 'slate' } => {
        const status = (v.visit_status || '').toLowerCase()
        const locStatus = String(v.visit_location_status || '').toLowerCase()
        if (locStatus && !['resolved', 'success', ''].includes(locStatus)) return { label: 'Location Issue', tone: 'amber' }
        if (status === 'official' || status.includes('complet')) return { label: 'Completed', tone: 'emerald' }
        if (status.includes('reject') || status.includes('fail')) return { label: 'Failed', tone: 'red' }
        return { label: v.visit_status || '—', tone: 'slate' }
    }

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    const lastUpdatedLabel = lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        Visit Tracking
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Track official visits by references across campaigns. View visit activity, location data, and estimated route distance.
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

            {/* Filters */}
            <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by reference, shop, or campaign..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <div className="md:col-span-2">
                    <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                        <SelectTrigger><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Campaigns</SelectItem>
                            {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-2">
                    <Select value={referenceFilter} onValueChange={setReferenceFilter}>
                        <SelectTrigger><SelectValue placeholder="All References" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All References</SelectItem>
                            {references.map((r) => <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-1">
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
                <div className="md:col-span-3 flex items-center gap-2">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="flex-1" />
                    <span className="text-muted-foreground">–</span>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="flex-1" />
                </div>
                <div className="md:col-span-1">
                    <Button variant="outline" size="sm" className="w-full gap-1" onClick={handleRefresh}>
                        <SlidersHorizontal className="h-4 w-4" />
                        More
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <KpiCard
                    icon={<Footprints className="h-5 w-5 text-blue-600" />}
                    iconBg="bg-blue-100"
                    label="Total Visits"
                    value={metrics.total.toString()}
                    trend={metrics.trendVisits}
                    trendLabel={`vs ${metrics.prevLabel}`}
                />
                <KpiCard
                    icon={<Store className="h-5 w-5 text-emerald-600" />}
                    iconBg="bg-emerald-100"
                    label="Unique Shops Visited"
                    value={metrics.uniqueShops.toString()}
                    trend={metrics.trendShops}
                    trendLabel={`vs ${metrics.prevLabel}`}
                />
                <KpiCard
                    icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                    iconBg="bg-emerald-100"
                    label="Completed Visits"
                    value={metrics.completed.toString()}
                    sub={`${metrics.completedPct.toFixed(1)}% of total visits`}
                />
                <KpiCard
                    icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
                    iconBg="bg-amber-100"
                    label="Location Issues"
                    value={metrics.locationIssues.toString()}
                    sub={`${metrics.locationIssuePct.toFixed(1)}% of total visits`}
                />
                <KpiCard
                    icon={<Route className="h-5 w-5 text-purple-600" />}
                    iconBg="bg-purple-100"
                    label="Estimated Distance"
                    value={`${metrics.totalKm.toFixed(1)} km`}
                    sub="Total route distance"
                />
            </div>

            {/* Charts row */}
            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base">Visits Over Time</CardTitle>
                            <div className="flex rounded-md border bg-muted p-0.5 text-xs">
                                <button onClick={() => setTrendView('day')} className={`px-2 py-1 rounded ${trendView === 'day' ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}>Day</button>
                                <button onClick={() => setTrendView('week')} className={`px-2 py-1 rounded ${trendView === 'week' ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}>Week</button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={visitsOverTime} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip />
                                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Visits by Region</CardTitle></CardHeader>
                    <CardContent className="h-[220px]">
                        {visitsByRegion.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No region data</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={visitsByRegion} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                                        {visitsByRegion.map((_, i) => <Cell key={i} fill={REGION_COLORS[i % REGION_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip />
                                    <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                        <CardTitle className="text-base">Top References</CardTitle>
                        <button className="text-xs text-blue-600 hover:underline">View all</button>
                    </CardHeader>
                    <CardContent>
                        {topReferences.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No references in this period.</p>
                        ) : (
                            <div className="space-y-3">
                                {topReferences.map((ref, idx) => (
                                    <div key={ref.id} className="flex items-center gap-3">
                                        <span className="w-4 text-xs font-semibold text-muted-foreground">{idx + 1}</span>
                                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${colorFor(ref.id)}`}>{initialsFor(ref.name)}</div>
                                        <span className="flex-1 text-sm font-medium truncate">{ref.name}</span>
                                        <span className="text-xs text-muted-foreground">{ref.count} visits</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

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
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date / Time</TableHead>
                                <TableHead>Reference</TableHead>
                                <TableHead>Shop</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Location</TableHead>
                                <TableHead>Distance from Previous</TableHead>
                                <TableHead>Outcome</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pageItems.length === 0 && (
                                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No visits found.</TableCell></TableRow>
                            )}
                            {pageItems.map((v) => {
                                const dist = distanceByVisitId.get(v.id)
                                const outcome = visitOutcomeForRow(v)
                                const locationDisplay = formatVisitLocationDisplay(v)
                                const time = new Date(v.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
                                const visitDate = (() => { try { return new Date(v.visit_date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return v.visit_date } })()
                                const locColor = v.visit_location_status === 'resolved' ? 'text-emerald-600'
                                    : v.visit_location_status ? 'text-amber-600' : 'text-muted-foreground'
                                const distColor = !dist ? 'text-muted-foreground'
                                    : dist.level === 'high' ? 'text-amber-700'
                                        : dist.level === 'medium' ? 'text-amber-600'
                                            : 'text-muted-foreground'
                                const outcomeBadge = outcome.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700'
                                    : outcome.tone === 'amber' ? 'bg-amber-100 text-amber-700'
                                        : outcome.tone === 'red' ? 'bg-red-100 text-red-700'
                                            : 'bg-slate-100 text-slate-700'
                                return (
                                    <TableRow key={v.id}>
                                        <TableCell className="text-sm whitespace-nowrap">
                                            <div>{visitDate}, {time}</div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${colorFor(v.account_manager_user_id)}`}>{initialsFor(v.user_name)}</div>
                                                <span className="text-sm font-medium">{v.user_name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div>
                                                <p className="text-sm font-medium">{v.shop_name}</p>
                                                {(v.shop_branch || v.shop_state) && (
                                                    <p className="text-xs text-muted-foreground">{[v.shop_branch, v.shop_state].filter(Boolean).join(', ')}</p>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">{v.campaign_name}</TableCell>
                                        <TableCell className="text-xs">
                                            <div className="space-y-1">
                                                <div className={`flex items-center gap-1 ${locColor}`}>
                                                    <MapPin className="h-3 w-3" />
                                                    <span className="text-sm font-medium text-foreground">{locationDisplay.title}</span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                                                    <Badge variant="outline" className={`border ${locationDisplay.accuracyBadge.className}`}>
                                                        {locationDisplay.accuracyBadge.label}
                                                    </Badge>
                                                    {locationDisplay.metaParts.map((part) => (
                                                        <span key={part}>{part}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className={`text-sm ${distColor}`}>
                                            {dist ? `${dist.km.toFixed(1)} km` : '—'}
                                        </TableCell>
                                        <TableCell className="text-sm">{outcome.label}</TableCell>
                                        <TableCell>
                                            <Badge className={outcomeBadge}>{outcome.label}</Badge>
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
                                return (
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
                                )
                            })()}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><Label className="text-muted-foreground">Date</Label><p className="font-medium">{detailVisit.visit_date}</p></div>
                                <div><Label className="text-muted-foreground">Campaign</Label><p className="font-medium">{detailVisit.campaign_name}</p></div>
                                <div><Label className="text-muted-foreground">Reference</Label><p className="font-medium">{detailVisit.user_name}</p>{detailVisit.user_phone && <p className="text-xs text-muted-foreground">{detailVisit.user_phone}</p>}</div>
                                <div><Label className="text-muted-foreground">Shop</Label><p className="font-medium">{detailVisit.shop_name}</p>{detailVisit.shop_contact_phone && <p className="text-xs text-muted-foreground">{detailVisit.shop_contact_phone}</p>}</div>
                                <div><Label className="text-muted-foreground">Status</Label><p className="font-medium">{detailVisit.visit_status}</p></div>
                                <div><Label className="text-muted-foreground">Date Created</Label><p className="font-medium">{new Date(detailVisit.created_at).toLocaleString()}</p></div>
                            </div>

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

function KpiCard({ icon, iconBg, label, value, trend, trendLabel, sub }: {
    icon: React.ReactNode
    iconBg: string
    label: string
    value: string
    trend?: { sign: '+' | '-'; value: string } | null
    trendLabel?: string
    sub?: string
}) {
    return (
        <Card>
            <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-1 text-2xl font-bold">{value}</p>
                        {trend && (
                            <p className={`mt-1 inline-flex items-center gap-1 text-xs ${trend.sign === '+' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {trend.sign === '+' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {trend.sign}{trend.value}
                                {trendLabel && <span className="text-muted-foreground font-normal">{trendLabel}</span>}
                            </p>
                        )}
                        {!trend && sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>{icon}</div>
                </div>
            </CardContent>
        </Card>
    )
}
