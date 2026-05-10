import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, isKpiHrManager } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => ({}))
    const { data: review } = await supabase
        .from('hr_kpi_reviews').select('*')
        .eq('id', id).eq('organization_id', auth.data.organizationId).single()
    if (!review) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const isManager = review.manager_user_id === auth.data.userId || isKpiHrManager(auth.data)
    if (!isManager) return NextResponse.json({ success: false, error: 'Only the manager may record manager review' }, { status: 403 })

    const update: any = {
        manager_user_id: review.manager_user_id ?? auth.data.userId,
        manager_rating: body.manager_rating ?? review.manager_rating,
        manager_comments: body.manager_comments ?? review.manager_comments,
        strengths: body.strengths ?? review.strengths,
        improvement_areas: body.improvement_areas ?? review.improvement_areas,
    }
    if (body.submit) {
        update.review_stage = 'final_review'
        update.status = 'submitted'
    }
    const { data, error } = await supabase.from('hr_kpi_reviews')
        .update(update).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'review', entityId: id, action: 'manager_review',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
