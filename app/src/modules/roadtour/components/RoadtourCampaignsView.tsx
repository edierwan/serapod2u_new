'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
    Search, Store, Trash2, Users, Eye, Play, Pause, Archive
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

interface ReferenceOption {
    id: string
    full_name: string
    email: string
    phone: string
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
    const [formReferenceIds, setFormReferenceIds] = useState<string[]>([])
    const [formReferenceSearch, setFormReferenceSearch] = useState('')

    // Point value from org settings
    const [pointValueRm, setPointValueRm] = useState(0.10)

    // Shop counts by state
    const [shopCountByState, setShopCountByState] = useState<Record<string, number>>({})

    // Region detail dialog
    const [regionDialogOpen, setRegionDialogOpen] = useState(false)
    const [regionDialogState, setRegionDialogState] = useState('')
    const [regionShops, setRegionShops] = useState<{ id: string; org_name: string; branch_name: string | null }[]>([])
    const [regionShopsLoading, setRegionShopsLoading] = useState(false)

    // References detail dialog
    const [refsDialogOpen, setRefsDialogOpen] = useState(false)
    const [refsDialogCampaignName, setRefsDialogCampaignName] = useState('')
    const [refsDialogManagers, setRefsDialogManagers] = useState<{ full_name: string; phone: string }[]>([])

    // Managers dialog
    const [managersDialogOpen, setManagersDialogOpen] = useState(false)
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
    const [selectedCampaignName, setSelectedCampaignName] = useState('')
    const [managers, setManagers] = useState<AccountManager[]>([])
    const [availableManagers, setAvailableManagers] = useState<{ id: string; full_name: string; email: string; phone: string }[]>([])
    const [managersLoading, setManagersLoading] = useState(false)
    const [managerSearch, setManagerSearch] = useState('')
    const [eligibleReferencesLoading, setEligibleReferencesLoading] = useState(false)

    // Calculate working days (exclude weekends)
    const calcWorkingDays = (start: string, end: string): number => {
        if (!start || !end) return 0
        const s = new Date(start)
        const e = new Date(end)
        let count = 0
        const cur = new Date(s)
        while (cur <= e) {
            const day = cur.getDay()
            if (day !== 0 && day !== 6) count++
            cur.setDate(cur.getDate() + 1)
        }
        return count
    }

    // Load point_value_rm from org settings
    useEffect(() => {
        (async () => {
            const { data } = await supabase.from('organizations').select('settings').eq('id', companyId).single()
            if (data?.settings && typeof data.settings === 'object') {
                const pv = (data.settings as any).point_value_rm
                if (pv && !isNaN(Number(pv))) setPointValueRm(Number(pv))
            }
        })()
    }, [companyId, supabase])

    // Load shop counts by state
    useEffect(() => {
        (async () => {
            const { data } = await (supabase as any).from('organizations').select('state_id, states:state_id(state_name)').eq('org_type_code', 'SHOP').eq('is_active', true)
            if (data) {
                const counts: Record<string, number> = {}
                for (const r of data) {
                    const st = (r as any).states?.state_name?.trim()
                    if (st) counts[st] = (counts[st] || 0) + 1
                }
                setShopCountByState(counts)
            }
        })()
    }, [supabase])

    const openRegionShops = async (stateName: string) => {
        setRegionDialogState(stateName)
        setRegionDialogOpen(true)
        setRegionShopsLoading(true)
        try {
            // First get the state_id for this state name
            const { data: stateRow } = await (supabase as any).from('states').select('id').eq('state_name', stateName).single()
            if (!stateRow) { setRegionShops([]); return }
            const { data } = await (supabase as any).from('organizations').select('id, org_name, branch').eq('org_type_code', 'SHOP').eq('is_active', true).eq('state_id', stateRow.id).order('org_name')
            setRegionShops((data || []).map((r: any) => ({ id: r.id, org_name: r.org_name, branch_name: r.branch ?? null })))
        } catch {
            setRegionShops([])
        } finally {
            setRegionShopsLoading(false)
        }
    }

