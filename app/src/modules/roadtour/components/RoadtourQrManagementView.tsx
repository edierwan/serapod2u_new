'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    AlertCircle, CheckCircle2, Copy, Download, Eye, Loader2, QrCode, RefreshCcw,
    Search, Send, ShieldOff, XCircle
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

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
    campaign_reference_count?: number
    campaign_references?: { full_name: string; phone: string }[]
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

    // Generate dialog
    const [generateOpen, setGenerateOpen] = useState(false)
    const [genCampaignId, setGenCampaignId] = useState('')
    const [genManagerId, setGenManagerId] = useState('')
    const [assignedManagers, setAssignedManagers] = useState<{ user_id: string; full_name: string }[]>([])
    const [generating, setGenerating] = useState(false)

    // Preview dialog
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewQr, setPreviewQr] = useState<QrCode | null>(null)
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [refsDialogOpen, setRefsDialogOpen] = useState(false)
    const [refsDialogCampaignName, setRefsDialogCampaignName] = useState('')
    const [refsDialogManagers, setRefsDialogManagers] = useState<{ full_name: string; phone: string }[]>([])

    const qrBaseUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/scan`
        : ''

    const loadData = useCallback(async () => {
        try {
            setLoading(true)

            const [campaignRes, qrRes, managerRes] = await Promise.all([
                (supabase as any).from('roadtour_campaigns').select('id, name, status').eq('org_id', companyId).order('name'),
                (supabase as any).from('roadtour_qr_codes')
                    .select('*, roadtour_campaigns!inner(name, org_id), users:account_manager_user_id(full_name, phone)')
                    .eq('roadtour_campaigns.org_id', companyId)
                    .order('created_at', { ascending: false })
                    .limit(200),
                (supabase as any).from('roadtour_campaign_managers')
                    .select('campaign_id, users:user_id(full_name, phone), roadtour_campaigns!inner(org_id)')
                    .eq('is_active', true)
                    .eq('roadtour_campaigns.org_id', companyId),
            ])

            if (campaignRes.error) throw campaignRes.error
            if (qrRes.error) throw qrRes.error
            if (managerRes.error) throw managerRes.error

            const campaignManagers = new Map<string, { full_name: string; phone: string }[]>()
            for (const row of managerRes.data || []) {
                const list = campaignManagers.get(row.campaign_id) || []
                list.push({
                    full_name: row.users?.full_name || '—',
                    phone: row.users?.phone || '',
                })
                campaignManagers.set(row.campaign_id, list)
            }

            setCampaigns(campaignRes.data || [])
            setQrCodes(
                (qrRes.data || []).map((q: any) => {
                    const campaignReferences = campaignManagers.get(q.campaign_id) || []
                    return {
                        ...q,
                        campaign_name: q.roadtour_campaigns?.name || '—',
                        user_name: q.users?.full_name || '—',
                        user_phone: q.users?.phone || '',
                        campaign_reference_count: campaignReferences.length,
                        campaign_references: campaignReferences,
                    }
                })
            )
        } catch (err: any) {
            toast({ title: 'Error', description: 'Failed to load QR codes.', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [companyId, supabase])

    useEffect(() => { loadData() }, [loadData])

    // When campaign selected in generate dialog, load its managers
    useEffect(() => {
        if (!genCampaignId) { setAssignedManagers([]); return }
        ; (async () => {
            const { data } = await (supabase as any)
                .from('roadtour_campaign_managers')
                .select('user_id, users:user_id(full_name)')
                .eq('campaign_id', genCampaignId)
                .eq('is_active', true)
            setAssignedManagers((data || []).map((d: any) => ({ user_id: d.user_id, full_name: d.users?.full_name || '—' })))
        })()
    }, [genCampaignId, supabase])

    const generateQr = async () => {
        if (!genCampaignId || !genManagerId) {
            toast({ title: 'Validation', description: 'Select a campaign and a reference.', variant: 'destructive' })
            return
        }
        try {
            setGenerating(true)
            const token = crypto.randomUUID()

            // Determine expiry from campaign's qr_mode
            const campaign = campaigns.find((c) => c.id === genCampaignId)
            let expiresAt: string | null = null

            // Check settings for QR mode specifics
            const { data: settings } = await (supabase as any).from('roadtour_settings').select('qr_expiry_hours, qr_mode').eq('org_id', companyId).maybeSingle()
            if (settings?.qr_mode === 'time_limited' && settings?.qr_expiry_hours) {
                const exp = new Date()
                exp.setHours(exp.getHours() + settings.qr_expiry_hours)
                expiresAt = exp.toISOString()
            }

            const { error } = await (supabase as any).from('roadtour_qr_codes').insert({
                campaign_id: genCampaignId,
                account_manager_user_id: genManagerId,
                token,
                status: 'active',
                expires_at: expiresAt,
            })

            if (error) {
                if (error.code === '23505') {
                    toast({ title: 'Duplicate', description: 'This reference already has an active QR for this campaign.', variant: 'destructive' })
                    return
                }
                throw error
            }

            toast({ title: 'QR Generated', description: 'New QR code created successfully.' })
            setGenerateOpen(false)
            setGenCampaignId('')
            setGenManagerId('')
            loadData()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setGenerating(false)
        }
    }

    const previewQrCode = async (qr: QrCode) => {
        setPreviewQr(qr)
        setPreviewOpen(true)
        setPreviewLoading(true)
        try {
            const QRCode = (await import('qrcode')).default
            const url = `${qrBaseUrl}?rt=${qr.token}`
            const dataUrl = await QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
            setPreviewDataUrl(dataUrl)
        } catch {
            toast({ title: 'Error', description: 'Failed to generate QR preview.', variant: 'destructive' })
        } finally {
            setPreviewLoading(false)
        }
    }

    const downloadQr = async (qr: QrCode) => {
        try {
            const QRCode = (await import('qrcode')).default
            const url = `${qrBaseUrl}?rt=${qr.token}`
            const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 2 })
            const link = document.createElement('a')
            link.download = `roadtour-qr-${qr.token.substring(0, 8)}.png`
            link.href = dataUrl
            link.click()
        } catch {
            toast({ title: 'Error', description: 'Failed to download QR.', variant: 'destructive' })
        }
    }

    const copyLink = (qr: QrCode) => {
        const url = `${qrBaseUrl}?rt=${qr.token}`
        navigator.clipboard.writeText(url)
        toast({ title: 'Copied', description: 'QR link copied to clipboard.' })
    }

    const openRefsDialog = (qr: QrCode) => {
        setRefsDialogCampaignName(qr.campaign_name || 'Campaign')
        setRefsDialogManagers(qr.campaign_references || [])
        setRefsDialogOpen(true)
    }

    const revokeQr = async (qrId: string) => {
        try {
            const { error } = await (supabase as any).from('roadtour_qr_codes').update({ status: 'revoked' }).eq('id', qrId)
            if (error) throw error
            toast({ title: 'Revoked', description: 'QR code has been revoked.' })
            loadData()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    const sendWhatsApp = async (qr: QrCode) => {
        try {
            // Use the phone already loaded from the JOIN (same as displayed in the table)
            const phone = qr.user_phone
            if (!phone) { toast({ title: 'Error', description: 'Reference has no phone number.', variant: 'destructive' }); return }

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

            // Log delivery
            await (supabase as any).from('roadtour_qr_delivery_logs').insert({
                campaign_id: qr.campaign_id,
                qr_code_id: qr.id,
                account_manager_user_id: qr.account_manager_user_id,
                phone_number: phone,
                channel: 'whatsapp_qr_image',
                send_status: 'sent',
                sent_at: new Date().toISOString(),
            })

            toast({ title: 'Sent', description: `QR code image sent via WhatsApp to ${phone}.` })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || 'Failed to send WhatsApp message.', variant: 'destructive' })
        }
    }

    const statusColors: Record<string, string> = {
        active: 'bg-emerald-100 text-emerald-700',
        revoked: 'bg-red-100 text-red-700',
        expired: 'bg-gray-100 text-gray-700',
    }

    const filtered = qrCodes.filter((q) => {
        if (campaignFilter !== 'all' && q.campaign_id !== campaignFilter) return false
        if (statusFilter !== 'all' && q.status !== statusFilter) return false
        if (searchTerm && !q.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) && !q.campaign_name?.toLowerCase().includes(searchTerm.toLowerCase())) return false
        return true
    })

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><QrCode className="h-5 w-5 text-primary" />QR Management</h3>
                    <p className="text-sm text-muted-foreground mt-1">Generate, preview, and distribute RoadTour QR codes to references.</p>
                </div>
                <Button onClick={() => setGenerateOpen(true)} className="gap-2 w-full sm:w-auto"><QrCode className="h-4 w-4" />Generate QR</Button>
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by reference or campaign..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                    <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Campaigns</SelectItem>
                        {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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

            {/* QR Table */}
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
                            {filtered.length === 0 && (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No QR codes found.</TableCell></TableRow>
                            )}
                            {filtered.map((q) => (
                                <TableRow key={q.id}>
                                    <TableCell>
                                        <div>
                                            {q.campaign_reference_count && q.campaign_reference_count > 1 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => openRefsDialog(q)}
                                                    className="font-medium text-primary hover:underline"
                                                >
                                                    Show ({q.campaign_reference_count})
                                                </button>
                                            ) : (
                                                <>
                                                    <p className="font-medium">{q.campaign_references?.[0]?.full_name || q.user_name}</p>
                                                    {(q.campaign_references?.[0]?.phone || q.user_phone) && (
                                                        <p className="text-xs text-muted-foreground">{q.campaign_references?.[0]?.phone || q.user_phone}</p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>{q.campaign_name}</TableCell>
                                    <TableCell><Badge className={statusColors[q.status] || ''}>{q.status}</Badge></TableCell>
                                    <TableCell className="hidden sm:table-cell">{q.usage_count}</TableCell>
                                    <TableCell className="text-sm hidden md:table-cell">{q.expires_at ? new Date(q.expires_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex gap-1 justify-end">
                                            <Button size="sm" variant="ghost" onClick={() => previewQrCode(q)} title="Preview"><Eye className="h-4 w-4" /></Button>
                                            <Button size="sm" variant="ghost" onClick={() => downloadQr(q)} title="Download"><Download className="h-4 w-4" /></Button>
                                            <Button size="sm" variant="ghost" onClick={() => copyLink(q)} title="Copy Link"><Copy className="h-4 w-4" /></Button>
                                            <Button size="sm" variant="ghost" onClick={() => sendWhatsApp(q)} title="Send WhatsApp"><Send className="h-4 w-4 text-green-600" /></Button>
                                            {q.status === 'active' && (
                                                <Button size="sm" variant="ghost" onClick={() => revokeQr(q.id)} title="Revoke"><ShieldOff className="h-4 w-4 text-red-500" /></Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Generate Dialog */}
            <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Generate QR Code</DialogTitle>
                        <DialogDescription>Create a QR code for an account manager in a specific campaign.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Campaign *</Label>
                            <Select value={genCampaignId} onValueChange={setGenCampaignId}>
                                <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                                <SelectContent>
                                    {campaigns.filter((c) => c.status === 'active').map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Reference *</Label>
                            <Select value={genManagerId} onValueChange={setGenManagerId}>
                                <SelectTrigger><SelectValue placeholder={assignedManagers.length === 0 ? 'Select campaign first' : 'Select reference'} /></SelectTrigger>
                                <SelectContent>
                                    {assignedManagers.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            {genCampaignId && assignedManagers.length === 0 && (
                                <p className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" />No references assigned to this campaign yet.</p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
                        <Button onClick={generateQr} disabled={generating}>{generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Generate</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={refsDialogOpen} onOpenChange={setRefsDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>References — {refsDialogCampaignName}</DialogTitle>
                        <DialogDescription>{refsDialogManagers.length} reference{refsDialogManagers.length !== 1 ? 's' : ''} assigned</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {refsDialogManagers.map((manager, index) => (
                            <div key={`${manager.full_name}-${index}`} className="rounded-lg border p-3">
                                <p className="text-sm font-medium">{manager.full_name}</p>
                                {manager.phone && <p className="text-xs text-muted-foreground">{manager.phone}</p>}
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Preview Dialog */}
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="sm:max-w-sm text-center">
                    <DialogHeader>
                        <DialogTitle>QR Code Preview</DialogTitle>
                        <DialogDescription>{previewQr?.campaign_name} — {previewQr?.user_name}</DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-center py-4">
                        {previewLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : previewDataUrl ? (
                            <img src={previewDataUrl} alt="RoadTour QR" className="w-64 h-64 rounded-lg border" />
                        ) : (
                            <p className="text-muted-foreground">Failed to generate preview.</p>
                        )}
                    </div>
                    {previewQr && (
                        <div className="flex gap-2 justify-center">
                            <Button size="sm" variant="outline" onClick={() => downloadQr(previewQr)} className="gap-1"><Download className="h-4 w-4" />Download</Button>
                            <Button size="sm" variant="outline" onClick={() => copyLink(previewQr)} className="gap-1"><Copy className="h-4 w-4" />Copy Link</Button>
                            <Button size="sm" variant="outline" onClick={() => sendWhatsApp(previewQr)} className="gap-1"><Send className="h-4 w-4" />WhatsApp</Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
