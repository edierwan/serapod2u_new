import { NextRequest, NextResponse } from 'next/server'

import { loadVisitParticipants, MAX_VISIT_PARTICIPANT_IDS } from '@/lib/roadtour/visit-participants'
// The Visit Log sits in the RoadTour Reporting group and is guarded exactly like
// the monthly report it shares its month selection with.
import { assertOrgAccess, jsonError, requireKpiAdmin } from '../../kpi/_lib'

export const dynamic = 'force-dynamic'

/** POST rather than GET so a page of visit ids is not carried in the URL. */
export async function POST(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const body = await request.json().catch(() => null)
        const orgId = String(body?.org_id || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const visitIds: string[] = Array.isArray(body?.visit_ids)
            ? body.visit_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            : []
        if (visitIds.length > MAX_VISIT_PARTICIPANT_IDS) {
            return jsonError(`At most ${MAX_VISIT_PARTICIPANT_IDS} visits can be resolved at a time.`)
        }
        if (visitIds.length === 0) return NextResponse.json({ success: true, data: {} })

        const data = await loadVisitParticipants({ admin: ctx.admin, orgId, visitIds })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('RoadTour visit participants API error:', error)
        return jsonError(error?.message || 'Failed to resolve Visit Log participants.', 500)
    }
}