    const syncCampaignQrs = useCallback(async (campaignId: string, managerIds?: string[]) => {
        const targetManagerIds = managerIds && managerIds.length > 0
            ? managerIds
            : (() => { return [] })()

        let resolvedManagerIds = targetManagerIds
        if (resolvedManagerIds.length === 0) {
            const { data: assignedManagers, error: managerError } = await (supabase as any)
                .from('roadtour_campaign_managers')
                .select('user_id')
                .eq('campaign_id', campaignId)
                .eq('is_active', true)

            if (managerError) throw managerError
            resolvedManagerIds = (assignedManagers || []).map((row: any) => row.user_id)
        }

        if (resolvedManagerIds.length === 0) return 0

        let expiresAt: string | null = null
        const { data: settings } = await (supabase as any)
            .from('roadtour_settings')
            .select('qr_expiry_hours, qr_mode')
            .eq('org_id', companyId)
            .maybeSingle()

        if (settings?.qr_mode === 'time_limited' && settings?.qr_expiry_hours) {
            const expiry = new Date()
            expiry.setHours(expiry.getHours() + settings.qr_expiry_hours)
            expiresAt = expiry.toISOString()
        }

        const { data: existingRows, error: existingError } = await (supabase as any)
            .from('roadtour_qr_codes')
            .select('account_manager_user_id')
            .eq('campaign_id', campaignId)
            .eq('status', 'active')
            .is('shop_id', null)
            .in('account_manager_user_id', resolvedManagerIds)

        if (existingError) throw existingError

        const existingManagerIds = new Set((existingRows || []).map((row: any) => row.account_manager_user_id))
        const missingManagerIds = resolvedManagerIds.filter((managerId) => !existingManagerIds.has(managerId))

        if (missingManagerIds.length === 0) return 0

        const { error: insertError } = await (supabase as any)
            .from('roadtour_qr_codes')
            .insert(missingManagerIds.map((managerId) => ({
                campaign_id: campaignId,
                account_manager_user_id: managerId,
                token: crypto.randomUUID(),
                status: 'active',
                expires_at: expiresAt,
            })))

        if (insertError) throw insertError
        return missingManagerIds.length
    }, [companyId, supabase])

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

    const loadEligibleReferences = useCallback(async () => {
        try {
            setEligibleReferencesLoading(true)
            const { data, error } = await supabase
                .from('users')
                .select('id, full_name, email, phone')
                .eq('can_be_reference', true)
                .eq('is_active', true)
                .order('full_name')

            if (error) throw error
            setAvailableManagers((data || []).map((row: any) => ({
                id: row.id,
                full_name: row.full_name || '',
                email: row.email || '',
                phone: row.phone || '',
            })))
        } catch {
            toast({ title: 'Error', description: 'Failed to load eligible references.', variant: 'destructive' })
        } finally {
            setEligibleReferencesLoading(false)
        }
    }, [supabase])

    const loadCampaignReferenceIds = useCallback(async (campaignId: string) => {
        const { data, error } = await (supabase as any)
            .from('roadtour_campaign_managers')
            .select('user_id')
            .eq('campaign_id', campaignId)
            .eq('is_active', true)

        if (error) throw error
        return (data || []).map((row: any) => row.user_id)
    }, [supabase])

    const ensureCampaignHasReferences = useCallback(async (campaignId: string) => {
        const referenceIds = await loadCampaignReferenceIds(campaignId)
        if (referenceIds.length > 0) return referenceIds

        toast({
            title: 'Reference required',
            description: 'Please select at least one reference before activating this campaign.',
            variant: 'destructive',
        })
        return null
    }, [loadCampaignReferenceIds])

