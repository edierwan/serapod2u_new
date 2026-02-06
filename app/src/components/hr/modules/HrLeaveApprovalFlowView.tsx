'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    Plus,
    Pencil,
    Trash2,
    GripVertical,
    ChevronRight,
    CheckCircle2,
    Clock,
    ArrowRight,
    Shield,
    Users,
    User,
    Star,
    AlertCircle,
    X,
    Settings,
    CalendarDays,
    Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { getLeaveRepository } from '@/modules/hr/leave/repository'
import { formatDate } from '@/modules/hr/leave/utils'
import type {
    ApprovalChain,
    ApprovalChainStep,
    ApproverRole,
    DelegationRule,
    LeaveType,
} from '@/modules/hr/leave/types'

// ── Constants ───────────────────────────────────────────────────

const ROLE_CONFIG: Record<ApproverRole, { label: string; icon: typeof User; color: string }> = {
    direct_manager: { label: 'Direct Manager', icon: User, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    department_head: { label: 'Department Head', icon: Users, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    hr_manager: { label: 'HR Manager', icon: Shield, color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    ceo: { label: 'CEO', icon: Star, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    custom: { label: 'Custom Approver', icon: User, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
}

const ROLE_OPTIONS: ApproverRole[] = ['direct_manager', 'department_head', 'hr_manager', 'ceo', 'custom']

// ── Blank chain ─────────────────────────────────────────────────

function blankChain(): Omit<ApprovalChain, 'id' | 'createdAt' | 'updatedAt'> {
    return {
        name: '',
        description: '',
        isDefault: false,
        leaveTypeIds: [],
        steps: [
            {
                id: `step-${Date.now()}`,
                level: 1,
                role: 'direct_manager',
                customApproverId: null,
                customApproverName: null,
                autoApproveAfterHours: null,
                canDelegate: true,
            },
        ],
        escalationEnabled: false,
        escalationHours: 72,
        organizationId: 'org-1',
    }
}

// ── Component ───────────────────────────────────────────────────

export default function HrLeaveApprovalFlowView() {
    const repo = getLeaveRepository()
    const [chains, setChains] = useState<ApprovalChain[]>([])
    const [delegations, setDelegations] = useState<DelegationRule[]>([])
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
    const [loading, setLoading] = useState(true)

    const [activeTab, setActiveTab] = useState<'chains' | 'delegation' | 'sla'>('chains')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingChain, setEditingChain] = useState<ApprovalChain | null>(null)
    const [formData, setFormData] = useState(blankChain())
    const [saving, setSaving] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

    // Delegation form
    const [delegationDialogOpen, setDelegationDialogOpen] = useState(false)
    const [delDelegator, setDelDelegator] = useState('')
    const [delDelegate, setDelDelegate] = useState('')
    const [delStart, setDelStart] = useState('')
    const [delEnd, setDelEnd] = useState('')

    // ── Load data ────────────────────────────────────────────────

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [ch, del, lt] = await Promise.all([
                repo.getApprovalChains(),
                repo.getDelegationRules(),
                repo.getLeaveTypes(),
            ])
            setChains(ch)
            setDelegations(del)
            setLeaveTypes(lt)
        } catch (e) {
            console.error('Failed to load approval data', e)
        } finally {
            setLoading(false)
        }
    }, [repo])

    useEffect(() => { loadData() }, [loadData])

    // ── Handlers: Chains ─────────────────────────────────────────

    function openCreateChain() {
        setEditingChain(null)
        setFormData(blankChain())
        setDialogOpen(true)
    }

    function openEditChain(chain: ApprovalChain) {
        setEditingChain(chain)
        setFormData({
            name: chain.name,
            description: chain.description,
            isDefault: chain.isDefault,
            leaveTypeIds: [...chain.leaveTypeIds],
            steps: chain.steps.map((s) => ({ ...s })),
            escalationEnabled: chain.escalationEnabled,
            escalationHours: chain.escalationHours,
            organizationId: chain.organizationId,
        })
        setDialogOpen(true)
    }

    async function handleSaveChain() {
        setSaving(true)
        try {
            if (editingChain) {
                await repo.updateApprovalChain(editingChain.id, formData)
            } else {
                await repo.createApprovalChain(formData as any)
            }
            setDialogOpen(false)
            await loadData()
        } catch (e) {
            console.error('Failed to save chain', e)
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteChain(id: string) {
        await repo.deleteApprovalChain(id)
        setDeleteConfirm(null)
        await loadData()
    }

    // ── Step management ──────────────────────────────────────────

    function addStep() {
        const steps = formData.steps
        setFormData({
            ...formData,
            steps: [
                ...steps,
                {
                    id: `step-${Date.now()}`,
                    level: steps.length + 1,
                    role: 'hr_manager',
                    customApproverId: null,
                    customApproverName: null,
                    autoApproveAfterHours: null,
                    canDelegate: true,
                },
            ],
        })
    }

    function updateStep(idx: number, updates: Partial<ApprovalChainStep>) {
        const steps = [...formData.steps]
        steps[idx] = { ...steps[idx], ...updates }
        setFormData({ ...formData, steps })
    }

    function removeStep(idx: number) {
        const steps = formData.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, level: i + 1 }))
        setFormData({ ...formData, steps })
    }

    function toggleLeaveType(ltId: string) {
        const ids = formData.leaveTypeIds.includes(ltId)
            ? formData.leaveTypeIds.filter((id) => id !== ltId)
            : [...formData.leaveTypeIds, ltId]
        setFormData({ ...formData, leaveTypeIds: ids })
    }

    // ── Delegation handlers ──────────────────────────────────────

    async function handleCreateDelegation() {
        if (!delDelegator || !delDelegate || !delStart || !delEnd) return
        setSaving(true)
        try {
            await repo.createDelegationRule({
                delegatorId: delDelegator,
                delegatorName: delDelegator,
                delegateId: delDelegate,
                delegateName: delDelegate,
                startDate: delStart,
                endDate: delEnd,
                isActive: true,
            })
            setDelegationDialogOpen(false)
            setDelDelegator('')
            setDelDelegate('')
            setDelStart('')
            setDelEnd('')
            await loadData()
        } catch (e) {
            console.error('Failed to create delegation', e)
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteDelegation(id: string) {
        await repo.deleteDelegationRule(id)
        await loadData()
    }

    // ── Helpers ──────────────────────────────────────────────────

    function leaveTypeNames(ids: string[]): string {
        if (ids.length === 0) return 'None assigned'
        return ids
            .map((id) => leaveTypes.find((lt) => lt.id === id)?.name ?? id)
            .join(', ')
    }

    // ── Render ───────────────────────────────────────────────────

    return (
        <div className="w-full space-y-6">
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Approval Flow</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure approval chains, delegation rules, and SLA settings
                    </p>
                </div>
            </div>

            {/* ── Tabs ───────────────────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <TabsList>
                    <TabsTrigger value="chains" className="gap-1.5">
                        <ArrowRight className="h-3.5 w-3.5" /> Approval Chains
                    </TabsTrigger>
                    <TabsTrigger value="delegation" className="gap-1.5">
                        <Users className="h-3.5 w-3.5" /> Delegation
                    </TabsTrigger>
                    <TabsTrigger value="sla" className="gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> SLA & Escalation
                    </TabsTrigger>
                </TabsList>

                {/* ═══ Tab: Approval Chains ═══════════════════════ */}
                <TabsContent value="chains" className="space-y-4 mt-4">
                    <div className="flex justify-end">
                        <Button onClick={openCreateChain} className="gap-2">
                            <Plus className="h-4 w-4" /> New Chain
                        </Button>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2].map((i) => <div key={i} className="h-32 rounded-lg border bg-card animate-pulse" />)}
                        </div>
                    ) : chains.length === 0 ? (
                        <div className="text-center py-16">
                            <ArrowRight className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                            <p className="text-muted-foreground">No approval chains configured</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {chains.map((chain) => (
                                <Card key={chain.id} className="overflow-hidden">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-2">
                                                <CardTitle className="text-base">{chain.name}</CardTitle>
                                                {chain.isDefault && (
                                                    <Badge variant="default" className="text-[10px] px-1.5 py-0">Default</Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openEditChain(chain)}>
                                                    <Pencil className="h-3 w-3" /> Edit
                                                </Button>
                                                {!chain.isDefault && (
                                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(chain.id)}>
                                                        <Trash2 className="h-3 w-3" /> Delete
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{chain.description}</p>
                                    </CardHeader>
                                    <CardContent className="pb-4 space-y-3">
                                        {/* Visual flow */}
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs">
                                                <User className="h-3 w-3" /> Employee
                                            </div>
                                            {chain.steps.map((step, i) => {
                                                const cfg = ROLE_CONFIG[step.role]
                                                const Icon = cfg.icon
                                                return (
                                                    <div key={step.id} className="flex items-center gap-1">
                                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium', cfg.color)}>
                                                            <Icon className="h-3 w-3" />
                                                            {step.role === 'custom' ? (step.customApproverName || 'Custom') : cfg.label}
                                                            {step.autoApproveAfterHours && (
                                                                <span className="text-[10px] opacity-70">({step.autoApproveAfterHours}h)</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-100 dark:bg-green-900/40 text-xs text-green-700 dark:text-green-300">
                                                <CheckCircle2 className="h-3 w-3" /> Done
                                            </div>
                                        </div>

                                        {/* Leave types */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-muted-foreground">Applies to:</span>
                                            {chain.leaveTypeIds.length === 0 ? (
                                                <span className="text-xs text-muted-foreground italic">No leave types assigned</span>
                                            ) : (
                                                chain.leaveTypeIds.map((ltId) => {
                                                    const lt = leaveTypes.find((t) => t.id === ltId)
                                                    return lt ? (
                                                        <Badge key={ltId} variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: lt.color, color: lt.color }}>
                                                            {lt.name}
                                                        </Badge>
                                                    ) : null
                                                })
                                            )}
                                        </div>

                                        {/* Escalation */}
                                        {chain.escalationEnabled && (
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Zap className="h-3 w-3 text-amber-500" />
                                                Escalation after {chain.escalationHours}h
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ═══ Tab: Delegation ════════════════════════════ */}
                <TabsContent value="delegation" className="space-y-4 mt-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold">Delegation Rules</h3>
                            <p className="text-xs text-muted-foreground">Temporarily delegate approval authority</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setDelegationDialogOpen(true)} className="gap-1">
                            <Plus className="h-3.5 w-3.5" /> Add Delegation
                        </Button>
                    </div>

                    {delegations.length === 0 ? (
                        <div className="text-center py-12">
                            <Users className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground">No active delegations</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {delegations.map((del) => (
                                <Card key={del.id}>
                                    <CardContent className="p-4 flex items-center gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="font-medium">{del.delegatorName}</span>
                                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="font-medium">{del.delegateName}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                <CalendarDays className="h-3 w-3" />
                                                {formatDate(del.startDate)} – {formatDate(del.endDate)}
                                            </div>
                                        </div>
                                        <Badge variant={del.isActive ? 'default' : 'secondary'} className="text-[10px]">
                                            {del.isActive ? 'Active' : 'Expired'}
                                        </Badge>
                                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleDeleteDelegation(del.id)}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ═══ Tab: SLA & Escalation ══════════════════════ */}
                <TabsContent value="sla" className="space-y-4 mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">SLA & Escalation Settings</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {chains.map((chain) => (
                                    <div key={chain.id} className="rounded-lg border p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-semibold">{chain.name}</h4>
                                            <Badge variant={chain.escalationEnabled ? 'default' : 'secondary'} className="text-[10px]">
                                                {chain.escalationEnabled ? 'Escalation ON' : 'Escalation OFF'}
                                            </Badge>
                                        </div>

                                        <div className="space-y-2">
                                            {chain.steps.map((step) => {
                                                const cfg = ROLE_CONFIG[step.role]
                                                return (
                                                    <div key={step.id} className="flex items-center justify-between text-xs">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground">L{step.level}</span>
                                                            <span className="font-medium">
                                                                {step.role === 'custom' ? (step.customApproverName || 'Custom') : cfg.label}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            {step.autoApproveAfterHours ? (
                                                                <span className="flex items-center gap-1 text-amber-600">
                                                                    <Zap className="h-3 w-3" />
                                                                    Auto-approve: {step.autoApproveAfterHours}h
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground">No auto-approve</span>
                                                            )}
                                                            <Badge variant="outline" className="text-[10px] px-1.5">
                                                                {step.canDelegate ? 'Can delegate' : 'No delegation'}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {chain.escalationEnabled && (
                                            <div className="flex items-center gap-1.5 pt-2 border-t text-xs text-muted-foreground">
                                                <Clock className="h-3 w-3" />
                                                Escalation timeout: <strong>{chain.escalationHours} hours</strong>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2 mb-2">
                                    <Settings className="h-3.5 w-3.5" />
                                    <span className="font-medium text-foreground">How SLA works</span>
                                </div>
                                <ul className="space-y-1 list-disc list-inside">
                                    <li>Each step has an optional auto-approve timer</li>
                                    <li>If the approver doesn&apos;t act within the timer, the request auto-approves and moves to the next level</li>
                                    <li>Escalation timeout triggers a notification to HR when the entire chain is stalled</li>
                                    <li>Delegated approvals inherit the same SLA timers</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* ── Delete Confirmation ─────────────────────────────── */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-popover rounded-lg border shadow-lg p-6 max-w-sm w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                <AlertCircle className="h-5 w-5 text-destructive" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Delete Approval Chain</h3>
                                <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDeleteChain(deleteConfirm)}>Delete</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Create/Edit Chain Dialog ─────────────────────────── */}
            {dialogOpen && (
                <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40 overflow-y-auto pb-10">
                    <div className="bg-popover rounded-lg border shadow-xl w-full max-w-2xl mx-4">
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                            <h2 className="text-lg font-semibold">{editingChain ? 'Edit Approval Chain' : 'Create Approval Chain'}</h2>
                            <button onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                            {/* Name + Description */}
                            <div className="grid grid-cols-1 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Chain Name *</label>
                                    <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Standard Approval" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Description</label>
                                    <textarea className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description…" />
                                </div>
                            </div>

                            {/* Default */}
                            <label className="flex items-center justify-between rounded-md border px-3 py-2">
                                <span className="text-sm">Set as default chain</span>
                                <Switch checked={formData.isDefault} onCheckedChange={(v) => setFormData({ ...formData, isDefault: v })} />
                            </label>

                            {/* Linked Leave Types */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Linked Leave Types</label>
                                <div className="flex flex-wrap gap-2">
                                    {leaveTypes.filter((t) => t.status === 'active').map((lt) => {
                                        const selected = formData.leaveTypeIds.includes(lt.id)
                                        return (
                                            <button
                                                key={lt.id}
                                                type="button"
                                                onClick={() => toggleLeaveType(lt.id)}
                                                className={cn(
                                                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                                                    selected
                                                        ? 'border-current bg-opacity-10'
                                                        : 'border-border text-muted-foreground hover:border-foreground'
                                                )}
                                                style={selected ? { color: lt.color, borderColor: lt.color, backgroundColor: lt.color + '18' } : undefined}
                                            >
                                                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: lt.color }} />
                                                {lt.name}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Steps */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">Approval Steps</label>
                                    <Button variant="outline" size="sm" onClick={addStep} className="gap-1"><Plus className="h-3 w-3" /> Add Step</Button>
                                </div>

                                {formData.steps.map((step, idx) => {
                                    const cfg = ROLE_CONFIG[step.role]
                                    return (
                                        <div key={step.id} className="rounded-lg border p-3 space-y-3 bg-muted/20">
                                            <div className="flex items-center gap-3">
                                                <div className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">L{step.level}</div>
                                                <div className="flex-1 grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[11px] text-muted-foreground">Approver role</label>
                                                        <select className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={step.role} onChange={(e) => updateStep(idx, { role: e.target.value as ApproverRole })}>
                                                            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[11px] text-muted-foreground">Auto-approve after (hours)</label>
                                                        <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={step.autoApproveAfterHours ?? ''} placeholder="Disabled" onChange={(e) => updateStep(idx, { autoApproveAfterHours: e.target.value ? parseInt(e.target.value) : null })} min={1} />
                                                    </div>
                                                </div>
                                                {formData.steps.length > 1 && (
                                                    <button onClick={() => removeStep(idx)} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 pl-9">
                                                <label className="flex items-center gap-2 text-xs">
                                                    <Switch checked={step.canDelegate} onCheckedChange={(v) => updateStep(idx, { canDelegate: v })} />
                                                    Can delegate
                                                </label>
                                                {step.role === 'custom' && (
                                                    <input className="rounded border bg-background px-2 py-1 text-xs flex-1" placeholder="Custom approver name…" value={step.customApproverName ?? ''} onChange={(e) => updateStep(idx, { customApproverName: e.target.value })} />
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Escalation */}
                            <div className="rounded-lg border p-4 space-y-3">
                                <label className="flex items-center justify-between">
                                    <div>
                                        <span className="text-sm font-medium">Escalation</span>
                                        <p className="text-xs text-muted-foreground">Notify HR when chain stalls</p>
                                    </div>
                                    <Switch checked={formData.escalationEnabled} onCheckedChange={(v) => setFormData({ ...formData, escalationEnabled: v })} />
                                </label>
                                {formData.escalationEnabled && (
                                    <div className="space-y-1">
                                        <label className="text-[11px] text-muted-foreground">Escalation timeout (hours)</label>
                                        <input type="number" className="w-full rounded border bg-background px-2 py-1.5 text-sm" value={formData.escalationHours} onChange={(e) => setFormData({ ...formData, escalationHours: parseInt(e.target.value) || 0 })} min={1} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
                            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                            <Button onClick={handleSaveChain} disabled={saving || !formData.name || formData.steps.length === 0}>
                                {saving ? 'Saving…' : editingChain ? 'Update' : 'Create'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delegation Dialog ───────────────────────────────── */}
            {delegationDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-popover rounded-lg border shadow-lg w-full max-w-md mx-4">
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                            <h2 className="text-lg font-semibold">Add Delegation Rule</h2>
                            <button onClick={() => setDelegationDialogOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium">Delegator (original approver)</label>
                                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={delDelegator} onChange={(e) => setDelDelegator(e.target.value)} placeholder="Manager name…" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium">Delegate (temporary replacement)</label>
                                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={delDelegate} onChange={(e) => setDelDelegate(e.target.value)} placeholder="Replacement name…" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Start</label>
                                    <input type="date" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={delStart} onChange={(e) => setDelStart(e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">End</label>
                                    <input type="date" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={delEnd} onChange={(e) => setDelEnd(e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 px-6 py-4 border-t">
                            <Button variant="outline" onClick={() => setDelegationDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleCreateDelegation} disabled={!delDelegator || !delDelegate || !delStart || !delEnd}>Create</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
