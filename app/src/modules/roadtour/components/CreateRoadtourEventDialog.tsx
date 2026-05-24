'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { Info, Loader2, Map as MapIcon } from 'lucide-react'
import {
    DUPLICATE_POLICY_OPTIONS,
    POINT_RELEASE_RULE_LABEL,
    PRODUCT_QR_COUNTING_PERIOD_LABEL,
    type RoadtourDuplicatePolicy,
    type RoadtourPointReleaseRule,
    type RoadtourProductQrCountingPeriod,
    type RoadtourRunStatus,
    type RoadtourRun,
    createRoadtourRun,
} from '@/lib/roadtour/events'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CreateRoadtourEventDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    supabase: SupabaseClient
    orgId: string
    createdBy?: string | null
    event?: RoadtourRun | null
    onCreated?: (run: RoadtourRun) => void
    onSaved?: (run: RoadtourRun) => void
}

export function CreateRoadtourEventDialog({
    open,
    onOpenChange,
    supabase,
    orgId,
    createdBy = null,
    event = null,
    onCreated,
    onSaved,
}: CreateRoadtourEventDialogProps) {
    const isEditMode = Boolean(event)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [status, setStatus] = useState<RoadtourRunStatus>('active')
    const [duplicatePolicy, setDuplicatePolicy] = useState<RoadtourDuplicatePolicy>('one_participant_once_per_event')
    const [pointReleaseRule, setPointReleaseRule] = useState<RoadtourPointReleaseRule>('immediate_after_roadtour_claim')
    const [requiredProductQrScans, setRequiredProductQrScans] = useState(3)
    const [productQrCountingPeriod, setProductQrCountingPeriod] = useState<RoadtourProductQrCountingPeriod>('rolling_1_month')
    const [saving, setSaving] = useState(false)
    const isMilestoneRule = pointReleaseRule === 'product_qr_scan_target_once'

    useEffect(() => {
        if (!open) return

        if (event) {
            setName(event.name)
            setDescription(event.description || '')
            setStartDate(event.start_date)
            setEndDate(event.end_date)
            setStatus(event.status)
            setDuplicatePolicy(event.duplicate_policy)
            setPointReleaseRule(event.point_release_rule || 'immediate_after_roadtour_claim')
            setRequiredProductQrScans(event.required_product_qr_scans || 3)
            setProductQrCountingPeriod(event.product_qr_counting_period || 'rolling_1_month')
            return
        }

        reset()
    }, [event, open])

    const previewText = useMemo(() => {
        if (!isMilestoneRule) {
            return 'Participants receive their campaign Reward Points immediately after a successful RoadTour claim.'
        }

        const periodText = productQrCountingPeriod === 'rolling_1_month'
            ? 'within 1 month from enrollment'
            : productQrCountingPeriod === 'rolling_2_months'
                ? 'within 2 months from enrollment'
                : 'before the campaign/event ends'

        return `Participants under this event earn their campaign Reward Points once after scanning ${requiredProductQrScans} unique Product QR codes ${periodText}.`
    }, [isMilestoneRule, productQrCountingPeriod, requiredProductQrScans])

    const reset = () => {
        setName('')
        setDescription('')
        setStartDate('')
        setEndDate('')
        setStatus('active')
        setDuplicatePolicy('one_participant_once_per_event')
        setPointReleaseRule('immediate_after_roadtour_claim')
        setRequiredProductQrScans(3)
        setProductQrCountingPeriod('rolling_1_month')
    }

    const handleClose = (next: boolean) => {
        if (!next) reset()
        onOpenChange(next)
    }

    const handleSave = async () => {
        if (!name.trim()) {
            toast({ title: 'Event name is required', variant: 'destructive' })
            return
        }
        if (!startDate || !endDate) {
            toast({ title: 'Start and end dates are required', variant: 'destructive' })
            return
        }
        if (endDate < startDate) {
            toast({ title: 'End date must be on or after start date', variant: 'destructive' })
            return
        }
        if (isMilestoneRule && (!Number.isInteger(requiredProductQrScans) || requiredProductQrScans < 1)) {
            toast({ title: 'Required Product QR scans must be at least 1', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            const rewardReleasePayload = {
                point_release_rule: pointReleaseRule,
                required_product_qr_scans: isMilestoneRule ? requiredProductQrScans : null,
                product_qr_counting_period: isMilestoneRule ? productQrCountingPeriod : null,
                unique_product_qr_only: true,
            }

            if (event) {
                const response = await fetch(`/api/roadtour/events/${event.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        description,
                        start_date: startDate,
                        end_date: endDate,
                        status,
                        duplicate_policy: duplicatePolicy,
                        ...rewardReleasePayload,
                    }),
                })

                const result = await response.json().catch(() => null)
                if (!response.ok || !result?.success) {
                    throw new Error(result?.error || result?.message || 'Failed to update event.')
                }

                toast({ title: 'RoadTour Event updated', description: `"${result.data.name}" has been updated.` })
                onSaved?.(result.data)
            } else {
                const created = await createRoadtourRun(supabase, {
                    org_id: orgId,
                    name,
                    description,
                    start_date: startDate,
                    end_date: endDate,
                    status,
                    duplicate_policy: duplicatePolicy,
                    ...rewardReleasePayload,
                    created_by: createdBy,
                })
                toast({ title: 'RoadTour Event created', description: `"${created.name}" is ready.` })
                onCreated?.(created)
            }
            handleClose(false)
        } catch (err: any) {
            toast({ title: isEditMode ? 'Failed to update event' : 'Failed to create event', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <MapIcon className="h-5 w-5 text-primary" />
                        {isEditMode ? 'Edit RoadTour Event' : 'Create RoadTour Event'}
                    </DialogTitle>
                    <DialogDescription>
                        {isEditMode
                            ? 'Update the RoadTour activity details and duplicate claim protection for future claims.'
                            : 'Group campaigns under one RoadTour activity. This is the key grouping for duplicate scan protection.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Event Name *</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. RoadTour 2026"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Description</Label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value.slice(0, 250))}
                            rows={2}
                            maxLength={250}
                            placeholder="Optional description for this RoadTour Event"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Start Date *</Label>
                            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">End Date *</Label>
                            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Status</Label>
                            <Select value={status} onValueChange={(v) => setStatus(v as RoadtourRunStatus)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Duplicate Protection *</Label>
                            <Select value={duplicatePolicy} onValueChange={(v) => setDuplicatePolicy(v as RoadtourDuplicatePolicy)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DUPLICATE_POLICY_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}{opt.recommended ? ' (recommended)' : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                        Recommended: <strong>One participant once per event</strong> allows multiple workers from the same shop to claim once each,
                        while preventing the same user or phone from claiming repeatedly. Use shop-level protection only when the reward is intended once per shop.
                    </p>
                    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 space-y-4">
                        <div>
                            <p className="text-sm font-semibold">Participant Reward Release Rule (New Flow)</p>
                            <p className="text-xs text-muted-foreground mt-1">This event-level rule applies to all campaigns under this event.</p>
                        </div>

                        <div className="flex gap-2 rounded-md border border-blue-200 bg-white/80 p-3 text-xs text-blue-800">
                            <Info className="h-4 w-4 shrink-0 mt-0.5" />
                            <p>Campaign Reward Points remain configured inside each RoadTour campaign. This section only controls when participants receive those points.</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Point Release Rule</Label>
                                <Select value={pointReleaseRule} onValueChange={(v) => setPointReleaseRule(v as RoadtourPointReleaseRule)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="immediate_after_roadtour_claim">{POINT_RELEASE_RULE_LABEL.immediate_after_roadtour_claim}</SelectItem>
                                        <SelectItem value="product_qr_scan_target_once">{POINT_RELEASE_RULE_LABEL.product_qr_scan_target_once}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-[11px] text-muted-foreground">
                                    {isMilestoneRule ? 'Participants qualify after Product QR progress.' : 'Keeps current logic unchanged.'}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Required Product QR scans</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={requiredProductQrScans}
                                    disabled={!isMilestoneRule}
                                    onChange={(e) => setRequiredProductQrScans(Math.max(1, Number(e.target.value || 1)))}
                                />
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Counting Period</Label>
                                <Select
                                    value={productQrCountingPeriod}
                                    disabled={!isMilestoneRule}
                                    onValueChange={(v) => setProductQrCountingPeriod(v as RoadtourProductQrCountingPeriod)}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="rolling_1_month">{PRODUCT_QR_COUNTING_PERIOD_LABEL.rolling_1_month}</SelectItem>
                                        <SelectItem value="rolling_2_months">{PRODUCT_QR_COUNTING_PERIOD_LABEL.rolling_2_months}</SelectItem>
                                        <SelectItem value="open_period">{PRODUCT_QR_COUNTING_PERIOD_LABEL.open_period}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Scope</Label>
                                <Input value="Per participant / phone" readOnly className="bg-white" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                            <div>
                                <p className="text-xs font-medium">Count only unique Product QR scans</p>
                                <p className="text-[11px] text-muted-foreground">Locked on for this first version.</p>
                            </div>
                            <Switch checked disabled />
                        </div>

                        <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">{previewText}</p>
                    </div>
                    {isEditMode && event?.status === 'active' && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                            Changing duplicate protection or reward release rule affects future claims only. Existing progress, completed rewards, and awarded points remain unchanged.
                        </p>
                    )}
                </div>

                <DialogFooter className="pt-2">
                    <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        {isEditMode ? 'Save Changes' : 'Create Event'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
