'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    BarChart3, Loader2, RefreshCw, Users, ClipboardCheck, Megaphone, Clock, Eye, Download, Inbox, FileText,
} from 'lucide-react'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import { toast } from '@/components/ui/use-toast'
import { Progress } from '@/components/ui/progress'
import { ResponseDetailsDialog, formatAnswer, maskPhone, type ResponseRow, type ResponseItem } from './roadtour-survey-shared'

interface Props {
    userProfile: any
    onNavigateTemplates?: () => void
}

interface TemplateField {
    id: string
    template_id: string
    field_key: string
    field_label: string
    field_type: string
    field_options: string[] | null
    is_required: boolean
    sort_order: number
}

interface TemplateRow { id: string; name: string; description: string | null; is_active: boolean }

const DONUT_COLORS = ['#10b981', '#ef4444', '#94a3b8']
const BAR_COLOR = '#e85d04'

function formatLocalIsoDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function todayIso() {
    return formatLocalIsoDate(new Date())
}
function isoAddDays(iso: string, days: number) {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + days)
    return formatLocalIsoDate(d)
}

function normalizeOptions(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null
    const out = value
        .map((o) => {
            if (typeof o === 'string') return o.trim()
            if (o && typeof o === 'object') {
                const label = typeof (o as any).label === 'string' ? (o as any).label.trim() : ''
                const v = typeof (o as any).value === 'string' ? (o as any).value.trim() : ''
                return label || v
            }
            return ''
        })
        .filter(Boolean)
    return out.length > 0 ? out : null
}

function answerToYesNo(item: ResponseItem): 'yes' | 'no' | null {
    if (typeof item.answer_json === 'boolean') return item.answer_json ? 'yes' : 'no'
    const raw = (item.answer_text || (item.answer_json != null ? String(item.answer_json) : '')).trim().toLowerCase()
    if (!raw) return null
    if (['yes', 'y', 'true', '1'].includes(raw)) return 'yes'
    if (['no', 'n', 'false', '0'].includes(raw)) return 'no'
    return null
}

function answerToSelections(item: ResponseItem): string[] {
    if (Array.isArray(item.answer_json)) return item.answer_json.map((v) => String(v))
    if (typeof item.answer_json === 'string') return [item.answer_json]
    if (item.answer_text) return [item.answer_text]
    return []
}

function answerToNumber(item: ResponseItem): number | null {
    if (typeof item.answer_number === 'number' && Number.isFinite(item.answer_number)) return item.answer_number
    if (item.answer_text) {
        const n = Number(item.answer_text)
        if (Number.isFinite(n)) return n
    }
    return null
}

function isAnswered(item: ResponseItem | undefined): boolean {
    if (!item) return false
    if (item.answer_text && item.answer_text.trim()) return true
    if (item.answer_number != null) return true
    if (item.media_url) return true
    if (item.answer_json !== null && item.answer_json !== undefined) {
        if (Array.isArray(item.answer_json)) return item.answer_json.length > 0
        if (typeof item.answer_json === 'string') return item.answer_json.trim().length > 0
        return true
    }
    return false
}

