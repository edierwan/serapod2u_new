import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canApproveReview, isKpiHrManager } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const allowed = isKpiHrManager(auth.data) || (await canApproveReview(auth.data))
    if (!allowed) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const { data, error } = await supabase
        .from('hr_kpi_reviews')
        .update({
            status: 'rejected',
            review_stage: 'self_review',
            manager_comments: body.manager_comments ?? null,
        })
        .eq('id', id).eq('organization_id', auth.data.organizationId)
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'review', entityId: id, action: 'request_changes',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
