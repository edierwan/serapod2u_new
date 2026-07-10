'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/use-toast'
import {
    CalendarDays, CheckCircle2, Loader2, Pencil, Plus,
    Settings as SettingsIcon, ShieldCheck, Trash2, Trophy, Users, Wallet,
} from 'lucide-react'
import { fetchRoadtourRuns, type RoadtourRun } from '@/lib/roadtour/events'
import {
    autoDistributeTarget, compareKpiMonth, currentKpiMonth, deriveEffectiveFromOptions,
    deriveEffectiveToOptions, deriveKpiMonthPeriod, formatKpiMonthLabel, kpiMonthFromDate,
    monthKeyFromDate, resolveLeaderId, validateAmIncentiveTier,
} from '@/lib/roadtour/kpi'
import type { KpiAmOption, KpiPlanRow, KpiTeamRow } from '@/modules/roadtour/types/kpi'
import { EmptyBlock, LoadingBlock, PageHeader } from './analytics/shared'
import { AmIncentiveSettingsSection } from './AmIncentiveSettingsSection'
import { KpiFieldLabel, KpiHintBanner, kpiSubTabListClass, kpiSubTabTriggerClass, KpiSettingsSectionCard, KpiSettingsTabsPanel, kpiTabListClass, kpiTabTriggerClass, KpiTeamSidebar, KpiTierRow } from './KpiSettingsUi'

interface Props { userProfile: any; onViewChange: (viewId: string) => void }

const POLICY_RULES = [
    'A KPI Plan is created once per RoadTour Event and reused every month.',
    'Monthly reports are generated automatically for each month in the plan window.',
    'Team/member structure is frozen after the plan is activated.',
    'For shop recovery or AM takeover, create a new Campaign under the same Event — not a new Event.',
    'New campaign QR scans count to the new campaign/AM.',
    'Historical scan attribution is not rewritten when the AM or campaign changes.',
    'Leader bonus is optional and additive; the AM incentive cap applies only to individual AM incentive.',
    'AM KPI incentive uses fixed volume tiers: monthly scans × RM/scan rate (below 10,001 scans = RM 0).',
    'Point value (RM) follows the same volume tiers as KPI incentive.',
]

