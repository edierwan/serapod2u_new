import { NextRequest, NextResponse } from 'next/server'

import { validateAmAchievementThreshold, validateAmIncentiveTier } from '@/lib/roadtour/kpi'

import { RULE_SELECT, jsonError, loadAmTierContext, loadCycleForUpdate, requireKpiAdmin } from '../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_APPLIES_TO = new Set(['all_ams', 'team_leader', 'specific_team'])
const ALLOWED_BONUS_TYPES = new Set(['cash', 'other'])

/** List incentive rules for a KPI cycle (Read in CRUD). */
export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const cycleId = String(searchParams.get('kpi_cycle_id') || '').trim()
        if (!cycleId) return jsonError('kpi_cycle_id is required.')
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle

        let query = ctx.admin
            .from('roadtour_kpi_incentive_rules')
            .select(RULE_SELECT)
            .eq('kpi_cycle_id', cycleId)
            .order('created_at')

        const appliesTo = String(searchParams.get('applies_to') || '').trim()
        if (appliesTo) {
            if (!ALLOWED_APPLIES_TO.has(appliesTo)) return jsonError('Invalid applies_to value.')
            query = query.eq('applies_to', appliesTo)
        }
        const status = String(searchParams.get('status') || '').trim()
        if (status) {
            if (status !== 'active' && status !== 'inactive') return jsonError('Invalid status value.')
            query = query.eq('status', status)
        }
        const teamId = String(searchParams.get('team_id') || '').trim()
        if (teamId) query = query.eq('team_id', teamId)

        const { data, error } = await query
        if (error) return jsonError(error.message || 'Failed to load incentive rules.', 500)
        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('RoadTour KPI rules list API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Create an incentive rule inside a KPI cycle. */
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

        const ruleName = String(body?.rule_name || '').trim()
        if (!ruleName) return jsonError('Rule name is required.')
        const appliesTo = String(body?.applies_to || 'all_ams').trim()
        if (!ALLOWED_APPLIES_TO.has(appliesTo)) return jsonError('Invalid applies_to value.')
        const bonusType = String(body?.bonus_type || 'cash').trim()
        if (!ALLOWED_BONUS_TYPES.has(bonusType)) return jsonError('Invalid bonus type.')
        const threshold = Number(body?.achievement_threshold_percent)
        if (!Number.isFinite(threshold) || threshold <= 0) return jsonError('Achievement threshold must be a positive percentage.')
        const amount = appliesTo === 'all_ams' ? 0 : Number(body?.incentive_amount)
        if (appliesTo !== 'all_ams') {
            if (!Number.isFinite(amount) || amount < 0) return jsonError('Incentive amount must be non-negative.')
        }
        const teamId = String(body?.team_id || '').trim() || null
        if (appliesTo === 'specific_team' && !teamId) return jsonError('A team is required for team-specific rules.')

        // AM incentive tiers must form a logical, capped, strictly-increasing set.
        if (appliesTo === 'all_ams') {
            const { existingTiers } = await loadAmTierContext(ctx.admin, cycleId)
            const tierError = validateAmAchievementThreshold(
                { achievement_threshold_percent: threshold },
                existingTiers,
            )
            if (tierError) return jsonError(tierError)
        }

        const { data, error } = await ctx.admin
            .from('roadtour_kpi_incentive_rules')
            .insert({
                org_id: cycle.org_id,
                kpi_cycle_id: cycleId,
                team_id: teamId,
                rule_name: ruleName,
                applies_to: appliesTo,
                achievement_threshold_percent: threshold,
                incentive_amount: amount,
                bonus_type: bonusType,
                status: body?.status === 'inactive' ? 'inactive' : 'active',
            })
            .select(RULE_SELECT)
            .single()
        if (error) return jsonError(error.message || 'Failed to create incentive rule.', 500)
        return NextResponse.json({ success: true, data }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour KPI rule create API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
