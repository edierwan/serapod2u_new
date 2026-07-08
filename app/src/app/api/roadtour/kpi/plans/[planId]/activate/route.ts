import { NextRequest, NextResponse } from 'next/server'

import { PLAN_SELECT, jsonError, loadPlanForUpdate, requireKpiAdmin } from '../../../_lib'

export const dynamic = 'force-dynamic'

/**
 * Activate a draft KPI plan. Requires at least one configured team on the plan's
 * config cycle. Activating the plan also activates its config cycle (and teams)
 * so the frozen-structure semantics carry over to the monthly report.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { planId } = await params
        const plan = await loadPlanForUpdate(ctx, planId)
        if (plan instanceof NextResponse) return plan
        if (plan.status === 'active') return jsonError('KPI plan is already active.', 409)
        if (plan.status === 'archived') return jsonError('Archived KPI plans cannot be reactivated.', 409)
        if (!plan.config_cycle_id) return jsonError('This plan has no configuration cycle. Recreate the plan.', 409)

        const { count: teamCount, error: teamError } = await ctx.admin
            .from('roadtour_kpi_teams')
            .select('id', { count: 'exact', head: true })
            .eq('kpi_cycle_id', plan.config_cycle_id)
        if (teamError) return jsonError(teamError.message, 500)
        if (!teamCount) return jsonError('Add at least one team before activating the KPI plan.', 400)

        const nowIso = new Date().toISOString()
        const [{ data, error }, cycleRes, teamStatusRes] = await Promise.all([
            ctx.admin
                .from('roadtour_kpi_plans')
                .update({ status: 'active', activated_at: nowIso, updated_by: ctx.profile.id })
                .eq('id', planId)
                .select(PLAN_SELECT)
                .single(),
            ctx.admin
                .from('roadtour_kpi_cycles')
                .update({ status: 'active', activated_at: nowIso, updated_by: ctx.profile.id })
                .eq('id', plan.config_cycle_id),
            ctx.admin
                .from('roadtour_kpi_teams')
                .update({ status: 'active' })
                .eq('kpi_cycle_id', plan.config_cycle_id),
        ])
        if (error) return jsonError(error.message || 'Failed to activate KPI plan.', 500)
        if (cycleRes.error) return jsonError(cycleRes.error.message, 500)
        if (teamStatusRes.error) return jsonError(teamStatusRes.error.message, 500)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI plan activate API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
