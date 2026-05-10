'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  BarChart3, CheckCircle2, Loader2, Map as MapIcon, MapPin, QrCode, Scan, Star,
  TrendingUp, Users
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface RoadtourAnalyticsViewProps {
  userProfile: any
  onViewChange: (viewId: string) => void
}

interface AnalyticsData {
  totalCampaigns: number
  activeCampaigns: number
  totalManagers: number
  totalQrCodes: number
  totalScans: number
  totalVisits: number
  totalSurveys: number
  totalPointsAwarded: number
  uniqueShopsVisited: number
  topManagers: { user_id: string; full_name: string; visit_count: number; points_total: number }[]
  topCampaigns: { campaign_id: string; name: string; visit_count: number; scan_count: number }[]
  recentScans: { id: string; scanned_at: string; consumer_name: string | null; consumer_phone: string | null; shop_name: string | null; points: number; status: string }[]
}

export function RoadtourAnalyticsView({ userProfile, onViewChange }: RoadtourAnalyticsViewProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AnalyticsData>({
    totalCampaigns: 0, activeCampaigns: 0, totalManagers: 0, totalQrCodes: 0,
    totalScans: 0, totalVisits: 0, totalSurveys: 0, totalPointsAwarded: 0,
    uniqueShopsVisited: 0, topManagers: [], topCampaigns: [], recentScans: [],
  })
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [scanPage, setScanPage] = useState(0)
  const scansPerPage = 20

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
        .select('id, name, status', { count: 'exact' })
        .eq('org_id', companyId)

      if (campaignsRes.error) throw campaignsRes.error

      const campaignsList = campaignsRes.data || []
      const campaignIds = campaignsList.map((campaign: any) => campaign.id)

      if (campaignIds.length === 0) {
        setData({
          totalCampaigns: campaignsList.length,
          activeCampaigns: campaignsList.filter((campaign: any) => campaign.status === 'active').length,
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
            .select('id, campaign_id, scan_time, consumer_phone, points_awarded, scan_status, shop_id, scanned_by_user_id')
            .in('campaign_id', campaignIds)
            .order('scan_time', { ascending: false })
            .limit(100),
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
      const scansList = recentScansRes.data || []
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
      const recentScanUserNames = new globalThis.Map<string, string>((recentScanUsersRes.data || []).map((user: any) => [user.id, user.full_name || '—']))
      const recentScanShopNames = new globalThis.Map<string, string>((recentScanShopsRes.data || []).map((shop: any) => [shop.id, shop.org_name || '—']))

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
        totalManagers: managersRes.count || 0,
        totalQrCodes: qrRes.count || 0,
        totalScans: scanMetricsList.length,
        totalVisits: visitsList.length,
        totalSurveys: surveysRes.count || 0,
        totalPointsAwarded,
        uniqueShopsVisited: new Set(visitsList.map((v: any) => v.shop_id).filter(Boolean)).size,
        topManagers,
        topCampaigns,
        recentScans: scansList.map((s: any) => ({
          id: s.id,
          scanned_at: s.scan_time,
          consumer_name: recentScanUserNames.get(s.scanned_by_user_id) || null,
          consumer_phone: s.consumer_phone,
          shop_name: recentScanShopNames.get(s.shop_id) || null,
          points: s.points_awarded,
          status: s.scan_status,
        })),
      })
    } catch (err) {
      console.error('[RoadtourAnalytics] load failed', err)
      toast({ title: 'Error', description: 'Failed to load analytics.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [applyDateRange, companyId, supabase])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

  useEffect(() => {
    setScanPage(0)
  }, [dateFrom, dateTo])

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  const rewardStatusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    rewarded: 'bg-emerald-100 text-emerald-700',
    duplicate: 'bg-gray-100 text-gray-700',
    rejected: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />RoadTour Analytics</h3>
        <p className="text-sm text-muted-foreground mt-1">Monitor campaign performance, visits, and rewards distribution.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 sm:grid-cols-2">
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
          }}
          className="text-sm text-primary hover:underline self-start md:self-auto"
        >
          Clear date filter
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100"><MapIcon className="h-5 w-5 text-blue-600" /></div>
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
            <div className="p-2 rounded-lg bg-violet-100"><QrCode className="h-5 w-5 text-violet-600" /></div>
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
            <div className="p-2 rounded-lg bg-pink-100"><Star className="h-5 w-5 text-pink-600" /></div>
            <div><p className="text-2xl font-bold">{data.totalPointsAwarded.toLocaleString()}</p><p className="text-xs text-muted-foreground">Points Awarded</p></div>
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
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Scan className="h-4 w-4" />Recent Scans ({data.recentScans.length})</CardTitle></CardHeader>
        <CardContent>
          {data.recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No scans yet.</p>
          ) : (
            <div className="space-y-2">
              {data.recentScans.slice(scanPage * scansPerPage, (scanPage + 1) * scansPerPage).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{s.consumer_name || s.consumer_phone || 'Unknown consumer'}{s.consumer_name && s.consumer_phone ? ` (${s.consumer_phone})` : ''}</p>
                    <p className="text-xs text-muted-foreground">{s.shop_name || 'Unknown shop'} · {new Date(s.scanned_at).toLocaleDateString()} {new Date(s.scanned_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.points > 0 && <span className="text-sm font-medium text-emerald-600">+{s.points} pts</span>}
                    <Badge className={rewardStatusColor[s.status] || ''}>{s.status}</Badge>
                  </div>
                </div>
              ))}
              {data.recentScans.length > scansPerPage && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">Page {scanPage + 1} of {Math.ceil(data.recentScans.length / scansPerPage)}</p>
                  <div className="flex gap-2">
                    <button disabled={scanPage === 0} onClick={() => setScanPage(p => p - 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40">Previous</button>
                    <button disabled={(scanPage + 1) * scansPerPage >= data.recentScans.length} onClick={() => setScanPage(p => p + 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40">Next</button>
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
