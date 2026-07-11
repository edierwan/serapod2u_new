import { NextRequest, NextResponse } from 'next/server'

import { deriveKpiMonthPeriod, isValidKpiMonth } from '@/lib/roadtour/kpi'
import {
    CYCLE_SELECT, PLAN_SELECT,
    assertOrgAccess, isMissingKpiSchema, jsonError, loadCycleConfig, requireKpiAdmin,
} from '../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set(['all_campaigns', 'selected_campaigns'])

/** 'YYYY-MM' → 'YYYY-MM-01' (first day of month) for date columns. */
const monthToDate = (kpiMonth: string) => `${kpiMonth}-01`

/**
 * List KPI plans for an org (optionally scoped to an event), each with its
 * nested config cycle (teams + members + rules) so the settings/report UI can
 * render a plan and its team structure in one round trip.
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const orgId = String(searchParams.get('org_id') || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const runId = String(searchParams.get('roadtour_run_id') || '').trim()

        let query = ctx.admin
            .from('roadtour_kpi_plans')
            .select(PLAN_SELECT)
            .eq('org_id', orgId)
            .order('effective_from_month', { ascending: false })
        if (runId) query = query.eq('roadtour_run_id', runId)

        const { data: plans, error } = await query
        if (error) {
            if (isMissingKpiSchema(error)) return NextResponse.json({ success: true, data: [], schemaMissing: true })
            return jsonError(error.message || 'Failed to list KPI plans.', 500)
        }

        const data = await Promise.all((plans || []).map(async (plan: any) => {
            const config = await loadCycleConfig(ctx.admin, plan.config_cycle_id)
            return { ...plan, config_cycle_id: plan.config_cycle_id, teams: config.teams, rules: config.rules }
        }))

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI plans list API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/**
 * Create a KPI plan for an event (created ONCE per event). Also provisions the
 * plan's config cycle at the effective_from month — teams / members / incentive
 * rules are edited against that cycle, and the monthly report reuses them for
 * every month in the effective window.
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
        const fromMonth = String(body?.effective_from_month || '').trim()
        const toMonthRaw = String(body?.effective_to_month || '').trim()
        const reportingScope = String(body?.reporting_scope || 'all_campaigns').trim()
        const leaderBonusEnabled = Boolean(body?.leader_bonus_enabled)
        const planName = String(body?.plan_name || '').trim() || null

        if (!runId) return jsonError('RoadTour Event is required.')
        if (!isValidKpiMonth(fromMonth)) return jsonError('Effective From month must be in YYYY-MM format.')
        if (toMonthRaw && !isValidKpiMonth(toMonthRaw)) return jsonError('Effective To month must be in YYYY-MM format.')
        if (toMonthRaw && toMonthRaw < fromMonth) return jsonError('Effective To month cannot be before Effective From month.')
        if (!ALLOWED_SCOPES.has(reportingScope)) return jsonError('Invalid reporting scope.')

        const { data: run, error: runError } = await ctx.admin
            .from('roadtour_runs')
            .select('id, org_id')
            .eq('id', runId)
            .maybeSingle()
        if (runError) {
            if (isMissingKpiSchema(runError)) return jsonError('RoadTour KPI tables are not migrated yet.', 503)
            return jsonError(runError.message, 500)
        }
        if (!run || run.org_id !== orgId) return jsonError('RoadTour Event not found for this organization.', 404)

        // 1. Insert the plan (config cycle linked in step 3).
        const { data: plan, error: planError } = await ctx.admin
            .from('roadtour_kpi_plans')
            .insert({
                org_id: orgId,
                roadtour_run_id: runId,
                plan_name: planName,
                effective_from_month: monthToDate(fromMonth),
                effective_to_month: toMonthRaw ? monthToDate(toMonthRaw) : null,
                reporting_scope: reportingScope,
                status: 'draft',
                leader_bonus_enabled: leaderBonusEnabled,
                created_by: ctx.profile.id,
                updated_by: ctx.profile.id,
            })
            .select(PLAN_SELECT)
            .single()
        if (planError) {
            if (isMissingKpiSchema(planError)) return jsonError('RoadTour KPI plan tables are not migrated yet. Apply supabase/migrations/20260707_roadtour_kpi_plan_refinement.sql.', 503)
            if (planError.code === '23505') return jsonError('An active or draft KPI plan already exists for this event. Archive it before creating a new one.', 409)
            return jsonError(planError.message || 'Failed to create KPI plan.', 500)
        }

        // 2. Provision (or adopt) the config cycle at the effective_from month.
        const period = deriveKpiMonthPeriod(fromMonth)
        let configCycleId: string | null = null
        const { data: newCycle, error: cycleError } = await ctx.admin
            .from('roadtour_kpi_cycles')
            .insert({
                org_id: orgId,
                roadtour_run_id: runId,
                kpi_plan_id: plan.id,
                kpi_month: period.periodStart,
                period_start: period.periodStart,
                period_end: period.periodEnd,
                reporting_scope: reportingScope,
                status: 'draft',
                created_by: ctx.profile.id,
                updated_by: ctx.profile.id,
            })
            .select('id')
            .single()
        if (cycleError) {
            if (cycleError.code === '23505') {
                // A legacy standalone cycle already exists for this month — adopt it.
                const { data: existing } = await ctx.admin
                    .from('roadtour_kpi_cycles')
                    .select('id')
                    .eq('org_id', orgId).eq('roadtour_run_id', runId).eq('kpi_month', period.periodStart)
                    .maybeSingle()
                if (existing) {
                    await ctx.admin.from('roadtour_kpi_cycles').update({ kpi_plan_id: plan.id }).eq('id', existing.id)
                    configCycleId = existing.id
                }
            } else {
                // Roll back the plan so we never leave a plan without a config cycle.
                await ctx.admin.from('roadtour_kpi_plans').delete().eq('id', plan.id)
                return jsonError(cycleError.message || 'Failed to provision KPI plan configuration.', 500)
            }
        } else {
            configCycleId = newCycle.id
        }

        // 3. Link the config cycle back onto the plan.
        const { data: linkedPlan, error: linkError } = await ctx.admin
            .from('roadtour_kpi_plans')
            .update({ config_cycle_id: configCycleId, updated_by: ctx.profile.id })
            .eq('id', plan.id)
            .select(PLAN_SELECT)
            .single()
        if (linkError) return jsonError(linkError.message, 500)

        const config = await loadCycleConfig(ctx.admin, configCycleId)
        const { data: cycleRow } = await ctx.admin.from('roadtour_kpi_cycles').select(CYCLE_SELECT).eq('id', configCycleId).maybeSingle()
        return NextResponse.json({ success: true, data: { ...linkedPlan, config_cycle: cycleRow || null, teams: config.teams, rules: config.rules } }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour KPI plan create API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
