'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
    BarChart3, CalendarDays, CheckCircle2, Copy, Loader2, Pencil, Plus,
    Settings as SettingsIcon, ShieldCheck, Target, Trash2, Users, Wallet,
} from 'lucide-react'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'
import {
    autoDistributeTarget, deriveKpiMonthPeriod, formatKpiMonthLabel,
    kpiMonthFromDate, previousKpiMonth,
} from '@/lib/roadtour/kpi'
import type { KpiAmOption, KpiCycleRow, KpiIncentiveRuleRow, KpiTeamRow } from '@/modules/roadtour/types/kpi'
import { EmptyBlock, LoadingBlock, PageHeader } from './analytics/shared'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const APPLIES_TO_LABEL: Record<string, string> = {
    all_ams: 'All AMs',
    team_leader: 'Team Leader',
    specific_team: 'Specific Team',
}

const POLICY_RULES = [
    'KPI month uses calendar month boundaries.',
    'Team/member structure is frozen after cycle activation.',
    'New campaign QR scans contribute to the AM assigned in that campaign.',
    'New campaigns created mid-month are included in the same KPI month if under the selected event.',
    'Historical scan attribution is not rewritten when AM changes.',
]

function buildMonthOptions(): string[] {
    const now = new Date()
    const options: string[] = []
    for (let offset = 3; offset >= -12; offset--) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return options
}

function CycleStatusBadge({ status }: { status: string }) {
    if (status === 'active') return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Active</Badge>
    if (status === 'closed') return <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">Closed</Badge>
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200">Draft</Badge>
}

interface RuleFormState {
    id: string | null
    rule_name: string
    applies_to: string
    team_id: string
    achievement_threshold_percent: string
    incentive_amount: string
    bonus_type: string
    status: string
}

const EMPTY_RULE_FORM: RuleFormState = {
    id: null, rule_name: '', applies_to: 'all_ams', team_id: '',
    achievement_threshold_percent: '100', incentive_amount: '', bonus_type: 'cash', status: 'active',
}

