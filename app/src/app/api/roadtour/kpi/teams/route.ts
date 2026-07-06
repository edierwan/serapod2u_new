import { NextRequest, NextResponse } from 'next/server'

import { MEMBER_SELECT, TEAM_SELECT, buildMemberRows, jsonError, loadCycleForUpdate, parseMembers, requireKpiAdmin } from '../_lib'

export const dynamic = 'force-dynamic'

/** Create a team (with members) inside a KPI cycle. */
export async function POST(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const body = await request.json()
        const cycleId = String(body?.kpi_cycle_id || '').trim()
        if (!cycleId) return jsonError('KPI cycle is required.')
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)
        if (cycle.status === 'active' && cycle.freeze_members_targets) {
            return jsonError('Members & targets are frozen for this active KPI cycle.', 409)
        }

        const teamName = String(body?.team_name || '').trim()
        if (!teamName) return jsonError('Team name is required.')
        const teamTarget = Number(body?.monthly_team_target ?? 0)
        if (!Number.isInteger(teamTarget) || teamTarget < 0) return jsonError('Monthly team target must be a non-negative integer.')
        const incentiveBudget = Number(body?.incentive_budget ?? 0)
        if (!Number.isFinite(incentiveBudget) || incentiveBudget < 0) return jsonError('Incentive budget must be non-negative.')
        const leaderUserId = String(body?.leader_user_id || '').trim() || null
        const members = parseMembers(body?.members ?? [])
        if (typeof members === 'string') return jsonError(members)

        const { data: team, error: teamError } = await ctx.admin
            .from('roadtour_kpi_teams')
            .insert({
                org_id: cycle.org_id,
                kpi_cycle_id: cycleId,
                team_name: teamName,
                leader_user_id: leaderUserId,
                monthly_team_target: teamTarget,
                incentive_budget: incentiveBudget,
                status: cycle.status === 'active' ? 'active' : 'draft',
            })
            .select(TEAM_SELECT)
            .single()
        if (teamError) {
            if (teamError.code === '23505') return jsonError('A team with this name already exists in the cycle.', 409)
            return jsonError(teamError.message || 'Failed to create team.', 500)
        }

        if (members.length > 0) {
            const rows = buildMemberRows({ orgId: cycle.org_id, cycleId, teamId: team.id, teamTarget, members })
            const { error: memberError } = await ctx.admin.from('roadtour_kpi_team_members').insert(rows)
            if (memberError) {
                await ctx.admin.from('roadtour_kpi_teams').delete().eq('id', team.id)
                if (memberError.code === '23505') return jsonError('One of the selected AMs already belongs to another team in this cycle.', 409)
                return jsonError(memberError.message || 'Failed to add team members.', 500)
            }
        }

        const { data: memberRows } = await ctx.admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).eq('team_id', team.id).order('created_at')
        return NextResponse.json({ success: true, data: { ...team, members: memberRows || [] } }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour KPI team create API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
