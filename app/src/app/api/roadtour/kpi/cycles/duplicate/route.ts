import { NextRequest, NextResponse } from 'next/server'

import { deriveKpiMonthPeriod, isValidKpiMonth, previousKpiMonth } from '@/lib/roadtour/kpi'
import {
    CYCLE_SELECT, MEMBER_SELECT, RULE_SELECT, TEAM_SELECT,
    assertOrgAccess, isMissingKpiSchema, jsonError, requireKpiAdmin,
} from '../../_lib'

export const dynamic = 'force-dynamic'

/**
 * Duplicate the previous month's cycle (teams, members, targets, incentive
 * rules) into a new draft for target_kpi_month. The source defaults to the
 * month immediately before the target for the same org + event.
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const body = await request.json()
        const orgId = String(body?.org_id || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const runId = String(body?.roadtour_run_id || '').trim()
        const targetMonth = String(body?.target_kpi_month || '').trim()
        if (!runId) return jsonError('RoadTour Event is required.')
        if (!isValidKpiMonth(targetMonth)) return jsonError('Target KPI month must be in YYYY-MM format.')

        const sourceCycleId = String(body?.source_cycle_id || '').trim()
        let sourceQuery = ctx.admin
            .from('roadtour_kpi_cycles')
            .select(CYCLE_SELECT)
            .eq('org_id', orgId)
            .eq('roadtour_run_id', runId)
        sourceQuery = sourceCycleId
            ? sourceQuery.eq('id', sourceCycleId)
            : sourceQuery.eq('kpi_month', `${previousKpiMonth(targetMonth)}-01`)

        const { data: source, error: sourceError } = await sourceQuery.maybeSingle()
        if (sourceError) {
            if (isMissingKpiSchema(sourceError)) return jsonError('RoadTour KPI tables are not migrated yet.', 503)
            return jsonError(sourceError.message, 500)
        }
        if (!source) return jsonError('No previous KPI cycle found to duplicate.', 404)

        const period = deriveKpiMonthPeriod(targetMonth)
        const { data: newCycle, error: cycleError } = await ctx.admin
            .from('roadtour_kpi_cycles')
            .insert({
                org_id: orgId,
                roadtour_run_id: runId,
                kpi_month: period.periodStart,
                period_start: period.periodStart,
                period_end: period.periodEnd,
                reporting_scope: source.reporting_scope,
                status: 'draft',
                freeze_members_targets: source.freeze_members_targets,
                lock_campaign_qr_attribution: source.lock_campaign_qr_attribution,
                created_by: ctx.profile.id,
                updated_by: ctx.profile.id,
            })
            .select(CYCLE_SELECT)
            .single()
        if (cycleError) {
            if (cycleError.code === '23505') return jsonError('A KPI cycle for this event and month already exists.', 409)
            return jsonError(cycleError.message || 'Failed to duplicate KPI cycle.', 500)
        }

        const [teamsRes, membersRes, rulesRes] = await Promise.all([
            ctx.admin.from('roadtour_kpi_teams').select(TEAM_SELECT).eq('kpi_cycle_id', source.id).order('created_at'),
            ctx.admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).eq('kpi_cycle_id', source.id).order('created_at'),
            ctx.admin.from('roadtour_kpi_incentive_rules').select(RULE_SELECT).eq('kpi_cycle_id', source.id).order('created_at'),
        ])
        if (teamsRes.error || membersRes.error || rulesRes.error) {
            return jsonError(teamsRes.error?.message || membersRes.error?.message || rulesRes.error?.message || 'Failed to read source cycle.', 500)
        }

        const teamIdMap = new Map<string, string>()
        for (const team of teamsRes.data || []) {
            const { data: newTeam, error: teamError } = await ctx.admin
                .from('roadtour_kpi_teams')
                .insert({
                    org_id: orgId,
                    kpi_cycle_id: newCycle.id,
                    team_name: team.team_name,
                    leader_user_id: team.leader_user_id,
                    monthly_team_target: team.monthly_team_target,
                    incentive_budget: team.incentive_budget,
                    status: 'draft',
                })
                .select('id')
                .single()
            if (teamError) return jsonError(teamError.message, 500)
            teamIdMap.set(team.id, newTeam.id)
        }

        const memberRows = (membersRes.data || [])
            .filter((m: any) => teamIdMap.has(m.team_id))
            .map((m: any) => ({
                org_id: orgId,
                kpi_cycle_id: newCycle.id,
                team_id: teamIdMap.get(m.team_id),
                am_user_id: m.am_user_id,
                auto_target_scans: m.auto_target_scans,
                manual_target_scans: m.manual_target_scans,
                target_source: m.target_source,
            }))
        if (memberRows.length > 0) {
            const { error: memberError } = await ctx.admin.from('roadtour_kpi_team_members').insert(memberRows)
            if (memberError) return jsonError(memberError.message, 500)
        }

        const ruleRows = (rulesRes.data || []).map((r: any) => ({
            org_id: orgId,
            kpi_cycle_id: newCycle.id,
            team_id: r.team_id ? teamIdMap.get(r.team_id) || null : null,
            rule_name: r.rule_name,
            applies_to: r.applies_to,
            achievement_threshold_percent: r.achievement_threshold_percent,
            incentive_amount: r.incentive_amount,
            bonus_type: r.bonus_type,
            status: r.status,
        }))
        if (ruleRows.length > 0) {
            const { error: ruleError } = await ctx.admin.from('roadtour_kpi_incentive_rules').insert(ruleRows)
            if (ruleError) return jsonError(ruleError.message, 500)
        }

        return NextResponse.json({ success: true, data: newCycle }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour KPI cycle duplicate API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
