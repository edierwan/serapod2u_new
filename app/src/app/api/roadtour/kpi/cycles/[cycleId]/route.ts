import { NextRequest, NextResponse } from 'next/server'

import { CYCLE_SELECT, MEMBER_SELECT, RULE_SELECT, TEAM_SELECT, jsonError, loadCycleForUpdate, requireKpiAdmin } from '../../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set(['all_campaigns', 'selected_campaigns'])

/** Full cycle detail: cycle + teams (with members) + incentive rules. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { cycleId } = await params
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle

        const [teamsRes, membersRes, rulesRes] = await Promise.all([
            ctx.admin.from('roadtour_kpi_teams').select(TEAM_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
            ctx.admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
            ctx.admin.from('roadtour_kpi_incentive_rules').select(RULE_SELECT).eq('kpi_cycle_id', cycleId).order('created_at'),
        ])
        if (teamsRes.error) return jsonError(teamsRes.error.message, 500)
        if (membersRes.error) return jsonError(membersRes.error.message, 500)
        if (rulesRes.error) return jsonError(rulesRes.error.message, 500)

        const members = membersRes.data || []
        return NextResponse.json({
            success: true,
            data: {
                ...cycle,
                teams: (teamsRes.data || []).map((t: any) => ({ ...t, members: members.filter((m: any) => m.team_id === t.id) })),
                rules: rulesRes.data || [],
            },
        })
    } catch (error: any) {
        console.error('RoadTour KPI cycle detail API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Update draft-editable cycle settings (scope, toggles). Month/event of an existing cycle cannot change. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { cycleId } = await params
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status === 'closed') return jsonError('Closed KPI cycles cannot be edited.', 409)

        const body = await request.json()
        const updates: Record<string, any> = { updated_by: ctx.profile.id }
        if (body?.reporting_scope !== undefined) {
            const scope = String(body.reporting_scope).trim()
            if (!ALLOWED_SCOPES.has(scope)) return jsonError('Invalid reporting scope.')
            updates.reporting_scope = scope
        }
        if (body?.freeze_members_targets !== undefined) updates.freeze_members_targets = Boolean(body.freeze_members_targets)
        if (body?.lock_campaign_qr_attribution !== undefined) updates.lock_campaign_qr_attribution = Boolean(body.lock_campaign_qr_attribution)
        if (body?.status !== undefined) {
            const status = String(body.status).trim()
            // Activation goes through the dedicated endpoint; PATCH may only close an active cycle.
            if (status === 'closed' && cycle.status === 'active') updates.status = 'closed'
            else if (status !== cycle.status) return jsonError('Use the activate endpoint to activate a cycle.', 400)
        }

        const { data, error } = await ctx.admin
            .from('roadtour_kpi_cycles')
            .update(updates)
            .eq('id', cycleId)
            .select(CYCLE_SELECT)
            .single()
        if (error) return jsonError(error.message || 'Failed to update KPI cycle.', 500)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI cycle update API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Delete a cycle (drafts only) — teams, members, and rules cascade. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx
        const { cycleId } = await params
        const cycle = await loadCycleForUpdate(ctx, cycleId)
        if (cycle instanceof NextResponse) return cycle
        if (cycle.status !== 'draft') return jsonError('Only draft KPI cycles can be deleted.', 409)

        const { error } = await ctx.admin.from('roadtour_kpi_cycles').delete().eq('id', cycleId)
        if (error) return jsonError(error.message || 'Failed to delete KPI cycle.', 500)
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('RoadTour KPI cycle delete API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
