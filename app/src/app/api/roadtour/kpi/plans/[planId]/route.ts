import { NextRequest, NextResponse } from 'next/server'

import { isValidKpiMonth, normalizeAmIncentiveMode, type KpiAmIncentiveMode } from '@/lib/roadtour/kpi'
import {
    CYCLE_SELECT, PLAN_SELECT,
    isMissingColumn,
    jsonError, loadCycleConfig, loadPlanForUpdate, requireKpiAdmin,
} from '../../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set(['all_campaigns', 'selected_campaigns'])
const monthToDate = (kpiMonth: string) => `${kpiMonth}-01`

/** Full plan detail: plan + its config cycle + teams (with members) + rules. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { planId } = await params
        const plan = await loadPlanForUpdate(ctx, planId)
        if (plan instanceof NextResponse) return plan

        const config = await loadCycleConfig(ctx.admin, plan.config_cycle_id)
        const { data: cycleRow } = plan.config_cycle_id
            ? await ctx.admin.from('roadtour_kpi_cycles').select(CYCLE_SELECT).eq('id', plan.config_cycle_id).maybeSingle()
            : { data: null }
        return NextResponse.json({ success: true, data: { ...plan, config_cycle: cycleRow || null, teams: config.teams, rules: config.rules } })
    } catch (error: any) {
        console.error('RoadTour KPI plan detail API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Update plan-level settings: effective window, reporting scope, leader bonus, name, status. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { planId } = await params
        const plan = await loadPlanForUpdate(ctx, planId)
        if (plan instanceof NextResponse) return plan
        if (plan.status === 'archived') return jsonError('Archived KPI plans cannot be edited.', 409)

        const body = await request.json()
        const updates: Record<string, any> = { updated_by: ctx.profile.id }

        if (body?.plan_name !== undefined) updates.plan_name = String(body.plan_name).trim() || null
        if (body?.leader_bonus_enabled !== undefined) updates.leader_bonus_enabled = Boolean(body.leader_bonus_enabled)
        if (body?.am_incentive_mode !== undefined) {
            const mode = String(body.am_incentive_mode).trim()
            if (mode !== 'volume_tiers' && mode !== 'achievement_tiers') {
                return jsonError('Invalid AM incentive mode.')
            }
            updates.am_incentive_mode = mode as KpiAmIncentiveMode
        }
        if (body?.reporting_scope !== undefined) {
            const scope = String(body.reporting_scope).trim()
            if (!ALLOWED_SCOPES.has(scope)) return jsonError('Invalid reporting scope.')
            updates.reporting_scope = scope
        }

        const fromMonth = plan.effective_from_month?.slice(0, 7)
        if (body?.effective_from_month !== undefined) {
            const from = String(body.effective_from_month).trim()
            if (!isValidKpiMonth(from)) return jsonError('Effective From month must be in YYYY-MM format.')
            updates.effective_from_month = monthToDate(from)
        }
        if (body?.effective_to_month !== undefined) {
            const to = String(body.effective_to_month || '').trim()
            if (to && !isValidKpiMonth(to)) return jsonError('Effective To month must be in YYYY-MM format.')
            const effectiveFrom = (updates.effective_from_month || plan.effective_from_month || '').slice(0, 7)
            if (to && effectiveFrom && to < effectiveFrom) return jsonError('Effective To month cannot be before Effective From month.')
            updates.effective_to_month = to ? monthToDate(to) : null
        }
        void fromMonth

        if (body?.status !== undefined) {
            const status = String(body.status).trim()
            // Activation goes through the dedicated endpoint; PATCH may only archive.
            if (status === 'archived') updates.status = 'archived'
            else if (status !== plan.status) return jsonError('Use the activate endpoint to activate a plan.', 400)
        }

        const { data, error } = await ctx.admin
            .from('roadtour_kpi_plans')
            .update(updates)
            .eq('id', planId)
            .select(PLAN_SELECT)
            .single()
        if (error) {
            if (isMissingColumn(error, 'am_incentive_mode') && updates.am_incentive_mode !== undefined) {
                const { am_incentive_mode, ...fallback } = updates
                const retry = await ctx.admin.from('roadtour_kpi_plans').update(fallback).eq('id', planId).select(PLAN_SELECT).single()
                if (retry.error) {
                    if (retry.error.code === '23505') return jsonError('Another active or draft KPI plan already exists for this event.', 409)
                    return jsonError(retry.error.message || 'Failed to update KPI plan.', 500)
                }
                return NextResponse.json({
                    success: true,
                    data: { ...retry.data, am_incentive_mode: normalizeAmIncentiveMode(body?.am_incentive_mode) },
                    schemaWarning: 'Apply supabase/migrations/20260709_roadtour_kpi_am_incentive_mode.sql to persist Custom tiers.',
                })
            }
            if (error.code === '23505') return jsonError('Another active or draft KPI plan already exists for this event.', 409)
            return jsonError(error.message || 'Failed to update KPI plan.', 500)
        }
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI plan update API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Delete a draft plan and its config cycle (teams/members/rules cascade with the cycle). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { planId } = await params
        const plan = await loadPlanForUpdate(ctx, planId)
        if (plan instanceof NextResponse) return plan
        if (plan.status !== 'draft') return jsonError('Only draft KPI plans can be deleted. Archive an active plan instead.', 409)

        if (plan.config_cycle_id) {
            await ctx.admin.from('roadtour_kpi_cycles').delete().eq('id', plan.config_cycle_id)
        }
        const { error } = await ctx.admin.from('roadtour_kpi_plans').delete().eq('id', planId)
        if (error) return jsonError(error.message || 'Failed to delete KPI plan.', 500)
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('RoadTour KPI plan delete API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
