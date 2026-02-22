import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const { organizationId, userId, roleLevel } = ctxResult.data
        if (!organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')
        const cycleId = searchParams.get('cycle_id')
        const myReviews = searchParams.get('my') === 'true'

        let query = supabase
            .from('hr_performance_reviews')
            .select(`
                *,
                employee:users!hr_performance_reviews_employee_id_fkey(id, full_name, email, avatar_url),
                reviewer:users!hr_performance_reviews_reviewer_id_fkey(id, full_name, email),
                cycle:hr_appraisal_cycles(id, name, cycle_type),
                template:hr_review_templates(id, name, template_type)
            `)
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })

        if (status) query = query.eq('status', status)
        if (cycleId) query = query.eq('appraisal_cycle_id', cycleId)
        if (myReviews) {
            // Show reviews where user is the employee or the reviewer
            query = query.or(`employee_id.eq.${userId},reviewer_id.eq.${userId}`)
        } else if (roleLevel && roleLevel > 20) {
            // Non-admin: only see own reviews or reviews they need to do
            query = query.or(`employee_id.eq.${userId},reviewer_id.eq.${userId}`)
        }

        const { data, error } = await query.limit(100)

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to list performance reviews:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const body = await request.json()
        const { employee_id, reviewer_id, appraisal_cycle_id, review_template_id, review_type, due_date } = body

        if (!employee_id) {
            return NextResponse.json({ success: false, error: 'Employee is required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_performance_reviews')
            .insert({
                organization_id: ctx.organizationId,
                employee_id,
                reviewer_id: reviewer_id || null,
                appraisal_cycle_id: appraisal_cycle_id || null,
                review_template_id: review_template_id || null,
                review_type: review_type || 'manager',
                due_date: due_date || null,
                status: 'pending',
            })
            .select(`
                *,
                employee:users!hr_performance_reviews_employee_id_fkey(id, full_name, email),
                reviewer:users!hr_performance_reviews_reviewer_id_fkey(id, full_name, email)
            `)
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to create performance review:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const { organizationId, userId } = ctxResult.data
        if (!organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const body = await request.json()
        const { id, status, overall_rating, overall_remarks, employee_remarks, responses, kpi_scores } = body

        if (!id) {
            return NextResponse.json({ success: false, error: 'Review ID is required' }, { status: 400 })
        }

        const updates: Record<string, any> = { updated_at: new Date().toISOString() }
        if (status) {
            updates.status = status
            if (status === 'submitted') updates.submitted_at = new Date().toISOString()
            if (status === 'reviewed') updates.reviewed_at = new Date().toISOString()
            if (status === 'acknowledged') updates.acknowledged_at = new Date().toISOString()
        }
        if (overall_rating !== undefined) updates.overall_rating = overall_rating
        if (overall_remarks !== undefined) updates.overall_remarks = overall_remarks
        if (employee_remarks !== undefined) updates.employee_remarks = employee_remarks
        if (responses !== undefined) updates.responses = responses
        if (kpi_scores !== undefined) updates.kpi_scores = kpi_scores

        const { data, error } = await supabase
            .from('hr_performance_reviews')
            .update(updates)
            .eq('id', id)
            .eq('organization_id', organizationId)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to update performance review:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
