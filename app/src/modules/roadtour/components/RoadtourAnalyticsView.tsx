'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { normalizePointClaimSettings } from '@/lib/engagement/point-claim-settings'
import { normalizePhoneE164 } from '@/utils/phone'
import {
  BarChart3, CheckCircle2, Loader2, Map as MapIcon, MapPin, QrCode, Scan, Star,
  TrendingUp, Users
} from 'lucide-react'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import { toast } from '@/components/ui/use-toast'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'

interface RoadtourAnalyticsViewProps {
  userProfile: any
  onViewChange: (viewId: string) => void
}

interface AnalyticsData {
  totalCampaigns: number
  activeCampaigns: number
  pointValueRm: number
  totalManagers: number
  totalQrCodes: number
  totalScans: number
  totalVisits: number
  totalSurveys: number
  totalPointsAwarded: number
  uniqueShopsVisited: number
  topManagers: { user_id: string; full_name: string; visit_count: number; points_total: number }[]
  topCampaigns: { campaign_id: string; name: string; visit_count: number; scan_count: number }[]
  recentScans: { id: string; scanned_at: string; consumer_name: string | null; consumer_phone: string | null; shop_name: string | null; shop_context_note?: string | null; points: number; status: string }[]
  recentScansTotal: number
}

interface RecentScanEventRow {
  id: string
  campaign_id: string
  qr_code_id: string
  scan_time: string
  consumer_phone: string | null
  points_awarded: number
  scan_status: string
  shop_id: string | null
  scanned_by_user_id: string | null
}

interface OrganizationLookup {
  id: string
  org_name: string
  branch?: string | null
}

interface UserLookup {
  id: string
  full_name?: string | null
  phone?: string | null
  organization_id?: string | null
  referral_phone?: string | null
  shop_name?: string | null
}

const SCAN_PAGE_SIZE_OPTIONS = [10, 20, 50]

function formatShopDisplayName(shop?: OrganizationLookup | null) {
  if (!shop) return null
  return `${shop.org_name}${shop.branch ? ` (${shop.branch})` : ''}`
}

function formatRewardCost(totalPointsAwarded: number, pointValueRm: number) {
  if (totalPointsAwarded <= 0) return 'RM 0.00'
  if (!(pointValueRm > 0)) return 'Not configured'
  return `RM ${(totalPointsAwarded * pointValueRm).toFixed(2)}`
}

