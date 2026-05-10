import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

/**
 * Stub sync endpoint for an auto-mapped KPI. The MVP supports manual entry
 * via /api/hr/kpi/actuals; auto sync requires per-metric formula execution
 * which will be expanded in a follow-up phase. This endpoint returns a
 * not-implemented marker today and records the attempt for audit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { period_id } = body || {}

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'data_mapping', entityId: id, action: 'sync_attempted',
        newValues: { period_id, status: 'not_implemented' },
        actorUserId: auth.data.userId,
    })

    return NextResponse.json({
        success: false,
        error: 'Auto sync not yet implemented; please record actuals via the manual entry endpoint.',
    }, { status: 501 })
}
