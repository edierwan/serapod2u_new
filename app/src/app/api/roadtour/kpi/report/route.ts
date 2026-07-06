import { NextRequest, NextResponse } from 'next/server'

import { isValidKpiMonth, type KpiPerformanceStatus } from '@/lib/roadtour/kpi'
import { computeKpiReport } from '@/lib/roadtour/kpi-report'
import { assertOrgAccess, isMissingKpiSchema, jsonError, requireKpiAdmin } from '../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set<KpiPerformanceStatus>(['achieved', 'on_track', 'at_risk', 'needs_focus'])

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const orgId = String(searchParams.get('org_id') || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const kpiMonth = String(searchParams.get('kpi_month') || '').trim()
        const runId = String(searchParams.get('roadtour_run_id') || '').trim()
        if (!isValidKpiMonth(kpiMonth)) return jsonError('KPI month must be in YYYY-MM format.')
        if (!runId) return jsonError('RoadTour Event is required.')

        const statusParam = String(searchParams.get('status') || '').trim() as KpiPerformanceStatus

        const report = await computeKpiReport(ctx.admin, {
            orgId,
            kpiMonth,
            roadtourRunId: runId,
            teamId: String(searchParams.get('team_id') || '').trim() || null,
            leaderUserId: String(searchParams.get('leader_id') || '').trim() || null,
            status: ALLOWED_STATUS.has(statusParam) ? statusParam : null,
        })
        return NextResponse.json({ success: true, data: report })
    } catch (error: any) {
        if (isMissingKpiSchema(error)) return NextResponse.json({ success: true, data: null, schemaMissing: true })
        console.error('RoadTour KPI report API error:', error)
        return jsonError(error.message || 'Internal server error', 500)
    }
}
