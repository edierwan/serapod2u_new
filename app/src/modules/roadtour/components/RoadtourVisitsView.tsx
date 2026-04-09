'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    Calendar, CheckCircle2, Eye, Loader2, MapPin, Search, Users
} from 'lucide-react'
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
    visit_date: string
    visit_status: string
    notes: string | null
    created_at: string
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
}

export function RoadtourVisitsView({ userProfile, onViewChange }: RoadtourVisitsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [visits, setVisits] = useState<OfficialVisit[]>([])
    const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
    const [campaignFilter, setCampaignFilter] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    // Detail dialog
    const [detailOpen, setDetailOpen] = useState(false)
    const [detailVisit, setDetailVisit] = useState<OfficialVisit | null>(null)
    const [scans, setScans] = useState<ScanEvent[]>([])
    const [scansLoading, setScansLoading] = useState(false)

    const loadVisits = useCallback(async () => {
        try {
            setLoading(true)
            let q = (supabase as any)
                .from('roadtour_official_visits')
                .select('*, roadtour_campaigns!inner(name, org_id), users:account_manager_user_id(full_name, phone), organizations:shop_id(name)')
                .eq('roadtour_campaigns.org_id', companyId)
                .order('visit_date', { ascending: false })
                .limit(200)

            if (campaignFilter !== 'all') q = q.eq('campaign_id', campaignFilter)
            if (dateFrom) q = q.gte('visit_date', dateFrom)
            if (dateTo) q = q.lte('visit_date', dateTo)

            const { data, error } = await q;
            if (error) throw error

            setVisits(
                (data || []).map((v: any) => ({
                    ...v,
                    campaign_name: v.roadtour_campaigns?.name || '—',
                    user_name: v.users?.full_name || '—',
                    user_phone: v.users?.phone || '',
                    shop_name: v.organizations?.name || '—',
                }))
            )

            // Load campaigns for filter
            const { data: cData } = await (supabase as any).from('roadtour_campaigns').select('id, name').eq('org_id', companyId).order('name')
            setCampaigns(cData || [])
        } catch {
            toast({ title: 'Error', description: 'Failed to load visits.', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [companyId, supabase, campaignFilter, dateFrom, dateTo])

    useEffect(() => { loadVisits() }, [loadVisits])

    const openDetail = async (visit: OfficialVisit) => {
        setDetailVisit(visit)
        setDetailOpen(true)
        setScansLoading(true)
        try {
            // Get scan events for this visit's campaign + AM + shop + date
            const { data, error } = await (supabase as any)
                .from('roadtour_scan_events')
                .select('*, users:scanned_by_user_id(full_name), organizations:shop_id(name)')
                .eq('campaign_id', visit.campaign_id)
                .eq('account_manager_user_id', visit.account_manager_user_id)
                .eq('shop_id', visit.shop_id)
                .gte('scan_time', visit.visit_date + 'T00:00:00')
                .lt('scan_time', visit.visit_date + 'T23:59:59')
                .order('scan_time', { ascending: false })

            if (error) throw error
            setScans(
                (data || []).map((s: any) => ({
                    ...s,
                    consumer_name: s.users?.full_name || null,
                    shop_name: s.organizations?.name || null,
                }))
            )
        } catch {
            toast({ title: 'Error', description: 'Failed to load scan details.', variant: 'destructive' })
        } finally {
            setScansLoading(false)
        }
    }

    const filtered = visits.filter((v) => {
        if (searchTerm) {
            const term = searchTerm.toLowerCase()
            if (!v.user_name?.toLowerCase().includes(term) && !v.shop_name?.toLowerCase().includes(term) && !v.campaign_name?.toLowerCase().includes(term)) return false
        }
        return true
    })

    const rewardStatusColor: Record<string, string> = {
        opened: 'bg-amber-100 text-amber-700',
        success: 'bg-emerald-100 text-emerald-700',
        duplicate: 'bg-gray-100 text-gray-700',
        rejected: 'bg-red-100 text-red-700',
        invalid: 'bg-red-100 text-red-700',
        expired: 'bg-gray-100 text-gray-700',
    }

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-4 sm:space-y-6">
            <div>
                <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" />Visit Tracking</h3>
                <p className="text-sm text-muted-foreground mt-1">Track official visits by references across campaigns.</p>
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by reference, shop, or campaign..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                    <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Campaigns</SelectItem>
                        {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" placeholder="From" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" placeholder="To" />
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{filtered.length}</p><p className="text-xs text-muted-foreground">Total Visits</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{new Set(filtered.map((v) => v.account_manager_user_id)).size}</p><p className="text-xs text-muted-foreground">Active References</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{new Set(filtered.map((v) => v.shop_id)).size}</p><p className="text-xs text-muted-foreground">Shops Visited</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{new Set(filtered.map((v) => v.campaign_id)).size}</p><p className="text-xs text-muted-foreground">Campaigns</p></CardContent></Card>
            </div>

            {/* Visits Table */}
            <Card>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Reference</TableHead>
                                <TableHead>Shop</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 && (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No visits found.</TableCell></TableRow>
                            )}
                            {filtered.map((v) => (
                                <TableRow key={v.id}>
                                    <TableCell className="text-sm">{v.visit_date}</TableCell>
                                    <TableCell>
                                        <div>
                                            <p className="font-medium">{v.user_name}</p>
                                            {v.user_phone && <p className="text-xs text-muted-foreground">{v.user_phone}</p>}
                                        </div>
                                    </TableCell>
                                    <TableCell>{v.shop_name}</TableCell>
                                    <TableCell>{v.campaign_name}</TableCell>
                                    <TableCell><Badge className={v.visit_status === 'official' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}>{v.visit_status}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Button size="sm" variant="ghost" onClick={() => openDetail(v)}><Eye className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Detail Dialog */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Visit Details</DialogTitle>
                    </DialogHeader>
                    {detailVisit && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><Label className="text-muted-foreground">Date</Label><p className="font-medium">{detailVisit.visit_date}</p></div>
                                <div><Label className="text-muted-foreground">Campaign</Label><p className="font-medium">{detailVisit.campaign_name}</p></div>
                                <div><Label className="text-muted-foreground">Reference</Label><p className="font-medium">{detailVisit.user_name}</p>{detailVisit.user_phone && <p className="text-xs text-muted-foreground">{detailVisit.user_phone}</p>}</div>
                                <div><Label className="text-muted-foreground">Shop</Label><p className="font-medium">{detailVisit.shop_name}</p></div>
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
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {s.points_awarded > 0 && <span className="text-sm font-medium text-emerald-600">+{s.points_awarded} pts</span>}
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
