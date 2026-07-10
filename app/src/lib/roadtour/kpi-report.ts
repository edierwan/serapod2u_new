/**
 * Monthly KPI Performance Report computation (server-side).
 *
 * Attribution rules:
 * - Actual scans = successful roadtour_scan_events within the selected KPI
 *   reporting window (weekly/monthly/quarterly/yearly), Malaysia time.
 * - Each scan counts for the AM snapshotted on the scan row at scan time
 *   (account_manager_user_id); historical attribution is never rewritten.
 * - Scans belong to the selected Event via the snapshotted roadtour_run_id,
 *   falling back to the campaign's current event for legacy rows. Campaigns
 *   created mid-month are automatically included.
 */

import {
    achievementPercent,
    amPerformanceStatus,
    attributeScans,
    computeAmIncentiveEarnings,
    computeLeaderBonus,
    deriveKpiPeriodWindow,
    effectiveIncentiveRules,
    isMonthInEffectiveRange,
    kpiMonthFromDate,
    normalizeAmIncentiveMode,
    teamPerformanceStatus,
    type KpiAmIncentiveMode,
    type KpiPeriodType,
    type KpiPerformanceStatus,
} from './kpi'

export interface KpiReportFilters {
    orgId: string
    kpiMonth: string
    periodType?: KpiPeriodType
    roadtourRunId: string
    teamId?: string | null
    leaderUserId?: string | null
    status?: KpiPerformanceStatus | null
}

export interface KpiReportSummary {
    total_team_target: number
    actual_scans: number
    overall_achievement_percent: number
    ams_achieved: number
    ams_total: number
    incentive_estimated_payout: number
    teams_on_track: number
    teams_total: number
    unassigned_scans: number
}

export interface KpiReportTeamRow {
    team_id: string
    team_name: string
    leader_user_id: string | null
    leader_name: string
    member_count: number
    team_target: number
    actual_scans: number
    achievement_percent: number
    incentive_budget: number
    estimated_payout: number
    status: KpiPerformanceStatus
}

export interface KpiReportAmRow {
    am_user_id: string
    am_name: string
    team_id: string
    team_name: string
    assigned_target: number
    actual_scans: number
    achievement_percent: number
    volume_tier_rate: number | null
    incentive_earned: number
    rank: number
    status: KpiPerformanceStatus
}

export interface KpiReportCampaignRow {
    rank: number
    campaign_id: string
    campaign_name: string
    team_name: string
    actual_scans: number
    percent_of_total: number
}

export interface KpiReport {
    cycle: {
        id: string
        kpi_month: string
        status: string
        period_label: string
        period_start: string
        period_end: string
        period_type: KpiPeriodType
        freeze_members_targets: boolean
        lock_campaign_qr_attribution: boolean
        am_incentive_mode: KpiAmIncentiveMode
    }
    summary: KpiReportSummary
    teams: KpiReportTeamRow[]
    ams: KpiReportAmRow[]
    top_campaigns: KpiReportCampaignRow[]
    chart_team_achievement: { team_name: string; target: number; actual: number; achievement_percent: number }[]
    chart_payout_by_team: { team_name: string; payout: number }[]
}

const SCAN_PAGE_SIZE = 1000

/**
 * Resolve the KPI configuration for a month/event.
 *
 * Preferred path: a durable KPI Plan whose effective window covers the month —
 * its config cycle supplies teams/rules and the report is auto-generated for
 * that month (no manual monthly cycle needed). leader_bonus_enabled comes from
 * the plan. Legacy fallback: a standalone cycle for the exact month.
 * Returns null when nothing is configured for the month.
 */
