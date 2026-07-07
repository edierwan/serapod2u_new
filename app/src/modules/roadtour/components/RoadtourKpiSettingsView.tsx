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
    BarChart3, CalendarDays, CheckCircle2, Loader2, Pencil, Plus,
    Settings as SettingsIcon, ShieldCheck, Target, Trash2, Trophy, Users, Wallet,
} from 'lucide-react'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'
import {
    autoDistributeTarget, compareKpiMonth, currentKpiMonth, deriveEffectiveFromOptions,
    deriveEffectiveToOptions, deriveKpiMonthPeriod, formatKpiMonthLabel, kpiMonthFromDate,
    monthKeyFromDate, resolveLeaderId,
} from '@/lib/roadtour/kpi'
import type { KpiAmOption, KpiPlanRow, KpiTeamRow } from '@/modules/roadtour/types/kpi'
import { EmptyBlock, LoadingBlock, PageHeader } from './analytics/shared'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const POLICY_RULES = [
    'A KPI Plan is created once per RoadTour Event and reused every month.',
    'Monthly reports are generated automatically for each month in the plan window.',
    'Team/member structure is frozen after the plan is activated.',
    'New campaign QR scans contribute to the AM assigned in that campaign.',
    'Historical scan attribution is not rewritten when AM changes.',
]

function PlanStatusBadge({ status }: { status: string }) {
    if (status === 'active') return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Active</Badge>
    if (status === 'archived') return <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">Archived</Badge>
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200">Draft</Badge>
}

interface TierFormState {
    id: string | null
    rule_name: string
    applies_to: 'all_ams' | 'team_leader'
    achievement_threshold_percent: string
    incentive_amount: string
    status: string
}

const emptyTierForm = (appliesTo: 'all_ams' | 'team_leader'): TierFormState => ({
    id: null,
    rule_name: appliesTo === 'team_leader' ? 'Leader bonus' : 'AM incentive',
    applies_to: appliesTo,
    achievement_threshold_percent: '100',
    incentive_amount: '',
    status: 'active',
})

