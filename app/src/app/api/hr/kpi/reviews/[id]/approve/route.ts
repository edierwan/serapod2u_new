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
    const { data, error } = await supabase
        .from('hr_kpi_reviews')
        .update({
            status: 'approved',
            review_stage: 'completed',
            approved_by: auth.data.userId,
            approved_at: new Date().toISOString(),
        })
        .eq('id', id).eq('organization_id', auth.data.organizationId)
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    if (data?.scorecard_id) {
        await supabase.from('hr_kpi_scorecards')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', data.scorecard_id)
    }
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'review', entityId: id, action: 'approve',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