async function resolveKpiConfig(admin: any, filters: KpiReportFilters): Promise<{
    configCycleId: string
    leaderBonusEnabled: boolean
    amIncentiveMode: KpiAmIncentiveMode
    status: string
    freeze_members_targets: boolean
    lock_campaign_qr_attribution: boolean
} | null> {
    // KPI plans may not exist yet on un-migrated environments; ignore the error.
    const { data: plans, error: plansError } = await admin
        .from('roadtour_kpi_plans')
        .select('id, effective_from_month, effective_to_month, status, leader_bonus_enabled, am_incentive_mode, config_cycle_id, reporting_scope')
        .eq('org_id', filters.orgId)
        .eq('roadtour_run_id', filters.roadtourRunId)
        .neq('status', 'draft')
        .order('effective_from_month', { ascending: false })

    const planRows = plansError && String(plansError.message || '').toLowerCase().includes('am_incentive_mode')
        ? (await admin
            .from('roadtour_kpi_plans')
            .select('id, effective_from_month, effective_to_month, status, leader_bonus_enabled, config_cycle_id, reporting_scope')
            .eq('org_id', filters.orgId)
            .eq('roadtour_run_id', filters.roadtourRunId)
            .neq('status', 'draft')
            .order('effective_from_month', { ascending: false })).data
        : plans

    for (const plan of planRows || []) {
        if (!plan.config_cycle_id) continue
        const from = String(plan.effective_from_month).slice(0, 7)
        const to = plan.effective_to_month ? String(plan.effective_to_month).slice(0, 7) : null
        if (!isMonthInEffectiveRange(filters.kpiMonth, from, to)) continue
        return {
            configCycleId: plan.config_cycle_id,
            leaderBonusEnabled: Boolean(plan.leader_bonus_enabled),
            amIncentiveMode: normalizeAmIncentiveMode(plan.am_incentive_mode),
            status: plan.status,
            freeze_members_targets: true,
            lock_campaign_qr_attribution: true,
        }
    }

    // Legacy fallback — a cycle for the exact month. Note: we intentionally do
    // NOT reference the kpi_plan_id column here so the report still works on
    // environments where the first KPI migration is applied but this plan
    // refinement migration has not been run yet.
    const period = deriveKpiPeriodWindow(filters.kpiMonth, filters.periodType || 'monthly')
    const { data: cycle, error: cycleError } = await admin
        .from('roadtour_kpi_cycles')
        .select('id, status, freeze_members_targets, lock_campaign_qr_attribution')
        .eq('org_id', filters.orgId)
        .eq('roadtour_run_id', filters.roadtourRunId)
        .eq('kpi_month', period.periodStart)
        .maybeSingle()
    if (cycleError) throw cycleError
    if (!cycle) return null
    return {
        configCycleId: cycle.id,
        leaderBonusEnabled: true, // legacy cycles had no plan-level toggle
        amIncentiveMode: 'volume_tiers',
        status: cycle.status,
        freeze_members_targets: cycle.freeze_members_targets,
        lock_campaign_qr_attribution: cycle.lock_campaign_qr_attribution,
    }
}

