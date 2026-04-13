'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    Copy, Download, Eye, Loader2, QrCode, RefreshCcw,
    Search, Send, ShieldOff
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { buildRoadTourUrl } from '@/lib/roadtour/url'

interface RoadtourQrManagementViewProps {
    userProfile: any
    onViewChange: (viewId: string) => void
}

interface Campaign {
    id: string
    name: string
    status: string
}

interface QrCode {
    id: string
    campaign_id: string
    campaign_name?: string
    account_manager_user_id: string
    user_name?: string
    user_phone?: string
    token: string
    status: string
    expires_at: string | null
    usage_count: number
    created_at: string
    route_year?: number | null
    campaign_slug?: string | null
    reference_slug?: string | null
    short_code?: string | null
    canonical_path?: string | null
}

interface QrCampaignGroup {
    key: string
    campaign_id: string
    campaign_name: string
    status: string
    qr_codes: QrCode[]
    usage_count: number
    expires_at: string | null
    created_at: string
    has_friendly_url: boolean
}

export function RoadtourQrManagementView({ userProfile, onViewChange }: RoadtourQrManagementViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [qrCodes, setQrCodes] = useState<QrCode[]>([])
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [campaignFilter, setCampaignFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')
    const [sendingGroupKey, setSendingGroupKey] = useState<string | null>(null)
    const [revokingGroupKey, setRevokingGroupKey] = useState<string | null>(null)

    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewOptions, setPreviewOptions] = useState<QrCode[]>([])
    const [previewQr, setPreviewQr] = useState<QrCode | null>(null)
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    const qrOrigin = typeof window !== 'undefined' ? window.location.origin : ''

    const getQrUrl = useCallback((qr: QrCode) => {
        return buildRoadTourUrl(qrOrigin, qr.canonical_path || null) || `${qrOrigin}/scan?rt=${qr.token}`
    }, [qrOrigin])

    const loadData = useCallback(async () => {
        try {
            setLoading(true)

            const [campaignRes, qrRes] = await Promise.all([
                (supabase as any).from('roadtour_campaigns').select('id, name, status').eq('org_id', companyId).order('name'),
                (supabase as any).from('roadtour_qr_codes')
                    .select('*, roadtour_campaigns!inner(name, org_id), users:account_manager_user_id(full_name, phone)')
                    .eq('roadtour_campaigns.org_id', companyId)
                    .order('created_at', { ascending: false })
                    .limit(500),
            ])

            if (campaignRes.error) throw campaignRes.error
            if (qrRes.error) throw qrRes.error

            setCampaigns(campaignRes.data || [])
            setQrCodes((qrRes.data || []).map((row: any) => ({
                ...row,
                campaign_name: row.roadtour_campaigns?.name || '—',
                user_name: row.users?.full_name || '—',
                user_phone: row.users?.phone || '',
            })))
        } catch {
            toast({ title: 'Error', description: 'Failed to load QR records.', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [companyId, supabase])

    useEffect(() => { loadData() }, [loadData])

    useEffect(() => {
        if (!previewQr) {
            setPreviewDataUrl(null)
            return
        }

        ; (async () => {
            try {
                setPreviewLoading(true)
                const QRCode = (await import('qrcode')).default
                const dataUrl = await QRCode.toDataURL(getQrUrl(previewQr), {
                    width: 360,
                    margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' },
                })
                setPreviewDataUrl(dataUrl)
            } catch {
                setPreviewDataUrl(null)
                toast({ title: 'Error', description: 'Failed to generate QR preview.', variant: 'destructive' })
            } finally {
                setPreviewLoading(false)
            }
        })()
    }, [getQrUrl, previewQr])

    const sendWhatsAppForQr = async (qr: QrCode, silent = false) => {
        const phone = qr.user_phone
        if (!phone) {
            if (!silent) {
                toast({ title: 'Error', description: 'Reference has no phone number.', variant: 'destructive' })
            }
            return { ok: false, reason: 'missing_phone' }
        }

        const resp = await fetch('/api/roadtour/send-qr-whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone,
                token: qr.token,
                campaignName: qr.campaign_name,
                userName: qr.user_name,
            }),
        })

        if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}))
            throw new Error(errBody.error || `WhatsApp send failed (${resp.status})${errBody.step ? ` [${errBody.step}]` : ''}`)
        }

        await (supabase as any).from('roadtour_qr_delivery_logs').insert({
            campaign_id: qr.campaign_id,
            qr_code_id: qr.id,
            account_manager_user_id: qr.account_manager_user_id,
            phone_number: phone,
            channel: 'whatsapp_qr_image',
            send_status: 'sent',
            sent_at: new Date().toISOString(),
        })

        if (!silent) {
            toast({ title: 'Sent', description: `QR code image sent via WhatsApp to ${phone}.` })
        }

        return { ok: true }
    }

    const downloadQr = async (qr: QrCode) => {
        try {
            const QRCode = (await import('qrcode')).default
            const dataUrl = await QRCode.toDataURL(getQrUrl(qr), { width: 600, margin: 2 })
            const link = document.createElement('a')
            link.download = `roadtour-qr-${qr.token.substring(0, 8)}.png`
            link.href = dataUrl
            link.click()
        } catch {
            toast({ title: 'Error', description: 'Failed to download QR.', variant: 'destructive' })
        }
    }

    const copyLink = (qr: QrCode) => {
        navigator.clipboard.writeText(getQrUrl(qr))
        toast({ title: 'Copied', description: 'QR link copied to clipboard.' })
    }

    const openPreviewGroup = (group: QrCampaignGroup) => {
        setPreviewOptions(group.qr_codes)
        setPreviewQr(group.qr_codes[0] || null)
        setPreviewOpen(true)
    }

    const sendGroupWhatsApp = async (group: QrCampaignGroup) => {
        const activeQrs = group.qr_codes.filter((qr) => qr.status === 'active')
        if (activeQrs.length === 0) {
            toast({ title: 'No Active QR', description: 'This campaign has no active QR records to send.', variant: 'destructive' })
            return
        }

        try {
            setSendingGroupKey(group.key)
            let sentCount = 0
            for (const qr of activeQrs) {
                const result = await sendWhatsAppForQr(qr, true)
                if (result.ok) sentCount += 1
            }
            toast({
                title: 'WhatsApp Sent',
                description: sentCount === 1
                    ? 'QR code sent to 1 reference.'
                    : `QR codes sent to ${sentCount} references.`
            })
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to send WhatsApp messages.', variant: 'destructive' })
        } finally {
            setSendingGroupKey(null)
        }
    }

    const revokeGroup = async (group: QrCampaignGroup) => {
        const activeIds = group.qr_codes.filter((qr) => qr.status === 'active').map((qr) => qr.id)
        if (activeIds.length === 0) {
            toast({ title: 'No Active QR', description: 'This group has no active QR records to revoke.' })
            return
        }

        try {
            setRevokingGroupKey(group.key)
            const { error } = await (supabase as any)
                .from('roadtour_qr_codes')
                .update({ status: 'revoked' })
                .in('id', activeIds)

            if (error) throw error
            toast({
                title: 'Revoked',
                description: activeIds.length === 1
                    ? '1 QR code has been revoked.'
                    : `${activeIds.length} QR codes have been revoked.`
            })
            loadData()
        } catch (error: any) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' })
        } finally {
            setRevokingGroupKey(null)
        }
    }

    const groupedMap = new Map<string, QrCampaignGroup>()
    for (const qr of qrCodes) {
        const key = `${qr.campaign_id}:${qr.status}`
        const existing = groupedMap.get(key)
        if (existing) {
            existing.qr_codes.push(qr)
            existing.usage_count += qr.usage_count || 0
            existing.has_friendly_url = existing.has_friendly_url || Boolean(qr.canonical_path)
            if (!existing.expires_at && qr.expires_at) existing.expires_at = qr.expires_at
            if (new Date(qr.created_at).getTime() > new Date(existing.created_at).getTime()) {
                existing.created_at = qr.created_at
            }
        } else {
            groupedMap.set(key, {
                key,
                campaign_id: qr.campaign_id,
                campaign_name: qr.campaign_name || '—',
                status: qr.status,
                qr_codes: [qr],
                usage_count: qr.usage_count || 0,
                expires_at: qr.expires_at,
                created_at: qr.created_at,
                has_friendly_url: Boolean(qr.canonical_path),
            })
        }
    }

    const groupedRows = Array.from(groupedMap.values())
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .filter((group) => {
            if (campaignFilter !== 'all' && group.campaign_id !== campaignFilter) return false
            if (statusFilter !== 'all' && group.status !== statusFilter) return false
            if (!searchTerm) return true
            const term = searchTerm.toLowerCase()
            return group.campaign_name.toLowerCase().includes(term)
                || group.qr_codes.some((qr) => (qr.user_name || '').toLowerCase().includes(term))
        })

    const statusColors: Record<string, string> = {
        active: 'bg-emerald-100 text-emerald-700',
        revoked: 'bg-red-100 text-red-700',
        expired: 'bg-gray-100 text-gray-700',
    }

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><QrCode className="h-5 w-5 text-primary" />QR Management</h3>
                    <p className="text-sm text-muted-foreground mt-1">QR records are created automatically when campaigns are activated and references are assigned.</p>
                </div>
                <Button variant="outline" onClick={loadData} className="gap-2 w-full sm:w-auto"><RefreshCcw className="h-4 w-4" />Refresh</Button>
            </div>

            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by reference or campaign..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                    <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Campaigns</SelectItem>
                        {campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="revoked">Revoked</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Reference</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden sm:table-cell">Scans</TableHead>
                                <TableHead className="hidden md:table-cell">Expires</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groupedRows.length === 0 && (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No QR records found. Activate a campaign with assigned references to generate them automatically.</TableCell></TableRow>
                            )}
                            {groupedRows.map((group) => (
                                <TableRow key={group.key}>
                                    <TableCell>
                                        {group.qr_codes.length > 1 ? (
                                            <button type="button" onClick={() => openPreviewGroup(group)} className="font-medium text-primary hover:underline">
                                                Show ({group.qr_codes.length})
                                            </button>
                                        ) : (
                                            <div>
                                                <p className="font-medium">{group.qr_codes[0]?.user_name || '—'}</p>
                                                {group.qr_codes[0]?.user_phone && <p className="text-xs text-muted-foreground">{group.qr_codes[0].user_phone}</p>}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div>
                                            <p>{group.campaign_name}</p>
                                            {group.has_friendly_url && <p className="text-xs text-emerald-700">Friendly URL active</p>}
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge className={statusColors[group.status] || ''}>{group.status}</Badge></TableCell>
                                    <TableCell className="hidden sm:table-cell">{group.usage_count}</TableCell>
                                    <TableCell className="hidden md:table-cell text-sm">{group.expires_at ? new Date(group.expires_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex gap-1 justify-end">
                                            <Button size="sm" variant="ghost" onClick={() => openPreviewGroup(group)} title="Preview"><Eye className="h-4 w-4" /></Button>
                                            <Button size="sm" variant="ghost" onClick={() => sendGroupWhatsApp(group)} title="Send WhatsApp" disabled={sendingGroupKey === group.key}>
                                                {sendingGroupKey === group.key ? <Loader2 className="h-4 w-4 animate-spin text-green-600" /> : <Send className="h-4 w-4 text-green-600" />}
                                            </Button>
                                            {group.status === 'active' && (
                                                <Button size="sm" variant="ghost" onClick={() => revokeGroup(group)} title="Revoke" disabled={revokingGroupKey === group.key}>
                                                    {revokingGroupKey === group.key ? <Loader2 className="h-4 w-4 animate-spin text-red-500" /> : <ShieldOff className="h-4 w-4 text-red-500" />}
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>QR Preview</DialogTitle>
                        <DialogDescription>
                            {previewQr ? `${previewQr.campaign_name} — ${previewOptions.length} reference${previewOptions.length === 1 ? '' : 's'}` : 'Preview QR details'}
                        </DialogDescription>
                    </DialogHeader>
                    {previewOptions.length > 1 && (
                        <div className="flex flex-wrap gap-2">
                            {previewOptions.map((option) => (
                                <Button key={option.id} size="sm" variant={previewQr?.id === option.id ? 'default' : 'outline'} onClick={() => setPreviewQr(option)}>
                                    {option.user_name}
                                </Button>
                            ))}
                        </div>
                    )}
                    <div className="flex justify-center py-4">
                        {previewLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : previewDataUrl ? (
                            <img src={previewDataUrl} alt="RoadTour QR" className="w-64 h-64 rounded-lg border" />
                        ) : (
                            <p className="text-muted-foreground">Failed to generate preview.</p>
                        )}
                    </div>
                    {previewQr && (
                        <div className="space-y-3">
                            <div>
                                <p className="font-medium">{previewQr.user_name}</p>
                                {previewQr.user_phone && <p className="text-xs text-muted-foreground">{previewQr.user_phone}</p>}
                            </div>
                            <p className="text-xs text-muted-foreground break-all">{getQrUrl(previewQr)}</p>
                            <div className="flex flex-wrap gap-2 justify-center">
                                <Button size="sm" variant="outline" onClick={() => downloadQr(previewQr)} className="gap-1"><Download className="h-4 w-4" />Download</Button>
                                <Button size="sm" variant="outline" onClick={() => copyLink(previewQr)} className="gap-1"><Copy className="h-4 w-4" />Copy Link</Button>
                                <Button size="sm" variant="outline" onClick={() => sendWhatsAppForQr(previewQr)} className="gap-1"><Send className="h-4 w-4" />WhatsApp</Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}