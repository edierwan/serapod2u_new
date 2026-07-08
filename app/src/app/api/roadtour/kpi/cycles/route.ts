import { NextRequest, NextResponse } from 'next/server'

import { deriveKpiMonthPeriod, isValidKpiMonth } from '@/lib/roadtour/kpi'
import {
    CYCLE_SELECT, MEMBER_SELECT, RULE_SELECT, TEAM_SELECT,
    assertOrgAccess, isMissingKpiSchema, jsonError, requireKpiAdmin,
} from '../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set(['all_campaigns', 'selected_campaigns'])

/** List KPI cycles for an org (optionally scoped to an event / month), with nested teams, members, and rules. */
export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const orgId = String(searchParams.get('org_id') || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const runId = String(searchParams.get('roadtour_run_id') || '').trim()
        const kpiMonth = String(searchParams.get('kpi_month') || '').trim()

        let query = ctx.admin
            .from('roadtour_kpi_cycles')
            .select(CYCLE_SELECT)
            .eq('org_id', orgId)
            .order('kpi_month', { ascending: false })
        if (runId) query = query.eq('roadtour_run_id', runId)
        if (kpiMonth && isValidKpiMonth(kpiMonth)) query = query.eq('kpi_month', `${kpiMonth}-01`)

        const { data: cycles, error } = await query
        if (error) {
            if (isMissingKpiSchema(error)) return NextResponse.json({ success: true, data: [], schemaMissing: true })
            return jsonError(error.message || 'Failed to list KPI cycles.', 500)
        }

        const cycleIds = (cycles || []).map((c: any) => c.id)
        let teams: any[] = []
        let members: any[] = []
        let rules: any[] = []
        if (cycleIds.length > 0) {
            const [teamsRes, membersRes, rulesRes] = await Promise.all([
                ctx.admin.from('roadtour_kpi_teams').select(TEAM_SELECT).in('kpi_cycle_id', cycleIds).order('created_at'),
                ctx.admin.from('roadtour_kpi_team_members').select(MEMBER_SELECT).in('kpi_cycle_id', cycleIds).order('created_at'),
                ctx.admin.from('roadtour_kpi_incentive_rules').select(RULE_SELECT).in('kpi_cycle_id', cycleIds).order('created_at'),
            ])
            if (teamsRes.error) return jsonError(teamsRes.error.message, 500)
            if (membersRes.error) return jsonError(membersRes.error.message, 500)
            if (rulesRes.error) return jsonError(rulesRes.error.message, 500)
            teams = teamsRes.data || []
            members = membersRes.data || []
            rules = rulesRes.data || []
        }

        const data = (cycles || []).map((cycle: any) => ({
            ...cycle,
            teams: teams
                .filter((t) => t.kpi_cycle_id === cycle.id)
                .map((t) => ({ ...t, members: members.filter((m) => m.team_id === t.id) })),
            rules: rules.filter((r) => r.kpi_cycle_id === cycle.id),
        }))

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour KPI cycles list API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}

/** Create a draft KPI cycle. Period is always derived from kpi_month — never client-supplied. */
export async function POST(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const body = await request.json()
        const orgId = String(body?.org_id || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const runId = String(body?.roadtour_run_id || '').trim()
        const kpiMonth = String(body?.kpi_month || '').trim()
        const reportingScope = String(body?.reporting_scope || 'all_campaigns').trim()
        if (!runId) return jsonError('RoadTour Event is required.')
        if (!isValidKpiMonth(kpiMonth)) return jsonError('KPI month must be in YYYY-MM format.')
        if (!ALLOWED_SCOPES.has(reportingScope)) return jsonError('Invalid reporting scope.')

        const { data: run, error: runError } = await ctx.admin
            .from('roadtour_runs')
            .select('id, org_id')
            .eq('id', runId)
            .maybeSingle()
        if (runError) return jsonError(runError.message, 500)
        if (!run || run.org_id !== orgId) return jsonError('RoadTour Event not found for this organization.', 404)

        const period = deriveKpiMonthPeriod(kpiMonth)
        const { data, error } = await ctx.admin
            .from('roadtour_kpi_cycles')
            .insert({
                org_id: orgId,
                roadtour_run_id: runId,
                kpi_month: period.periodStart,
                period_start: period.periodStart,
                period_end: period.periodEnd,
                reporting_scope: reportingScope,
                status: 'draft',
                freeze_members_targets: body?.freeze_members_targets !== false,
                lock_campaign_qr_attribution: body?.lock_campaign_qr_attribution !== false,
                created_by: ctx.profile.id,
                updated_by: ctx.profile.id,
            })
            .select(CYCLE_SELECT)
            .single()
        if (error) {
            if (isMissingKpiSchema(error)) return jsonError('RoadTour KPI tables are not migrated yet.', 503)
            if (error.code === '23505') return jsonError('A KPI cycle for this event and month already exists.', 409)
            return jsonError(error.message || 'Failed to create KPI cycle.', 500)
        }
        return NextResponse.json({ success: true, data }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour KPI cycle create API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