/** Compute the monthly KPI report, or null when nothing is configured for the month/event. */
export async function computeKpiReport(admin: any, filters: KpiReportFilters): Promise<KpiReport | null> {
    const periodType = filters.periodType || 'monthly'
    const period = deriveKpiPeriodWindow(filters.kpiMonth, periodType)

    const config = await resolveKpiConfig(admin, filters)
    if (!config) return null
    const cycle = {
        id: config.configCycleId,
        status: config.status,
        freeze_members_targets: config.freeze_members_targets,
        lock_campaign_qr_attribution: config.lock_campaign_qr_attribution,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        kpi_month: period.periodStart,
    }

    const [teamsRes, membersRes, rulesRes, campaignsRes] = await Promise.all([
        admin.from('roadtour_kpi_teams').select('id, team_name, leader_user_id, monthly_team_target, incentive_budget, status').eq('kpi_cycle_id', cycle.id).order('created_at'),
        admin.from('roadtour_kpi_team_members').select('id, team_id, am_user_id, auto_target_scans, manual_target_scans, target_source').eq('kpi_cycle_id', cycle.id).order('created_at'),
        admin.from('roadtour_kpi_incentive_rules').select('id, team_id, rule_name, applies_to, achievement_threshold_percent, incentive_amount, bonus_type, status').eq('kpi_cycle_id', cycle.id),
        admin.from('roadtour_campaigns').select('id, name, roadtour_run_id').eq('org_id', filters.orgId).eq('roadtour_run_id', filters.roadtourRunId),
    ])
    for (const res of [teamsRes, membersRes, rulesRes, campaignsRes]) {
        if (res.error) throw res.error
    }
    const teams = teamsRes.data || []
    const members = membersRes.data || []
    // Leader-bonus tiers only count when the plan has leader bonus enabled.
    const rules = effectiveIncentiveRules(
        (rulesRes.data || []).map((r: any) => ({
            ...r,
            achievement_threshold_percent: Number(r.achievement_threshold_percent),
            incentive_amount: Number(r.incentive_amount),
        })),
        config.leaderBonusEnabled,
    )
    const campaigns = campaignsRes.data || []
    const campaignNameById = new Map<string, string>(campaigns.map((c: any) => [c.id, c.name]))
    const campaignIds = campaigns.map((c: any) => c.id)

    // Successful scans inside the KPI month attributed to this event. The
    // snapshotted roadtour_run_id wins; legacy rows fall back to campaign
    // membership. Paged to stay under PostgREST row limits.
    const scans: { account_manager_user_id: string; campaign_id: string }[] = []
    const campaignFilter = campaignIds.length > 0
        ? `roadtour_run_id.eq.${filters.roadtourRunId},and(roadtour_run_id.is.null,campaign_id.in.(${campaignIds.join(',')}))`
        : `roadtour_run_id.eq.${filters.roadtourRunId}`
    for (let page = 0; ; page++) {
        const { data, error } = await admin
            .from('roadtour_scan_events')
            .select('account_manager_user_id, campaign_id')
            .eq('scan_status', 'success')
            .gte('scan_time', period.scanTimeFrom)
            .lt('scan_time', period.scanTimeToExclusive)
            .or(campaignFilter)
            .order('id')
            .range(page * SCAN_PAGE_SIZE, (page + 1) * SCAN_PAGE_SIZE - 1)
        if (error) throw error
        scans.push(...(data || []))
        if (!data || data.length < SCAN_PAGE_SIZE) break
    }

    const teamIdByAm = new Map<string, string>()
    for (const m of members) teamIdByAm.set(m.am_user_id, m.team_id)
    // Attribution is driven purely by each scan's snapshotted AM, so multiple
    // campaigns per shop (e.g. an AM takeover) resolve to the right AM/team.
    const { scansByAm, scansByCampaign, scansByCampaignTeam } = attributeScans(scans, teamIdByAm)

    // Resolve display names for leaders + AMs.
    const userIds = [...new Set([...members.map((m: any) => m.am_user_id), ...teams.map((t: any) => t.leader_user_id).filter(Boolean)])]
    const nameById = new Map<string, string>()
    if (userIds.length > 0) {
        const { data: users, error: usersError } = await admin.from('users').select('id, full_name').in('id', userIds)
        if (usersError) throw usersError
        for (const u of users || []) nameById.set(u.id, u.full_name || 'Unknown')
    }
    const teamById = new Map<string, any>(teams.map((t: any) => [t.id, t]))

    const amIncentiveMode = config.amIncentiveMode
    const amRules = rules.filter((r) => r.applies_to === 'all_ams' || r.applies_to === 'specific_team')

    // AM rows.
    let amRows: Omit<KpiReportAmRow, 'rank'>[] = members.map((m: any) => {
        const team = teamById.get(m.team_id)
        const target = m.manual_target_scans ?? m.auto_target_scans
        const actual = scansByAm.get(m.am_user_id) || 0
        const percent = achievementPercent(actual, target)
        const maxIncentivePerAm = Number(team?.incentive_budget) || 0
        const earnings = computeAmIncentiveEarnings(amIncentiveMode, {
            actualScans: actual,
            achievementPercent: percent,
            amRules,
            teamId: m.team_id,
            maxIncentivePerAm,
        })
        return {
            am_user_id: m.am_user_id,
            am_name: nameById.get(m.am_user_id) || 'Unknown',
            team_id: m.team_id,
            team_name: team?.team_name || '—',
            assigned_target: target,
            actual_scans: actual,
            achievement_percent: percent,
            volume_tier_rate: earnings.volumeTierRate,
            incentive_earned: earnings.incentiveEarned,
            status: amPerformanceStatus(percent),
        }
    })

    // Team rows.
    let teamRows: KpiReportTeamRow[] = teams.map((t: any) => {
        const teamMembers = amRows.filter((a) => a.team_id === t.id)
        const actual = teamMembers.reduce((sum, a) => sum + a.actual_scans, 0)
        const percent = achievementPercent(actual, t.monthly_team_target)
        const memberPayout = teamMembers.reduce((sum, a) => sum + a.incentive_earned, 0)
        const leaderBonus = computeLeaderBonus(rules, percent, t.id)
        return {
            team_id: t.id,
            team_name: t.team_name,
            leader_user_id: t.leader_user_id,
            leader_name: t.leader_user_id ? (nameById.get(t.leader_user_id) || 'Unknown') : '—',
            member_count: teamMembers.length,
            team_target: t.monthly_team_target,
            actual_scans: actual,
            achievement_percent: percent,
            incentive_budget: Number(t.incentive_budget) || 0,
            estimated_payout: memberPayout + leaderBonus,
            status: teamPerformanceStatus(percent),
        }
    })

    // Optional filters narrow the team/AM tables (and the summary follows).
    if (filters.teamId) teamRows = teamRows.filter((t) => t.team_id === filters.teamId)
    if (filters.leaderUserId) teamRows = teamRows.filter((t) => t.leader_user_id === filters.leaderUserId)
    if (filters.status) teamRows = teamRows.filter((t) => t.status === filters.status)
    const visibleTeamIds = new Set(teamRows.map((t) => t.team_id))
    amRows = amRows.filter((a) => visibleTeamIds.has(a.team_id))

    const rankedAms: KpiReportAmRow[] = [...amRows]
        .sort((a, b) => b.achievement_percent - a.achievement_percent || b.actual_scans - a.actual_scans)
        .map((a, i) => ({ ...a, rank: i + 1 }))

    const assignedAmIds = new Set(members.map((m: any) => m.am_user_id))
    const unassignedScans = [...scansByAm.entries()].reduce((sum, [amId, count]) => (assignedAmIds.has(amId) ? sum : sum + count), 0)

    const totalTarget = teamRows.reduce((sum, t) => sum + t.team_target, 0)
    const teamActualTotal = teamRows.reduce((sum, t) => sum + t.actual_scans, 0)
    const summary: KpiReportSummary = {
        total_team_target: totalTarget,
        actual_scans: teamActualTotal,
        overall_achievement_percent: achievementPercent(teamActualTotal, totalTarget),
        ams_achieved: rankedAms.filter((a) => a.achievement_percent >= 100).length,
        ams_total: rankedAms.length,
        incentive_estimated_payout: teamRows.reduce((sum, t) => sum + t.estimated_payout, 0),
        teams_on_track: teamRows.filter((t) => t.status === 'achieved' || t.status === 'on_track').length,
        teams_total: teamRows.length,
        unassigned_scans: unassignedScans,
    }

    const totalScans = scans.length
    const topCampaigns: KpiReportCampaignRow[] = [...scansByCampaign.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([campaignId, count], i) => {
            const perTeam = scansByCampaignTeam.get(campaignId)
            let topTeamName = '—'
            if (perTeam && perTeam.size > 0) {
                const [topTeamId] = [...perTeam.entries()].sort((a, b) => b[1] - a[1])[0]
                topTeamName = teamById.get(topTeamId)?.team_name || '—'
            }
            return {
                rank: i + 1,
                campaign_id: campaignId,
                campaign_name: campaignNameById.get(campaignId) || 'Unknown campaign',
                team_name: topTeamName,
                actual_scans: count,
                percent_of_total: totalScans > 0 ? (count / totalScans) * 100 : 0,
            }
        })

    return {
        cycle: {
            id: cycle.id,
            kpi_month: kpiMonthFromDate(cycle.kpi_month),
            status: cycle.status,
            period_label: period.label,
            period_start: cycle.period_start,
            period_end: cycle.period_end,
            period_type: periodType,
            freeze_members_targets: cycle.freeze_members_targets,
            lock_campaign_qr_attribution: cycle.lock_campaign_qr_attribution,
            am_incentive_mode: amIncentiveMode,
        },
        summary,
        teams: teamRows,
        ams: rankedAms,
        top_campaigns: topCampaigns,
        chart_team_achievement: teamRows.map((t) => ({
            team_name: t.team_name,
            target: t.team_target,
            actual: t.actual_scans,
            achievement_percent: t.achievement_percent,
        })),
        chart_payout_by_team: teamRows.map((t) => ({ team_name: t.team_name, payout: t.estimated_payout })),
    }
}