function formatRecentScanTimestamp(value?: string | null) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })}`
}

function toNormalizedPhone(value?: string | null) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  return normalizePhoneE164(trimmed)
}

function resolveRecentScanConsumer(scan: RecentScanEventRow, usersById: Map<string, UserLookup>, usersByPhone: Map<string, UserLookup>) {
  const normalizedPhone = toNormalizedPhone(scan.consumer_phone)
  const userByPhone = normalizedPhone ? usersByPhone.get(normalizedPhone) || null : null
  const userById = scan.scanned_by_user_id ? usersById.get(scan.scanned_by_user_id) || null : null
  const resolvedUser = userByPhone || userById

  return {
    normalizedPhone,
    resolvedUser,
    consumerName: resolvedUser?.full_name || userById?.full_name || userByPhone?.full_name || null,
    consumerPhone: resolvedUser?.phone || normalizedPhone || scan.consumer_phone || null,
  }
}

function resolveRecentScanShop(args: {
  scan: RecentScanEventRow
  consumerUser: UserLookup | null
  surveysByScanId: Map<string, { shop_id?: string | null }>
  qrById: Map<string, { shop_id?: string | null }>
  shopsById: Map<string, OrganizationLookup>
  referenceUsersByPhone: Map<string, UserLookup>
}) {
  const { scan, consumerUser, surveysByScanId, qrById, shopsById, referenceUsersByPhone } = args

  const directShop = scan.shop_id ? shopsById.get(scan.shop_id) || null : null
  if (directShop) return { shopName: formatShopDisplayName(directShop), note: null }

  const surveyShopId = surveysByScanId.get(scan.id)?.shop_id || null
  const surveyShop = surveyShopId ? shopsById.get(surveyShopId) || null : null
  if (surveyShop) return { shopName: formatShopDisplayName(surveyShop), note: null }

  const qrShopId = qrById.get(scan.qr_code_id)?.shop_id || null
  const qrShop = qrShopId ? shopsById.get(qrShopId) || null : null
  if (qrShop) return { shopName: formatShopDisplayName(qrShop), note: null }

  const consumerOrg = consumerUser?.organization_id ? shopsById.get(consumerUser.organization_id) || null : null
  if (consumerOrg) return { shopName: formatShopDisplayName(consumerOrg), note: null }

  const referencePhone = toNormalizedPhone(consumerUser?.referral_phone)
  const referenceUser = referencePhone ? referenceUsersByPhone.get(referencePhone) || null : null
  const referenceOrg = referenceUser?.organization_id ? shopsById.get(referenceUser.organization_id) || null : null
  if (referenceOrg) return { shopName: formatShopDisplayName(referenceOrg), note: null }

  if (consumerUser?.shop_name?.trim()) {
    return { shopName: consumerUser.shop_name.trim(), note: 'Linked via user profile' }
  }

  return { shopName: null, note: 'No linked shop context' }
}

export function RoadtourAnalyticsView({ userProfile, onViewChange }: RoadtourAnalyticsViewProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AnalyticsData>({
    totalCampaigns: 0, activeCampaigns: 0, pointValueRm: 0, totalManagers: 0, totalQrCodes: 0,
    totalScans: 0, totalVisits: 0, totalSurveys: 0, totalPointsAwarded: 0,
    uniqueShopsVisited: 0, topManagers: [], topCampaigns: [], recentScans: [], recentScansTotal: 0,
  })
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [runs, setRuns] = useState<RoadtourRun[]>([])
  const [runFilter, setRunFilter] = useState('all')
  const [scanPage, setScanPage] = useState(0)
  const [scansPerPage, setScansPerPage] = useState(10)

  const applyDateRange = useCallback((query: any, column: string, isDateOnly = false) => {
    let nextQuery = query

    if (dateFrom) {
      nextQuery = nextQuery.gte(column, isDateOnly ? dateFrom : `${dateFrom}T00:00:00`)
    }

    if (dateTo) {
      nextQuery = nextQuery.lte(column, isDateOnly ? dateTo : `${dateTo}T23:59:59.999`)
    }

    return nextQuery
  }, [dateFrom, dateTo])

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true)

      const campaignsRes = await (supabase as any)
        .from('roadtour_campaigns')
        .select('id, name, status, roadtour_run_id', { count: 'exact' })
        .eq('org_id', companyId)

      const orgSettingsRes = await (supabase as any)
        .from('organizations')
        .select('settings')
        .eq('id', companyId)
        .single()

      if (campaignsRes.error) throw campaignsRes.error
      if (orgSettingsRes.error) throw orgSettingsRes.error

      const campaignsList = (campaignsRes.data || []).filter((campaign: any) => runFilter === 'all' || campaign.roadtour_run_id === runFilter)
      const campaignIds = campaignsList.map((campaign: any) => campaign.id)
      const pointValueRm = normalizePointClaimSettings(orgSettingsRes.data?.settings, 100).pointValueRM

      if (campaignIds.length === 0) {
        setData({
          totalCampaigns: campaignsList.length,
          activeCampaigns: campaignsList.filter((campaign: any) => campaign.status === 'active').length,
          pointValueRm,
          totalManagers: 0,
          totalQrCodes: 0,
          totalScans: 0,
          totalVisits: 0,
          totalSurveys: 0,
          totalPointsAwarded: 0,
          uniqueShopsVisited: 0,
          topManagers: [],
          topCampaigns: [],
          recentScans: [],
          recentScansTotal: 0,
        })
        return
      }

      const [managersRes, qrRes, visitsRes, scanMetricsRes, recentScansRes, surveysRes] = await Promise.all([
        (supabase as any)
          .from('roadtour_campaign_managers')
          .select('id', { count: 'exact', head: true })
          .in('campaign_id', campaignIds)
          .eq('is_active', true),
        (supabase as any)
          .from('roadtour_qr_codes')
          .select('id', { count: 'exact', head: true })
          .in('campaign_id', campaignIds),
        applyDateRange(
          (supabase as any)
            .from('roadtour_official_visits')
            .select('id, campaign_id, account_manager_user_id, shop_id, official_scan_event_id')
            .in('campaign_id', campaignIds),
          'visit_date',
          true
        ),
        applyDateRange(
          (supabase as any)
            .from('roadtour_scan_events')
            .select('id, campaign_id, points_awarded')
            .in('campaign_id', campaignIds),
          'scan_time'
        ),
        applyDateRange(
          (supabase as any)
            .from('roadtour_scan_events')
            .select('id, campaign_id, qr_code_id, scan_time, consumer_phone, points_awarded, scan_status, shop_id, scanned_by_user_id', { count: 'exact' })
            .in('campaign_id', campaignIds)
            .order('scan_time', { ascending: false })
            .range(scanPage * scansPerPage, (scanPage + 1) * scansPerPage - 1),
          'scan_time'
        ),
        applyDateRange(
          (supabase as any)
            .from('roadtour_survey_responses')
            .select('id', { count: 'exact', head: true })
            .in('campaign_id', campaignIds),
          'submitted_at'
        ),
      ])

      const primaryError = [
        managersRes.error,
        qrRes.error,
        visitsRes.error,
        scanMetricsRes.error,
        recentScansRes.error,
        surveysRes.error,
      ].find(Boolean)

      if (primaryError) throw primaryError

      const visitsList = visitsRes.data || []
      const scanMetricsList = scanMetricsRes.data || []
      const scansList = (recentScansRes.data || []) as RecentScanEventRow[]
      const campaignNames = new globalThis.Map<string, string>(campaignsList.map((campaign: any) => [campaign.id, campaign.name || '—']))

      const managerUserIds = Array.from(new Set(visitsList.map((visit: any) => visit.account_manager_user_id).filter(Boolean)))
      const scanEventIds = Array.from(new Set(visitsList.map((visit: any) => visit.official_scan_event_id).filter(Boolean)))
      const recentScanUserIds = Array.from(new Set(scansList.map((scan: any) => scan.scanned_by_user_id).filter(Boolean)))
      const recentScanShopIds = Array.from(new Set(scansList.map((scan: any) => scan.shop_id).filter(Boolean)))

      const [managerUsersRes, visitScanPointsRes, recentScanUsersRes, recentScanShopsRes] = await Promise.all([
        managerUserIds.length > 0
          ? (supabase as any).from('users').select('id, full_name').in('id', managerUserIds)
          : Promise.resolve({ data: [], error: null }),
        scanEventIds.length > 0
          ? (supabase as any).from('roadtour_scan_events').select('id, points_awarded').in('id', scanEventIds)
          : Promise.resolve({ data: [], error: null }),
        recentScanUserIds.length > 0
          ? (supabase as any).from('users').select('id, full_name').in('id', recentScanUserIds)
          : Promise.resolve({ data: [], error: null }),
        recentScanShopIds.length > 0
          ? (supabase as any).from('organizations').select('id, org_name').in('id', recentScanShopIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (managerUsersRes.error || visitScanPointsRes.error || recentScanUsersRes.error || recentScanShopsRes.error) {
        console.warn('[RoadtourAnalytics] enrichment lookup failed', {
          managerUsersError: managerUsersRes.error,
          visitScanPointsError: visitScanPointsRes.error,
          recentScanUsersError: recentScanUsersRes.error,
          recentScanShopsError: recentScanShopsRes.error,
        })
      }

      const managerNames = new globalThis.Map<string, string>((managerUsersRes.data || []).map((user: any) => [user.id, user.full_name || '—']))
      const visitScanPoints = new globalThis.Map<string, number>((visitScanPointsRes.data || []).map((scan: any) => [scan.id, Number(scan.points_awarded || 0)]))

      const scanPhoneFilters = Array.from(new Set(scansList.flatMap((scan) => {
        const rawPhone = typeof scan.consumer_phone === 'string' ? scan.consumer_phone.trim() : ''
        const normalizedPhone = toNormalizedPhone(scan.consumer_phone)
        return [rawPhone, normalizedPhone].filter(Boolean)
      })))

      const scanQrIds = Array.from(new Set(scansList.map((scan) => scan.qr_code_id).filter(Boolean)))
      const scanIds = Array.from(new Set(scansList.map((scan) => scan.id)))

      const [recentScanUsersByIdRes, recentScanUsersByPhoneRes, recentScanSurveysRes, recentScanQrRes] = await Promise.all([
        recentScanUserIds.length > 0
          ? (supabase as any).from('users').select('id, full_name, phone, organization_id, referral_phone, shop_name').in('id', recentScanUserIds)
          : Promise.resolve({ data: [], error: null }),
        scanPhoneFilters.length > 0
          ? (supabase as any).from('users').select('id, full_name, phone, organization_id, referral_phone, shop_name').in('phone', scanPhoneFilters)
          : Promise.resolve({ data: [], error: null }),
        scanIds.length > 0
          ? (supabase as any).from('roadtour_survey_responses').select('scan_event_id, shop_id').in('scan_event_id', scanIds)
          : Promise.resolve({ data: [], error: null }),
        scanQrIds.length > 0
          ? (supabase as any).from('roadtour_qr_codes').select('id, shop_id').in('id', scanQrIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (recentScanUsersByIdRes.error || recentScanUsersByPhoneRes.error || recentScanSurveysRes.error || recentScanQrRes.error) {
        console.warn('[RoadtourAnalytics] recent scan context lookup failed', {
          recentScanUsersByIdError: recentScanUsersByIdRes.error,
          recentScanUsersByPhoneError: recentScanUsersByPhoneRes.error,
          recentScanSurveysError: recentScanSurveysRes.error,
          recentScanQrError: recentScanQrRes.error,
        })
      }

      const consumerUsers = [
        ...((recentScanUsersByIdRes.data || []) as UserLookup[]),
        ...((recentScanUsersByPhoneRes.data || []) as UserLookup[]),
      ]

      const userIdsNeedingOrgLookup = Array.from(new Set(consumerUsers.map((user) => user.organization_id).filter(Boolean)))
      const referencePhones = Array.from(new Set(consumerUsers.map((user) => toNormalizedPhone(user.referral_phone)).filter(Boolean)))

      const referenceUsersRes = referencePhones.length > 0
        ? await (supabase as any).from('users').select('id, full_name, phone, organization_id').in('phone', referencePhones)
        : { data: [], error: null }

      if (referenceUsersRes.error) {
        console.warn('[RoadtourAnalytics] reference user lookup failed', referenceUsersRes.error)
      }

      const organizationIds = Array.from(new Set([
        ...recentScanShopIds,
        ...(((recentScanSurveysRes.data || []) as Array<{ shop_id?: string | null }>).map((row) => row.shop_id).filter(Boolean) as string[]),
        ...(((recentScanQrRes.data || []) as Array<{ shop_id?: string | null }>).map((row) => row.shop_id).filter(Boolean) as string[]),
        ...(userIdsNeedingOrgLookup as string[]),
        ...(((referenceUsersRes.data || []) as Array<{ organization_id?: string | null }>).map((row) => row.organization_id).filter(Boolean) as string[]),
      ]))

      const organizationsRes = organizationIds.length > 0
        ? await (supabase as any).from('organizations').select('id, org_name, branch').in('id', organizationIds)
        : { data: [], error: null }

      if (organizationsRes.error) {
        console.warn('[RoadtourAnalytics] organization lookup failed', organizationsRes.error)
      }

      const usersById = new globalThis.Map<string, UserLookup>(consumerUsers.map((user) => [user.id, user]))
      const usersByPhone = new globalThis.Map<string, UserLookup>(consumerUsers
        .filter((user) => typeof user.phone === 'string' && user.phone.trim())
        .map((user) => [toNormalizedPhone(user.phone), user]))
      const surveysByScanId = new globalThis.Map<string, { shop_id?: string | null }>(((recentScanSurveysRes.data || []) as Array<{ scan_event_id: string; shop_id?: string | null }>).map((row) => [row.scan_event_id, row]))
      const qrById = new globalThis.Map<string, { shop_id?: string | null }>(((recentScanQrRes.data || []) as Array<{ id: string; shop_id?: string | null }>).map((row) => [row.id, row]))
      const shopsById = new globalThis.Map<string, OrganizationLookup>(((organizationsRes.data || []) as OrganizationLookup[]).map((shop) => [shop.id, shop]))
      const referenceUsersByPhone = new globalThis.Map<string, UserLookup>(((referenceUsersRes.data || []) as UserLookup[])
        .filter((user) => typeof user.phone === 'string' && user.phone.trim())
        .map((user) => [toNormalizedPhone(user.phone), user]))

      // Compute top managers
      const managerMap: Record<string, { full_name: string; visits: number; points: number }> = {}
      for (const v of visitsList) {
        const uid = v.account_manager_user_id
        if (!managerMap[uid]) managerMap[uid] = { full_name: managerNames.get(uid) || '—', visits: 0, points: 0 }
        managerMap[uid].visits++
        managerMap[uid].points += visitScanPoints.get(v.official_scan_event_id) || 0
      }
      const topManagers = Object.entries(managerMap)
        .map(([uid, m]) => ({ user_id: uid, full_name: m.full_name, visit_count: m.visits, points_total: m.points }))
        .sort((a, b) => b.visit_count - a.visit_count)
        .slice(0, 10)

      const campaignVisitCounts: Record<string, number> = {}
      for (const v of visitsList) {
        const cid = v.campaign_id
        campaignVisitCounts[cid] = (campaignVisitCounts[cid] || 0) + 1
      }

      const campaignScanCounts: Record<string, number> = {}
      let totalPointsAwarded = 0
      for (const scan of scanMetricsList) {
        const cid = scan.campaign_id
        campaignScanCounts[cid] = (campaignScanCounts[cid] || 0) + 1
        totalPointsAwarded += scan.points_awarded || 0
      }

      const topCampaigns = campaignIds
        .map((campaignId: string) => ({
          campaign_id: campaignId,
          name: campaignNames.get(campaignId) || '—',
          visit_count: campaignVisitCounts[campaignId] || 0,
          scan_count: campaignScanCounts[campaignId] || 0,
        }))
        .filter((campaign: { visit_count: number; scan_count: number }) => campaign.visit_count > 0 || campaign.scan_count > 0)
        .sort((a: { scan_count: number; visit_count: number }, b: { scan_count: number; visit_count: number }) => b.scan_count - a.scan_count || b.visit_count - a.visit_count)
        .slice(0, 10)

      setData({
        totalCampaigns: campaignsList.length,
        activeCampaigns: campaignsList.filter((c: any) => c.status === 'active').length,
        pointValueRm,
        totalManagers: managersRes.count || 0,
        totalQrCodes: qrRes.count || 0,
        totalScans: scanMetricsList.length,
        totalVisits: visitsList.length,
        totalSurveys: surveysRes.count || 0,
        totalPointsAwarded,
        uniqueShopsVisited: new Set(visitsList.map((v: any) => v.shop_id).filter(Boolean)).size,
        topManagers,
        topCampaigns,
        recentScans: scansList.map((scan) => {
          const consumer = resolveRecentScanConsumer(scan, usersById, usersByPhone)
          const shop = resolveRecentScanShop({
            scan,
            consumerUser: consumer.resolvedUser,
            surveysByScanId,
            qrById,
            shopsById,
            referenceUsersByPhone,
          })

          return {
            id: scan.id,
            scanned_at: scan.scan_time,
            consumer_name: consumer.consumerName,
            consumer_phone: consumer.consumerPhone,
            shop_name: shop.shopName,
            shop_context_note: shop.note,
            points: scan.points_awarded,
            status: scan.scan_status,
          }
        }),
        recentScansTotal: recentScansRes.count || 0,
      })
    } catch (err) {
      console.error('[RoadtourAnalytics] load failed', err)
      toast({ title: 'Error', description: 'Failed to load analytics.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [applyDateRange, companyId, scanPage, scansPerPage, supabase, runFilter])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

  useEffect(() => {
    fetchRoadtourRuns(supabase, companyId).then(setRuns).catch(() => setRuns([]))
  }, [supabase, companyId])

  useEffect(() => {
    setScanPage(0)
  }, [dateFrom, dateTo, scansPerPage])

  if (loading) return <SeraLoadingState variant="page" />

  const rewardStatusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    rewarded: 'bg-emerald-100 text-emerald-700',
    duplicate: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
    success: 'bg-emerald-100 text-emerald-700',
    invalid: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-700',
  }

  const estimatedRewardCost = formatRewardCost(data.totalPointsAwarded, data.pointValueRm)
  const scansFrom = data.recentScansTotal === 0 ? 0 : scanPage * scansPerPage + 1
  const scansTo = Math.min((scanPage + 1) * scansPerPage, data.recentScansTotal)
  const totalScanPages = Math.max(1, Math.ceil(data.recentScansTotal / scansPerPage))

  return (
    <div className="sera-sc-page space-y-6">
      <div>
        <div className="sera-sc-header__bar mb-3 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
                    <h3 className="font-display flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--sera-ink)]"><BarChart3 className="h-5 w-5 text-[var(--sera-orange)]" />RoadTour Analytics</h3>
        <p className="text-sm text-muted-foreground mt-1">Monitor campaign performance, visits, and rewards distribution.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">RoadTour Event</label>
            <Select value={runFilter} onValueChange={setRunFilter}>
              <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="All Events" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full sm:w-44" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full sm:w-44" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setDateFrom('')
            setDateTo('')
            setRunFilter('all')
          }}
          className="text-sm text-[var(--sera-orange)] hover:underline hover:text-[var(--sera-orange-deep)] self-start md:self-auto"
        >
          Clear filters
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--sera-orange)]/10"><MapIcon className="h-5 w-5 text-[var(--sera-orange)]" /></div>
            <div><p className="text-2xl font-bold">{data.activeCampaigns}</p><p className="text-xs text-muted-foreground">Active Campaigns</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100"><Users className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-2xl font-bold">{data.totalManagers}</p><p className="text-xs text-muted-foreground">Account Managers</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--sera-mist)]"><QrCode className="h-5 w-5 text-[var(--sera-ink-soft)]" /></div>
            <div><p className="text-2xl font-bold">{data.totalQrCodes}</p><p className="text-xs text-muted-foreground">QR Codes</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100"><MapPin className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-2xl font-bold">{data.totalVisits}</p><p className="text-xs text-muted-foreground">Official Visits</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--sera-mist)]"><Star className="h-5 w-5 text-[var(--sera-muted)]" /></div>
            <div>
              <p className="text-2xl font-bold">{data.totalPointsAwarded.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Points Awarded</p>
              <p className="text-[11px] text-muted-foreground">Est. cost: {estimatedRewardCost}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Scans</span>
              <Scan className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-1">{data.totalScans}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Surveys Completed</span>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-1">{data.totalSurveys}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Unique Shops Visited</span>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-1">{data.uniqueShopsVisited}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Managers */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Top Account Managers</CardTitle></CardHeader>
          <CardContent>
            {data.topManagers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {data.topManagers.map((m, i) => (
                  <div key={m.user_id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted-foreground w-6">#{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{m.full_name}</p>
                        <p className="text-xs text-muted-foreground">{m.visit_count} visits</p>
                      </div>
                    </div>
                    <Badge variant="outline">{m.points_total} pts</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Campaigns */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><MapIcon className="h-4 w-4" />Top Campaigns</CardTitle></CardHeader>
          <CardContent>
            {data.topCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {data.topCampaigns.map((c, i) => (
                  <div key={c.campaign_id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted-foreground w-6">#{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.visit_count} visits · {c.scan_count} scans</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Scans */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2"><Scan className="h-4 w-4" />Recent Scans ({data.recentScansTotal})</CardTitle>
              {data.recentScansTotal > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Showing {scansFrom}-{scansTo} of {data.recentScansTotal} scans</p>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page</span>
              <Select value={String(scansPerPage)} onValueChange={(value) => setScansPerPage(Number(value))}>
                <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCAN_PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No scans yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_auto_auto] md:items-center md:gap-4">
                <span>Name</span>
                <span>Kedai</span>
                <span>Date/Time Scan</span>
                <span className="text-right">Points</span>
                <span className="text-right">Status</span>
              </div>
              {data.recentScans.map((s) => (
                <div key={s.id} className="rounded-lg border p-4">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{s.consumer_name || 'Unknown customer'}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{s.consumer_phone || 'No contact'}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm">{s.shop_name || 'Unknown shop'}</p>
                      {s.shop_context_note ? (
                        <p className="mt-1 break-words text-xs text-muted-foreground">{s.shop_context_note}</p>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{formatRecentScanTimestamp(s.scanned_at)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t pt-3 md:contents md:border-0 md:pt-0">
                      <div className="md:justify-self-end md:text-right">
                        {s.points > 0 ? (
                          <span className="text-sm font-medium text-emerald-600">+{s.points} pts</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </div>
                      <div className="md:justify-self-end md:text-right">
                        <Badge className={rewardStatusColor[s.status] || ''}>{s.status}</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {data.recentScansTotal > 0 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">Page {scanPage + 1} of {totalScanPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={scanPage === 0} onClick={() => setScanPage((page) => page - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={scanPage + 1 >= totalScanPages} onClick={() => setScanPage((page) => page + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
