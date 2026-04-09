'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Smartphone, CheckCircle2, XCircle, Clock, Loader2, Send, AlertTriangle,
  RefreshCw, MessageSquare
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'

interface RoadtourWhatsAppMonitoringViewProps {
  userProfile: any
  onViewChange: (viewId: string) => void
}

interface DeliveryLog {
  id: string
  campaign_id: string
  qr_code_id: string
  phone_number: string
  channel: string
  send_status: string
  error_message: string | null
  sent_at: string
  delivered_at: string | null
  provider_message_id: string | null
  campaign_name?: string
  manager_name?: string
}

interface DeliveryStats {
  total: number
  sent: number
  delivered: number
  failed: number
  pending: number
}

export function RoadtourWhatsAppMonitoringView({ userProfile, onViewChange }: RoadtourWhatsAppMonitoringViewProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<DeliveryLog[]>([])
  const [stats, setStats] = useState<DeliveryStats>({ total: 0, sent: 0, delivered: 0, failed: 0, pending: 0 })
  const [campaignFilter, setCampaignFilter] = useState<string>('all')
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)

      // Load campaigns for filter
      const { data: campaignData } = await (supabase as any)
        .from('roadtour_campaigns')
        .select('id, name')
        .eq('org_id', companyId)
        .order('created_at', { ascending: false })

      setCampaigns(campaignData || [])

      // Build delivery logs query
      let query = (supabase as any)
        .from('roadtour_qr_delivery_logs')
        .select(`
          id, campaign_id, qr_code_id, phone_number, channel, send_status,
          error_message, sent_at, delivered_at, provider_message_id,
          account_manager_user_id,
          roadtour_campaigns!inner(name, org_id),
          users:account_manager_user_id(full_name)
        `)
        .eq('roadtour_campaigns.org_id', companyId)
        .order('sent_at', { ascending: false })
        .limit(100)

      if (campaignFilter !== 'all') {
        query = query.eq('campaign_id', campaignFilter)
      }

      const { data: logData, error } = await query

      if (error) {
        toast({ title: 'Error', description: 'Failed to load delivery logs.', variant: 'destructive' })
        return
      }

      const mappedLogs: DeliveryLog[] = (logData || []).map((l: any) => ({
        ...l,
        campaign_name: l.roadtour_campaigns?.name || '—',
        manager_name: l.users?.full_name || '—',
      }))

      setLogs(mappedLogs)

      // Compute stats
      const s: DeliveryStats = { total: mappedLogs.length, sent: 0, delivered: 0, failed: 0, pending: 0 }
      for (const log of mappedLogs) {
        if (log.send_status === 'sent') s.sent++
        else if (log.send_status === 'delivered') s.delivered++
        else if (log.send_status === 'failed') s.failed++
        else s.pending++
      }
      setStats(s)
    } catch {
      toast({ title: 'Error', description: 'Failed to load WhatsApp monitoring data.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [companyId, supabase, campaignFilter])

  useEffect(() => { loadData() }, [loadData])

  const statusConfig: Record<string, { icon: any; color: string; badge: string }> = {
    sent: { icon: Send, color: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
    delivered: { icon: CheckCircle2, color: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
    failed: { icon: XCircle, color: 'text-red-600', badge: 'bg-red-100 text-red-700' },
    pending: { icon: Clock, color: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />WhatsApp Monitoring
          </h3>
          <p className="text-sm text-muted-foreground mt-1">Track WhatsApp QR delivery status and activity.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
          <RefreshCw className="h-4 w-4" />Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100"><MessageSquare className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total Messages</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-2xl font-bold">{stats.sent + stats.delivered}</p><p className="text-xs text-muted-foreground">Sent / Delivered</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100"><XCircle className="h-5 w-5 text-red-600" /></div>
            <div><p className="text-2xl font-bold">{stats.failed}</p><p className="text-xs text-muted-foreground">Failed</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-2xl font-bold">{stats.pending}</p><p className="text-xs text-muted-foreground">Pending</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Campaign:</span>
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-[250px]"><SelectValue placeholder="All Campaigns" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Delivery Log Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No WhatsApp delivery logs found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Phone</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Campaign</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Sent By</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Status</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Sent At</th>
                    <th className="pb-2 font-medium text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const sc = statusConfig[log.send_status] || statusConfig.pending
                    const StatusIcon = sc.icon
                    return (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 font-mono text-xs">{log.phone_number}</td>
                        <td className="py-2.5 pr-4">{log.campaign_name}</td>
                        <td className="py-2.5 pr-4">{log.manager_name}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className={`gap-1 ${sc.badge}`}>
                            <StatusIcon className="h-3 w-3" />
                            {log.send_status}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                          {new Date(log.sent_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
                        </td>
                        <td className="py-2.5 text-xs text-red-600 max-w-[200px] truncate">
                          {log.error_message || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
