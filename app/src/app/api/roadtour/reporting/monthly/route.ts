import { NextRequest, NextResponse } from 'next/server'

import { loadRoadtourReportingDataset } from '@/lib/roadtour/reporting-data'
import { isValidMonthKey, normalizeMonthKey } from '@/modules/roadtour/lib/reporting/month'
import { normalizeImpactWindowDays } from '@/modules/roadtour/lib/reporting/impactModel'
// The RoadTour admin guard (authenticated, role_level <= 20, own organization)
// lives with the KPI APIs and is shared as-is — the permission surface for
// reporting is identical to the RLS on `roadtour_official_visits`.
import { assertOrgAccess, jsonError, requireKpiAdmin } from '../../kpi/_lib'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const orgId = String(searchParams.get('org_id') || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const requestedMonth = String(searchParams.get('month') || '').trim()
        if (requestedMonth && !isValidMonthKey(requestedMonth)) {
            return jsonError('Month must be in YYYY-MM format.')
        }

        const dataset = await loadRoadtourReportingDataset({
            admin: ctx.admin,
            orgId,
            monthKey: normalizeMonthKey(requestedMonth),
            windowDays: normalizeImpactWindowDays(searchParams.get('window')),
            campaignId: String(searchParams.get('campaignId') || '').trim() || null,
            accountManagerUserId: String(searchParams.get('accountManagerUserId') || '').trim() || null,
            regionStateId: String(searchParams.get('regionStateId') || '').trim() || null,
            carryForwardOpenItems: searchParams.get('carryForward') === 'open',
        })

        return NextResponse.json({ success: true, data: dataset })
    } catch (error: any) {
        console.error('RoadTour reporting API error:', error)
        return jsonError(error?.message || 'Failed to load RoadTour reporting data.', 500)
    }
}
