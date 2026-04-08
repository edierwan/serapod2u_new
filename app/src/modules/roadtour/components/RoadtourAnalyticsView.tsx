'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  BarChart3, CheckCircle2, Loader2, Map, MapPin, QrCode, Scan, Star,
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
  recentScans: { id: string; scanned_at: string; consumer_phone: string | null; shop_name: string | null; points: number; status: string }[]
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

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true)

      // Run parallel queries
      const [campaignsRes, managersRes, qrRes, visitsRes, scansRes, surveysRes] = await Promise.all([
        (supabase as any).from('roadtour_campaigns').select('id, status', { count: 'exact' }).eq('org_id', companyId),
        (supabase as any).from('roadtour_campaign_managers')
          .select('user_id, roadtour_campaigns!inner(org_id)', { count: 'exact' })
          .eq('roadtour_campaigns.org_id', companyId)
          .eq('is_active', true),
        (supabase as any).from('roadtour_qr_codes')
          .select('id, roadtour_campaigns!inner(org_id)', { count: 'exact' })
          .eq('roadtour_campaigns.org_id', companyId),
        (supabase as any).from('roadtour_official_visits')
          .select('id, user_id, shop_id, total_points_awarded, verified_scans, surveys_completed, roadtour_campaigns!inner(org_id, name), users:user_id(full_name)')
          .eq('roadtour_campaigns.org_id', companyId),
        (supabase as any).from('roadtour_scan_events')
          .select('id, scanned_at, consumer_phone, points_awarded, reward_status, shop_id, organizations:shop_id(name), roadtour_qr_codes!inner(campaign_id, roadtour_campaigns!inner(org_id))')
          .eq('roadtour_qr_codes.roadtour_campaigns.org_id', companyId)
          .order('scanned_at', { ascending: false })
          .limit(20),
        (supabase as any).from('roadtour_survey_responses')
          .select('id, roadtour_scan_events!inner(roadtour_qr_codes!inner(roadtour_campaigns!inner(org_id)))', { count: 'exact' })
          .eq('roadtour_scan_events.roadtour_qr_codes.roadtour_campaigns.org_id', companyId),
      ])

      const campaignsList = campaignsRes.data || []
      const visitsList = visitsRes.data || []
      const scansList = scansRes.data || []

      // Compute top managers
      const managerMap: Record<string, { full_name: string; visits: number; points: number }> = {}
      for (const v of visitsList) {
        const uid = v.user_id
        if (!managerMap[uid]) managerMap[uid] = { full_name: v.users?.full_name || '—', visits: 0, points: 0 }
        managerMap[uid].visits++
        managerMap[uid].points += v.total_points_awarded || 0
      }
      const topManagers = Object.entries(managerMap)
        .map(([uid, m]) => ({ user_id: uid, full_name: m.full_name, visit_count: m.visits, points_total: m.points }))
        .sort((a, b) => b.visit_count - a.visit_count)
        .slice(0, 10)

      // Compute top campaigns
      const campaignMap: Record<string, { name: string; visits: number; scans: number }> = {}
      for (const v of visitsList) {
        const cid = v.campaign_id
        if (!campaignMap[cid]) campaignMap[cid] = { name: v.roadtour_campaigns?.name || '—', visits: 0, scans: 0 }
        campaignMap[cid].visits++
        campaignMap[cid].scans += v.verified_scans || 0
      }
      const topCampaigns = Object.entries(campaignMap)
        .map(([cid, c]) => ({ campaign_id: cid, name: c.name, visit_count: c.visits, scan_count: c.scans }))
        .sort((a, b) => b.visit_count - a.visit_count)
        .slice(0, 10)

      setData({
        totalCampaigns: campaignsList.length,
        activeCampaigns: campaignsList.filter((c: any) => c.status === 'active').length,
        totalManagers: managersRes.count || 0,
        totalQrCodes: qrRes.count || 0,
        totalScans: scansList.length,
        totalVisits: visitsList.length,
        totalSurveys: surveysRes.count || 0,
        totalPointsAwarded: visitsList.reduce((s: number, v: any) => s + (v.total_points_awarded || 0), 0),
        uniqueShopsVisited: new Set(visitsList.map((v: any) => v.shop_id)).size,
        topManagers,
        topCampaigns,
        recentScans: scansList.map((s: any) => ({
          id: s.id,
          scanned_at: s.scanned_at,
          consumer_phone: s.consumer_phone,
          shop_name: s.organizations?.name || null,
          points: s.points_awarded,
          status: s.reward_status,
        })),
      })
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load analytics.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [companyId, supabase])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

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

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100"><Map className="h-5 w-5 text-blue-600" /></div>
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
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Map className="h-4 w-4" />Top Campaigns</CardTitle></CardHeader>
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
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Scan className="h-4 w-4" />Recent Scans</CardTitle></CardHeader>
        <CardContent>
          {data.recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No scans yet.</p>
          ) : (
            <div className="space-y-2">
              {data.recentScans.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{s.consumer_phone || 'Unknown consumer'}</p>
                    <p className="text-xs text-muted-foreground">{s.shop_name || 'Unknown shop'} · {new Date(s.scanned_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.points > 0 && <span className="text-sm font-medium text-emerald-600">+{s.points} pts</span>}
                    <Badge className={rewardStatusColor[s.status] || ''}>{s.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
