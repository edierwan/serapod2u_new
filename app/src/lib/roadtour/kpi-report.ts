/**
 * Monthly KPI Performance Report computation (server-side).
 *
 * Attribution rules:
 * - Actual scans = successful roadtour_scan_events within the KPI month
 *   (calendar month boundaries, Malaysia time).
 * - Each scan counts for the AM snapshotted on the scan row at scan time
 *   (account_manager_user_id); historical attribution is never rewritten.
 * - Scans belong to the selected Event via the snapshotted roadtour_run_id,
 *   falling back to the campaign's current event for legacy rows. Campaigns
 *   created mid-month are automatically included.
 */

import {
    achievementPercent,
    amPerformanceStatus,
    computeAmIncentive,
    computeLeaderBonus,
    deriveKpiMonthPeriod,
    kpiMonthFromDate,
    teamPerformanceStatus,
    type KpiPerformanceStatus,
} from './kpi'

export interface KpiReportFilters {
    orgId: string
    kpiMonth: string
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
        freeze_members_targets: boolean
        lock_campaign_qr_attribution: boolean
    }
    summary: KpiReportSummary
    teams: KpiReportTeamRow[]
    ams: KpiReportAmRow[]
    top_campaigns: KpiReportCampaignRow[]
    chart_team_achievement: { team_name: string; target: number; actual: number; achievement_percent: number }[]
    chart_payout_by_team: { team_name: string; payout: number }[]
}

const SCAN_PAGE_SIZE = 1000

/** Compute the monthly KPI report, or null when no cycle exists for the month/event. */
export async function computeKpiReport(admin: any, filters: KpiReportFilters): Promise<KpiReport | null> {
    const period = deriveKpiMonthPeriod(filters.kpiMonth)

    const { data: cycle, error: cycleError } = await admin
        .from('roadtour_kpi_cycles')
        .select('id, org_id, roadtour_run_id, kpi_month, period_start, period_end, status, freeze_members_targets, lock_campaign_qr_attribution')
        .eq('org_id', filters.orgId)
        .eq('roadtour_run_id', filters.roadtourRunId)
        .eq('kpi_month', period.periodStart)
        .maybeSingle()
    if (cycleError) throw cycleError
    if (!cycle) return null

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
    const rules = (rulesRes.data || []).map((r: any) => ({
        ...r,
        achievement_threshold_percent: Number(r.achievement_threshold_percent),
        incentive_amount: Number(r.incentive_amount),
    }))
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

    const scansByAm = new Map<string, number>()
    const scansByCampaign = new Map<string, number>()
    const scansByCampaignTeam = new Map<string, Map<string, number>>()
    const teamIdByAm = new Map<string, string>()
    for (const m of members) teamIdByAm.set(m.am_user_id, m.team_id)

    for (const scan of scans) {
        scansByAm.set(scan.account_manager_user_id, (scansByAm.get(scan.account_manager_user_id) || 0) + 1)
        scansByCampaign.set(scan.campaign_id, (scansByCampaign.get(scan.campaign_id) || 0) + 1)
        const teamId = teamIdByAm.get(scan.account_manager_user_id)
        if (teamId) {
            const perTeam = scansByCampaignTeam.get(scan.campaign_id) || new Map<string, number>()
            perTeam.set(teamId, (perTeam.get(teamId) || 0) + 1)
            scansByCampaignTeam.set(scan.campaign_id, perTeam)
        }
    }

    // Resolve display names for leaders + AMs.
    const userIds = [...new Set([...members.map((m: any) => m.am_user_id), ...teams.map((t: any) => t.leader_user_id).filter(Boolean)])]
    const nameById = new Map<string, string>()
    if (userIds.length > 0) {
        const { data: users, error: usersError } = await admin.from('users').select('id, full_name').in('id', userIds)
        if (usersError) throw usersError
        for (const u of users || []) nameById.set(u.id, u.full_name || 'Unknown')
    }
    const teamById = new Map<string, any>(teams.map((t: any) => [t.id, t]))

    // AM rows.
    let amRows: Omit<KpiReportAmRow, 'rank'>[] = members.map((m: any) => {
        const team = teamById.get(m.team_id)
        const target = m.manual_target_scans ?? m.auto_target_scans
        const actual = scansByAm.get(m.am_user_id) || 0
        const percent = achievementPercent(actual, target)
        return {
            am_user_id: m.am_user_id,
            am_name: nameById.get(m.am_user_id) || 'Unknown',
            team_id: m.team_id,
            team_name: team?.team_name || '—',
            assigned_target: target,
            actual_scans: actual,
            achievement_percent: percent,
            incentive_earned: computeAmIncentive(rules, percent, m.team_id),
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
            freeze_members_targets: cycle.freeze_members_targets,
            lock_campaign_qr_attribution: cycle.lock_campaign_qr_attribution,
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