export function RoadtourKpiSettingsView({ userProfile }: Props) {
    const supabase = createClient()
    const companyId = userProfile?.organizations?.id

    const [runs, setRuns] = useState<RoadtourRun[]>([])
    const [ams, setAms] = useState<KpiAmOption[]>([])
    const [plans, setPlans] = useState<KpiPlanRow[]>([])
    const [loading, setLoading] = useState(true)
    const [schemaMissing, setSchemaMissing] = useState(false)

    const [selectedRunId, setSelectedRunId] = useState('')
    const [saving, setSaving] = useState(false)

    // Create-plan dialog state.
    const [planDialogOpen, setPlanDialogOpen] = useState(false)
    const [planFromMonth, setPlanFromMonth] = useState(currentKpiMonth())
    const [planToMonth, setPlanToMonth] = useState('') // '' = open-ended
    const [planLeaderBonus, setPlanLeaderBonus] = useState(false)

    // Team builder state.
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
    const [teamName, setTeamName] = useState('')
    const [leaderId, setLeaderId] = useState('')
    const [memberIds, setMemberIds] = useState<string[]>([])
    const [teamTarget, setTeamTarget] = useState('')
    const [incentiveBudget, setIncentiveBudget] = useState('')
    const [manualOverride, setManualOverride] = useState(false)
    const [manualTargets, setManualTargets] = useState<Record<string, string>>({})
    const [memberSearch, setMemberSearch] = useState('')

    // Incentive tier dialog state.
    const [tierDialogOpen, setTierDialogOpen] = useState(false)
    const [tierForm, setTierForm] = useState<TierFormState>(emptyTierForm('all_ams'))

    // The live (draft or active) plan for the selected event.
    const plan: KpiPlanRow | null = useMemo(
        () => plans.find((p) => p.roadtour_run_id === selectedRunId && p.status !== 'archived') || null,
        [plans, selectedRunId],
    )
    const configCycleId = plan?.config_cycle_id || null
    const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) || null, [runs, selectedRunId])

    // Configured plan endpoints for this event — kept selectable even when they
    // fall outside the recent-months window (from-months) or the event end (to).
    const eventPlans = useMemo(
        () => plans.filter((p) => p.roadtour_run_id === selectedRunId && p.status !== 'archived'),
        [plans, selectedRunId],
    )
    const configuredFromMonths = useMemo(
        () => eventPlans.map((p) => kpiMonthFromDate(p.effective_from_month)),
        [eventPlans],
    )
    const configuredEndpointMonths = useMemo(
        () => eventPlans.flatMap((p) => [
            kpiMonthFromDate(p.effective_from_month),
            ...(p.effective_to_month ? [kpiMonthFromDate(p.effective_to_month)] : []),
        ]),
        [eventPlans],
    )

    // Effective From is a short setup list (previous/current/next month + a future
    // event start + configured from-months) — never the full event period.
    const fromMonthOptions = useMemo(
        () => deriveEffectiveFromOptions({
            startDate: selectedRun?.start_date,
            configuredMonths: configuredFromMonths,
        }),
        [selectedRun, configuredFromMonths],
    )
    // Effective To is bounded by the selected From and the event end month.
    const editFromMonth = plan ? kpiMonthFromDate(plan.effective_from_month) : ''
    const editToMonthOptions = useMemo(
        () => deriveEffectiveToOptions({
            from: editFromMonth,
            endDate: selectedRun?.end_date,
            configuredMonths: configuredEndpointMonths,
        }),
        [editFromMonth, selectedRun, configuredEndpointMonths],
    )
    const createToMonthOptions = useMemo(
        () => deriveEffectiveToOptions({
            from: planFromMonth,
            endDate: selectedRun?.end_date,
            configuredMonths: configuredEndpointMonths,
        }),
        [planFromMonth, selectedRun, configuredEndpointMonths],
    )
    const eventHasFixedPeriod = Boolean(selectedRun?.start_date && selectedRun?.end_date)
    // Default a new plan to the current month, unless the event starts later.
    const defaultFromMonth = useMemo(() => {
        const start = monthKeyFromDate(selectedRun?.start_date)
        const cur = currentKpiMonth()
        return start && compareKpiMonth(start, cur) > 0 ? start : cur
    }, [selectedRun])

    const amById = useMemo(() => new Map(ams.map((a) => [a.id, a])), [ams])
    const isActive = plan?.status === 'active'
    // Members/targets freeze once the plan is active (structure locked for the month).
    const isFrozen = isActive

    const amTiers = useMemo(() => (plan?.rules || []).filter((r) => r.applies_to === 'all_ams'), [plan])
    const leaderTiers = useMemo(() => (plan?.rules || []).filter((r) => r.applies_to === 'team_leader'), [plan])

    const loadPlans = useCallback(async () => {
        if (!companyId) return
        const res = await fetch(`/api/roadtour/kpi/plans?org_id=${encodeURIComponent(companyId)}`)
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load KPI plans.')
        setSchemaMissing(Boolean(json.schemaMissing))
        setPlans(json.data || [])
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
                await loadPlans()
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
        const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed.')
        return json
    }, [])

    // Rule 4: if the selected leader is removed from the member list, reset the leader.
    useEffect(() => {
        setLeaderId((prev) => resolveLeaderId(prev, memberIds))
    }, [memberIds])

    const handleCreatePlan = useCallback(async () => {
        if (!selectedRunId) {
            toast({ title: 'Select an event', description: 'Choose a RoadTour Event before creating a KPI Plan.', variant: 'destructive' })
            return
        }
        if (planToMonth && planToMonth < planFromMonth) {
            toast({ title: 'Invalid range', description: 'Effective To cannot be before Effective From.', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            await callApi('/api/roadtour/kpi/plans', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: companyId,
                    roadtour_run_id: selectedRunId,
                    effective_from_month: planFromMonth,
                    effective_to_month: planToMonth || null,
                    leader_bonus_enabled: planLeaderBonus,
                }),
            })
            await loadPlans()
            setPlanDialogOpen(false)
            toast({ title: 'KPI Plan created', description: `Effective from ${formatKpiMonthLabel(planFromMonth)}.` })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, companyId, loadPlans, planFromMonth, planLeaderBonus, planToMonth, selectedRunId])

    const patchPlan = useCallback(async (updates: Record<string, any>) => {
        if (!plan) return
        try {
            await callApi(`/api/roadtour/kpi/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify(updates) })
            await loadPlans()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, loadPlans, plan])

    const handleSaveTeam = useCallback(async () => {
        if (!plan || !configCycleId) return
        const target = Number(teamTarget || 0)
        if (!teamName.trim()) { toast({ title: 'Team name required', variant: 'destructive' }); return }
        if (leaderId && !memberIds.includes(leaderId)) { toast({ title: 'Leader must be a team member', variant: 'destructive' }); return }
        const members = memberIds.map((id) => ({
            am_user_id: id,
            manual_target_scans: manualOverride && manualTargets[id] !== undefined && manualTargets[id] !== ''
                ? Number(manualTargets[id]) : null,
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
                await callApi('/api/roadtour/kpi/teams', { method: 'POST', body: JSON.stringify({ ...payload, kpi_cycle_id: configCycleId }) })
            }
            await loadPlans()
            resetTeamBuilder()
            toast({ title: 'Team saved' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, configCycleId, editingTeamId, incentiveBudget, leaderId, loadPlans, manualOverride, manualTargets, memberIds, plan, resetTeamBuilder, teamName, teamTarget])

    const handleDeleteTeam = useCallback(async (teamId: string) => {
        if (!window.confirm('Delete this team and its member assignments?')) return
        try {
            await callApi(`/api/roadtour/kpi/teams/${teamId}`, { method: 'DELETE' })
            await loadPlans()
            if (editingTeamId === teamId) resetTeamBuilder()
            toast({ title: 'Team deleted' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, editingTeamId, loadPlans, resetTeamBuilder])

    const handleSaveTier = useCallback(async () => {
        if (!plan || !configCycleId) return
        const payload = {
            rule_name: tierForm.rule_name.trim() || (tierForm.applies_to === 'team_leader' ? 'Leader bonus' : 'AM incentive'),
            applies_to: tierForm.applies_to,
            team_id: null,
            achievement_threshold_percent: Number(tierForm.achievement_threshold_percent),
            incentive_amount: Number(tierForm.incentive_amount),
            bonus_type: 'cash',
            status: tierForm.status,
        }
        if (!Number.isFinite(payload.achievement_threshold_percent) || payload.achievement_threshold_percent <= 0) {
            toast({ title: 'Enter a valid achievement %', variant: 'destructive' }); return
        }
        if (!Number.isFinite(payload.incentive_amount) || payload.incentive_amount < 0) {
            toast({ title: 'Enter a valid amount', variant: 'destructive' }); return
        }
        try {
            setSaving(true)
            if (tierForm.id) {
                await callApi(`/api/roadtour/kpi/rules/${tierForm.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            } else {
                await callApi('/api/roadtour/kpi/rules', { method: 'POST', body: JSON.stringify({ ...payload, kpi_cycle_id: configCycleId }) })
            }
            await loadPlans()
            setTierDialogOpen(false)
            toast({ title: 'Incentive tier saved' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, configCycleId, loadPlans, plan, tierForm])

    const handleDeleteTier = useCallback(async (ruleId: string) => {
        if (!window.confirm('Delete this incentive tier?')) return
        try {
            await callApi(`/api/roadtour/kpi/rules/${ruleId}`, { method: 'DELETE' })
            await loadPlans()
            toast({ title: 'Incentive tier deleted' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }, [callApi, loadPlans])

    const handleActivate = useCallback(async () => {
        if (!plan) return
        if (!window.confirm('Activate this KPI Plan? Team members and targets will be frozen.')) return
        try {
            setSaving(true)
            await callApi(`/api/roadtour/kpi/plans/${plan.id}/activate`, { method: 'POST' })
            await loadPlans()
            toast({ title: 'KPI Plan activated', description: 'Members & targets are now frozen.' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, loadPlans, plan])

    const handleArchive = useCallback(async () => {
        if (!plan) return
        if (!window.confirm('Archive this KPI Plan? It will stop generating monthly reports and you can create a new plan for this event.')) return
        try {
            setSaving(true)
            await callApi(`/api/roadtour/kpi/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })
            await loadPlans()
            resetTeamBuilder()
            toast({ title: 'KPI Plan archived' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }, [callApi, loadPlans, plan, resetTeamBuilder])

    const summary = useMemo(() => {
        const teams = plan?.teams || []
        return {
            teams: teams.length,
            ams: teams.reduce((sum, t) => sum + t.members.length, 0),
            targetTotal: teams.reduce((sum, t) => sum + (t.monthly_team_target || 0), 0),
            budgetTotal: teams.reduce((sum, t) => sum + (Number(t.incentive_budget) || 0), 0),
        }
    }, [plan])

    const memberCount = memberIds.length
    const autoTargets = useMemo(() => autoDistributeTarget(Number(teamTarget || 0), memberCount), [teamTarget, memberCount])
    const perAmAuto = memberCount > 0 ? Math.floor(Number(teamTarget || 0) / memberCount) : 0

    const filteredAmOptions = useMemo(() => {
        const q = memberSearch.trim().toLowerCase()
        if (!q) return ams
        return ams.filter((a) => a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
    }, [ams, memberSearch])

    // Rule 4: leader options are limited to the members currently selected.
    const leaderOptions = useMemo(
        () => memberIds.map((id) => ({ id, name: amById.get(id)?.full_name || 'Unknown' })),
        [memberIds, amById],
    )

    const fromLabel = plan ? formatKpiMonthLabel(kpiMonthFromDate(plan.effective_from_month)) : ''
    const toLabel = plan?.effective_to_month ? formatKpiMonthLabel(kpiMonthFromDate(plan.effective_to_month)) : 'Open-ended'
    const currentPeriod = deriveKpiMonthPeriod(currentKpiMonth())

    if (!companyId) {
        return <Card><EmptyBlock title="Organization required" description="Your profile is not linked to an organization." /></Card>
    }

    return (
        <div className="space-y-4 pb-24">
            <PageHeader
                overline="RoadTour Settings"
                title="RoadTour KPI & Incentive Settings"
                description="Create a KPI Plan once per RoadTour Event. Monthly performance reports are generated automatically for every month in the plan window — no need to set up a new cycle each month."
            />

            {loading && <Card><LoadingBlock /></Card>}

            {!loading && schemaMissing && (
                <div className="border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-md px-3 py-2">
                    The RoadTour KPI Plan database migration has not been applied to this environment yet. Apply
                    supabase/migrations/20260707_roadtour_kpi_plan_refinement.sql to enable KPI Plans.
                </div>
            )}

            {!loading && (
                <>
                    {/* KPI Plan summary / creation */}
                    <Card className="border-blue-100 bg-blue-50/40">
                        <CardHeader className="pb-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4 text-blue-600" />
                                    {isActive ? 'Active KPI Plan' : 'KPI Plan'}
                                </CardTitle>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-[200px]">
                                        <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                                            <SelectTrigger className="h-9"><SelectValue placeholder="Select event" /></SelectTrigger>
                                            <SelectContent>
                                                {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {!plan && (
                                        <Button size="sm" onClick={() => { setPlanFromMonth(defaultFromMonth); setPlanToMonth(''); setPlanLeaderBonus(false); setPlanDialogOpen(true) }} disabled={saving || schemaMissing || !selectedRunId}>
                                            <Plus className="h-4 w-4 mr-1" /> Create KPI Plan
                                        </Button>
                                    )}
                                    {plan && (
                                        <Button size="sm" variant="outline" className="text-rose-600 border-rose-200" onClick={handleArchive} disabled={saving}>
                                            Archive Plan
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {plan ? (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7 text-sm">
                                    <div>
                                        <div className="text-xs text-muted-foreground">Event</div>
                                        <div className="font-semibold truncate">{selectedRun?.name || '—'}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Effective From</div>
                                        <div className="font-semibold">{fromLabel}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Effective To</div>
                                        <div className="font-semibold">{toLabel}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Status</div>
                                        <PlanStatusBadge status={plan.status} />
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Teams / AMs</div>
                                        <div className="text-lg font-bold">{summary.teams} / {summary.ams}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Monthly Target</div>
                                        <div className="text-lg font-bold">{summary.targetTotal.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">scans</span></div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Incentive Budget</div>
                                        <div className="text-lg font-bold">RM {summary.budgetTotal.toLocaleString()}</div>
                                    </div>
                                </div>
                            ) : (
                                <EmptyBlock
                                    title="No KPI Plan configured for this RoadTour Event"
                                    description="Create a KPI Plan once for this event. The monthly report is generated automatically for each month in the plan window."
                                />
                            )}
                        </CardContent>
                    </Card>

                    {plan && (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {/* Left column: plan window + team builder */}
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <SettingsIcon className="h-4 w-4 text-blue-600" /> KPI Plan Window
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Effective From Month</label>
                                            <Select value={kpiMonthFromDate(plan.effective_from_month)} onValueChange={(v) => patchPlan({ effective_from_month: v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {fromMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Effective To Month (optional)</label>
                                            <Select value={plan.effective_to_month ? kpiMonthFromDate(plan.effective_to_month) : 'none'} onValueChange={(v) => patchPlan({ effective_to_month: v === 'none' ? '' : v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">Open-ended</SelectItem>
                                                    {editToMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Reporting Scope</label>
                                            <Select value={plan.reporting_scope} onValueChange={(v) => patchPlan({ reporting_scope: v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all_campaigns">All surveys/shops under event</SelectItem>
                                                    <SelectItem value="selected_campaigns">Selected campaigns only</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <p className="text-xs text-muted-foreground">
                                        Month options are limited to recent setup months, the selected RoadTour Event period{eventHasFixedPeriod && selectedRun ? ` (${formatKpiMonthLabel(monthKeyFromDate(selectedRun.start_date) || '')} – ${formatKpiMonthLabel(monthKeyFromDate(selectedRun.end_date) || '')})` : ''}, and configured KPI data. Effective To must be on or after Effective From.
                                    </p>

                                    <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                                        <span className="flex items-center gap-2 text-blue-800">
                                            <CalendarDays className="h-4 w-4" /> Current Report Month (auto)
                                        </span>
                                        <span className="font-semibold text-blue-800">{formatKpiMonthLabel(currentKpiMonth())} · {currentPeriod.label}</span>
                                    </div>

                                    <div className="rounded-md border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-800">
                                        Reports are produced monthly from this single plan. Changing AM assignment affects new scans only; historical scans keep their original campaign/QR attribution.
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Users className="h-4 w-4 text-blue-600" /> Selected Team Detail / Team Builder
                                        </CardTitle>
                                        {editingTeamId && <Button size="sm" variant="ghost" onClick={resetTeamBuilder}>New Team</Button>}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="sm:col-span-1">
                                            <label className="text-xs font-medium text-muted-foreground">Team Name</label>
                                            <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. North Penang Team" disabled={isFrozen} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Leader</label>
                                            <Select value={leaderId || 'none'} onValueChange={(v) => setLeaderId(v === 'none' ? '' : v)} disabled={isFrozen || memberIds.length === 0}>
                                                <SelectTrigger><SelectValue placeholder={memberIds.length === 0 ? 'Select members first' : 'No leader'} /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No leader</SelectItem>
                                                    {leaderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
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
                                                        {!isFrozen && (
                                                            <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => setMemberIds((prev) => prev.filter((x) => x !== id))}>×</button>
                                                        )}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                        {!isFrozen && (
                                            <div className="border rounded-md">
                                                <Input className="border-0 border-b rounded-b-none focus-visible:ring-0" placeholder="Search account managers…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
                                                <div className="max-h-36 overflow-y-auto p-1">
                                                    {filteredAmOptions.length === 0 && <div className="text-xs text-muted-foreground px-2 py-2">No account managers found.</div>}
                                                    {filteredAmOptions.map((a) => {
                                                        const checked = memberIds.includes(a.id)
                                                        return (
                                                            <button key={a.id} type="button"
                                                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between hover:bg-muted ${checked ? 'bg-blue-50 text-blue-800' : ''}`}
                                                                onClick={() => setMemberIds((prev) => checked ? prev.filter((x) => x !== a.id) : [...prev, a.id])}>
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
                                            <Input type="number" min={0} value={teamTarget} onChange={(e) => setTeamTarget(e.target.value)} placeholder="e.g. 7000" disabled={isFrozen} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground">Incentive Budget (RM)</label>
                                            <Input type="number" min={0} value={incentiveBudget} onChange={(e) => setIncentiveBudget(e.target.value)} placeholder="e.g. 1600" />
                                        </div>
                                    </div>

                                    {memberCount > 0 && Number(teamTarget) > 0 && (
                                        <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-800">
                                            <span className="font-medium">Auto-distribution:</span>{' '}
                                            {memberCount} members × {perAmAuto.toLocaleString()} scans ≈ {Number(teamTarget).toLocaleString()}
                                        </div>
                                    )}

                                    <label className="flex items-center gap-2 text-sm">
                                        <Switch checked={manualOverride} onCheckedChange={setManualOverride} disabled={isFrozen} />
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
                                                            <Input type="number" min={0} className="h-7 w-24 text-right"
                                                                placeholder={String(autoTargets[i] ?? 0)}
                                                                value={manualTargets[id] ?? ''}
                                                                onChange={(e) => setManualTargets((prev) => ({ ...prev, [id]: e.target.value }))}
                                                                disabled={isFrozen} />
                                                        ) : (
                                                            <span className="text-muted-foreground">{(autoTargets[i] ?? 0).toLocaleString()} scans</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-end gap-2">
                                        <Button onClick={handleSaveTeam} disabled={saving || isFrozen}>
                                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                            {editingTeamId ? 'Update Team' : 'Add Team'}
                                        </Button>
                                    </div>
                                    {isFrozen && (
                                        <div className="text-xs text-amber-700">
                                            Members &amp; targets are frozen because this plan is active. Archive the plan to make structural changes.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right column: team structure + incentives + policy */}
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <BarChart3 className="h-4 w-4 text-blue-600" /> Team KPI Structure
                                        </CardTitle>
                                        <Button size="sm" variant="outline" onClick={resetTeamBuilder} disabled={isFrozen}>
                                            <Plus className="h-4 w-4 mr-1" /> Add Team
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {plan.teams.length === 0 ? (
                                        <EmptyBlock title="No teams yet" description="Use the Team Builder to add the first team for this KPI Plan." />
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Team Name</TableHead>
                                                        <TableHead>Leader</TableHead>
                                                        <TableHead className="text-right">Members</TableHead>
                                                        <TableHead className="text-right">Monthly Target</TableHead>
                                                        <TableHead className="text-right">Auto / AM</TableHead>
                                                        <TableHead className="text-right">Actions</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {plan.teams.map((t) => {
                                                        const autoPerAm = t.members.length > 0 ? Math.floor(t.monthly_team_target / t.members.length) : 0
                                                        return (
                                                            <TableRow key={t.id} className={editingTeamId === t.id ? 'bg-blue-50/50' : ''}>
                                                                <TableCell className="font-medium">{t.team_name}</TableCell>
                                                                <TableCell>{t.leader_user_id ? (amById.get(t.leader_user_id)?.full_name || '—') : '—'}</TableCell>
                                                                <TableCell className="text-right">{t.members.length}</TableCell>
                                                                <TableCell className="text-right">{t.monthly_team_target.toLocaleString()}</TableCell>
                                                                <TableCell className="text-right">{autoPerAm.toLocaleString()}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <div className="flex justify-end gap-1">
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => loadTeamIntoBuilder(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => handleDeleteTeam(t.id)} disabled={isFrozen}><Trash2 className="h-3.5 w-3.5" /></Button>
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

                            {/* AM Incentive Tiers */}
                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Wallet className="h-4 w-4 text-blue-600" /> AM Incentive Tiers
                                            </CardTitle>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Applies to every AM (including the leader). Based on the AM&apos;s actual scans vs their assigned monthly target.
                                                <span className="font-medium text-blue-700"> Highest achieved tier wins</span> — payouts are not stacked.
                                            </p>
                                        </div>
                                        <Button size="sm" variant="outline" onClick={() => { setTierForm(emptyTierForm('all_ams')); setTierDialogOpen(true) }}>
                                            <Plus className="h-4 w-4 mr-1" /> Add Tier
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {amTiers.length === 0 ? (
                                        <EmptyBlock title="No AM tiers yet" description="e.g. 100% = RM200, 120% = RM300, 140% = RM400." />
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Achievement</TableHead>
                                                    <TableHead className="text-right">Incentive</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead className="text-right">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {[...amTiers].sort((a, b) => Number(a.achievement_threshold_percent) - Number(b.achievement_threshold_percent)).map((r) => (
                                                    <TableRow key={r.id}>
                                                        <TableCell className="font-medium">{Number(r.achievement_threshold_percent)}% of target</TableCell>
                                                        <TableCell className="text-right">RM {Number(r.incentive_amount).toLocaleString()}</TableCell>
                                                        <TableCell>{r.status === 'active' ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-1">
                                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setTierForm({ id: r.id, rule_name: r.rule_name, applies_to: 'all_ams', achievement_threshold_percent: String(Number(r.achievement_threshold_percent)), incentive_amount: String(Number(r.incentive_amount)), status: r.status }); setTierDialogOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => handleDeleteTier(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Leader Bonus */}
                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Trophy className="h-4 w-4 text-amber-500" /> Leader Bonus
                                            </CardTitle>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Optional. When ON, the leader bonus is <span className="font-medium text-amber-700">additive</span> — paid on top of the leader&apos;s own AM incentive, based on total team achievement.
                                            </p>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                                            <Switch checked={plan.leader_bonus_enabled} onCheckedChange={(v) => patchPlan({ leader_bonus_enabled: v })} />
                                            {plan.leader_bonus_enabled ? 'On' : 'Off'}
                                        </label>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {!plan.leader_bonus_enabled ? (
                                        <div className="text-sm text-muted-foreground">Leader bonus is off. Turn it on to add team-achievement bonus tiers for team leaders.</div>
                                    ) : (
                                        <>
                                            <div className="flex justify-end mb-2">
                                                <Button size="sm" variant="outline" onClick={() => { setTierForm(emptyTierForm('team_leader')); setTierDialogOpen(true) }}>
                                                    <Plus className="h-4 w-4 mr-1" /> Add Bonus Tier
                                                </Button>
                                            </div>
                                            {leaderTiers.length === 0 ? (
                                                <EmptyBlock title="No leader bonus tiers yet" description="e.g. Team reaches 100% = RM500, 120% = RM800." />
                                            ) : (
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Team Achievement</TableHead>
                                                            <TableHead className="text-right">Bonus</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {[...leaderTiers].sort((a, b) => Number(a.achievement_threshold_percent) - Number(b.achievement_threshold_percent)).map((r) => (
                                                            <TableRow key={r.id}>
                                                                <TableCell className="font-medium">Team reaches {Number(r.achievement_threshold_percent)}%</TableCell>
                                                                <TableCell className="text-right">RM {Number(r.incentive_amount).toLocaleString()}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <div className="flex justify-end gap-1">
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setTierForm({ id: r.id, rule_name: r.rule_name, applies_to: 'team_leader', achievement_threshold_percent: String(Number(r.achievement_threshold_percent)), incentive_amount: String(Number(r.incentive_amount)), status: r.status }); setTierDialogOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
                                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => handleDeleteTier(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            )}
                                        </>
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
                    )}

                    {/* Footer actions */}
                    {plan && (
                        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 backdrop-blur px-4 py-3">
                            <div className="max-w-screen-2xl mx-auto flex justify-end gap-2">
                                <Button variant="outline" onClick={() => { resetTeamBuilder(); loadPlans() }} disabled={saving}>Cancel</Button>
                                <Button variant="outline" onClick={() => { loadPlans(); toast({ title: 'Draft saved', description: 'All changes are saved as you edit.' }) }} disabled={saving}>Save Draft</Button>
                                <Button onClick={handleActivate} disabled={plan.status !== 'draft' || saving}>
                                    {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                                    Activate KPI Plan
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Create KPI Plan dialog */}
                    <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader><DialogTitle>Create KPI Plan</DialogTitle></DialogHeader>
                            <div className="space-y-3">
                                <p className="text-xs text-muted-foreground">
                                    Create the plan once for <span className="font-medium">{selectedRun?.name || 'this event'}</span>. Monthly reports are generated automatically for each month in the window.
                                </p>
                                <div className="grid gap-3 grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Effective From Month</label>
                                        <Select value={planFromMonth} onValueChange={setPlanFromMonth}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {fromMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Effective To Month (optional)</label>
                                        <Select value={planToMonth || 'none'} onValueChange={(v) => setPlanToMonth(v === 'none' ? '' : v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Open-ended</SelectItem>
                                                {createToMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Month options are limited to recent setup months, the selected RoadTour Event period, and configured KPI data. Effective To must be on or after Effective From.
                                </p>
                                <label className="flex items-center gap-2 text-sm">
                                    <Switch checked={planLeaderBonus} onCheckedChange={setPlanLeaderBonus} />
                                    Enable leader bonus (additive, optional)
                                </label>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleCreatePlan} disabled={saving}>
                                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create Plan
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Incentive tier dialog */}
                    <Dialog open={tierDialogOpen} onOpenChange={setTierDialogOpen}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>
                                    {tierForm.id ? 'Edit' : 'Add'} {tierForm.applies_to === 'team_leader' ? 'Leader Bonus Tier' : 'AM Incentive Tier'}
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                                <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
                                    {tierForm.applies_to === 'team_leader'
                                        ? 'Leader bonus is additive and based on total team achievement.'
                                        : 'AM incentive uses highest-tier-wins based on the AM’s achievement vs target.'}
                                </div>
                                <div className="grid gap-3 grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">{tierForm.applies_to === 'team_leader' ? 'Team Achievement (%)' : 'Achievement (%)'}</label>
                                        <Input type="number" min={1} value={tierForm.achievement_threshold_percent} onChange={(e) => setTierForm((p) => ({ ...p, achievement_threshold_percent: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">{tierForm.applies_to === 'team_leader' ? 'Bonus (RM)' : 'Incentive (RM)'}</label>
                                        <Input type="number" min={0} value={tierForm.incentive_amount} onChange={(e) => setTierForm((p) => ({ ...p, incentive_amount: e.target.value }))} placeholder="e.g. 200" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                                    <Select value={tierForm.status} onValueChange={(v) => setTierForm((p) => ({ ...p, status: v }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setTierDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleSaveTier} disabled={saving}>
                                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save Tier
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </div>
    )
}
