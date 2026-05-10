'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Eye, Loader2, RefreshCw, Search, ClipboardList, Inbox, Download } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { ResponseDetailsDialog, type ResponseRow } from './roadtour-survey-shared'

interface Props {
    userProfile: any
}

const PAGE_SIZE = 10

function todayIso() {
    return new Date().toISOString().slice(0, 10)
}
function isoAddDays(iso: string, days: number) {
    const d = new Date(iso + 'T00:00:00')
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
}

export function RoadtourSurveyResponsesView({ userProfile }: Props) {
    const supabase = createClient()
    const orgId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [rows, setRows] = useState<ResponseRow[]>([])
    const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
    const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])

    const [templateId, setTemplateId] = useState<string>('all')
    const [campaignId, setCampaignId] = useState<string>('all')
    const [dateFrom, setDateFrom] = useState(isoAddDays(todayIso(), -29))
    const [dateTo, setDateTo] = useState(todayIso())
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [page, setPage] = useState(1)

    const [detail, setDetail] = useState<ResponseRow | null>(null)

    const load = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true)
            const [{ data: tpl }, { data: camp }] = await Promise.all([
                (supabase as any).from('roadtour_survey_templates').select('id, name').eq('org_id', orgId).order('name'),
                (supabase as any).from('roadtour_campaigns').select('id, name').eq('org_id', orgId).order('name'),
            ])
            setTemplates(tpl || [])
            setCampaigns(camp || [])

            let q = (supabase as any)
                .from('roadtour_survey_responses')
                .select(`
                    id, campaign_id, template_id, response_status, submitted_at, points_awarded, shop_id, scanned_by_user_id, account_manager_user_id, created_at,
                    roadtour_campaigns!inner(name, org_id),
                    template:template_id(name),
                    am_user:account_manager_user_id(full_name, phone),
                    shop:shop_id(org_name, branch, city, states:state_id(state_name))
                `)
                .eq('roadtour_campaigns.org_id', orgId)
                .gte('submitted_at', dateFrom + 'T00:00:00')
                .lte('submitted_at', dateTo + 'T23:59:59')
                .order('submitted_at', { ascending: false })
                .limit(500)

            if (templateId !== 'all') q = q.eq('template_id', templateId)
            if (campaignId !== 'all') q = q.eq('campaign_id', campaignId)

            const { data, error } = await q
            if (error) throw error

            const responseIds = (data || []).map((r: any) => r.id)
            let itemsByResponse: Record<string, any[]> = {}
            if (responseIds.length > 0) {
                const { data: items } = await (supabase as any)
                    .from('roadtour_survey_response_items')
                    .select('response_id, field_key, field_label_snapshot, field_type_snapshot, answer_text, answer_json, answer_number, media_url')
                    .in('response_id', responseIds)
                for (const it of items || []) {
                    if (!itemsByResponse[it.response_id]) itemsByResponse[it.response_id] = []
                    itemsByResponse[it.response_id].push(it)
                }
            }

            // Fetch field counts per template to compute completion %
            const tmplIds = Array.from(new Set((data || []).map((r: any) => r.template_id).filter(Boolean)))
            let totalFieldsByTemplate: Record<string, number> = {}
            if (tmplIds.length > 0) {
                const { data: fields } = await (supabase as any)
                    .from('roadtour_survey_template_fields')
                    .select('template_id, is_required')
                    .in('template_id', tmplIds)
                for (const f of fields || []) {
                    totalFieldsByTemplate[f.template_id] = (totalFieldsByTemplate[f.template_id] || 0) + 1
                }
            }

            const normalized: ResponseRow[] = (data || []).map((r: any) => {
                const items = itemsByResponse[r.id] || []
                const totalFields = totalFieldsByTemplate[r.template_id] || items.length
                const answered = items.length
                const completionPct = totalFields > 0 ? Math.round((answered / totalFields) * 100) : 100
                return {
                    id: r.id,
                    campaign_id: r.campaign_id,
                    campaign_name: r.roadtour_campaigns?.name || '—',
                    template_id: r.template_id,
                    template_name: r.template?.name || '—',
                    submitted_at: r.submitted_at || r.created_at,
                    response_status: r.response_status || 'submitted',
                    points_awarded: r.points_awarded || 0,
                    am_name: r.am_user?.full_name || '—',
                    am_phone: r.am_user?.phone || null,
                    shop_id: r.shop_id,
                    shop_name: r.shop?.org_name || '—',
                    shop_branch: r.shop?.branch || null,
                    shop_city: r.shop?.city || null,
                    shop_state: r.shop?.states?.state_name || null,
                    completion_pct: completionPct,
                    total_fields: totalFields,
                    answered_count: answered,
                    items,
                }
            })

            setRows(normalized)
        } catch (err: any) {
            console.error('[RoadtourSurveyResponses] load failed', err)
            toast({ title: 'Error', description: err?.message || 'Failed to load responses.', variant: 'destructive' })
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [orgId, supabase, templateId, campaignId, dateFrom, dateTo, refreshing])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            if (statusFilter !== 'all') {
                const isComplete = r.completion_pct >= 100
                if (statusFilter === 'completed' && !isComplete) return false
                if (statusFilter === 'partial' && isComplete) return false
            }
            if (search) {
                const t = search.toLowerCase()
                if (
                    !r.campaign_name.toLowerCase().includes(t) &&
                    !r.am_name.toLowerCase().includes(t) &&
                    !r.shop_name.toLowerCase().includes(t) &&
                    !r.template_name.toLowerCase().includes(t)
                ) return false
            }
            return true
        })
    }, [rows, statusFilter, search])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageRows = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE
        return filtered.slice(start, start + PAGE_SIZE)
    }, [filtered, page])

    useEffect(() => { setPage(1) }, [statusFilter, search, templateId, campaignId, dateFrom, dateTo])

    const handleExport = () => {
        if (filtered.length === 0) {
            toast({ title: 'No data', description: 'No responses to export.' })
            return
        }
        const headers = ['Submitted At', 'Campaign', 'Template', 'Reference / AM', 'Shop', 'Region', 'Completion %', 'Points']
        const rows = filtered.map((r) => [
            new Date(r.submitted_at).toLocaleString(),
            r.campaign_name,
            r.template_name,
            r.am_name,
            r.shop_name,
            r.shop_state || '',
            r.completion_pct + '%',
            String(r.points_awarded),
        ])
        const csv = [headers, ...rows]
            .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `roadtour-survey-responses-${todayIso()}.csv`
        a.click()
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                        <ClipboardList className="h-5 w-5 text-primary" />
                        Survey Responses
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Browse all survey submissions captured from RoadTour campaigns.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setRefreshing(true); load() }} className="gap-2">
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2" disabled={filtered.length === 0}>
                        <Download className="h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search campaign, reference, shop..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                </div>
                <div className="md:col-span-2">
                    <Select value={templateId} onValueChange={setTemplateId}>
                        <SelectTrigger><SelectValue placeholder="All Templates" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Templates</SelectItem>
                            {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-2">
                    <Select value={campaignId} onValueChange={setCampaignId}>
                        <SelectTrigger><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Campaigns</SelectItem>
                            {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="partial">Partial</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-1.5">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="md:col-span-1.5">
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
            </div>

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                    ) : filtered.length === 0 ? (
                        <div className="py-16 text-center">
                            <Inbox className="h-10 w-10 mx-auto text-muted-foreground/40" />
                            <p className="mt-3 text-sm font-medium">No survey responses found</p>
                            <p className="text-xs text-muted-foreground mt-1">Responses will appear here after QR scans and survey submissions.</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Submitted At</TableHead>
                                            <TableHead>Campaign</TableHead>
                                            <TableHead>Template</TableHead>
                                            <TableHead>Reference / AM</TableHead>
                                            <TableHead>Shop</TableHead>
                                            <TableHead>Region</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Completion</TableHead>
                                            <TableHead className="text-right">Points</TableHead>
                                            <TableHead className="text-right">Details</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {pageRows.map((r) => {
                                            const complete = r.completion_pct >= 100
                                            return (
                                                <TableRow key={r.id}>
                                                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                                                    <TableCell className="text-sm">{r.campaign_name}</TableCell>
                                                    <TableCell className="text-sm">{r.template_name}</TableCell>
                                                    <TableCell className="text-sm">{r.am_name}</TableCell>
                                                    <TableCell className="text-sm">{r.shop_name}</TableCell>
                                                    <TableCell className="text-sm">{r.shop_state || '—'}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={complete ? 'default' : 'secondary'} className={complete ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>
                                                            {complete ? 'Completed' : 'Partial'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right text-sm font-medium">{r.completion_pct}%</TableCell>
                                                    <TableCell className="text-right text-sm">{r.points_awarded}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                                <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                                <div className="flex items-center gap-1">
                                    <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
                                    <span>Page {page} / {totalPages}</span>
                                    <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <ResponseDetailsDialog row={detail} onClose={() => setDetail(null)} />
        </div>
    )
}
