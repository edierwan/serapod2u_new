import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

// ─── GET  /api/hr/attendance/overtime/requests ── list OT requests
// ─── POST /api/hr/attendance/overtime/requests ── create/update OT requests

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }
        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const url = new URL(request.url)
        const status = url.searchParams.get('status') // draft, submitted, approved, rejected
        const employee_id = url.searchParams.get('employee_id')
        const start_date = url.searchParams.get('start_date')
        const end_date = url.searchParams.get('end_date')
        const page = parseInt(url.searchParams.get('page') || '1', 10)
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)

        let query = supabase
            .from('hr_overtime_requests')
            .select('*, users!hr_overtime_requests_employee_id_fkey(full_name)', { count: 'exact' })
            .eq('organization_id', ctx.organizationId)
            .order('request_date', { ascending: false })
            .range((page - 1) * limit, page * limit - 1)

        // Managers see all, employees see their own
        const isManager = canManageAttendance(ctx)
        if (!isManager) {
            query = query.eq('employee_id', ctx.userId)
        } else if (employee_id) {
            query = query.eq('employee_id', employee_id)
        }

        if (status) {
            query = query.eq('status', status)
        }
        if (start_date) {
            query = query.gte('request_date', start_date)
        }
        if (end_date) {
            query = query.lte('request_date', end_date)
        }

        const { data, error, count } = await query

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            data: data || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        })
    } catch (error: any) {
        console.error('Failed to fetch OT requests:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }
        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const body = await request.json()
        const { action } = body // submit, approve, reject, cancel

        if (action === 'submit') {
            return handleSubmit(supabase, ctx, body)
        } else if (action === 'approve') {
            return handleApproveReject(supabase, ctx, body, 'approved')
        } else if (action === 'reject') {
            return handleApproveReject(supabase, ctx, body, 'rejected')
        } else if (action === 'cancel') {
            return handleCancel(supabase, ctx, body)
        }

        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
    } catch (error: any) {
        console.error('Failed to process OT request:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

async function handleSubmit(supabase: any, ctx: any, body: any) {
    const {
        attendance_entry_id,
        request_date,
        planned_start,
        planned_end,
        reason,
        ot_minutes_claimed,
    } = body

    if (!request_date || !reason) {
        return NextResponse.json({ success: false, error: 'request_date and reason are required' }, { status: 400 })
    }

    // Check if OT policy allows this
    const { data: policy } = await supabase
        .from('hr_overtime_policies')
        .select('*')
        .eq('organization_id', ctx.organizationId)
        .maybeSingle()

    if (!policy || !policy.enabled) {
        return NextResponse.json({ success: false, error: 'Overtime tracking is not enabled' }, { status: 400 })
    }

    const requestData: any = {
        organization_id: ctx.organizationId,
        employee_id: ctx.userId,
        attendance_entry_id: attendance_entry_id || null,
        request_date,
        planned_start_time: planned_start || null,
        planned_end_time: planned_end || null,
        reason,
        ot_minutes_claimed: ot_minutes_claimed || null,
        status: policy.require_approval ? 'submitted' : 'approved',
    }

    // Auto-approve if policy doesn't require approval
    if (!policy.require_approval) {
        requestData.approved_by = ctx.userId
        requestData.approved_at = new Date().toISOString()
        requestData.approver_remarks = 'Auto-approved per policy'
    }

    const { data, error } = await supabase
        .from('hr_overtime_requests')
        .insert(requestData)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
        success: true,
        data,
        auto_approved: !policy.require_approval,
    })
}

async function handleApproveReject(supabase: any, ctx: any, body: any, status: 'approved' | 'rejected') {
    const { request_id, remarks } = body

    if (!request_id) {
        return NextResponse.json({ success: false, error: 'request_id is required' }, { status: 400 })
    }

    // Only managers can approve/reject
    if (!canManageAttendance(ctx)) {
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
    }

    // Load the request
    const { data: existingRequest } = await supabase
        .from('hr_overtime_requests')
        .select('*')
        .eq('id', request_id)
        .eq('organization_id', ctx.organizationId)
        .single()

    if (!existingRequest) {
        return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 })
    }

    if (existingRequest.status !== 'submitted') {
        return NextResponse.json({ success: false, error: `Cannot ${status === 'approved' ? 'approve' : 'reject'} a request with status: ${existingRequest.status}` }, { status: 400 })
    }

    const updateData: any = {
        status,
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
        approver_remarks: remarks || null,
    }

    const { data, error } = await supabase
        .from('hr_overtime_requests')
        .update(updateData)
        .eq('id', request_id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // If approved & linked to an attendance entry, update the entry overtime_minutes
    if (status === 'approved' && data.attendance_entry_id && data.ot_minutes_claimed) {
        await supabase
            .from('hr_attendance_entries')
            .update({ overtime_minutes: data.ot_minutes_claimed })
            .eq('id', data.attendance_entry_id)
    }

    return NextResponse.json({ success: true, data })
}

async function handleCancel(supabase: any, ctx: any, body: any) {
    const { request_id } = body

    if (!request_id) {
        return NextResponse.json({ success: false, error: 'request_id is required' }, { status: 400 })
    }

    // Load to verify ownership
    const { data: existingRequest } = await supabase
        .from('hr_overtime_requests')
        .select('*')
        .eq('id', request_id)
        .eq('organization_id', ctx.organizationId)
        .single()

    if (!existingRequest) {
        return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 })
    }

    // Only the requester can cancel, and only if not already approved
    if (existingRequest.employee_id !== ctx.userId && !canManageAttendance(ctx)) {
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
    }

    if (existingRequest.status === 'approved') {
        return NextResponse.json({ success: false, error: 'Cannot cancel an approved request' }, { status: 400 })
    }

    const { error } = await supabase
        .from('hr_overtime_requests')
        .delete()
        .eq('id', request_id)

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted: true })
}
