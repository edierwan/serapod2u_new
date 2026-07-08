import { NextRequest, NextResponse } from 'next/server'

import { MEMBER_SELECT, TEAM_SELECT, buildMemberRows, isMissingColumn, jsonError, loadCycleForUpdate, parseMembers, requireKpiAdmin } from '../../_lib'

export const dynamic = 'force-dynamic'

async function loadTeam(ctx: any, teamId: string) {
    const { data: team, error } = await ctx.admin
        .from('roadtour_kpi_teams')
        .select(TEAM_SELECT)
        .eq('id', teamId)
        .maybeSingle()
    if (error) return jsonError(error.message, 500)
    if (!team) return jsonError('Team not found.', 404)
    return team
}

/** Update a team; when members or target change, member targets are re-distributed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { teamId } = await params
        const team = await loadTeam(ctx, teamId)
        if (team instanceof NextResponse) return team
        const cycle = await loadCycleForUpdate(ctx, team.kpi_cycle_id)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)
        if (cycle.status === 'active' && cycle.freeze_members_targets) {
            return jsonError('Members & targets are frozen for this active KPI cycle.', 409)
        }

        const body = await request.json()
        const updates: Record<string, any> = {}
        if (body?.team_name !== undefined) {
            const name = String(body.team_name).trim()
            if (!name) return jsonError('Team name is required.')
            updates.team_name = name
        }
        if (body?.leader_user_id !== undefined) updates.leader_user_id = String(body.leader_user_id || '').trim() || null
        let teamTarget = Number(team.monthly_team_target)
        if (body?.monthly_team_target !== undefined) {
            teamTarget = Number(body.monthly_team_target)
            if (!Number.isInteger(teamTarget) || teamTarget < 0) return jsonError('Monthly team target must be a non-negative integer.')
            updates.monthly_team_target = teamTarget
        }
        // "Max Incentive / AM" — accept the new field name, fall back to the
        // legacy incentive_budget key. Both DB columns are kept in sync.
        const capRaw = body?.max_incentive_per_am ?? body?.incentive_budget
        if (capRaw !== undefined) {
            const cap = Number(capRaw)
            if (!Number.isFinite(cap) || cap < 0) return jsonError('Max Incentive / AM must be non-negative.')
            updates.incentive_budget = cap
            updates.max_incentive_per_am = cap
        }

        if (Object.keys(updates).length > 0) {
            let { error: updateError } = await ctx.admin.from('roadtour_kpi_teams').update(updates).eq('id', teamId)
            // Rolling deploy: retry without the additive cap column if absent.
            if (updateError && isMissingColumn(updateError, 'max_incentive_per_am')) {
                const { max_incentive_per_am, ...fallback } = updates
                ;({ error: updateError } = await ctx.admin.from('roadtour_kpi_teams').update(fallback).eq('id', teamId))
            }
            if (updateError) {
                if (updateError.code === '23505') return jsonError('A team with this name already exists in the cycle.', 409)
                return jsonError(updateError.message || 'Failed to update team.', 500)
            }
        }

        // Replace membership when provided, or re-distribute when only the target changed.
        if (body?.members !== undefined) {
            const members = parseMembers(body.members)
            if (typeof members === 'string') return jsonError(members)
            const { error: deleteError } = await ctx.admin.from('roadtour_kpi_team_members').delete().eq('team_id', teamId)
            if (deleteError) return jsonError(deleteError.message, 500)
            if (members.length > 0) {
                const rows = buildMemberRows({ orgId: team.org_id, cycleId: team.kpi_cycle_id, teamId, teamTarget, members })
                const { error: insertError } = await ctx.admin.from('roadtour_kpi_team_members').insert(rows)
                if (insertError) {
                    if (insertError.code === '23505') return jsonError('One of the selected AMs already belongs to another team in this cycle.', 409)
                    return jsonError(insertError.message, 500)
                }
            }
        } else if (updates.monthly_team_target !== undefined) {
            const { data: existing, error: existingError } = await ctx.admin
                .from('roadtour_kpi_team_members')
                .select(MEMBER_SELECT)
                .eq('team_id', teamId)
                .order('created_at')
            if (existingError) return jsonError(existingError.message, 500)
            const members = (existing || []).map((m: any) => ({ am_user_id: m.am_user_id, manual_target_scans: m.manual_target_scans }))
            if (members.length > 0) {
                const { error: deleteError } = await ctx.admin.from('roadtour_kpi_team_members').delete().eq('team_id', teamId)
                if (deleteError) return jsonError(deleteError.message, 500)
                const rows = buildMemberRows({ orgId: team.org_id, cycleId: team.kpi_cycle_id, teamId, teamTarget, members })
                const { error: insertError } = await ctx.admin.from('roadtour_kpi_team_members').insert(rows)
                if (insertError) return jsonError(insertError.message, 500)
            }
        }

        const [{ data: updatedTeam }, { data: memberRows }] = await Promise.all([
            ctx.admin.from('roadtour_kpi_teams').select(TEAM_SELECT).eq('id', teamId).single(),
            ctx.admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).eq('team_id', teamId).order('created_at'),
        ])
        return NextResponse.json({ success: true, data: { ...updatedTeam, members: memberRows || [] } })
    } catch (error: any) {
        console.error('RoadTour KPI team update API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Delete a team (members cascade). Blocked while frozen. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { teamId } = await params
        const team = await loadTeam(ctx, teamId)
        if (team instanceof NextResponse) return team
        const cycle = await loadCycleForUpdate(ctx, team.kpi_cycle_id)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)
        if (cycle.status === 'active' && cycle.freeze_members_targets) {
            return jsonError('Members & targets are frozen for this active KPI cycle.', 409)
        }

        const { error } = await ctx.admin.from('roadtour_kpi_teams').delete().eq('id', teamId)
        if (error) return jsonError(error.message || 'Failed to delete team.', 500)
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('RoadTour KPI team delete API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
