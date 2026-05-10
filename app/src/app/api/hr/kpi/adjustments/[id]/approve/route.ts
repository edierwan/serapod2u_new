import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canApproveReview } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canApproveReview(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const { data: adj, error: aErr } = await supabase
        .from('hr_kpi_adjustments').select('*')
        .eq('id', id).eq('organization_id', auth.data.organizationId).single()
    if (aErr || !adj) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const { error: uErr } = await supabase
        .from('hr_kpi_scorecard_items')
        .update({ actual_value: adj.adjusted_actual_value })
        .eq('id', adj.scorecard_item_id)
    if (uErr) return NextResponse.json({ success: false, error: uErr.message }, { status: 500 })

    const { data, error } = await supabase
        .from('hr_kpi_adjustments')
        .update({ status: 'approved', approved_by: auth.data.userId, approved_at: new Date().toISOString() })
        .eq('id', id).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'adjustment', entityId: id, action: 'approve',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
