import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

/** Submit employee self-review notes. Sets review_stage to manager_review when submit=true. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => ({}))
    const { data: review } = await supabase
        .from('hr_kpi_reviews')
        .select('*')
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .single()
    if (!review) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    if (review.employee_user_id !== auth.data.userId) {
        return NextResponse.json({ success: false, error: 'Only the employee may submit self-review' }, { status: 403 })
    }

    const update: any = {
        employee_comments: body.employee_comments ?? review.employee_comments,
        development_plan: body.development_plan ?? review.development_plan,
    }
    if (body.submit) {
        update.review_stage = 'manager_review'
        update.status = 'submitted'
        update.submitted_by = auth.data.userId
        update.submitted_at = new Date().toISOString()
    }
    const { data, error } = await supabase.from('hr_kpi_reviews')
        .update(update).eq('id', id)
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'review', entityId: id, action: 'self_review',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
