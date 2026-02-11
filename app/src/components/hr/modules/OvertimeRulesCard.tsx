'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from '@/components/ui/accordion'
import { useToast } from '@/components/ui/use-toast'
import {
    AlertTriangle, Calculator, Clock, FileText, HelpCircle,
    Landmark, Loader2, RotateCcw, Save, Shield, Sparkles, Zap
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────

interface OTRule {
    id?: string
    rule_type: 'daily' | 'weekly' | 'consecutive_days' | 'shift_based'
    threshold_minutes_t1: number
    threshold_minutes_t2: number | null
    multiplier_t1: number
    multiplier_t2: number | null
    rest_day_multiplier: number
    holiday_multiplier: number
    day_type_overrides: Record<string, number> | null
    priority: number
    is_active: boolean
}

interface OTPolicy {
    id?: string
    enabled: boolean
    compensation_mode: 'paid' | 'time_off' | 'hybrid'
    require_approval: boolean
    approval_flow: 'manager' | 'hr' | 'manager_then_hr'
    ot_grace_minutes: number
    auto_deduct_break: number
    rounding_mode: 'none' | 'round_down' | 'round_up' | 'nearest'
    rounding_interval: number
    max_ot_per_day_hours: number
    max_ot_per_week_hours: number
    min_ot_block_minutes: number
    eligibility_mode: 'all' | 'shift_only' | 'selected_positions'
    eligible_positions: string[]
    carry_forward_days: number
}

interface OTPreset {
    id: string
    name: string
    country_code: string
    rules_json: any
}

interface PreviewResult {
    entries: Array<{
        date: string
        employee_name: string
        total_work_minutes: number
        regular_minutes: number
        ot_minutes_t1: number
        ot_minutes_t2: number
        day_type: string
        rate_t1: number
        rate_t2: number
        flags: Record<string, boolean>
    }>
    summary: {
        total_entries: number
        total_regular_hours: number
        total_ot_t1_hours: number
        total_ot_t2_hours: number
    }
}

interface OvertimeRulesCardProps {
    canManage: boolean
}

const DEFAULT_POLICY: OTPolicy = {
    enabled: true,
    compensation_mode: 'paid',
    require_approval: true,
    approval_flow: 'manager',
    ot_grace_minutes: 15,
    auto_deduct_break: 0,
    rounding_mode: 'round_down',
    rounding_interval: 15,
    max_ot_per_day_hours: 4,
    max_ot_per_week_hours: 20,
    min_ot_block_minutes: 30,
    eligibility_mode: 'all',
    eligible_positions: [],
    carry_forward_days: 90,
}

const DEFAULT_RULE: OTRule = {
    rule_type: 'daily',
    threshold_minutes_t1: 480, // 8 hours
    threshold_minutes_t2: null,
    multiplier_t1: 1.5,
    multiplier_t2: null,
    rest_day_multiplier: 2.0,
    holiday_multiplier: 3.0,
    day_type_overrides: null,
    priority: 1,
    is_active: true,
}

// ─── Component ─────────────────────────────────────────────────────

export default function OvertimeRulesCard({ canManage }: OvertimeRulesCardProps) {
    const { toast } = useToast()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [policy, setPolicy] = useState<OTPolicy>(DEFAULT_POLICY)
    const [rules, setRules] = useState<OTRule[]>([{ ...DEFAULT_RULE }])
    const [presets, setPresets] = useState<OTPreset[]>([])
    const [dirty, setDirty] = useState(false)

    // Preview state
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
    const [previewRange, setPreviewRange] = useState(() => {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
        const end = now.toISOString().split('T')[0]
        return { start, end }
    })

    // ─── Load data ─────────────────────────────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/hr/attendance/overtime')
            const json = await res.json()
            if (json.success) {
                if (json.policy) {
                    setPolicy(prev => ({ ...prev, ...json.policy }))
                }
                if (json.rules && json.rules.length > 0) {
                    setRules(json.rules)
                } else {
                    setRules([{ ...DEFAULT_RULE }])
                }
                if (json.presets) {
                    setPresets(json.presets)
                }
            }
        } catch (e) {
            console.error('Failed to load OT config:', e)
        }
        setLoading(false)
    }, [])

    useEffect(() => { loadData() }, [loadData])

    // ─── Save ──────────────────────────────────────────────────────
    const handleSave = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/hr/attendance/overtime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ policy, rules }),
            })
            const json = await res.json()
            if (json.success) {
                toast({ title: 'Overtime rules saved' })
                setDirty(false)
                loadData()
            } else {
                toast({ title: 'Error', description: json.error, variant: 'destructive' })
            }
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' })
        }
        setSaving(false)
    }

    // ─── Apply preset ──────────────────────────────────────────────
    const applyPreset = (preset: OTPreset) => {
        const r = preset.rules_json
        if (r) {
            setRules([{
                ...DEFAULT_RULE,
                multiplier_t1: r.multiplier_normal ?? 1.5,
                rest_day_multiplier: r.multiplier_rest_day ?? 2.0,
                holiday_multiplier: r.multiplier_holiday ?? 3.0,
                multiplier_t2: r.multiplier_extended ?? null,
                threshold_minutes_t2: r.extended_after_minutes ?? null,
            }])
            setPolicy(prev => ({
                ...prev,
                max_ot_per_day_hours: r.max_daily_hours ?? prev.max_ot_per_day_hours,
            }))
            setDirty(true)
            toast({ title: `Applied: ${preset.name}`, description: `${preset.country_code} rates loaded.` })
        }
    }

    // ─── Preview ───────────────────────────────────────────────────
    const runPreview = async () => {
        setPreviewLoading(true)
        try {
            const res = await fetch('/api/hr/attendance/overtime/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_date: previewRange.start,
                    end_date: previewRange.end,
                }),
            })
            const json = await res.json()
            if (json.success) {
                setPreviewResult({ entries: json.entries, summary: json.summary })
            } else {
                toast({ title: 'Preview failed', description: json.error, variant: 'destructive' })
                setPreviewResult(null)
            }
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' })
        }
        setPreviewLoading(false)
    }

    // ─── Helpers ───────────────────────────────────────────────────
    const updatePolicy = (updates: Partial<OTPolicy>) => {
        setPolicy(prev => ({ ...prev, ...updates }))
        setDirty(true)
    }

    const updateRule = (index: number, updates: Partial<OTRule>) => {
        setRules(prev => prev.map((r, i) => i === index ? { ...r, ...updates } : r))
        setDirty(true)
    }

    const hoursToMinutes = (h: number) => Math.round(h * 60)
    const minutesToHours = (m: number) => +(m / 60).toFixed(1)

    if (loading) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading overtime configuration...
                </CardContent>
            </Card>
        )
    }

    const primaryRule = rules[0] || DEFAULT_RULE

    return (
        <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-blue-600" />
                        <div>
                            <CardTitle className="text-base">Overtime Rules</CardTitle>
                            <CardDescription>Configure overtime triggers, rates, caps, and approval flow.</CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {dirty && <Badge variant="outline" className="text-orange-600 border-orange-300">Unsaved changes</Badge>}
                        {canManage && (
                            <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                                {saving ? 'Saving...' : 'Save Rules'}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <Accordion type="multiple" defaultValue={['trigger', 'rates']} className="space-y-2">

                    {/* ── Presets ─────────────────────────────────── */}
                    {presets.length > 0 && (
                        <div className="flex items-center gap-2 pb-2">
                            <Landmark className="h-4 w-4 text-gray-500" />
                            <span className="text-sm text-gray-600 font-medium">Quick Presets:</span>
                            {presets.map(p => (
                                <Button key={p.id} variant="outline" size="sm"
                                    onClick={() => applyPreset(p)} disabled={!canManage}>
                                    <Sparkles className="h-3 w-3 mr-1" />{p.name}
                                </Button>
                            ))}
                        </div>
                    )}

                    {/* ── 1. Eligibility & Scope ─────────────────── */}
                    <AccordionItem value="eligibility" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-gray-500" />Eligibility &amp; Scope</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="space-y-2">
                                <Label>Who qualifies for OT?</Label>
                                <Select
                                    value={policy.eligibility_mode}
                                    onValueChange={(v) => updatePolicy({ eligibility_mode: v as OTPolicy['eligibility_mode'] })}
                                    disabled={!canManage}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All employees</SelectItem>
                                        <SelectItem value="shift_only">Shift-assigned employees only</SelectItem>
                                        <SelectItem value="selected_positions">Selected positions / grades</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Compensation Mode</Label>
                                <Select
                                    value={policy.compensation_mode}
                                    onValueChange={(v) => updatePolicy({ compensation_mode: v as OTPolicy['compensation_mode'] })}
                                    disabled={!canManage}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="paid">Paid overtime (hourly rate × multiplier)</SelectItem>
                                        <SelectItem value="time_off">Time-off in lieu (TOIL)</SelectItem>
                                        <SelectItem value="hybrid">Hybrid (employee chooses per request)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {policy.compensation_mode !== 'paid' && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>TOIL carry-forward (days)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">Max days before accumulated TOIL expires.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" value={policy.carry_forward_days}
                                        onChange={e => updatePolicy({ carry_forward_days: Number(e.target.value) })}
                                        disabled={!canManage} />
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 2. OT Trigger & Thresholds ──────────────── */}
                    <AccordionItem value="trigger" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-gray-500" />OT Trigger &amp; Thresholds</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>Daily threshold (hours)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">OT starts after this many work hours. Default: 8h.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" step="0.5" min="1" max="24"
                                        value={minutesToHours(primaryRule.threshold_minutes_t1)}
                                        onChange={e => updateRule(0, { threshold_minutes_t1: hoursToMinutes(Number(e.target.value)) })}
                                        disabled={!canManage} />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>Extended OT after (hours)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">Tier 2 rate applies after this threshold. Leave empty for single tier.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" step="0.5" min="1" max="24"
                                        value={primaryRule.threshold_minutes_t2 ? minutesToHours(primaryRule.threshold_minutes_t2) : ''}
                                        placeholder="e.g. 12"
                                        onChange={e => updateRule(0, { threshold_minutes_t2: e.target.value ? hoursToMinutes(Number(e.target.value)) : null })}
                                        disabled={!canManage} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>OT grace (minutes)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">Extra minutes beyond threshold before OT counts. Prevents small overruns being flagged as OT.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" min="0" max="60"
                                        value={policy.ot_grace_minutes}
                                        onChange={e => updatePolicy({ ot_grace_minutes: Number(e.target.value) })}
                                        disabled={!canManage} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Auto-deduct break (min)</Label>
                                    <Input type="number" min="0" max="120"
                                        value={policy.auto_deduct_break}
                                        onChange={e => updatePolicy({ auto_deduct_break: Number(e.target.value) })}
                                        disabled={!canManage} />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 3. Grace & Rounding ──────────────────────── */}
                    <AccordionItem value="rounding" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-gray-500" />Rounding Rules</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Rounding mode</Label>
                                    <Select
                                        value={policy.rounding_mode}
                                        onValueChange={(v) => updatePolicy({ rounding_mode: v as OTPolicy['rounding_mode'] })}
                                        disabled={!canManage}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No rounding (exact minutes)</SelectItem>
                                            <SelectItem value="round_down">Round down (employer-friendly)</SelectItem>
                                            <SelectItem value="round_up">Round up (employee-friendly)</SelectItem>
                                            <SelectItem value="nearest">Nearest interval</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {policy.rounding_mode !== 'none' && (
                                    <div className="space-y-2">
                                        <Label>Rounding interval (min)</Label>
                                        <Select
                                            value={String(policy.rounding_interval)}
                                            onValueChange={(v) => updatePolicy({ rounding_interval: Number(v) })}
                                            disabled={!canManage}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="5">5 minutes</SelectItem>
                                                <SelectItem value="10">10 minutes</SelectItem>
                                                <SelectItem value="15">15 minutes</SelectItem>
                                                <SelectItem value="30">30 minutes</SelectItem>
                                                <SelectItem value="60">1 hour</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-1">
                                    <Label>Minimum OT block (min)</Label>
                                    <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                        <TooltipContent><p className="text-xs">OT shorter than this is not counted. E.g. 30 = anything under 30min OT is ignored.</p></TooltipContent>
                                    </Tooltip>
                                </div>
                                <Input type="number" min="0" max="120"
                                    value={policy.min_ot_block_minutes}
                                    onChange={e => updatePolicy({ min_ot_block_minutes: Number(e.target.value) })}
                                    disabled={!canManage} />
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 4. Rate Multipliers ──────────────────────── */}
                    <AccordionItem value="rates" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-gray-500" />Rate Multipliers</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="text-xs text-gray-500 mb-2">
                                Multiplier applied to hourly rate for each day type. E.g., 1.5× means employee earns 1.5 times normal hourly rate for OT.
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2 p-3 rounded-lg border">
                                    <Label className="text-xs text-gray-500">Normal Day (Tier 1)</Label>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" step="0.1" min="1" max="5"
                                            value={primaryRule.multiplier_t1}
                                            onChange={e => updateRule(0, { multiplier_t1: Number(e.target.value) })}
                                            disabled={!canManage} className="text-center font-semibold" />
                                        <span className="text-sm text-gray-400">×</span>
                                    </div>
                                </div>
                                <div className="space-y-2 p-3 rounded-lg border border-orange-200 bg-orange-50/50">
                                    <Label className="text-xs text-orange-600">Rest Day</Label>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" step="0.1" min="1" max="5"
                                            value={primaryRule.rest_day_multiplier}
                                            onChange={e => updateRule(0, { rest_day_multiplier: Number(e.target.value) })}
                                            disabled={!canManage} className="text-center font-semibold" />
                                        <span className="text-sm text-gray-400">×</span>
                                    </div>
                                </div>
                                <div className="space-y-2 p-3 rounded-lg border border-red-200 bg-red-50/50">
                                    <Label className="text-xs text-red-600">Public Holiday</Label>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" step="0.1" min="1" max="5"
                                            value={primaryRule.holiday_multiplier}
                                            onChange={e => updateRule(0, { holiday_multiplier: Number(e.target.value) })}
                                            disabled={!canManage} className="text-center font-semibold" />
                                        <span className="text-sm text-gray-400">×</span>
                                    </div>
                                </div>
                            </div>
                            {primaryRule.threshold_minutes_t2 && (
                                <div className="grid grid-cols-3 gap-4 pt-2 border-t mt-2">
                                    <div className="space-y-2 p-3 rounded-lg border">
                                        <Label className="text-xs text-gray-500">Normal Day (Tier 2)</Label>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.1" min="1" max="5"
                                                value={primaryRule.multiplier_t2 || primaryRule.multiplier_t1}
                                                onChange={e => updateRule(0, { multiplier_t2: Number(e.target.value) })}
                                                disabled={!canManage} className="text-center font-semibold" />
                                            <span className="text-sm text-gray-400">×</span>
                                        </div>
                                    </div>
                                    <div className="col-span-2 flex items-center text-xs text-gray-500 italic ml-2">
                                        Tier 2 applies after {minutesToHours(primaryRule.threshold_minutes_t2)}h total work.
                                    </div>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 5. Caps & Compliance ──────────────────────── */}
                    <AccordionItem value="caps" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-gray-500" />Caps &amp; Compliance</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>Max OT per day (hours)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">Hard cap on daily OT. Excess is flagged but not counted. Malaysian EA: 4h.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" step="0.5" min="0" max="12"
                                        value={policy.max_ot_per_day_hours}
                                        onChange={e => updatePolicy({ max_ot_per_day_hours: Number(e.target.value) })}
                                        disabled={!canManage} />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Label>Max OT per week (hours)</Label>
                                        <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3 w-3 text-gray-400" /></TooltipTrigger>
                                            <TooltipContent><p className="text-xs">Weekly cap for labor compliance. Malaysia: 104h/month general limit.</p></TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input type="number" step="0.5" min="0" max="60"
                                        value={policy.max_ot_per_week_hours}
                                        onChange={e => updatePolicy({ max_ot_per_week_hours: Number(e.target.value) })}
                                        disabled={!canManage} />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 6. Approval Flow ──────────────────────────── */}
                    <AccordionItem value="approval" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-gray-500" />Approval Flow</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="flex items-center gap-3">
                                <Switch checked={policy.require_approval}
                                    onCheckedChange={c => updatePolicy({ require_approval: c })}
                                    disabled={!canManage} />
                                <span className="text-sm text-gray-700">Require approval for OT claims</span>
                            </div>
                            {policy.require_approval && (
                                <div className="space-y-2">
                                    <Label>Approval chain</Label>
                                    <Select
                                        value={policy.approval_flow}
                                        onValueChange={(v) => updatePolicy({ approval_flow: v as OTPolicy['approval_flow'] })}
                                        disabled={!canManage}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="manager">Direct manager only</SelectItem>
                                            <SelectItem value="hr">HR only</SelectItem>
                                            <SelectItem value="manager_then_hr">Manager → then HR</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {!policy.require_approval && (
                                <div className="text-xs text-yellow-600 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    All OT claims will be auto-approved. This may have payroll implications.
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── 7. Preview Panel ──────────────────────────── */}
                    <AccordionItem value="preview" className="rounded-lg border bg-white px-4">
                        <AccordionTrigger className="text-sm font-medium gap-2 py-3">
                            <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-blue-500" />OT Preview &amp; Simulation</div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 pb-4">
                            <div className="text-xs text-gray-500 mb-2">
                                Test the current rules against actual attendance data to see computed OT before saving.
                            </div>
                            <div className="flex items-end gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">From</Label>
                                    <Input type="date" value={previewRange.start}
                                        onChange={e => setPreviewRange(p => ({ ...p, start: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">To</Label>
                                    <Input type="date" value={previewRange.end}
                                        onChange={e => setPreviewRange(p => ({ ...p, end: e.target.value }))} />
                                </div>
                                <Button size="sm" onClick={runPreview} disabled={previewLoading}>
                                    {previewLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Calculator className="h-4 w-4 mr-1" />}
                                    Run Preview
                                </Button>
                            </div>

                            {previewResult && (
                                <div className="mt-3 space-y-3">
                                    {/* Summary cards */}
                                    <div className="grid grid-cols-4 gap-3">
                                        <div className="rounded-lg border p-3 text-center">
                                            <div className="text-lg font-semibold">{previewResult.summary.total_entries}</div>
                                            <div className="text-xs text-gray-500">Entries</div>
                                        </div>
                                        <div className="rounded-lg border p-3 text-center">
                                            <div className="text-lg font-semibold text-green-600">{previewResult.summary.total_regular_hours}h</div>
                                            <div className="text-xs text-gray-500">Regular</div>
                                        </div>
                                        <div className="rounded-lg border p-3 text-center">
                                            <div className="text-lg font-semibold text-blue-600">{previewResult.summary.total_ot_t1_hours}h</div>
                                            <div className="text-xs text-gray-500">OT Tier 1</div>
                                        </div>
                                        <div className="rounded-lg border p-3 text-center">
                                            <div className="text-lg font-semibold text-purple-600">{previewResult.summary.total_ot_t2_hours}h</div>
                                            <div className="text-xs text-gray-500">OT Tier 2</div>
                                        </div>
                                    </div>

                                    {/* Detail table */}
                                    {previewResult.entries.length > 0 && (
                                        <div className="rounded-lg border overflow-hidden">
                                            <div className="max-h-64 overflow-y-auto">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-gray-50 sticky top-0">
                                                        <tr>
                                                            <th className="text-left px-3 py-2 font-medium">Date</th>
                                                            <th className="text-left px-3 py-2 font-medium">Employee</th>
                                                            <th className="text-right px-3 py-2 font-medium">Work</th>
                                                            <th className="text-right px-3 py-2 font-medium">Regular</th>
                                                            <th className="text-right px-3 py-2 font-medium">OT T1</th>
                                                            <th className="text-right px-3 py-2 font-medium">OT T2</th>
                                                            <th className="text-center px-3 py-2 font-medium">Day</th>
                                                            <th className="text-center px-3 py-2 font-medium">Rate</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {previewResult.entries.slice(0, 20).map((entry, i) => (
                                                            <tr key={i} className="hover:bg-gray-50">
                                                                <td className="px-3 py-1.5">{entry.date}</td>
                                                                <td className="px-3 py-1.5 truncate max-w-[120px]">{entry.employee_name}</td>
                                                                <td className="px-3 py-1.5 text-right">{minutesToHours(entry.total_work_minutes)}h</td>
                                                                <td className="px-3 py-1.5 text-right text-green-700">{minutesToHours(entry.regular_minutes)}h</td>
                                                                <td className="px-3 py-1.5 text-right text-blue-700">{entry.ot_minutes_t1 > 0 ? `${minutesToHours(entry.ot_minutes_t1)}h` : '-'}</td>
                                                                <td className="px-3 py-1.5 text-right text-purple-700">{entry.ot_minutes_t2 > 0 ? `${minutesToHours(entry.ot_minutes_t2)}h` : '-'}</td>
                                                                <td className="px-3 py-1.5 text-center">
                                                                    <Badge variant={entry.day_type === 'public_holiday' ? 'destructive' : entry.day_type === 'rest_day' ? 'outline' : 'secondary'} className="text-[10px] px-1">
                                                                        {entry.day_type === 'public_holiday' ? 'PH' : entry.day_type === 'rest_day' ? 'Rest' : 'Normal'}
                                                                    </Badge>
                                                                </td>
                                                                <td className="px-3 py-1.5 text-center font-mono">{entry.rate_t1}×</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            {previewResult.entries.length > 20 && (
                                                <div className="text-xs text-gray-500 text-center py-2 border-t">
                                                    Showing 20 of {previewResult.entries.length} entries
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {previewResult.entries.length === 0 && (
                                        <div className="text-sm text-gray-500 text-center py-4">
                                            No attendance entries found for this date range.
                                        </div>
                                    )}
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>
        </Card>
    )
}