export function RoadtourSurveyReportingView({ userProfile, onNavigateTemplates }: Props) {
    const supabase = createClient()
    const orgId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [templates, setTemplates] = useState<TemplateRow[]>([])
    const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([])

    const [templateId, setTemplateId] = useState<string>('')
    const [campaignId, setCampaignId] = useState<string>('all')
    const [region, setRegion] = useState<string>('all')
    const [dateFrom, setDateFrom] = useState(isoAddDays(todayIso(), -29))
    const [dateTo, setDateTo] = useState(todayIso())

    const [fields, setFields] = useState<TemplateField[]>([])
    const [responses, setResponses] = useState<ResponseRow[]>([])
    const [detail, setDetail] = useState<ResponseRow | null>(null)

    // Initial load: templates + campaigns
    useEffect(() => {
        (async () => {
            try {
                const [{ data: tpl }, { data: camp }] = await Promise.all([
                    (supabase as any).from('roadtour_survey_templates').select('id, name, description, is_active').eq('org_id', orgId).order('name'),
                    (supabase as any).from('roadtour_campaigns').select('id, name, status').eq('org_id', orgId).order('name'),
                ])
                setTemplates(tpl || [])
                setCampaigns(camp || [])
                const activeTpl = (tpl || []).find((t: any) => t.is_active) || (tpl || [])[0]
                if (activeTpl) setTemplateId(activeTpl.id)
            } catch (err: any) {
                toast({ title: 'Error', description: err?.message || 'Failed to load filters.', variant: 'destructive' })
            } finally {
                setLoading(false)
            }
        })()
    }, [orgId, supabase])

    // Load fields and responses when template/filters change
    const loadData = useCallback(async () => {
        if (!templateId) {
            setFields([])
            setResponses([])
            return
        }
        try {
            if (!refreshing) setLoading(true)
            const { data: fieldRows, error: fErr } = await (supabase as any)
                .from('roadtour_survey_template_fields')
                .select('id, template_id, field_key, field_label, field_type, field_options, is_required, sort_order')
                .eq('template_id', templateId)
                .order('sort_order')
            if (fErr) throw fErr

            const normalizedFields: TemplateField[] = (fieldRows || []).map((r: any) => ({
                id: r.id,
                template_id: r.template_id,
                field_key: r.field_key,
                field_label: r.field_label,
                field_type: r.field_type,
                field_options: normalizeOptions(r.field_options),
                is_required: !!r.is_required,
                sort_order: Number(r.sort_order || 0),
            }))
            setFields(normalizedFields)

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
                .eq('template_id', templateId)
                .gte('submitted_at', dateFrom + 'T00:00:00')
                .lte('submitted_at', dateTo + 'T23:59:59')
                .order('submitted_at', { ascending: false })
                .limit(1000)

            if (campaignId !== 'all') q = q.eq('campaign_id', campaignId)

            const { data: respData, error: rErr } = await q
            if (rErr) throw rErr

            const responseIds = (respData || []).map((r: any) => r.id)
            let itemsByResponse: Record<string, ResponseItem[]> = {}
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

            const totalFields = normalizedFields.length
            const normalized: ResponseRow[] = (respData || []).map((r: any) => {
                const items = itemsByResponse[r.id] || []
                const answered = items.filter(isAnswered).length
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
            setResponses(normalized)
        } catch (err: any) {
            console.error('[RoadtourSurveyReporting] load failed', err)
            toast({ title: 'Error', description: err?.message || 'Failed to load reporting data.', variant: 'destructive' })
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [orgId, supabase, templateId, campaignId, dateFrom, dateTo, refreshing])

    useEffect(() => { loadData() }, [loadData])

    // Region options derived from response data
    const regions = useMemo(() => {
        const set = new Set<string>()
        for (const r of responses) if (r.shop_state) set.add(r.shop_state)
        return Array.from(set).sort()
    }, [responses])

    const filtered = useMemo(() => {
        if (region === 'all') return responses
        return responses.filter((r) => r.shop_state === region)
    }, [responses, region])

    // KPI metrics
    const metrics = useMemo(() => {
        const total = filtered.length
        const completed = filtered.filter((r) => r.completion_pct >= 100).length
        const completionRate = total > 0 ? (completed / total) * 100 : 0
        const uniqueShops = new Set(filtered.map((r) => r.shop_id).filter(Boolean)).size
        const activeCampaigns = new Set(filtered.map((r) => r.campaign_id)).size
        return { total, completionRate, uniqueShops, activeCampaigns }
    }, [filtered])

    const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId])

    // Per-field analytics
    const fieldInsights = useMemo(() => {
        return fields.map((field) => {
            const fieldItems = filtered.flatMap((r) => r.items.filter((i) => i.field_key === field.field_key))
            const answeredCount = fieldItems.filter(isAnswered).length
            const totalRespForField = filtered.length
            const completenessPct = totalRespForField > 0 ? (answeredCount / totalRespForField) * 100 : 0
            return { field, items: fieldItems, answeredCount, totalRespForField, completenessPct }
        })
    }, [fields, filtered])

    const handleExport = () => {
        if (filtered.length === 0) return toast({ title: 'No data', description: 'No responses to export.' })
        const headerRow = ['Submitted At', 'Campaign', 'Reference / AM', 'Shop', 'Region', 'Status', 'Completion %', 'Points', ...fields.map((f) => f.field_label)]
        const csvRows = filtered.map((r) => {
            const itemMap = new Map(r.items.map((i) => [i.field_key, i]))
            return [
                new Date(r.submitted_at).toLocaleString(),
                r.campaign_name,
                r.am_name,
                r.shop_name,
                r.shop_state || '',
                r.completion_pct >= 100 ? 'Completed' : 'Partial',
                r.completion_pct + '%',
                String(r.points_awarded),
                ...fields.map((f) => {
                    const it = itemMap.get(f.field_key)
                    if (!it) return ''
                    const v = formatAnswer(it)
                    return f.field_type === 'phone' ? maskPhone(v) : v
                }),
            ]
        })
        const csv = [headerRow, ...csvRows]
            .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `roadtour-survey-report-${todayIso()}.csv`
        a.click()
    }

    if (loading && templates.length === 0) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-[var(--sera-orange)]" /></div>
    }

    if (templates.length === 0) {
        return (
            <Card>
                <CardContent className="py-16 text-center">
                    <FileText className="h-10 w-10 mx-auto text-muted-foreground/40" />
                    <p className="mt-3 text-sm font-medium">No survey templates yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Create a survey template to start collecting RoadTour responses.</p>
                    {onNavigateTemplates && (
                        <Button variant="outline" size="sm" className="mt-4" onClick={onNavigateTemplates}>Go to Templates</Button>
                    )}
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="sera-sc-page space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="sera-sc-header__bar mb-3 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
                    <h3 className="font-display flex items-center gap-2 text-lg font-semibold tracking-tight text-[var(--sera-ink)] sm:text-xl">
                        <BarChart3 className="h-5 w-5 text-[var(--sera-orange)]" />
                        Survey Reporting
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Reporting is generated dynamically from the selected survey template.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setRefreshing(true); loadData() }} className="gap-2">
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2" disabled={filtered.length === 0}>
                        <Download className="h-4 w-4" />
                        Export Report
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3">
                    <label className="text-xs text-muted-foreground">Template</label>
                    <Select value={templateId} onValueChange={setTemplateId}>
                        <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                        <SelectContent>
                            {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-3">
                    <label className="text-xs text-muted-foreground">Campaign</label>
                    <Select value={campaignId} onValueChange={setCampaignId}>
                        <SelectTrigger><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Campaigns</SelectItem>
                            {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="md:col-span-2">
                    <label className="text-xs text-muted-foreground">From</label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                    <label className="text-xs text-muted-foreground">To</label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                    <label className="text-xs text-muted-foreground">Region</label>
                    <Select value={region} onValueChange={setRegion}>
                        <SelectTrigger><SelectValue placeholder="All Regions" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Regions</SelectItem>
                            {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {!templateId ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground/40" />
                        <p className="mt-3 text-sm font-medium">Select a survey template to view reporting.</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* KPI cards */}
                    <div className="grid gap-3 md:grid-cols-5">
                        <KpiCard icon={<BarChart3 className="h-4 w-4" />} label="Total Responses" value={metrics.total.toLocaleString()} accent="blue" />
                        <KpiCard icon={<ClipboardCheck className="h-4 w-4" />} label="Completion Rate" value={metrics.completionRate.toFixed(1) + '%'} accent="emerald" />
                        <KpiCard icon={<Users className="h-4 w-4" />} label="Unique Shops" value={metrics.uniqueShops.toLocaleString()} accent="violet" />
                        <KpiCard icon={<Megaphone className="h-4 w-4" />} label="Active Campaigns" value={metrics.activeCampaigns.toLocaleString()} accent="amber" />
                        <KpiCard icon={<Clock className="h-4 w-4" />} label="Avg. Completion Time" value="Not tracked" valueClass="text-sm font-medium text-muted-foreground" accent="slate" />
                    </div>

                    {/* Question Insights + Field Explorer */}
                    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">Dynamic Question Insights</CardTitle>
                                <p className="text-xs text-muted-foreground">Insights adapt automatically based on the selected survey template fields.</p>
                            </CardHeader>
                            <CardContent>
                                {filtered.length === 0 ? (
                                    <EmptyState message="No reporting data for this template" hint="Try another campaign, date range, or wait for responses." />
                                ) : fields.length === 0 ? (
                                    <EmptyState message="This template has no fields yet" hint="Add fields in the Templates tab to generate insights." />
                                ) : (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        {fieldInsights.map(({ field, items, answeredCount, totalRespForField, completenessPct }) => (
                                            <FieldInsightCard
                                                key={field.id}
                                                field={field}
                                                items={items}
                                                answeredCount={answeredCount}
                                                totalRespForField={totalRespForField}
                                                completenessPct={completenessPct}
                                            />
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Field Explorer */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">Template Field Explorer</CardTitle>
                                <p className="text-xs text-muted-foreground">Fields in &quot;{selectedTemplate?.name}&quot;</p>
                            </CardHeader>
                            <CardContent>
                                {fields.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-3">No fields defined for this template.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {fields.map((f) => {
                                            const insight = fieldInsights.find((i) => i.field.id === f.id)
                                            return (
                                                <div key={f.id} className="rounded-lg border p-2.5 text-sm">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="font-medium text-sm break-words">{f.field_label}</p>
                                                            <p className="text-[11px] text-muted-foreground">{f.field_key}</p>
                                                        </div>
                                                        <Badge variant="outline" className="text-[10px] capitalize whitespace-nowrap">{f.field_type.replace('_', ' ')}</Badge>
                                                    </div>
                                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                                        {f.is_required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                                                        <span>#{f.sort_order}</span>
                                                        {f.field_options && <span>· {f.field_options.length} options</span>}
                                                        {insight && <span>· {insight.completenessPct.toFixed(0)}% answered</span>}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                                    <span>Total fields: {fields.length}</span>
                                    {onNavigateTemplates && (
                                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onNavigateTemplates}>
                                            <Eye className="h-3.5 w-3.5 mr-1" /> Open Template
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Response Records preview */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Response Records</CardTitle>
                            <p className="text-xs text-muted-foreground">Showing the latest {Math.min(10, filtered.length)} of {filtered.length} responses.</p>
                        </CardHeader>
                        <CardContent className="p-0">
                            {filtered.length === 0 ? (
                                <div className="py-10 text-center">
                                    <Inbox className="h-10 w-10 mx-auto text-muted-foreground/40" />
                                    <p className="mt-3 text-sm font-medium">No responses yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">Responses will appear here after QR scans and survey submissions.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Submitted At</TableHead>
                                                <TableHead>Campaign</TableHead>
                                                <TableHead>Reference / AM</TableHead>
                                                <TableHead>Shop</TableHead>
                                                <TableHead>Region</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Completion</TableHead>
                                                <TableHead className="text-right">Details</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filtered.slice(0, 10).map((r) => {
                                                const complete = r.completion_pct >= 100
                                                return (
                                                    <TableRow key={r.id}>
                                                        <TableCell className="text-xs whitespace-nowrap">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                                                        <TableCell className="text-sm">{r.campaign_name}</TableCell>
                                                        <TableCell className="text-sm">{r.am_name}</TableCell>
                                                        <TableCell className="text-sm">{r.shop_name}</TableCell>
                                                        <TableCell className="text-sm">{r.shop_state || '—'}</TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className={complete ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>
                                                                {complete ? 'Completed' : 'Partial'}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <span className="text-xs font-medium">{r.completion_pct}%</span>
                                                                <div className="w-16"><Progress value={r.completion_pct} className="h-1.5" /></div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button size="sm" variant="ghost" onClick={() => setDetail(r)}><Eye className="h-4 w-4" /></Button>
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            <ResponseDetailsDialog row={detail} onClose={() => setDetail(null)} />
        </div>
    )
}

function KpiCard({ icon, label, value, accent, valueClass }: { icon: React.ReactNode; label: string; value: string; accent: string; valueClass?: string }) {
    const accentMap: Record<string, string> = {
        blue: 'bg-[var(--sera-orange)]/[0.06] text-[var(--sera-orange-deep)]',
        emerald: 'bg-emerald-50 text-emerald-700',
        violet: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)]',
        amber: 'bg-amber-50 text-amber-700',
        slate: 'bg-slate-50 text-slate-600',
    }
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <span className={`rounded-md p-1.5 ${accentMap[accent] || accentMap.slate}`}>{icon}</span>
                </div>
                <p className={valueClass || 'text-2xl font-semibold mt-1.5'}>{value}</p>
            </CardContent>
        </Card>
    )
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
    return (
        <div className="py-10 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">{message}</p>
            {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
    )
}

function FieldInsightCard({ field, items, answeredCount, totalRespForField, completenessPct }: {
    field: TemplateField
    items: ResponseItem[]
    answeredCount: number
    totalRespForField: number
    completenessPct: number
}) {
    const type = field.field_type
    const subTitle = `(${type.replace('_', ' ')}) · ${answeredCount} answers`

    return (
        <div className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{field.field_label}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{subTitle}</p>
                </div>
                {field.is_required && <Badge variant="outline" className="text-[10px]">Required</Badge>}
            </div>
            <FieldInsightBody field={field} items={items} answeredCount={answeredCount} totalRespForField={totalRespForField} completenessPct={completenessPct} />
        </div>
    )
}

function FieldInsightBody({ field, items, answeredCount, totalRespForField, completenessPct }: {
    field: TemplateField
    items: ResponseItem[]
    answeredCount: number
    totalRespForField: number
    completenessPct: number
}) {
    const type = field.field_type

    if (totalRespForField === 0) {
        return <p className="text-xs text-muted-foreground py-2">No responses yet.</p>
    }

    if (type === 'yes_no') {
        let yes = 0, no = 0, unanswered = 0
        for (let i = 0; i < totalRespForField; i++) {
            const item = items[i]
            const v = item ? answerToYesNo(item) : null
            if (v === 'yes') yes++
            else if (v === 'no') no++
            else unanswered++
        }
        const data = [
            { name: 'Yes', value: yes },
            { name: 'No', value: no },
            { name: 'Unanswered', value: unanswered },
        ].filter((d) => d.value > 0)
        return (
            <div className="flex items-center gap-3">
                <div className="h-32 w-32 shrink-0">
                    <ResponsiveContainer>
                        <PieChart>
                            <Pie data={data} cx="50%" cy="50%" innerRadius={32} outerRadius={56} dataKey="value">
                                {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1 text-xs">
                    <Row label="Yes" value={yes} total={totalRespForField} color="bg-emerald-500" />
                    <Row label="No" value={no} total={totalRespForField} color="bg-rose-500" />
                    <Row label="Unanswered" value={unanswered} total={totalRespForField} color="bg-slate-300" />
                </div>
            </div>
        )
    }

    if (type === 'single_select' || type === 'radio' || type === 'multi_select' || type === 'checkbox') {
        const counts = new Map<string, number>()
        const opts = field.field_options || []
        for (const o of opts) counts.set(o, 0)
        for (const it of items) {
            const sels = type === 'multi_select' || type === 'checkbox' ? answerToSelections(it) : [formatAnswer(it)]
            for (const s of sels) {
                if (!s) continue
                counts.set(s, (counts.get(s) || 0) + 1)
            }
        }
        const data = Array.from(counts.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
        if (data.length === 0) return <p className="text-xs text-muted-foreground py-2">No selections recorded.</p>
        return (
            <div className="h-44">
                <ResponsiveContainer>
                    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} fontSize={11} />
                        <YAxis dataKey="name" type="category" fontSize={11} width={90} />
                        <Tooltip />
                        <Bar dataKey="value" fill={BAR_COLOR} radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        )
    }

    if (type === 'number') {
        const numbers = items.map(answerToNumber).filter((n): n is number => n !== null)
        if (numbers.length === 0) return <p className="text-xs text-muted-foreground py-2">No numeric responses.</p>
        const sum = numbers.reduce((a, b) => a + b, 0)
        const avg = sum / numbers.length
        const min = Math.min(...numbers)
        const max = Math.max(...numbers)
        return (
            <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Average" value={avg.toFixed(2)} />
                <Stat label="Min" value={String(min)} />
                <Stat label="Max" value={String(max)} />
            </div>
        )
    }

    if (type === 'text' || type === 'textarea') {
        const samples = items.filter(isAnswered).slice(0, 3)
        return (
            <div className="space-y-2">
                <CompletenessBar percent={completenessPct} count={answeredCount} total={totalRespForField} />
                {samples.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No text responses yet.</p>
                ) : (
                    <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground">Recent answers:</p>
                        {samples.map((s, i) => (
                            <p key={i} className="text-xs italic text-foreground/80 line-clamp-2">&quot;{formatAnswer(s)}&quot;</p>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    if (type === 'phone' || type === 'email') {
        return (
            <div className="space-y-2">
                <CompletenessBar percent={completenessPct} count={answeredCount} total={totalRespForField} />
                <p className="text-[11px] text-muted-foreground">Values masked in reporting; see details for full record.</p>
            </div>
        )
    }

    if (type === 'photo') {
        return (
            <div className="space-y-2">
                <CompletenessBar percent={completenessPct} count={answeredCount} total={totalRespForField} />
                <p className="text-[11px] text-muted-foreground">Photo attachments uploaded.</p>
            </div>
        )
    }

    // Unknown / generic fallback
    return (
        <div className="space-y-2">
            <CompletenessBar percent={completenessPct} count={answeredCount} total={totalRespForField} />
            <p className="text-[11px] text-muted-foreground">Response coverage shown for this field type.</p>
        </div>
    )
}

function Row({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
    const pct = total > 0 ? (value / total) * 100 : 0
    return (
        <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
                <span className="truncate">{label}</span>
            </div>
            <span className="font-medium whitespace-nowrap">{value} ({pct.toFixed(1)}%)</span>
        </div>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg bg-muted/30 px-2 py-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="text-base font-semibold">{value}</p>
        </div>
    )
}

function CompletenessBar({ percent, count, total }: { percent: number; count: number; total: number }) {
    return (
        <div>
            <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Completeness</span>
                <span className="font-medium">{count}/{total} ({percent.toFixed(0)}%)</span>
            </div>
            <Progress value={percent} className="h-2" />
        </div>
    )
}
