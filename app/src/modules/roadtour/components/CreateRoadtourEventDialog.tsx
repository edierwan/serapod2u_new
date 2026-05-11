'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { Loader2, Map as MapIcon } from 'lucide-react'
import {
    DUPLICATE_POLICY_OPTIONS,
    type RoadtourDuplicatePolicy,
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
    onCreated?: (run: RoadtourRun) => void
}

export function CreateRoadtourEventDialog({
    open,
    onOpenChange,
    supabase,
    orgId,
    createdBy = null,
    onCreated,
}: CreateRoadtourEventDialogProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [status, setStatus] = useState<RoadtourRunStatus>('active')
    const [duplicatePolicy, setDuplicatePolicy] = useState<RoadtourDuplicatePolicy>('per_run')
    const [saving, setSaving] = useState(false)

    const reset = () => {
        setName('')
        setDescription('')
        setStartDate('')
        setEndDate('')
        setStatus('active')
        setDuplicatePolicy('per_run')
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
        try {
            setSaving(true)
            const created = await createRoadtourRun(supabase, {
                org_id: orgId,
                name,
                description,
                start_date: startDate,
                end_date: endDate,
                status,
                duplicate_policy: duplicatePolicy,
                created_by: createdBy,
            })
            toast({ title: 'RoadTour Event created', description: `"${created.name}" is ready.` })
            onCreated?.(created)
            handleClose(false)
        } catch (err: any) {
            toast({ title: 'Failed to create event', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <MapIcon className="h-5 w-5 text-primary" />
                        Create RoadTour Event
                    </DialogTitle>
                    <DialogDescription>
                        Group campaigns under one RoadTour activity. This is the key grouping for duplicate scan protection.
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
                        Default <strong>One shop once per event</strong> protects against duplicate rewards across different
                        campaigns/references in the same RoadTour Event.
                    </p>
                </div>

                <DialogFooter className="pt-2">
                    <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Create Event
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
