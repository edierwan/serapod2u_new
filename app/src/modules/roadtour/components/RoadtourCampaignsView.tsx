'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
    AlertCircle, Calendar, CheckCircle2, Edit, Loader2, Map, MapPin, Plus,
    Search, Trash2, Users, Eye, Play, Pause, Archive
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface RoadtourCampaignsViewProps {
    userProfile: any
    onViewChange: (viewId: string) => void
}

interface Campaign {
    id: string
    name: string
    description: string | null
    start_date: string
    end_date: string
    status: string
    region_scope: string[] | null
    default_points: number
    reward_mode: string
    qr_mode: string
    notes: string | null
    created_at: string
    _manager_count?: number
    _visit_count?: number
    _scan_count?: number
    _managers?: { full_name: string; phone: string }[]
}

interface AccountManager {
    id: string
    user_id: string
    full_name: string
    email: string
    phone: string
    is_active: boolean
}

const MALAYSIAN_STATES = [
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
    'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak', 'Selangor',
    'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya'
]

const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-emerald-100 text-emerald-700',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-slate-100 text-slate-600',
}

export function RoadtourCampaignsView({ userProfile, onViewChange }: RoadtourCampaignsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [searchTerm, setSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false)
    const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
    const [saving, setSaving] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)

    // Form
    const [formName, setFormName] = useState('')
    const [formDesc, setFormDesc] = useState('')
    const [formStart, setFormStart] = useState('')
    const [formEnd, setFormEnd] = useState('')
    const [formPoints, setFormPoints] = useState(20)
    const [formRewardMode, setFormRewardMode] = useState('survey_submit')
    const [formQrMode, setFormQrMode] = useState('persistent')
    const [formRegions, setFormRegions] = useState<string[]>([])
    const [formNotes, setFormNotes] = useState('')

    // Managers dialog
    const [managersDialogOpen, setManagersDialogOpen] = useState(false)
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
    const [selectedCampaignName, setSelectedCampaignName] = useState('')
    const [managers, setManagers] = useState<AccountManager[]>([])
    const [availableManagers, setAvailableManagers] = useState<{ id: string; full_name: string; email: string; phone: string }[]>([])
    const [managersLoading, setManagersLoading] = useState(false)
    const [managerSearch, setManagerSearch] = useState('')

    const loadCampaigns = useCallback(async () => {
        try {
            setLoading(true)
            const { data, error } = await (supabase as any)
                .from('roadtour_campaigns')
                .select('*')
                .eq('org_id', companyId)
                .order('created_at', { ascending: false })

            if (error) throw error

            // Fetch managers for all campaigns
            const campaignIds = (data || []).map((c: any) => c.id)
            let managerMap: Record<string, { full_name: string; phone: string }[]> = {}
            if (campaignIds.length > 0) {
                const { data: mgrs } = await (supabase as any)
                    .from('roadtour_campaign_managers')
                    .select('campaign_id, users:user_id(full_name, phone)')
                    .in('campaign_id', campaignIds)
                    .eq('is_active', true)
                if (mgrs) {
                    for (const m of mgrs) {
                        if (!managerMap[m.campaign_id]) managerMap[m.campaign_id] = []
                        managerMap[m.campaign_id].push({
                            full_name: m.users?.full_name || '—',
                            phone: m.users?.phone || '',
                        })
                    }
                }
            }

            setCampaigns((data || []).map((c: any) => ({
                ...c,
                _managers: managerMap[c.id] || [],
            })))
        } catch (err: any) {
            toast({ title: 'Error', description: 'Failed to load campaigns.', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [companyId, supabase])

    useEffect(() => { loadCampaigns() }, [loadCampaigns])

    const resetForm = () => {
        setFormName('')
        setFormDesc('')
        setFormStart('')
        setFormEnd('')
        setFormPoints(20)
        setFormRewardMode('survey_submit')
        setFormQrMode('persistent')
        setFormRegions([])
        setFormNotes('')
        setEditId(null)
    }

    const openCreate = () => {
        resetForm()
        setDialogMode('create')
        setDialogOpen(true)
    }

    const openEdit = (c: Campaign) => {
        setFormName(c.name)
        setFormDesc(c.description || '')
        setFormStart(c.start_date)
        setFormEnd(c.end_date)
        setFormPoints(c.default_points)
        setFormRewardMode(c.reward_mode)
        setFormQrMode(c.qr_mode)
        setFormRegions(c.region_scope || [])
        setFormNotes(c.notes || '')
        setEditId(c.id)
        setDialogMode('edit')
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formName.trim()) { toast({ title: 'Validation', description: 'Campaign name is required.', variant: 'destructive' }); return }
        if (!formStart || !formEnd) { toast({ title: 'Validation', description: 'Start and end dates are required.', variant: 'destructive' }); return }

        try {
            setSaving(true)
            const payload = {
                org_id: companyId,
                name: formName.trim(),
                description: formDesc.trim() || null,
                start_date: formStart,
                end_date: formEnd,
                default_points: formPoints,
                reward_mode: formRewardMode,
                qr_mode: formQrMode,
                region_scope: formRegions.length > 0 ? formRegions : null,
                notes: formNotes.trim() || null,
                updated_by: userProfile.id,
            }

            if (editId) {
                const { error } = await (supabase as any).from('roadtour_campaigns').update(payload).eq('id', editId)
                if (error) throw error
                toast({ title: 'Campaign Updated', description: `"${formName}" has been updated.` })
            } else {
                const { error } = await (supabase as any).from('roadtour_campaigns').insert({ ...payload, created_by: userProfile.id })
                if (error) throw error
                toast({ title: 'Campaign Created', description: `"${formName}" has been created.` })
            }

            setDialogOpen(false)
            loadCampaigns()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const updateStatus = async (campaignId: string, newStatus: string) => {
        try {
            const { error } = await (supabase as any).from('roadtour_campaigns').update({ status: newStatus, updated_by: userProfile.id }).eq('id', campaignId)
            if (error) throw error
            toast({ title: 'Status Updated', description: `Campaign status changed to "${newStatus}".` })
            loadCampaigns()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    // Account Manager Assignment
    const openManagers = async (campaignId: string, campaignName: string) => {
        setSelectedCampaignId(campaignId)
        setSelectedCampaignName(campaignName)
        setManagersDialogOpen(true)
        setManagersLoading(true)

        try {
            // Load current assignments
            const { data: assigned, error: aErr } = await (supabase as any)
                .from('roadtour_campaign_managers')
                .select('id, user_id, is_active, users:user_id(full_name, email, phone)')
                .eq('campaign_id', campaignId)

            if (aErr) throw aErr

            setManagers((assigned || []).map((a: any) => ({
                id: a.id,
                user_id: a.user_id,
                full_name: a.users?.full_name || '',
                email: a.users?.email || '',
                phone: a.users?.phone || '',
                is_active: a.is_active,
            })))

            // Load eligible account managers (can_be_reference = true)
            const { data: eligible, error: eErr } = await supabase
                .from('users')
                .select('id, full_name, email, phone')
                .eq('can_be_reference', true)
                .eq('is_active', true)
                .order('full_name')

            if (eErr) throw eErr
            setAvailableManagers((eligible || []).map((e: any) => ({ id: e.id, full_name: e.full_name || '', email: e.email, phone: e.phone || '' })))
        } catch (err: any) {
            toast({ title: 'Error', description: 'Failed to load account managers.', variant: 'destructive' })
        } finally {
            setManagersLoading(false)
        }
    }

    const assignManager = async (userId: string) => {
        if (!selectedCampaignId) return
        try {
            const { error } = await (supabase as any).from('roadtour_campaign_managers').insert({
                campaign_id: selectedCampaignId,
                user_id: userId,
                assigned_by: userProfile.id,
            })
            if (error) {
                if (error.code === '23505') { toast({ title: 'Already Assigned', description: 'This account manager is already assigned.', variant: 'destructive' }); return }
                throw error
            }
            toast({ title: 'Assigned', description: 'Reference assigned to campaign.' })
            openManagers(selectedCampaignId, selectedCampaignName)
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    const removeManager = async (assignmentId: string) => {
        try {
            const { error } = await (supabase as any).from('roadtour_campaign_managers').update({ is_active: false }).eq('id', assignmentId)
            if (error) throw error
            toast({ title: 'Removed', description: 'Reference removed from campaign.' })
            if (selectedCampaignId) openManagers(selectedCampaignId, selectedCampaignName)
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    const filtered = campaigns.filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false
        if (searchTerm && !c.name.toLowerCase().includes(searchTerm.toLowerCase())) return false
        return true
    })

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><Map className="h-5 w-5 text-primary" />RoadTour Campaigns</h3>
                    <p className="text-sm text-muted-foreground mt-1">Create, manage, and assign references to road tour campaigns.</p>
                </div>
                <Button onClick={openCreate} className="gap-2 w-full sm:w-auto"><Plus className="h-4 w-4" />Create Campaign</Button>
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search campaigns..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Campaigns Table */}
            <Card>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden md:table-cell">Period</TableHead>
                                <TableHead>Points</TableHead>
                                <TableHead className="hidden lg:table-cell">Mode</TableHead>
                                <TableHead className="hidden lg:table-cell">Region</TableHead>
                                <TableHead>References</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 && (
                                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No campaigns found.</TableCell></TableRow>
                            )}
                            {filtered.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell>
                                        <div>
                                            <p className="font-medium">{c.name}</p>
                                            {c.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.description}</p>}
                                            <p className="text-xs text-muted-foreground md:hidden">{c.start_date} — {c.end_date}</p>
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge className={statusColors[c.status] || ''}>{c.status}</Badge></TableCell>
                                    <TableCell className="text-sm hidden md:table-cell">{c.start_date} — {c.end_date}</TableCell>
                                    <TableCell>{c.default_points}</TableCell>
                                    <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-xs">{c.reward_mode === 'survey_submit' ? 'Survey' : 'Direct'}</Badge></TableCell>
                                    <TableCell className="text-sm hidden lg:table-cell">{c.region_scope?.join(', ') || '—'}</TableCell>
                                    <TableCell>
                                        {(c._managers && c._managers.length > 0) ? (
                                            <div className="space-y-0.5">
                                                {c._managers.map((m, i) => (
                                                    <div key={i} className="text-sm">
                                                        <span className="font-medium">{m.full_name}</span>
                                                        {m.phone && <span className="text-xs text-muted-foreground ml-1">({m.phone})</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">No references</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex gap-1 justify-end">
                                            <Button size="sm" variant="ghost" onClick={() => openManagers(c.id, c.name)} title="Manage references"><Users className="h-4 w-4" /></Button>
                                            <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="Edit"><Edit className="h-4 w-4" /></Button>
                                            {c.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => updateStatus(c.id, 'active')} title="Activate"><Play className="h-4 w-4 text-emerald-600" /></Button>}
                                            {c.status === 'active' && <Button size="sm" variant="ghost" onClick={() => updateStatus(c.id, 'paused')} title="Pause"><Pause className="h-4 w-4 text-amber-600" /></Button>}
                                            {c.status === 'paused' && <Button size="sm" variant="ghost" onClick={() => updateStatus(c.id, 'active')} title="Resume"><Play className="h-4 w-4 text-emerald-600" /></Button>}
                                            {['completed', 'paused'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => updateStatus(c.id, 'archived')} title="Archive"><Archive className="h-4 w-4 text-slate-500" /></Button>}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{dialogMode === 'create' ? 'Create Campaign' : 'Edit Campaign'}</DialogTitle>
                        <DialogDescription>Define a RoadTour campaign for your field activities.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2"><Label>Campaign Name *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Northern Region April 2026" /></div>
                        <div className="space-y-2"><Label>Description</Label><Textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional description..." rows={2} /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Start Date *</Label><Input type="date" value={formStart} onChange={(e) => setFormStart(e.target.value)} /></div>
                            <div className="space-y-2"><Label>End Date *</Label><Input type="date" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Reward Points</Label><Input type="number" min={1} value={formPoints} onChange={(e) => setFormPoints(parseInt(e.target.value || '20', 10) || 20)} /></div>
                            <div className="space-y-2">
                                <Label>Reward Mode</Label>
                                <Select value={formRewardMode} onValueChange={setFormRewardMode}><SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="direct_scan">Direct Scan</SelectItem><SelectItem value="survey_submit">Survey Submit</SelectItem></SelectContent></Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Region Coverage</Label>
                            <div className="flex flex-wrap gap-2">
                                {MALAYSIAN_STATES.map((s) => (
                                    <Badge key={s} variant={formRegions.includes(s) ? 'default' : 'outline'}
                                        className="cursor-pointer" onClick={() => setFormRegions((prev) => prev.includes(s) ? prev.filter((r) => r !== s) : [...prev, s])}>{s}</Badge>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2"><Label>Notes</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{dialogMode === 'create' ? 'Create' : 'Update'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Account Managers Dialog */}
            <Dialog open={managersDialogOpen} onOpenChange={setManagersDialogOpen}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>References — {selectedCampaignName}</DialogTitle>
                        <DialogDescription>Assign eligible references (marked as &quot;Eligible as Reference&quot;) to this campaign.</DialogDescription>
                    </DialogHeader>
                    {managersLoading ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                        <div className="space-y-4">
                            {/* Current Assignments */}
                            <div>
                                <Label className="text-sm font-semibold">Currently Assigned ({managers.filter((m) => m.is_active).length})</Label>
                                {managers.filter((m) => m.is_active).length === 0 && <p className="text-sm text-muted-foreground mt-1">No references assigned yet.</p>}
                                <div className="space-y-2 mt-2">
                                    {managers.filter((m) => m.is_active).map((m) => (
                                        <div key={m.id} className="flex items-center justify-between rounded-lg border p-3">
                                            <div>
                                                <p className="text-sm font-medium">{m.full_name}</p>
                                                <p className="text-xs text-muted-foreground">{m.email} · {m.phone}</p>
                                            </div>
                                            <Button size="sm" variant="ghost" onClick={() => removeManager(m.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Add New */}
                            <div>
                                <Label className="text-sm font-semibold">Add Reference</Label>
                                <Input placeholder="Search by name..." value={managerSearch} onChange={(e) => setManagerSearch(e.target.value)} className="mt-2" />
                                <div className="space-y-1 mt-2 max-h-48 overflow-y-auto">
                                    {availableManagers
                                        .filter((am) => !managers.some((m) => m.user_id === am.id && m.is_active))
                                        .filter((am) => !managerSearch || am.full_name.toLowerCase().includes(managerSearch.toLowerCase()))
                                        .slice(0, 20)
                                        .map((am) => (
                                            <button key={am.id} onClick={() => assignManager(am.id)}
                                                className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 text-left">
                                                <div>
                                                    <p className="text-sm font-medium">{am.full_name}</p>
                                                    <p className="text-xs text-muted-foreground">{am.email} · {am.phone}</p>
                                                </div>
                                                <Plus className="h-4 w-4 text-primary" />
                                            </button>
                                        ))}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
