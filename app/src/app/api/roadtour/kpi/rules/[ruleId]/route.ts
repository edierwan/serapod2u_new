import { NextRequest, NextResponse } from 'next/server'

import { validateAmIncentiveTier } from '@/lib/roadtour/kpi'

import { RULE_SELECT, jsonError, loadAmTierContext, loadCycleForUpdate, requireKpiAdmin } from '../../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_APPLIES_TO = new Set(['all_ams', 'team_leader', 'specific_team'])
const ALLOWED_BONUS_TYPES = new Set(['cash', 'other'])

async function loadRule(ctx: any, ruleId: string) {
    const { data: rule, error } = await ctx.admin
        .from('roadtour_kpi_incentive_rules')
        .select(RULE_SELECT)
        .eq('id', ruleId)
        .maybeSingle()
    if (error) return jsonError(error.message, 500)
    if (!rule) return jsonError('Incentive rule not found.', 404)
    return rule
}

/** Update an incentive rule. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { ruleId } = await params
        const rule = await loadRule(ctx, ruleId)
        if (rule instanceof NextResponse) return rule
        const cycle = await loadCycleForUpdate(ctx, rule.kpi_cycle_id)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)

        const body = await request.json()
        const updates: Record<string, any> = {}
        if (body?.rule_name !== undefined) {
            const name = String(body.rule_name).trim()
            if (!name) return jsonError('Rule name is required.')
            updates.rule_name = name
        }
        if (body?.applies_to !== undefined) {
            const appliesTo = String(body.applies_to).trim()
            if (!ALLOWED_APPLIES_TO.has(appliesTo)) return jsonError('Invalid applies_to value.')
            updates.applies_to = appliesTo
        }
        if (body?.bonus_type !== undefined) {
            const bonusType = String(body.bonus_type).trim()
            if (!ALLOWED_BONUS_TYPES.has(bonusType)) return jsonError('Invalid bonus type.')
            updates.bonus_type = bonusType
        }
        if (body?.achievement_threshold_percent !== undefined) {
            const threshold = Number(body.achievement_threshold_percent)
            if (!Number.isFinite(threshold) || threshold <= 0) return jsonError('Achievement threshold must be a positive percentage.')
            updates.achievement_threshold_percent = threshold
        }
        if (body?.incentive_amount !== undefined) {
            const amount = Number(body.incentive_amount)
            if (!Number.isFinite(amount) || amount < 0) return jsonError('Incentive amount must be non-negative.')
            updates.incentive_amount = amount
        }
        if (body?.team_id !== undefined) updates.team_id = String(body.team_id || '').trim() || null
        if (body?.status !== undefined) updates.status = body.status === 'inactive' ? 'inactive' : 'active'

        const appliesTo = updates.applies_to ?? rule.applies_to
        const teamId = updates.team_id !== undefined ? updates.team_id : rule.team_id
        if (appliesTo === 'specific_team' && !teamId) return jsonError('A team is required for team-specific rules.')

        // Re-validate the whole AM tier set against the edited values (self excluded).
        if (appliesTo === 'all_ams') {
            const effectiveThreshold = updates.achievement_threshold_percent ?? Number(rule.achievement_threshold_percent)
            const effectiveAmount = updates.incentive_amount ?? Number(rule.incentive_amount)
            const { existingTiers, maxIncentivePerAm } = await loadAmTierContext(ctx.admin, rule.kpi_cycle_id, ruleId)
            const tierError = validateAmIncentiveTier(
                { id: ruleId, achievement_threshold_percent: effectiveThreshold, incentive_amount: effectiveAmount },
                existingTiers,
                maxIncentivePerAm,
            )
            if (tierError) return jsonError(tierError)
        }

        const { data, error } = await ctx.admin
            .from('roadtour_kpi_incentive_rules')
            .update(updates)
            .eq('id', ruleId)
            .select(RULE_SELECT)
            .single()
        if (error) return jsonError(error.message || 'Failed to update incentive rule.', 500)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI rule update API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Delete an incentive rule. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { ruleId } = await params
        const rule = await loadRule(ctx, ruleId)
        if (rule instanceof NextResponse) return rule
        const cycle = await loadCycleForUpdate(ctx, rule.kpi_cycle_id)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)

        const { error } = await ctx.admin.from('roadtour_kpi_incentive_rules').delete().eq('id', ruleId)
        if (error) return jsonError(error.message || 'Failed to delete incentive rule.', 500)
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('RoadTour KPI rule delete API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
