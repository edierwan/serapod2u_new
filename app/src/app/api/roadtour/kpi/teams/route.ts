import { NextRequest, NextResponse } from 'next/server'

import { MEMBER_SELECT, TEAM_SELECT, buildMemberRows, isMissingColumn, jsonError, loadCycleForUpdate, parseMembers, requireKpiAdmin } from '../_lib'

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
        // "Max Incentive / AM" — accept the new field name, fall back to the
        // legacy incentive_budget key. Both DB columns are kept in sync.
        const maxIncentivePerAm = Number(body?.max_incentive_per_am ?? body?.incentive_budget ?? 0)
        if (!Number.isFinite(maxIncentivePerAm) || maxIncentivePerAm < 0) return jsonError('Max Incentive / AM must be non-negative.')
        const leaderUserId = String(body?.leader_user_id || '').trim() || null
        const members = parseMembers(body?.members ?? [])
        if (typeof members === 'string') return jsonError(members)

        const insertTeam = (includeCap: boolean) => {
            const row: Record<string, any> = {
                org_id: cycle.org_id,
                kpi_cycle_id: cycleId,
                team_name: teamName,
                leader_user_id: leaderUserId,
                monthly_team_target: teamTarget,
                incentive_budget: maxIncentivePerAm,
                status: cycle.status === 'active' ? 'active' : 'draft',
            }
            if (includeCap) row.max_incentive_per_am = maxIncentivePerAm
            return ctx.admin.from('roadtour_kpi_teams').insert(row).select(TEAM_SELECT).single()
        }
        let { data: team, error: teamError } = await insertTeam(true)
        // Rolling deploy: the additive max_incentive_per_am column may not exist
        // yet — retry without it (incentive_budget still carries the cap value).
        if (teamError && isMissingColumn(teamError, 'max_incentive_per_am')) {
            ({ data: team, error: teamError } = await insertTeam(false))
        }
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
