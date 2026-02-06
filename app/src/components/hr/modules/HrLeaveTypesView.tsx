'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    CalendarDays,
    Plus,
    Pencil,
    Trash2,
    ToggleLeft,
    ToggleRight,
    Shield,
    Clock,
    ArrowRightLeft,
    RefreshCcw,
    AlertCircle,
    X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { getLeaveRepository } from '@/modules/hr/leave/repository'
import type {
    LeaveType,
    EntitlementTier,
    ProRataSettings,
    AccrualFrequency,
    Gender,
    LeaveTypeStatus,
} from '@/modules/hr/leave/types'

// ── Constants ───────────────────────────────────────────────────

const COLOR_OPTIONS = [
    '#3b82f6', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#8b5cf6', '#ec4899', '#6b7280', '#a3a3a3',
]

const ACCRUAL_OPTIONS: { value: AccrualFrequency; label: string }[] = [
    { value: 'yearly', label: 'Yearly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'none', label: 'None (fixed entitlement)' },
]

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
    { value: 'all', label: 'All employees' },
    { value: 'female', label: 'Female only' },
    { value: 'male', label: 'Male only' },
]

const ROUNDING_OPTIONS: { value: string; label: string }[] = [
    { value: 'round_up', label: 'Round up' },
    { value: 'round_down', label: 'Round down' },
    { value: 'round_nearest', label: 'Round to nearest' },
]

// ── Blank leave type for the form ───────────────────────────────

function blankLeaveType(): Omit<LeaveType, 'id' | 'createdAt' | 'updatedAt'> {
    return {
        code: '',
        name: '',
        description: '',
        color: '#3b82f6',
        status: 'active' as LeaveTypeStatus,
        isStatutory: false,
        gender: 'all' as Gender,
        requiresAttachment: false,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: null,
        minNoticeDays: 3,
        entitlementTiers: [
            { id: 'new-1', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 8 },
        ],
        accrualFrequency: 'yearly' as AccrualFrequency,
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 3 },
        proRata: { enabled: true, basedOn: 'join_date' as const, roundingRule: 'round_up' as const },
        organizationId: 'org-1',
    }
}

// ── Component ───────────────────────────────────────────────────

