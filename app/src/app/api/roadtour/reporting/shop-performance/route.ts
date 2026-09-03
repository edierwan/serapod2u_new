import { NextRequest, NextResponse } from 'next/server'

import { loadShopPerformanceDataset } from '@/lib/roadtour/shop-performance-data'
import { isValidMonthKey, normalizeMonthKey } from '@/modules/roadtour/lib/reporting/month'
// Same guard as the other RoadTour reporting routes: authenticated,
// role_level <= 20, own organization.
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

        const dataset = await loadShopPerformanceDataset({
            admin: ctx.admin,
            orgId,
            monthKey: normalizeMonthKey(requestedMonth),
            regionStateId: String(searchParams.get('regionStateId') || '').trim() || null,
        })

        return NextResponse.json({ success: true, data: dataset })
    } catch (error: any) {
        console.error('RoadTour shop performance API error:', error)
        return jsonError(error?.message || 'Failed to load RoadTour shop performance data.', 500)
    }
}