export function RoadtourKpiSettingsView({ userProfile }: Props) {
    const supabase = createClient()
    const companyId = userProfile?.organizations?.id

    const monthOptions = useMemo(buildMonthOptions, [])
    const [runs, setRuns] = useState<RoadtourRun[]>([])
    const [ams, setAms] = useState<KpiAmOption[]>([])
    const [cycles, setCycles] = useState<KpiCycleRow[]>([])
    const [loading, setLoading] = useState(true)
    const [schemaMissing, setSchemaMissing] = useState(false)

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [selectedRunId, setSelectedRunId] = useState('')
    const [saving, setSaving] = useState(false)

    // Team builder state
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
    const [teamName, setTeamName] = useState('')
    const [leaderId, setLeaderId] = useState('')
    const [memberIds, setMemberIds] = useState<string[]>([])
    const [teamTarget, setTeamTarget] = useState('')
    const [incentiveBudget, setIncentiveBudget] = useState('')
    const [manualOverride, setManualOverride] = useState(false)
    const [manualTargets, setManualTargets] = useState<Record<string, string>>({})
    const [memberSearch, setMemberSearch] = useState('')

    // Rule dialog state
    const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
    const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM)

    const cycle: KpiCycleRow | null = useMemo(() => {
        if (!selectedRunId) return null
        return cycles.find((c) => c.roadtour_run_id === selectedRunId && kpiMonthFromDate(c.kpi_month) === selectedMonth) || null
    }, [cycles, selectedRunId, selectedMonth])

    const period = useMemo(() => deriveKpiMonthPeriod(selectedMonth), [selectedMonth])
    const amById = useMemo(() => new Map(ams.map((a) => [a.id, a])), [ams])
    const isFrozen = Boolean(cycle && cycle.status === 'active' && cycle.freeze_members_targets)
    const isClosed = cycle?.status === 'closed'

    const loadCycles = useCallback(async () => {
        if (!companyId) return
        const res = await fetch(`/api/roadtour/kpi/cycles?org_id=${encodeURIComponent(companyId)}`)
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load KPI cycles.')
        setSchemaMissing(Boolean(json.schemaMissing))
        setCycles(json.data || [])
    }, [companyId])

    useEffect(() => {
        if (!companyId) return
        let cancelled = false
        const load = async () => {
            try {
                setLoading(true)
                const [runsData, amsData] = await Promise.all([
                    fetchRoadtourRuns(supabase, companyId),
                    supabase
                        .from('users')
                        .select('id, full_name, email, phone')
                        .eq('can_be_reference', true)
                        .eq('is_active', true)
                        .order('full_name'),
                ])
                if (cancelled) return
                setRuns(runsData)
                if (amsData.error) throw amsData.error
                setAms((amsData.data || []).map((row: any) => ({
                    id: row.id, full_name: row.full_name || '', email: row.email || '', phone: row.phone || '',
                })))
                const preferred = runsData.find((r) => r.status === 'active') || runsData[0]
                setSelectedRunId((prev) => prev || preferred?.id || '')
                await loadCycles()
            } catch (err: any) {
                if (!cancelled) toast({ title: 'Error', description: err.message || 'Failed to load KPI settings.', variant: 'destructive' })
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId])

    const resetTeamBuilder = useCallback(() => {
        setEditingTeamId(null)
        setTeamName('')
        setLeaderId('')
        setMemberIds([])
        setTeamTarget('')
        setIncentiveBudget('')
        setManualOverride(false)
        setManualTargets({})
        setMemberSearch('')
    }, [])

    const loadTeamIntoBuilder = useCallback((team: KpiTeamRow) => {
        setEditingTeamId(team.id)
        setTeamName(team.team_name)
        setLeaderId(team.leader_user_id || '')
        setMemberIds(team.members.map((m) => m.am_user_id))
        setTeamTarget(String(team.monthly_team_target))
        setIncentiveBudget(team.incentive_budget ? String(team.incentive_budget) : '')
        const overrides: Record<string, string> = {}
        let hasManual = false
        for (const m of team.members) {
            if (m.manual_target_scans != null) {
                overrides[m.am_user_id] = String(m.manual_target_scans)
                hasManual = true
            }
        }
        setManualOverride(hasManual)
        setManualTargets(overrides)
    }, [])

    const callApi = useCallback(async (path: string, init?: RequestInit) => {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json' },
            ...init,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed.')
        return json
    }, [])

    const handleCreateCycle = useCallback(async () => {
        if (!selectedRunId) {
            toast({ title: 'Select an event', description: 'Choose a RoadTour Event before creating a KPI cycle.', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            await callApi('/api/roadtour/kpi/cycles', {
                method: 'POST',
                body: JSON.stringify({ org_id: companyId, roadtour_run_id: selectedRunId, kpi_month: selectedMonth }),
            })
            await loadCycles()
            toast({ title: 'KPI cycle created', description: `Draft cycle for ${formatKpiMonthLabel(selectedMonth)} is ready.` })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, companyId, loadCycles, selectedMonth, selectedRunId])

    const handleDuplicatePrevious = useCallback(async () => {
        if (!selectedRunId) return
        try {
            setSaving(true)
            await callApi('/api/roadtour/kpi/cycles/duplicate', {
                method: 'POST',
                body: JSON.stringify({ org_id: companyId, roadtour_run_id: selectedRunId, target_kpi_month: selectedMonth }),
            })
            await loadCycles()
            toast({ title: 'Cycle duplicated', description: `Copied ${formatKpiMonthLabel(previousKpiMonth(selectedMonth))} structure into ${formatKpiMonthLabel(selectedMonth)}.` })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, companyId, loadCycles, selectedMonth, selectedRunId])

    const handleCycleToggle = useCallback(async (field: 'freeze_members_targets' | 'lock_campaign_qr_attribution', value: boolean) => {
        if (!cycle) return
        try {
            await callApi(`/api/roadtour/kpi/cycles/${cycle.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) })
            await loadCycles()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, cycle, loadCycles])

    const handleScopeChange = useCallback(async (scope: string) => {
        if (!cycle) return
        try {
            await callApi(`/api/roadtour/kpi/cycles/${cycle.id}`, { method: 'PATCH', body: JSON.stringify({ reporting_scope: scope }) })
            await loadCycles()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, cycle, loadCycles])

    const handleSaveTeam = useCallback(async () => {
        if (!cycle) return
        const target = Number(teamTarget || 0)
        if (!teamName.trim()) {
            toast({ title: 'Team name required', variant: 'destructive' })
            return
        }
        const members = memberIds.map((id) => ({
            am_user_id: id,
            manual_target_scans: manualOverride && manualTargets[id] !== undefined && manualTargets[id] !== ''
                ? Number(manualTargets[id])
                : null,
        }))
        const payload: Record<string, any> = {
            team_name: teamName.trim(),
            leader_user_id: leaderId || null,
            monthly_team_target: target,
            incentive_budget: Number(incentiveBudget || 0),
            members,
        }
        try {
            setSaving(true)
            if (editingTeamId) {
                await callApi(`/api/roadtour/kpi/teams/${editingTeamId}`, { method: 'PATCH', body: JSON.stringify(payload) })
            } else {
                await callApi('/api/roadtour/kpi/teams', { method: 'POST', body: JSON.stringify({ ...payload, kpi_cycle_id: cycle.id }) })
            }
            await loadCycles()
            resetTeamBuilder()
            toast({ title: 'Team saved' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, cycle, editingTeamId, incentiveBudget, leaderId, loadCycles, manualOverride, manualTargets, memberIds, resetTeamBuilder, teamName, teamTarget])

    const handleDeleteTeam = useCallback(async (teamId: string) => {
        if (!window.confirm('Delete this team and its member assignments?')) return
        try {
            await callApi(`/api/roadtour/kpi/teams/${teamId}`, { method: 'DELETE' })
            await loadCycles()
            if (editingTeamId === teamId) resetTeamBuilder()
            toast({ title: 'Team deleted' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, editingTeamId, loadCycles, resetTeamBuilder])

    const handleSaveRule = useCallback(async () => {
        if (!cycle) return
        const payload = {
            rule_name: ruleForm.rule_name.trim(),
            applies_to: ruleForm.applies_to,
            team_id: ruleForm.applies_to === 'specific_team' ? ruleForm.team_id || null : null,
            achievement_threshold_percent: Number(ruleForm.achievement_threshold_percent),
            incentive_amount: Number(ruleForm.incentive_amount),
            bonus_type: ruleForm.bonus_type,
            status: ruleForm.status,
        }
        if (!payload.rule_name) {
            toast({ title: 'Rule name required', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            if (ruleForm.id) {
                await callApi(`/api/roadtour/kpi/rules/${ruleForm.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            } else {
                await callApi('/api/roadtour/kpi/rules', { method: 'POST', body: JSON.stringify({ ...payload, kpi_cycle_id: cycle.id }) })
            }
            await loadCycles()
            setRuleDialogOpen(false)
            setRuleForm(EMPTY_RULE_FORM)
            toast({ title: 'Incentive rule saved' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, cycle, loadCycles, ruleForm])

    const handleDeleteRule = useCallback(async (ruleId: string) => {
        if (!window.confirm('Delete this incentive rule?')) return
        try {
            await callApi(`/api/roadtour/kpi/rules/${ruleId}`, { method: 'DELETE' })
            await loadCycles()
            toast({ title: 'Incentive rule deleted' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, loadCycles])

    const handleActivate = useCallback(async () => {
        if (!cycle) return
        if (!window.confirm('Activate this KPI cycle? Team members and targets will be frozen.')) return
        try {
            setSaving(true)
            await callApi(`/api/roadtour/kpi/cycles/${cycle.id}/activate`, { method: 'POST' })
            await loadCycles()
            toast({ title: 'KPI cycle activated', description: 'Members & targets are now frozen for this month.' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, cycle, loadCycles])

    // Derived summary numbers for the Active KPI Cycle card.
    const summary = useMemo(() => {
        const teams = cycle?.teams || []
        return {
            teams: teams.length,
            ams: teams.reduce((sum, t) => sum + t.members.length, 0),
            targetTotal: teams.reduce((sum, t) => sum + (t.monthly_team_target || 0), 0),
            budgetTotal: teams.reduce((sum, t) => sum + (Number(t.incentive_budget) || 0), 0),
        }
    }, [cycle])

    const memberCount = memberIds.length
    const autoTargets = useMemo(() => autoDistributeTarget(Number(teamTarget || 0), memberCount), [teamTarget, memberCount])
    const perAmAuto = memberCount > 0 ? Math.floor(Number(teamTarget || 0) / memberCount) : 0

    const filteredAmOptions = useMemo(() => {
        const q = memberSearch.trim().toLowerCase()
        if (!q) return ams
        return ams.filter((a) => a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
    }, [ams, memberSearch])

    const selectedRun = runs.find((r) => r.id === selectedRunId)

    if (!companyId) {
        return <Card><EmptyBlock title="Organization required" description="Your profile is not linked to an organization." /></Card>
    }

    return (
        <div className="space-y-4 pb-24">
            <PageHeader
                overline="RoadTour Settings"
                title="RoadTour KPI & Incentive Settings"
                description="Configure monthly KPI cycles, team structures, scan targets, and AM incentive rules for RoadTour performance tracking."
            />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && schemaMissing && (
                <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                    The RoadTour KPI database migration has not been applied to this environment yet. Apply
                    supabase/migrations/20260707_roadtour_monthly_kpi.sql to enable KPI cycles.
                </div>
            )}

            {!loading && (
                <>
                    {/* Active KPI Cycle summary */}
                    <Card className="border-blue-100 bg-blue-50/40">
                        <CardHeader className="pb-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4 text-blue-600" />
                                    {cycle?.status === 'active' ? 'Active KPI Cycle' : 'KPI Cycle'}
                                </CardTitle>
                                <div className="flex gap-2">
                                    {!cycle && (
                                        <Button size="sm" onClick={handleCreateCycle} disabled={saving || schemaMissing}>
                                            <Plus className="h-4 w-4 mr-1" /> Create KPI Cycle
                                        </Button>
                                    )}
                                    <Button size="sm" variant="outline" onClick={handleDuplicatePrevious} disabled={saving || schemaMissing || Boolean(cycle)}>
                                        <Copy className="h-4 w-4 mr-1" /> Duplicate Previous Month
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {cycle ? (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7 text-sm">
                                    <div>
                                        <div className="text-xs text-muted-foreground">Month</div>
                                        <div className="font-semibold">{formatKpiMonthLabel(selectedMonth)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Event</div>
                                        <div className="font-semibold truncate">{selectedRun?.name || '—'}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Status</div>
                                        <CycleStatusBadge status={cycle.status} />
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Scan attribution source</div>
                                        <div className="font-medium text-blue-700 text-xs mt-0.5">campaign QR / selected AM at scan time</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Teams</div>
                                        <div className="text-lg font-bold">{summary.teams}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> AMs</div>
                                        <div className="text-lg font-bold">{summary.ams}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Team Target</div>
                                            <div className="text-lg font-bold">{summary.targetTotal.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">scans</span></div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Incentive Budget</div>
                                            <div className="text-lg font-bold">RM {summary.budgetTotal.toLocaleString()}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <EmptyBlock
                                    title={`No KPI cycle for ${formatKpiMonthLabel(selectedMonth)}`}
                                    description="Create a KPI cycle for this month and event, or duplicate the previous month's structure."
                                />
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                        {/* Left column: cycle setup + team builder */}
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <SettingsIcon className="h-4 w-4 text-blue-600" /> KPI Cycle Setup
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">KPI Month</label>
                                            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {monthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">RoadTour Event</label>
                                            <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                                                <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                                                <SelectContent>
                                                    {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Reporting Scope</label>
                                            <Select value={cycle?.reporting_scope || 'all_campaigns'} onValueChange={handleScopeChange} disabled={!cycle || isClosed}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all_campaigns">All surveys/shops under event</SelectItem>
                                                    <SelectItem value="selected_campaigns">Selected campaigns only</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                                        <span className="flex items-center gap-2 text-blue-800">
                                            <CalendarDays className="h-4 w-4" /> Period: Auto based on KPI Month
                                        </span>
                                        <span className="font-semibold text-blue-800">{period.label} (auto)</span>
                                    </div>

                                    <div className="flex flex-wrap gap-x-8 gap-y-3">
                                        <label className="flex items-center gap-2 text-sm">
                                            <Switch
                                                checked={cycle?.freeze_members_targets ?? true}
                                                onCheckedChange={(v) => handleCycleToggle('freeze_members_targets', v)}
                                                disabled={!cycle || isClosed}
                                            />
                                            Freeze members &amp; targets
                                        </label>
                                        <label className="flex items-center gap-2 text-sm">
                                            <Switch
                                                checked={cycle?.lock_campaign_qr_attribution ?? true}
                                                onCheckedChange={(v) => handleCycleToggle('lock_campaign_qr_attribution', v)}
                                                disabled={!cycle || isClosed}
                                            />
                                            Lock attribution to campaign QR
                                        </label>
                                    </div>

                                    <div className="rounded-md border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-800">
                                        Changes to AM assignment affect new scans only; historical scans remain under the original campaign/QR attribution.
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Users className="h-4 w-4 text-blue-600" /> Selected Team Detail / Team Builder
                                        </CardTitle>
                                        {editingTeamId && (
                                            <Button size="sm" variant="ghost" onClick={resetTeamBuilder}>New Team</Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {!cycle ? (
                                        <EmptyBlock title="Create a KPI cycle first" description="Teams are configured inside a monthly KPI cycle." />
                                    ) : (
                                        <>
                                            <div className="grid gap-3 sm:grid-cols-3">
                                                <div className="sm:col-span-1">
                                                    <label className="text-xs font-medium text-muted-foreground">Team Name</label>
                                                    <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. North Penang Team" disabled={isFrozen || isClosed} />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-medium text-muted-foreground">Leader</label>
                                                    <Select value={leaderId || 'none'} onValueChange={(v) => setLeaderId(v === 'none' ? '' : v)} disabled={isFrozen || isClosed}>
                                                        <SelectTrigger><SelectValue placeholder="Select leader" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="none">No leader</SelectItem>
                                                            {ams.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-medium text-muted-foreground">Member Count</label>
                                                    <div className="h-10 flex items-center">
                                                        <Badge variant="secondary" className="text-sm">{memberCount} AMs</Badge>
                                                    </div>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-xs font-medium text-muted-foreground">Members</label>
                                                {memberIds.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 my-1.5">
                                                        {memberIds.map((id) => (
                                                            <Badge key={id} variant="outline" className="gap-1">
                                                                {amById.get(id)?.full_name || 'Unknown'}
                                                                {!isFrozen && !isClosed && (
                                                                    <button
                                                                        type="button"
                                                                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                                                                        onClick={() => setMemberIds((prev) => prev.filter((x) => x !== id))}
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                                {!isFrozen && !isClosed && (
                                                    <div className="border rounded-md">
                                                        <Input
                                                            className="border-0 border-b rounded-b-none focus-visible:ring-0"
                                                            placeholder="Search account managers…"
                                                            value={memberSearch}
                                                            onChange={(e) => setMemberSearch(e.target.value)}
                                                        />
                                                        <div className="max-h-36 overflow-y-auto p-1">
                                                            {filteredAmOptions.length === 0 && (
                                                                <div className="text-xs text-muted-foreground px-2 py-2">No account managers found.</div>
                                                            )}
                                                            {filteredAmOptions.map((a) => {
                                                                const checked = memberIds.includes(a.id)
                                                                return (
                                                                    <button
                                                                        key={a.id}
                                                                        type="button"
                                                                        className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between hover:bg-muted ${checked ? 'bg-blue-50 text-blue-800' : ''}`}
                                                                        onClick={() => setMemberIds((prev) => checked ? prev.filter((x) => x !== a.id) : [...prev, a.id])}
                                                                    >
                                                                        <span>{a.full_name}</span>
                                                                        {checked && <CheckCircle2 className="h-4 w-4" />}
                                                                    </button>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div>
                                                    <label className="text-xs font-medium text-muted-foreground">Monthly Cumulative Team Target (scans)</label>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={teamTarget}
                                                        onChange={(e) => setTeamTarget(e.target.value)}
                                                        placeholder="e.g. 7000"
                                                        disabled={isFrozen || isClosed}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-medium text-muted-foreground">Incentive Budget (RM)</label>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={incentiveBudget}
                                                        onChange={(e) => setIncentiveBudget(e.target.value)}
                                                        placeholder="e.g. 1600"
                                                        disabled={isClosed}
                                                    />
                                                </div>
                                            </div>

                                            {memberCount > 0 && Number(teamTarget) > 0 && (
                                                <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-800">
                                                    <span className="font-medium">Auto-distribution rules:</span>{' '}
                                                    {memberCount} members × {perAmAuto.toLocaleString()} scans ≈ {Number(teamTarget).toLocaleString()}
                                                </div>
                                            )}

                                            <label className="flex items-center gap-2 text-sm">
                                                <Switch checked={manualOverride} onCheckedChange={setManualOverride} disabled={isFrozen || isClosed} />
                                                Allow manual AM target override
                                            </label>

                                            {memberCount > 0 && (
                                                <div>
                                                    <div className="text-xs font-medium text-muted-foreground mb-1">
                                                        Auto Target Per AM {manualOverride ? '(override enabled)' : '(default-only)'}
                                                    </div>
                                                    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                                        {memberIds.map((id, i) => (
                                                            <div key={id} className="flex items-center justify-between gap-2 text-sm border-b py-1">
                                                                <span className="truncate">{amById.get(id)?.full_name || 'Unknown'}</span>
                                                                {manualOverride ? (
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        className="h-7 w-24 text-right"
                                                                        placeholder={String(autoTargets[i] ?? 0)}
                                                                        value={manualTargets[id] ?? ''}
                                                                        onChange={(e) => setManualTargets((prev) => ({ ...prev, [id]: e.target.value }))}
                                                                        disabled={isFrozen || isClosed}
                                                                    />
                                                                ) : (
                                                                    <span className="text-muted-foreground">{(autoTargets[i] ?? 0).toLocaleString()} scans</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex justify-end gap-2">
                                                <Button onClick={handleSaveTeam} disabled={saving || isFrozen || isClosed}>
                                                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                                    {editingTeamId ? 'Update Team' : 'Add Team'}
                                                </Button>
                                            </div>
                                            {isFrozen && (
                                                <div className="text-xs text-amber-700">
                                                    Members &amp; targets are frozen because this cycle is active. Turn off freeze to edit (not recommended mid-month).
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right column: team structure + incentive rules + policy */}
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <BarChart3 className="h-4 w-4 text-blue-600" /> Team KPI Structure
                                        </CardTitle>
                                        <Button size="sm" variant="outline" onClick={resetTeamBuilder} disabled={!cycle || isFrozen || isClosed}>
                                            <Plus className="h-4 w-4 mr-1" /> Add Team
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {!cycle || cycle.teams.length === 0 ? (
                                        <EmptyBlock title="No teams yet" description="Use the Team Builder to add the first team for this KPI cycle." />
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Team Name</TableHead>
                                                        <TableHead>Leader</TableHead>
                                                        <TableHead className="text-right">Members</TableHead>
                                                        <TableHead className="text-right">Monthly Team Target</TableHead>
                                                        <TableHead className="text-right">Auto Target / AM</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="text-right">Actions</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {cycle.teams.map((t) => {
                                                        const autoPerAm = t.members.length > 0 ? Math.floor(t.monthly_team_target / t.members.length) : 0
                                                        return (
                                                            <TableRow key={t.id} className={editingTeamId === t.id ? 'bg-blue-50/50' : ''}>
                                                                <TableCell className="font-medium">{t.team_name}</TableCell>
                                                                <TableCell>{t.leader_user_id ? (amById.get(t.leader_user_id)?.full_name || '—') : '—'}</TableCell>
                                                                <TableCell className="text-right">{t.members.length}</TableCell>
                                                                <TableCell className="text-right">{t.monthly_team_target.toLocaleString()} scans</TableCell>
                                                                <TableCell className="text-right">{autoPerAm.toLocaleString()} / AM</TableCell>
                                                                <TableCell><CycleStatusBadge status={t.status} /></TableCell>
                                                                <TableCell className="text-right">
                                                                    <div className="flex justify-end gap-1">
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => loadTeamIntoBuilder(t)}>
                                                                            <Pencil className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => handleDeleteTeam(t.id)} disabled={isFrozen || isClosed}>
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </div>
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

                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Wallet className="h-4 w-4 text-blue-600" /> KPI Incentive Rules
                                            </CardTitle>
                                            <p className="text-xs text-muted-foreground mt-1">Incentives are awarded based on achievement tiers within the selected KPI month.</p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => { setRuleForm(EMPTY_RULE_FORM); setRuleDialogOpen(true) }}
                                            disabled={!cycle || isClosed}
                                        >
                                            <Plus className="h-4 w-4 mr-1" /> Add Incentive Rule
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {!cycle || cycle.rules.length === 0 ? (
                                        <EmptyBlock title="No incentive rules" description="Add achievement tiers such as 100% target = RM200, or a team leader bonus." />
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Rule Name</TableHead>
                                                        <TableHead>Applies To</TableHead>
                                                        <TableHead className="text-right">Achievement Threshold</TableHead>
                                                        <TableHead className="text-right">Incentive Amount</TableHead>
                                                        <TableHead>Bonus Type</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="text-right">Actions</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {cycle.rules.map((r) => (
                                                        <TableRow key={r.id}>
                                                            <TableCell className="font-medium">{r.rule_name}</TableCell>
                                                            <TableCell>
                                                                {APPLIES_TO_LABEL[r.applies_to]}
                                                                {r.applies_to === 'specific_team' && r.team_id && (
                                                                    <span className="text-xs text-muted-foreground block">
                                                                        {cycle.teams.find((t) => t.id === r.team_id)?.team_name || ''}
                                                                    </span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {r.applies_to === 'team_leader' ? `Team reaches ${Number(r.achievement_threshold_percent)}%` : `${Number(r.achievement_threshold_percent)}% of target`}
                                                            </TableCell>
                                                            <TableCell className="text-right">RM {Number(r.incentive_amount).toLocaleString()}</TableCell>
                                                            <TableCell className="capitalize">{r.bonus_type}</TableCell>
                                                            <TableCell>
                                                                {r.status === 'active'
                                                                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Active</Badge>
                                                                    : <Badge variant="secondary">Inactive</Badge>}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <div className="flex justify-end gap-1">
                                                                    <Button
                                                                        size="icon" variant="ghost" className="h-7 w-7"
                                                                        onClick={() => {
                                                                            setRuleForm({
                                                                                id: r.id,
                                                                                rule_name: r.rule_name,
                                                                                applies_to: r.applies_to,
                                                                                team_id: r.team_id || '',
                                                                                achievement_threshold_percent: String(Number(r.achievement_threshold_percent)),
                                                                                incentive_amount: String(Number(r.incentive_amount)),
                                                                                bonus_type: r.bonus_type,
                                                                                status: r.status,
                                                                            })
                                                                            setRuleDialogOpen(true)
                                                                        }}
                                                                        disabled={isClosed}
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => handleDeleteRule(r.id)} disabled={isClosed}>
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <ShieldCheck className="h-4 w-4 text-blue-600" /> KPI Policy &amp; Attribution Rules
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ul className="grid gap-2 sm:grid-cols-2 text-sm">
                                        {POLICY_RULES.map((rule) => (
                                            <li key={rule} className="flex items-start gap-2">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                                                <span>{rule}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* Footer actions */}
                    <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 backdrop-blur px-4 py-3">
                        <div className="max-w-screen-2xl mx-auto flex justify-end gap-2">
                            <Button variant="outline" onClick={() => { resetTeamBuilder(); loadCycles() }} disabled={saving}>Cancel</Button>
                            <Button variant="outline" onClick={() => { loadCycles(); toast({ title: 'Draft saved', description: 'All changes are saved as you edit.' }) }} disabled={!cycle || saving || isClosed}>
                                Save Draft
                            </Button>
                            <Button onClick={handleActivate} disabled={!cycle || cycle.status !== 'draft' || saving}>
                                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                                Activate KPI Cycle
                            </Button>
                        </div>
                    </div>

                    {/* Incentive rule dialog */}
                    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>{ruleForm.id ? 'Edit Incentive Rule' : 'Add Incentive Rule'}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Rule Name</label>
                                    <Input value={ruleForm.rule_name} onChange={(e) => setRuleForm((p) => ({ ...p, rule_name: e.target.value }))} placeholder="e.g. Base Achievement" />
                                </div>
                                <div className="grid gap-3 grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Applies To</label>
                                        <Select value={ruleForm.applies_to} onValueChange={(v) => setRuleForm((p) => ({ ...p, applies_to: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all_ams">All AMs</SelectItem>
                                                <SelectItem value="team_leader">Team Leader</SelectItem>
                                                <SelectItem value="specific_team">Specific Team</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {ruleForm.applies_to === 'specific_team' && (
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Team</label>
                                            <Select value={ruleForm.team_id || 'none'} onValueChange={(v) => setRuleForm((p) => ({ ...p, team_id: v === 'none' ? '' : v }))}>
                                                <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">Select team</SelectItem>
                                                    {(cycle?.teams || []).map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Achievement Threshold (%)</label>
                                        <Input type="number" min={1} value={ruleForm.achievement_threshold_percent} onChange={(e) => setRuleForm((p) => ({ ...p, achievement_threshold_percent: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Incentive Amount (RM)</label>
                                        <Input type="number" min={0} value={ruleForm.incentive_amount} onChange={(e) => setRuleForm((p) => ({ ...p, incentive_amount: e.target.value }))} placeholder="e.g. 200" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Bonus Type</label>
                                        <Select value={ruleForm.bonus_type} onValueChange={(v) => setRuleForm((p) => ({ ...p, bonus_type: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="cash">Cash</SelectItem>
                                                <SelectItem value="other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                                        <Select value={ruleForm.status} onValueChange={(v) => setRuleForm((p) => ({ ...p, status: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="active">Active</SelectItem>
                                                <SelectItem value="inactive">Inactive</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleSaveRule} disabled={saving}>
                                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Rule
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </div>
    )
}