/** Highlighted note explaining the shop-recovery / AM-takeover workflow. */
const RECOVERY_NOTE = 'For shop recovery or AM takeover, create a new Campaign under the same RoadTour Event. New campaign QR scans count to the new AM; historical scans remain with the original campaign/AM.'

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
    const [maxIncentivePerAm, setMaxIncentivePerAm] = useState('')
    const [manualOverride, setManualOverride] = useState(false)
    const [manualTargets, setManualTargets] = useState<Record<string, string>>({})
    const [memberSearch, setMemberSearch] = useState('')

    // Incentive tier dialog state.
    const [tierDialogOpen, setTierDialogOpen] = useState(false)
    const [tierForm, setTierForm] = useState<TierFormState>(emptyTierForm('all_ams'))
    const [settingsTab, setSettingsTab] = useState<'setup' | 'teams' | 'incentives' | 'rules'>('setup')

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

    // Per-AM incentive cap for tier validation: the highest Max Incentive / AM
    // configured across the plan's teams (a tier must be payable to at least the
    // best-capped AM). Runtime clamps each AM to their own team's cap.
    const maxIncentiveCap = useMemo(
        () => (plan?.teams || []).reduce((max, t) => Math.max(max, Number(t.incentive_budget) || 0), 0),
        [plan],
    )

    // Live validation for the incentive tier dialog. AM tiers must be capped and
    // strictly monotonic (shared logic with the API); leader tiers only need a
    // positive threshold + amount. Save is disabled while this is non-null.
    const tierError = useMemo<string | null>(() => {
        const threshold = Number(tierForm.achievement_threshold_percent)
        const amount = Number(tierForm.incentive_amount)
        if (tierForm.incentive_amount.trim() === '' || !Number.isFinite(amount)) return 'Enter an incentive amount.'
        if (tierForm.applies_to === 'team_leader') {
            if (!Number.isFinite(threshold) || threshold <= 0) return 'Team achievement % must be greater than 0.'
            if (amount <= 0) return 'Bonus amount must be greater than RM0.'
            return null
        }
        return validateAmIncentiveTier(
            { id: tierForm.id, achievement_threshold_percent: threshold, incentive_amount: amount },
            amTiers.map((r: any) => ({ id: r.id, achievement_threshold_percent: Number(r.achievement_threshold_percent), incentive_amount: Number(r.incentive_amount) })),
            maxIncentiveCap,
        )
    }, [tierForm, amTiers, maxIncentiveCap])

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
        setMaxIncentivePerAm('')
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
        setMaxIncentivePerAm(team.incentive_budget ? String(team.incentive_budget) : '')
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

    const selectTeamForEdit = useCallback((team: KpiTeamRow) => {
        loadTeamIntoBuilder(team)
        setSettingsTab('teams')
    }, [loadTeamIntoBuilder])

    const startNewTeam = useCallback(() => {
        resetTeamBuilder()
        setSettingsTab('teams')
    }, [resetTeamBuilder])

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
            const json = await callApi(`/api/roadtour/kpi/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify(updates) })
            await loadPlans()
            if (json.schemaWarning) {
                toast({ title: 'Migration required', description: json.schemaWarning, variant: 'destructive' })
            }
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
            max_incentive_per_am: Number(maxIncentivePerAm || 0),
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
    }, [callApi, configCycleId, editingTeamId, maxIncentivePerAm, leaderId, loadPlans, manualOverride, manualTargets, memberIds, plan, resetTeamBuilder, teamName, teamTarget])

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
        if (tierError) {
            toast({ title: 'Invalid incentive tier', description: tierError, variant: 'destructive' }); return
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
    }, [callApi, configCycleId, loadPlans, plan, tierForm, tierError])

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
        <div className="space-y-6 pb-28">
            <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-slate-50/80 via-background to-brand-muted/50 p-5 shadow-sm dark:from-slate-900/40 dark:to-brand-muted/10 sm:p-6">
                <PageHeader
                    overline="RoadTour Settings"
                    title="RoadTour KPI & Incentive Settings"
                    description="Create a KPI Plan once per RoadTour Event. Monthly performance reports are generated automatically for every month in the plan window — no need to set up a new cycle each month."
                />
            </div>

            {loading && (
                <Card className="rounded-2xl border-border/70 shadow-sm">
                    <LoadingBlock />
                </Card>
            )}

            {!loading && schemaMissing && (
                <KpiHintBanner tone="amber">
                    The RoadTour KPI Plan database migration has not been applied to this environment yet. Apply
                    supabase/migrations/20260707_roadtour_kpi_plan_refinement.sql to enable KPI Plans.
                </KpiHintBanner>
            )}

            {!loading && (
                <>
                    <Card className="overflow-hidden rounded-2xl border-border/70 bg-card shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                        <div className="border-b border-border/60 bg-gradient-to-r from-brand-muted/35 via-background to-muted/30 px-5 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand/30 bg-brand-muted/80 shadow-sm">
                                        <CalendarDays className="h-4.5 w-4.5 text-brand" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-base font-semibold text-foreground">{isActive ? 'Active KPI Plan' : 'KPI Plan'}</h2>
                                        <p className="text-sm text-muted-foreground">One plan per RoadTour event</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-[210px]">
                                        <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                                            <SelectTrigger className="h-9 border-border/70 bg-background">
                                                <SelectValue placeholder="Select event" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {runs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {!plan && (
                                        <Button
                                            size="sm"
                                            className="bg-brand text-white hover:bg-brand/90"
                                            onClick={() => { setPlanFromMonth(defaultFromMonth); setPlanToMonth(''); setPlanLeaderBonus(false); setPlanDialogOpen(true) }}
                                            disabled={saving || schemaMissing || !selectedRunId}
                                        >
                                            <Plus className="h-4 w-4 mr-1" /> Create KPI Plan
                                        </Button>
                                    )}
                                    {plan && (
                                        <Button size="sm" variant="outline" className="border-border/70 bg-background/90 hover:bg-muted/60" onClick={handleArchive} disabled={saving}>
                                            Archive Plan
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <CardContent className="bg-gradient-to-b from-background to-muted/[0.18] p-4 sm:p-5">
                            {plan ? (
                                <div className="grid gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Event</p>
                                        <p className="font-semibold truncate">{selectedRun?.name || '—'}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Window</p>
                                        <p className="font-semibold">{fromLabel} → {toLabel}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p>
                                        <div className="mt-0.5"><PlanStatusBadge status={plan.status} /></div>
                                    </div>
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Teams / AMs</p>
                                        <p className="font-semibold tabular-nums">{summary.teams} / {summary.ams}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly target</p>
                                        <p className="font-semibold tabular-nums">{summary.targetTotal.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">scans</span></p>
                                    </div>
                                    <div className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Max / AM</p>
                                        <p className="font-semibold tabular-nums">RM {summary.budgetTotal.toLocaleString()}</p>
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
                    <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as typeof settingsTab)} className="w-full">
                        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                            <TabsList className={kpiTabListClass}>
                                <TabsTrigger value="setup" className={kpiTabTriggerClass}>
                                    <SettingsIcon className="h-4 w-4 shrink-0" />
                                    <span>Plan setup</span>
                                </TabsTrigger>
                                <TabsTrigger value="teams" className={kpiTabTriggerClass}>
                                    <Users className="h-4 w-4 shrink-0" />
                                    <span>Teams</span>
                                </TabsTrigger>
                                <TabsTrigger value="incentives" className={kpiTabTriggerClass}>
                                    <Wallet className="h-4 w-4 shrink-0" />
                                    <span>Incentives</span>
                                </TabsTrigger>
                                <TabsTrigger value="rules" className={kpiTabTriggerClass}>
                                    <ShieldCheck className="h-4 w-4 shrink-0" />
                                    <span>Rules</span>
                                </TabsTrigger>
                            </TabsList>

                            <KpiSettingsTabsPanel>
                        <TabsContent value="setup" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                            <KpiSettingsSectionCard
                                icon={SettingsIcon}
                                tone="slate"
                                title="KPI Plan Window"
                                description="When monthly reports run and which campaigns they include."
                                contentClassName="space-y-4"
                            >
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div>
                                        <KpiFieldLabel>Effective From Month</KpiFieldLabel>
                                        <Select value={kpiMonthFromDate(plan.effective_from_month)} onValueChange={(v) => patchPlan({ effective_from_month: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {fromMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <KpiFieldLabel>Effective To Month (optional)</KpiFieldLabel>
                                        <Select value={plan.effective_to_month ? kpiMonthFromDate(plan.effective_to_month) : 'none'} onValueChange={(v) => patchPlan({ effective_to_month: v === 'none' ? '' : v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Open-ended</SelectItem>
                                                {editToMonthOptions.map((m) => <SelectItem key={m} value={m}>{formatKpiMonthLabel(m)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <KpiFieldLabel>Reporting Scope</KpiFieldLabel>
                                        <Select value={plan.reporting_scope} onValueChange={(v) => patchPlan({ reporting_scope: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all_campaigns">All surveys/shops under event</SelectItem>
                                                <SelectItem value="selected_campaigns">Selected campaigns only</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    Month options are limited to recent setup months, the selected RoadTour Event period{eventHasFixedPeriod && selectedRun ? ` (${formatKpiMonthLabel(monthKeyFromDate(selectedRun.start_date) || '')} – ${formatKpiMonthLabel(monthKeyFromDate(selectedRun.end_date) || '')})` : ''}, and configured KPI data. Effective To must be on or after Effective From.
                                </p>

                                <KpiHintBanner tone="blue" className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 font-medium">
                                        <CalendarDays className="h-4 w-4 shrink-0" /> Current Report Month (auto)
                                    </span>
                                    <span className="font-semibold">{formatKpiMonthLabel(currentKpiMonth())} · {currentPeriod.label}</span>
                                </KpiHintBanner>

                                <KpiHintBanner tone="sky">
                                    Reports are produced monthly from this single plan. Changing AM assignment affects new scans only; historical scans keep their original campaign/QR attribution.
                                </KpiHintBanner>
                            </KpiSettingsSectionCard>
                        </TabsContent>

                        <TabsContent value="teams" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                            <div className="grid w-full gap-4 lg:grid-cols-[minmax(260px,320px)_1fr] lg:items-start">
                                <KpiTeamSidebar
                                    teams={plan.teams}
                                    selectedTeamId={editingTeamId}
                                    amById={amById}
                                    isFrozen={isFrozen}
                                    onSelectTeam={selectTeamForEdit}
                                    onAddTeam={startNewTeam}
                                    onDeleteTeam={handleDeleteTeam}
                                />

                                <KpiSettingsSectionCard
                                    icon={Users}
                                    tone="violet"
                                    title={editingTeamId ? 'Edit Team' : 'New Team'}
                                    description="Select a team on the left or create a new one."
                                    headerAction={editingTeamId ? <Button size="sm" variant="outline" onClick={startNewTeam}>New Team</Button> : undefined}
                                    contentClassName="space-y-4"
                                >
                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <div className="sm:col-span-1">
                                            <KpiFieldLabel>Team Name</KpiFieldLabel>
                                            <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. North Penang Team" disabled={isFrozen} />
                                        </div>
                                        <div>
                                            <KpiFieldLabel>Leader</KpiFieldLabel>
                                            <Select value={leaderId || 'none'} onValueChange={(v) => setLeaderId(v === 'none' ? '' : v)} disabled={isFrozen || memberIds.length === 0}>
                                                <SelectTrigger><SelectValue placeholder={memberIds.length === 0 ? 'Select members first' : 'No leader'} /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No leader</SelectItem>
                                                    {leaderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <KpiFieldLabel>Member Count</KpiFieldLabel>
                                            <div className="flex h-10 items-center">
                                                <Badge variant="secondary" className="text-sm">{memberCount} AMs</Badge>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <KpiFieldLabel>Members</KpiFieldLabel>
                                        {memberIds.length > 0 && (
                                            <div className="my-1.5 flex flex-wrap gap-1.5">
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
                                            <div className="overflow-hidden rounded-xl border border-border/70">
                                                <Input className="rounded-none border-0 border-b bg-muted/20 focus-visible:ring-0" placeholder="Search account managers…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
                                                <div className="max-h-40 overflow-y-auto p-1.5">
                                                    {filteredAmOptions.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">No account managers found.</div>}
                                                    {filteredAmOptions.map((a) => {
                                                        const checked = memberIds.includes(a.id)
                                                        return (
                                                            <button key={a.id} type="button"
                                                                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted ${checked ? 'bg-brand-muted text-brand-charcoal ring-1 ring-brand/25 dark:text-brand' : ''}`}
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

                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <KpiFieldLabel>Monthly Team Target (scans)</KpiFieldLabel>
                                            <Input type="number" min={0} value={teamTarget} onChange={(e) => setTeamTarget(e.target.value)} placeholder="e.g. 7000" disabled={isFrozen} />
                                        </div>
                                        <div>
                                            <KpiFieldLabel>Max Incentive / AM (RM)</KpiFieldLabel>
                                            <Input type="number" min={0} value={maxIncentivePerAm} onChange={(e) => setMaxIncentivePerAm(e.target.value)} placeholder="e.g. 500" />
                                        </div>
                                    </div>

                                    {memberCount > 0 && Number(teamTarget) > 0 && (
                                        <KpiHintBanner tone="indigo">
                                            <span className="font-semibold">Auto-distribution:</span>{' '}
                                            {memberCount} members × {perAmAuto.toLocaleString()} scans ≈ {Number(teamTarget).toLocaleString()}
                                        </KpiHintBanner>
                                    )}

                                    <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5 text-sm">
                                        <Switch checked={manualOverride} onCheckedChange={setManualOverride} disabled={isFrozen} />
                                        <span>Allow manual AM target override</span>
                                    </label>

                                    {memberCount > 0 && (
                                        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
                                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Per-AM target {manualOverride ? '(manual)' : '(auto)'}
                                            </p>
                                            <div className="space-y-1.5">
                                                {memberIds.map((id, i) => (
                                                    <div key={id} className="flex items-center justify-between gap-2 text-sm">
                                                        <span className="truncate">{amById.get(id)?.full_name || 'Unknown'}</span>
                                                        {manualOverride ? (
                                                            <Input type="number" min={0} className="h-8 w-28 text-right"
                                                                placeholder={String(autoTargets[i] ?? 0)}
                                                                value={manualTargets[id] ?? ''}
                                                                onChange={(e) => setManualTargets((prev) => ({ ...prev, [id]: e.target.value }))}
                                                                disabled={isFrozen} />
                                                        ) : (
                                                            <span className="tabular-nums text-muted-foreground">{(autoTargets[i] ?? 0).toLocaleString()} scans</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
                                        <Button onClick={handleSaveTeam} disabled={saving || isFrozen}>
                                            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                            {editingTeamId ? 'Update Team' : 'Add Team'}
                                        </Button>
                                    </div>
                                    {isFrozen && (
                                        <KpiHintBanner tone="amber" className="text-xs">
                                            Members &amp; targets are frozen because this plan is active. Archive the plan to make structural changes.
                                        </KpiHintBanner>
                                    )}
                                </KpiSettingsSectionCard>
                            </div>
                        </TabsContent>

                        <TabsContent value="incentives" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                            <div className="grid w-full gap-5 xl:grid-cols-2 xl:items-start">
                            <AmIncentiveSettingsSection
                                mode={(plan.am_incentive_mode || 'volume_tiers') as 'volume_tiers' | 'achievement_tiers'}
                                amTiers={amTiers}
                                onModeChange={(m) => patchPlan({ am_incentive_mode: m })}
                                onAddTier={() => { setTierForm(emptyTierForm('all_ams')); setTierDialogOpen(true) }}
                                onEditTier={(r) => {
                                    setTierForm({
                                        id: r.id,
                                        rule_name: r.rule_name,
                                        applies_to: 'all_ams',
                                        achievement_threshold_percent: String(Number(r.achievement_threshold_percent)),
                                        incentive_amount: String(Number(r.incentive_amount)),
                                        status: r.status,
                                    })
                                    setTierDialogOpen(true)
                                }}
                                onDeleteTier={handleDeleteTier}
                            />

                            <KpiSettingsSectionCard
                                icon={Trophy}
                                tone="amber"
                                title="Leader Bonus"
                                description="Optional additive bonus for team leaders."
                                headerAction={
                                    <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-1.5 text-sm">
                                        <Switch checked={plan.leader_bonus_enabled} onCheckedChange={(v) => patchPlan({ leader_bonus_enabled: v })} />
                                        {plan.leader_bonus_enabled ? 'On' : 'Off'}
                                    </label>
                                }
                                contentClassName="space-y-4"
                            >
                                {!plan.leader_bonus_enabled ? (
                                    <p className="text-sm text-muted-foreground">Leader bonus is off. Turn it on to add team-achievement bonus tiers.</p>
                                ) : (
                                    <>
                                        <div className="flex justify-end">
                                            <Button size="sm" onClick={() => { setTierForm(emptyTierForm('team_leader')); setTierDialogOpen(true) }}>
                                                <Plus className="h-4 w-4 mr-1" /> Add Bonus Tier
                                            </Button>
                                        </div>
                                        {leaderTiers.length === 0 ? (
                                            <EmptyBlock title="No leader bonus tiers yet" description="e.g. Team reaches 100% = RM500, 120% = RM800." />
                                        ) : (
                                            <div className="space-y-2">
                                                {[...leaderTiers].sort((a, b) => Number(a.achievement_threshold_percent) - Number(b.achievement_threshold_percent)).map((r) => (
                                                    <KpiTierRow
                                                        key={r.id}
                                                        title={`Team reaches ${Number(r.achievement_threshold_percent)}%`}
                                                        subtitle={`Bonus RM ${Number(r.incentive_amount).toLocaleString()}`}
                                                        actions={
                                                            <>
                                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setTierForm({ id: r.id, rule_name: r.rule_name, applies_to: 'team_leader', achievement_threshold_percent: String(Number(r.achievement_threshold_percent)), incentive_amount: String(Number(r.incentive_amount)), status: r.status }); setTierDialogOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
                                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => handleDeleteTier(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                                            </>
                                                        }
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </KpiSettingsSectionCard>
                            </div>
                        </TabsContent>

                        <TabsContent value="rules" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                            <KpiSettingsSectionCard
                                icon={ShieldCheck}
                                tone="slate"
                                title="KPI Policy & Attribution Rules"
                                description="Reference — how plans, reports, and scan attribution work."
                                contentClassName="space-y-4"
                            >
                                <ul className="grid w-full gap-2.5 sm:grid-cols-2">
                                    {POLICY_RULES.map((rule) => (
                                        <li key={rule} className="flex items-start gap-2.5 rounded-lg bg-muted/15 px-3 py-2.5 text-sm">
                                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                            <span className="leading-relaxed">{rule}</span>
                                        </li>
                                    ))}
                                </ul>
                                <KpiHintBanner tone="amber" className="text-xs">
                                    {RECOVERY_NOTE}
                                </KpiHintBanner>
                            </KpiSettingsSectionCard>
                        </TabsContent>
                            </KpiSettingsTabsPanel>
                        </div>
                    </Tabs>
                    )}

                    {/* Footer actions */}
                    {plan && (
                        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border/70 bg-background/90 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] backdrop-blur-md">
                            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
                                <div className="text-sm text-muted-foreground">
                                    {plan.status === 'draft'
                                        ? 'Draft plan — review teams and incentives, then activate when ready.'
                                        : 'Active plan — structural team changes are frozen until archived.'}
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => { resetTeamBuilder(); loadPlans() }} disabled={saving}>Cancel</Button>
                                    <Button variant="outline" onClick={() => { loadPlans(); toast({ title: 'Draft saved', description: 'All changes are saved as you edit.' }) }} disabled={saving}>Save Draft</Button>
                                    <Button onClick={handleActivate} disabled={plan.status !== 'draft' || saving}>
                                        {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                                        Activate KPI Plan
                                    </Button>
                                </div>
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
                                <div className="rounded-md border border-brand/20 bg-brand-muted/60 px-3 py-2 text-xs text-brand-charcoal dark:text-brand">
                                    {tierForm.applies_to === 'team_leader'
                                        ? 'Leader bonus is additive and based on total team achievement.'
                                        : `AM incentive uses fixed volume tiers (monthly scans × RM/scan). Max Incentive / AM${maxIncentiveCap > 0 ? ` (RM${maxIncentiveCap.toLocaleString()})` : ''} caps the payout after tier calculation.`}
                                </div>
                                <div className="grid gap-3 grid-cols-2">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">{tierForm.applies_to === 'team_leader' ? 'Team Achievement (%)' : 'Achievement (%)'}</label>
                                        <Input type="number" min={tierForm.applies_to === 'team_leader' ? 1 : 100} value={tierForm.achievement_threshold_percent} onChange={(e) => setTierForm((p) => ({ ...p, achievement_threshold_percent: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">{tierForm.applies_to === 'team_leader' ? 'Bonus (RM)' : 'Incentive (RM)'}</label>
                                        <Input type="number" min={0} value={tierForm.incentive_amount} onChange={(e) => setTierForm((p) => ({ ...p, incentive_amount: e.target.value }))} placeholder="e.g. 200" />
                                    </div>
                                </div>
                                {tierError && (
                                    <p className="text-xs text-red-600">{tierError}</p>
                                )}
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
                                <Button onClick={handleSaveTier} disabled={saving || Boolean(tierError)}>
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