export default function HrLeaveTypesView() {
    const repo = getLeaveRepository()
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingType, setEditingType] = useState<LeaveType | null>(null)
    const [formData, setFormData] = useState(blankLeaveType())
    const [formTab, setFormTab] = useState('basic')
    const [saving, setSaving] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

    // ── Load data ────────────────────────────────────────────────

    const loadLeaveTypes = useCallback(async () => {
        setLoading(true)
        try {
            const data = await repo.getLeaveTypes()
            setLeaveTypes(data)
        } catch (e) {
            console.error('Failed to load leave types', e)
        } finally {
            setLoading(false)
        }
    }, [repo])

    useEffect(() => {
        loadLeaveTypes()
    }, [loadLeaveTypes])

    // ── Stats ────────────────────────────────────────────────────

    const activeCount = leaveTypes.filter((t) => t.status === 'active').length
    const statutoryCount = leaveTypes.filter((t) => t.isStatutory).length
    const customCount = leaveTypes.filter((t) => !t.isStatutory).length

    // ── Handlers ─────────────────────────────────────────────────

    function openCreate() {
        setEditingType(null)
        setFormData(blankLeaveType())
        setFormTab('basic')
        setDialogOpen(true)
    }

    function openEdit(lt: LeaveType) {
        setEditingType(lt)
        setFormData({
            code: lt.code,
            name: lt.name,
            description: lt.description,
            color: lt.color,
            status: lt.status,
            isStatutory: lt.isStatutory,
            gender: lt.gender,
            requiresAttachment: lt.requiresAttachment,
            requiresApproval: lt.requiresApproval,
            isPaidLeave: lt.isPaidLeave,
            maxConsecutiveDays: lt.maxConsecutiveDays,
            minNoticeDays: lt.minNoticeDays,
            entitlementTiers: [...lt.entitlementTiers],
            accrualFrequency: lt.accrualFrequency,
            carryForward: { ...lt.carryForward },
            proRata: { ...lt.proRata },
            organizationId: lt.organizationId,
        })
        setFormTab('basic')
        setDialogOpen(true)
    }

    async function handleSave() {
        setSaving(true)
        try {
            if (editingType) {
                await repo.updateLeaveType(editingType.id, formData)
            } else {
                await repo.createLeaveType(formData as any)
            }
            await loadLeaveTypes()
            setDialogOpen(false)
        } catch (e) {
            console.error('Failed to save leave type', e)
        } finally {
            setSaving(false)
        }
    }

    async function handleToggleStatus(lt: LeaveType) {
        const newStatus = lt.status === 'active' ? 'inactive' : 'active'
        await repo.updateLeaveType(lt.id, { status: newStatus })
        await loadLeaveTypes()
    }

    async function handleDelete(id: string) {
        await repo.deleteLeaveType(id)
        setDeleteConfirm(null)
        await loadLeaveTypes()
    }

    // ── Tier helpers ─────────────────────────────────────────────

    function addTier() {
        const tiers = formData.entitlementTiers
        const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].maxYearsOfService ?? tiers[tiers.length - 1].minYearsOfService + 2) : 0
        setFormData({
            ...formData,
            entitlementTiers: [
                ...tiers,
                { id: `new-${Date.now()}`, minYearsOfService: lastMax, maxYearsOfService: null, daysEntitled: 8 },
            ],
        })
    }

    function updateTier(idx: number, updates: Partial<EntitlementTier>) {
        const tiers = [...formData.entitlementTiers]
        tiers[idx] = { ...tiers[idx], ...updates }
        setFormData({ ...formData, entitlementTiers: tiers })
    }

    function removeTier(idx: number) {
        setFormData({
            ...formData,
            entitlementTiers: formData.entitlementTiers.filter((_, i) => i !== idx),
        })
    }

    // ── Render ───────────────────────────────────────────────────

    return (
        <div className="w-full space-y-6">
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Leave Types</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Define leave policies aligned with Malaysia Employment Act 1955
                    </p>
                </div>
                <Button onClick={openCreate} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Leave Type
                </Button>
            </div>

            {/* ── Stats ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <CalendarDays className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{activeCount}</p>
                            <p className="text-xs text-muted-foreground">Active Types</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                            <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{statutoryCount}</p>
                            <p className="text-xs text-muted-foreground">Statutory (EA 1955)</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                            <Plus className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{customCount}</p>
                            <p className="text-xs text-muted-foreground">Custom Types</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* ── Leave Type Cards ────────────────────────────────── */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-48 rounded-lg border bg-card animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {leaveTypes.map((lt) => (
                        <Card
                            key={lt.id}
                            className={cn(
                                'group relative overflow-hidden transition-shadow hover:shadow-md',
                                lt.status === 'inactive' && 'opacity-60'
                            )}
                        >
                            <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: lt.color }} />

                            <CardHeader className="pb-2 pl-5">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div
                                            className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                                            style={{ backgroundColor: lt.color }}
                                        >
                                            {lt.code}
                                        </div>
                                        <div>
                                            <CardTitle className="text-sm font-semibold leading-tight">{lt.name}</CardTitle>
                                            <p className="text-[11px] text-muted-foreground mt-0.5">{lt.code}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {lt.isStatutory && (
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 dark:text-amber-400">
                                                Statutory
                                            </Badge>
                                        )}
                                        <Badge variant={lt.status === 'active' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                                            {lt.status}
                                        </Badge>
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="pl-5 pb-3 space-y-3">
                                <p className="text-xs text-muted-foreground line-clamp-2">{lt.description}</p>

                                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <CalendarDays className="h-3 w-3 shrink-0" />
                                        <span>
                                            {lt.entitlementTiers.length > 0
                                                ? `${lt.entitlementTiers[0].daysEntitled}–${lt.entitlementTiers[lt.entitlementTiers.length - 1].daysEntitled} days`
                                                : 'No tiers'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <RefreshCcw className="h-3 w-3 shrink-0" />
                                        <span className="capitalize">{lt.accrualFrequency === 'none' ? 'Fixed' : lt.accrualFrequency}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                                        <span>{lt.carryForward.enabled ? `CF ${lt.carryForward.maxDays}d` : 'No carry-fwd'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <Clock className="h-3 w-3 shrink-0" />
                                        <span>{lt.minNoticeDays > 0 ? `${lt.minNoticeDays}d notice` : 'Immediate'}</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-1">
                                    {lt.gender !== 'all' && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{lt.gender}</Badge>
                                    )}
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        {lt.isPaidLeave ? 'Paid' : 'Unpaid'}
                                    </Badge>
                                    {lt.requiresAttachment && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">Attachment req.</Badge>
                                    )}
                                </div>

                                <div className="flex items-center gap-1 pt-1 border-t border-border/50">
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openEdit(lt)}>
                                        <Pencil className="h-3 w-3" /> Edit
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handleToggleStatus(lt)}>
                                        {lt.status === 'active' ? <><ToggleRight className="h-3 w-3" /> Deactivate</> : <><ToggleLeft className="h-3 w-3" /> Activate</>}
                                    </Button>
                                    {!lt.isStatutory && (
                                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(lt.id)}>
                                            <Trash2 className="h-3 w-3" /> Delete
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* ── Delete Confirmation ─────────────────────────────── */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-popover rounded-lg border shadow-lg p-6 max-w-sm w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                <AlertCircle className="h-5 w-5 text-destructive" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Delete Leave Type</h3>
                                <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Create / Edit Dialog ────────────────────────────── */}
            {dialogOpen && (
                <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40 overflow-y-auto pb-10">
                    <div className="bg-popover rounded-lg border shadow-xl w-full max-w-2xl mx-4">
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                            <h2 className="text-lg font-semibold">{editingType ? 'Edit Leave Type' : 'Create Leave Type'}</h2>
                            <button onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                        </div>

                        <Tabs value={formTab} onValueChange={setFormTab} className="w-full">
                            <div className="px-6 pt-4">
                                <TabsList className="w-full grid grid-cols-3">
                                    <TabsTrigger value="basic">Basic Info</TabsTrigger>
                                    <TabsTrigger value="entitlement">Entitlement</TabsTrigger>
                                    <TabsTrigger value="policy">Policy</TabsTrigger>
                                </TabsList>
                            </div>

                            {/* Tab: Basic Info */}
                            <TabsContent value="basic" className="px-6 pb-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium">Name *</label>
                                        <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Annual Leave" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium">Code *</label>
                                        <input className="w-full rounded-md border bg-background px-3 py-2 text-sm uppercase" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="e.g. AL" maxLength={5} />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Description</label>
                                    <textarea className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description…" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Color</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {COLOR_OPTIONS.map((c) => (
                                            <button key={c} type="button" className={cn('h-7 w-7 rounded-md border-2 transition-transform', formData.color === c ? 'border-foreground scale-110' : 'border-transparent')} style={{ backgroundColor: c }} onClick={() => setFormData({ ...formData, color: c })} />
                                        ))}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium">Eligible gender</label>
                                        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value as Gender })}>
                                            {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium">Min notice days</label>
                                        <input type="number" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={formData.minNoticeDays} onChange={(e) => setFormData({ ...formData, minNoticeDays: parseInt(e.target.value) || 0 })} min={0} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><span className="text-sm">Paid leave</span><Switch checked={formData.isPaidLeave} onCheckedChange={(v) => setFormData({ ...formData, isPaidLeave: v })} /></label>
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><span className="text-sm">Requires approval</span><Switch checked={formData.requiresApproval} onCheckedChange={(v) => setFormData({ ...formData, requiresApproval: v })} /></label>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><span className="text-sm">Requires attachment</span><Switch checked={formData.requiresAttachment} onCheckedChange={(v) => setFormData({ ...formData, requiresAttachment: v })} /></label>
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><span className="text-sm">Statutory (EA 1955)</span><Switch checked={formData.isStatutory} onCheckedChange={(v) => setFormData({ ...formData, isStatutory: v })} /></label>
                                </div>
                            </TabsContent>

                            {/* Tab: Entitlement Tiers */}
                            <TabsContent value="entitlement" className="px-6 pb-6 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold">Entitlement Tiers</h3>
                                        <p className="text-xs text-muted-foreground">Set entitlement based on years of service</p>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={addTier} className="gap-1"><Plus className="h-3 w-3" /> Add Tier</Button>
                                </div>
                                <div className="space-y-3">
                                    {formData.entitlementTiers.map((tier, idx) => (
                                        <div key={tier.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                                            <div className="text-xs font-mono text-muted-foreground w-8 text-center">T{idx + 1}</div>
                                            <div className="flex-1 grid grid-cols-3 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[11px] text-muted-foreground">From (years)</label>
                                                    <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={tier.minYearsOfService} onChange={(e) => updateTier(idx, { minYearsOfService: parseInt(e.target.value) || 0 })} min={0} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[11px] text-muted-foreground">To (years)</label>
                                                    <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={tier.maxYearsOfService ?? ''} placeholder="∞" onChange={(e) => updateTier(idx, { maxYearsOfService: e.target.value ? parseInt(e.target.value) : null })} min={0} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[11px] text-muted-foreground">Days entitled</label>
                                                    <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={tier.daysEntitled} onChange={(e) => updateTier(idx, { daysEntitled: parseInt(e.target.value) || 0 })} min={0} />
                                                </div>
                                            </div>
                                            {formData.entitlementTiers.length > 1 && (
                                                <button onClick={() => removeTier(idx)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {formData.entitlementTiers.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground text-sm">No tiers defined. Click &quot;Add Tier&quot; to begin.</div>
                                )}
                            </TabsContent>

                            {/* Tab: Policy */}
                            <TabsContent value="policy" className="px-6 pb-6 space-y-5">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Accrual Frequency</label>
                                    <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={formData.accrualFrequency} onChange={(e) => setFormData({ ...formData, accrualFrequency: e.target.value as AccrualFrequency })}>
                                        {ACCRUAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>

                                {/* Carry Forward */}
                                <div className="rounded-lg border p-4 space-y-3">
                                    <label className="flex items-center justify-between">
                                        <div><span className="text-sm font-medium">Carry Forward</span><p className="text-xs text-muted-foreground">Allow unused days to roll over</p></div>
                                        <Switch checked={formData.carryForward.enabled} onCheckedChange={(v) => setFormData({ ...formData, carryForward: { ...formData.carryForward, enabled: v } })} />
                                    </label>
                                    {formData.carryForward.enabled && (
                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            <div className="space-y-1">
                                                <label className="text-[11px] text-muted-foreground">Max carry-forward days</label>
                                                <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={formData.carryForward.maxDays} onChange={(e) => setFormData({ ...formData, carryForward: { ...formData.carryForward, maxDays: parseInt(e.target.value) || 0 } })} min={0} />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[11px] text-muted-foreground">Expiry (months after year-end)</label>
                                                <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={formData.carryForward.expiryMonths} onChange={(e) => setFormData({ ...formData, carryForward: { ...formData.carryForward, expiryMonths: parseInt(e.target.value) || 0 } })} min={0} />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Pro-Rata */}
                                <div className="rounded-lg border p-4 space-y-3">
                                    <label className="flex items-center justify-between">
                                        <div><span className="text-sm font-medium">Pro-Rata Calculation</span><p className="text-xs text-muted-foreground">Partial year entitlement for new joiners</p></div>
                                        <Switch checked={formData.proRata.enabled} onCheckedChange={(v) => setFormData({ ...formData, proRata: { ...formData.proRata, enabled: v } })} />
                                    </label>
                                    {formData.proRata.enabled && (
                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            <div className="space-y-1">
                                                <label className="text-[11px] text-muted-foreground">Based on</label>
                                                <select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={formData.proRata.basedOn} onChange={(e) => setFormData({ ...formData, proRata: { ...formData.proRata, basedOn: e.target.value as 'join_date' | 'calendar_year' } })}>
                                                    <option value="join_date">Join date</option>
                                                    <option value="calendar_year">Calendar year</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[11px] text-muted-foreground">Rounding rule</label>
                                                <select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={formData.proRata.roundingRule} onChange={(e) => setFormData({ ...formData, proRata: { ...formData.proRata, roundingRule: e.target.value as ProRataSettings['roundingRule'] } })}>
                                                    {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>

                        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
                            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                            <Button onClick={handleSave} disabled={saving || !formData.name || !formData.code}>
                                {saving ? 'Saving…' : editingType ? 'Update' : 'Create'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
