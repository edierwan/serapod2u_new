import { NextRequest, NextResponse } from 'next/server'

import { CYCLE_SELECT, jsonError, loadCycleForUpdate, requireKpiAdmin } from '../../../_lib'

export const dynamic = 'force-dynamic'

/**
 * Activate a draft KPI cycle. After activation the team/member structure and
 * targets are frozen when freeze_members_targets is on.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { cycleId } = await params
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'active') return jsonError('KPI cycle is already active.', 409)
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be reactivated.', 409)

        const { count: teamCount, error: teamError } = await ctx.admin
            .from('roadtour_kpi_teams')
            .select('id', { count: 'exact', head: true })
            .eq('kpi_cycle_id', cycleId)
        if (teamError) return jsonError(teamError.message, 500)
        if (!teamCount) return jsonError('Add at least one team before activating the KPI cycle.', 400)

        const [{ data, error }, teamStatusRes] = await Promise.all([
            ctx.admin
                .from('roadtour_kpi_cycles')
                .update({ status: 'active', activated_at: new Date().toISOString(), updated_by: ctx.profile.id })
                .eq('id', cycleId)
                .select(CYCLE_SELECT)
                .single(),
            ctx.admin
                .from('roadtour_kpi_teams')
                .update({ status: 'active' })
                .eq('kpi_cycle_id', cycleId),
        ])
        if (error) return jsonError(error.message || 'Failed to activate KPI cycle.', 500)
        if (teamStatusRes.error) return jsonError(teamStatusRes.error.message, 500)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI cycle activate API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