    const syncCampaignManagers = useCallback(async (campaignId: string, managerIds: string[]) => {
        const uniqueManagerIds = Array.from(new Set(managerIds))
        const { data: existingRows, error: existingError } = await (supabase as any)
            .from('roadtour_campaign_managers')
            .select('id, user_id, is_active')
            .eq('campaign_id', campaignId)

        if (existingError) throw existingError

        const existingByUserId = new Map((existingRows || []).map((row: any) => [row.user_id, row]))
        const rowsToUpsert = uniqueManagerIds.map((userId) => ({
            campaign_id: campaignId,
            user_id: userId,
            assigned_by: userProfile.id,
            is_active: true,
            assigned_at: new Date().toISOString(),
        }))

        if (rowsToUpsert.length > 0) {
            const { error: upsertError } = await (supabase as any)
                .from('roadtour_campaign_managers')
                .upsert(rowsToUpsert, { onConflict: 'campaign_id,user_id' })
            if (upsertError) throw upsertError
        }

        const removedUserIds = (existingRows || [])
            .filter((row: any) => row.is_active && !uniqueManagerIds.includes(row.user_id))
            .map((row: any) => row.user_id)

        if (removedUserIds.length > 0) {
            const { error: deactivateError } = await (supabase as any)
                .from('roadtour_campaign_managers')
                .update({ is_active: false })
                .eq('campaign_id', campaignId)
                .in('user_id', removedUserIds)

            if (deactivateError) throw deactivateError
        }

        return {
            addedCount: uniqueManagerIds.filter((userId) => !existingByUserId.get(userId)?.is_active).length,
            removedUserIds,
        }
    }, [supabase, userProfile.id])

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
        setFormReferenceIds([])
        setFormReferenceSearch('')
        setEditId(null)
    }

    const openCreate = async () => {
        resetForm()
        await loadEligibleReferences()
        setDialogMode('create')
        setDialogOpen(true)
    }

    const openEdit = async (c: Campaign) => {
        setFormName(c.name)
        setFormDesc(c.description || '')
        setFormStart(c.start_date)
        setFormEnd(c.end_date)
        setFormPoints(c.default_points)
        setFormRewardMode(c.reward_mode)
        setFormQrMode(c.qr_mode)
        setFormRegions(c.region_scope || [])
        setFormNotes(c.notes || '')
        setFormReferenceSearch('')
        setEditId(c.id)
        await loadEligibleReferences()
        try {
            setFormReferenceIds(await loadCampaignReferenceIds(c.id))
        } catch {
            setFormReferenceIds([])
        }
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
                const { removedUserIds } = await syncCampaignManagers(editId, formReferenceIds)
                if (removedUserIds.length > 0) {
                    await (supabase as any)
                        .from('roadtour_qr_codes')
                        .update({ status: 'revoked' })
                        .eq('campaign_id', editId)
                        .in('account_manager_user_id', removedUserIds)
                        .eq('status', 'active')
                        .is('shop_id', null)
                }
                toast({ title: 'Campaign Updated', description: `"${formName}" has been updated.` })
            } else {
                const { data: createdCampaign, error } = await (supabase as any)
                    .from('roadtour_campaigns')
                    .insert({ ...payload, created_by: userProfile.id })
                    .select('id')
                    .single()
                if (error) throw error
                if (createdCampaign?.id && formReferenceIds.length > 0) {
                    await syncCampaignManagers(createdCampaign.id, formReferenceIds)
                }
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
            if (newStatus === 'active') {
                const referenceIds = await ensureCampaignHasReferences(campaignId)
                if (!referenceIds) return
            }

            const { error } = await (supabase as any).from('roadtour_campaigns').update({ status: newStatus, updated_by: userProfile.id }).eq('id', campaignId)
            if (error) throw error
            let createdQrCount = 0
            if (newStatus === 'active') {
                createdQrCount = await syncCampaignQrs(campaignId)
            }

            toast({
                title: 'Status Updated',
                description: createdQrCount > 0
                    ? `Campaign activated and ${createdQrCount} QR code${createdQrCount === 1 ? '' : 's'} created automatically.`
                    : `Campaign status changed to "${newStatus}".`
            })
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
            await loadEligibleReferences()
        } catch (err: any) {
            toast({ title: 'Error', description: 'Failed to load account managers.', variant: 'destructive' })
        } finally {
            setManagersLoading(false)
        }
    }

    const selectedFormReferences = useMemo(() => {
        const selectedIds = new Set(formReferenceIds)
        return availableManagers.filter((reference) => selectedIds.has(reference.id))
    }, [availableManagers, formReferenceIds])

    const filteredFormReferences = useMemo(() => {
        const query = formReferenceSearch.trim().toLowerCase()
        return availableManagers.filter((reference) => {
            if (formReferenceIds.includes(reference.id)) return false
            if (!query) return true
            return [reference.full_name, reference.email, reference.phone].some((value) => value?.toLowerCase().includes(query))
        })
    }, [availableManagers, formReferenceIds, formReferenceSearch])

    const toggleFormReference = (userId: string) => {
        setFormReferenceIds((current) => current.includes(userId)
            ? current.filter((id) => id !== userId)
            : [...current, userId])
    }

    const assignManager = async (userId: string) => {
        if (!selectedCampaignId) return
        try {
            const { error } = await (supabase as any).from('roadtour_campaign_managers').upsert({
                campaign_id: selectedCampaignId,
                user_id: userId,
                assigned_by: userProfile.id,
                is_active: true,
                assigned_at: new Date().toISOString(),
            }, { onConflict: 'campaign_id,user_id' })
            if (error) throw error
            const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId)
            let createdQrCount = 0
            if (selectedCampaign?.status === 'active') {
                createdQrCount = await syncCampaignQrs(selectedCampaignId, [userId])
            }

            toast({
                title: 'Assigned',
                description: createdQrCount > 0
                    ? 'Reference assigned and QR code created automatically.'
                    : 'Reference assigned to campaign.'
            })
            openManagers(selectedCampaignId, selectedCampaignName)
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    const removeManager = async (assignmentId: string) => {
        try {
            const removedManager = managers.find((manager) => manager.id === assignmentId)
            const { error } = await (supabase as any).from('roadtour_campaign_managers').update({ is_active: false }).eq('id', assignmentId)
            if (error) throw error

            if (selectedCampaignId && removedManager?.user_id) {
                await (supabase as any)
                    .from('roadtour_qr_codes')
                    .update({ status: 'revoked' })
                    .eq('campaign_id', selectedCampaignId)
                    .eq('account_manager_user_id', removedManager.user_id)
                    .eq('status', 'active')
                    .is('shop_id', null)
            }

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
                                <TableHead className="hidden md:table-cell">Days</TableHead>
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
                            {filtered.map((c) => {
                                const workDays = calcWorkingDays(c.start_date, c.end_date)
                                const costPerReward = c.default_points * pointValueRm
                                return (
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
                                        <TableCell className="hidden md:table-cell text-sm">
                                            <div>
                                                <p className="font-medium">{workDays}</p>
                                                <p className="text-xs text-muted-foreground">{(() => { const today = new Date(); today.setHours(0, 0, 0, 0); const end = new Date(c.end_date); end.setHours(0, 0, 0, 0); const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)); return diff > 0 ? `${diff} days left` : diff === 0 ? 'Last day' : 'Ended' })()}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-xs">{c.reward_mode === 'survey_submit' ? 'Survey' : 'Direct'}</Badge></TableCell>
                                        <TableCell className="text-sm hidden lg:table-cell">
                                            {c.region_scope && c.region_scope.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {c.region_scope.map((r) => (
                                                        <Badge key={r} variant="outline" className="text-xs cursor-pointer hover:bg-primary/10" onClick={() => openRegionShops(r)}>{r}</Badge>
                                                    ))}
                                                </div>
                                            ) : '—'}
                                        </TableCell>
                                        <TableCell>
                                            {(c._managers && c._managers.length > 0) ? (
                                                <button
                                                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                                    onClick={() => openManagers(c.id, c.name)}
                                                >
                                                    Show ({c._managers.length})
                                                </button>
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
                                )
                            })}
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
                        {formStart && formEnd && (
                            <p className="text-xs text-muted-foreground -mt-2">
                                📅 {calcWorkingDays(formStart, formEnd)} working days (excl. weekends)
                            </p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Reward Points</Label>
                                <Input type="number" min={1} value={formPoints} onChange={(e) => setFormPoints(parseInt(e.target.value || '20', 10) || 20)} />
                                {formPoints > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        💰 Estimated cost: <span className="font-semibold text-amber-700">RM {(formPoints * pointValueRm).toFixed(2)}</span> per reward
                                    </p>
                                )}
                            </div>
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
                                        className="cursor-pointer" onClick={() => setFormRegions((prev) => prev.includes(s) ? prev.filter((r) => r !== s) : [...prev, s])}>
                                        {s}
                                        {shopCountByState[s] ? <span className="ml-1 opacity-70">({shopCountByState[s]})</span> : null}
                                    </Badge>
                                ))}
                            </div>
                            {formRegions.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    🏪 <button type="button" className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer" onClick={() => {
                                        setRegionDialogState(formRegions.join(', '))
                                        setRegionDialogOpen(true)
                                        setRegionShopsLoading(true)
                                            ; (async () => {
                                                try {
                                                    const { data: stateRows } = await (supabase as any).from('states').select('id').in('state_name', formRegions)
                                                    const stateIds = (stateRows || []).map((s: any) => s.id)
                                                    if (stateIds.length === 0) { setRegionShops([]); setRegionShopsLoading(false); return }
                                                    const { data } = await (supabase as any).from('organizations').select('id, org_name, branch').eq('org_type_code', 'SHOP').eq('is_active', true).in('state_id', stateIds).order('org_name')
                                                    setRegionShops((data || []).map((r: any) => ({ id: r.id, org_name: r.org_name, branch_name: r.branch ?? null })))
                                                } catch { setRegionShops([]) } finally { setRegionShopsLoading(false) }
                                            })()
                                    }}>{formRegions.reduce((sum, s) => sum + (shopCountByState[s] || 0), 0)} shops</button> in selected regions
                                </p>
                            )}
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <Label>References</Label>
                                    <p className="text-xs text-muted-foreground mt-1">Attach at least one reference here so the campaign can be activated immediately after save.</p>
                                </div>
                                <Badge variant="outline">{formReferenceIds.length} selected</Badge>
                            </div>
                            <Input
                                placeholder="Search reference by name, email, or phone"
                                value={formReferenceSearch}
                                onChange={(e) => setFormReferenceSearch(e.target.value)}
                            />
                            <div className="rounded-lg border">
                                {eligibleReferencesLoading ? (
                                    <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                                ) : filteredFormReferences.length === 0 && selectedFormReferences.length === 0 ? (
                                    <p className="px-3 py-6 text-sm text-center text-muted-foreground">No eligible references found.</p>
                                ) : (
                                    <div className="max-h-48 overflow-y-auto divide-y">
                                        {selectedFormReferences.map((reference) => (
                                            <button
                                                key={reference.id}
                                                type="button"
                                                onClick={() => toggleFormReference(reference.id)}
                                                className="flex w-full items-center justify-between px-3 py-3 text-left bg-emerald-50 hover:bg-emerald-100/70"
                                            >
                                                <div>
                                                    <p className="text-sm font-medium">{reference.full_name}</p>
                                                    <p className="text-xs text-muted-foreground">{reference.email} · {reference.phone}</p>
                                                </div>
                                                <Badge className="bg-emerald-100 text-emerald-700">Selected</Badge>
                                            </button>
                                        ))}
                                        {filteredFormReferences.slice(0, 25).map((reference) => (
                                            <button
                                                key={reference.id}
                                                type="button"
                                                onClick={() => toggleFormReference(reference.id)}
                                                className="flex w-full items-center justify-between px-3 py-3 text-left hover:bg-muted/50"
                                            >
                                                <div>
                                                    <p className="text-sm font-medium">{reference.full_name}</p>
                                                    <p className="text-xs text-muted-foreground">{reference.email} · {reference.phone}</p>
                                                </div>
                                                <Plus className="h-4 w-4 text-primary" />
                                            </button>
                                        ))}
                                    </div>
                                )}
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
            <Dialog open={managersDialogOpen} onOpenChange={(open) => { setManagersDialogOpen(open); if (!open) loadCampaigns() }}>
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

            {/* Region Shops Dialog */}
            <Dialog open={regionDialogOpen} onOpenChange={setRegionDialogOpen}>
                <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle><MapPin className="inline h-4 w-4 mr-1" />{regionDialogState}</DialogTitle>
                        <DialogDescription>Shops registered under this state.</DialogDescription>
                    </DialogHeader>
                    {regionShopsLoading ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : regionShops.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No shops found in {regionDialogState}.</p>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">{regionShops.length} shops</p>
                            {regionShops.map((shop) => (
                                <div key={shop.id} className="rounded-lg border p-3">
                                    <p className="text-sm font-medium">{shop.org_name}</p>
                                    {shop.branch_name && <p className="text-xs text-muted-foreground">{shop.branch_name}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* References Detail Dialog */}
            <Dialog open={refsDialogOpen} onOpenChange={setRefsDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>References — {refsDialogCampaignName}</DialogTitle>
                        <DialogDescription>{refsDialogManagers.length} reference{refsDialogManagers.length !== 1 ? 's' : ''} assigned</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {refsDialogManagers.map((m, i) => (
                            <div key={i} className="rounded-lg border p-3">
                                <p className="text-sm font-medium">{m.full_name}</p>
                                {m.phone && <p className="text-xs text-muted-foreground">{m.phone}</p>}
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
