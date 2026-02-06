import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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

        const { id } = await params
        const body = await request.json()
        const action = body.action === 'reject' ? 'reject' : 'approve'
        const reason = body.reason ? String(body.reason) : null

        const { data: timesheet, error: tsError } = await supabase
            .from('hr_timesheets')
            .select('id, user_id, organization_id, status')
            .eq('id', id)
            .single()

        if (tsError || !timesheet) {
            return NextResponse.json({ success: false, error: 'Timesheet not found' }, { status: 404 })
        }

        if (timesheet.organization_id !== ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const isAdmin = await canManageAttendance(ctx)

        const { data: userRecord } = await supabase
            .from('users')
            .select('id, manager_user_id, department_id')
            .eq('id', timesheet.user_id)
            .single()

        const { data: dept } = userRecord?.department_id
            ? await supabase
                .from('departments')
                .select('manager_user_id')
                .eq('id', userRecord.department_id)
                .single()
            : { data: null }

        const isManager = userRecord?.manager_user_id === ctx.userId || dept?.manager_user_id === ctx.userId

        if (!isAdmin && !isManager) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const now = new Date().toISOString()
        const updateData: Record<string, any> = {
            status: action === 'approve' ? 'approved' : 'rejected',
            approved_at: action === 'approve' ? now : null,
            approved_by: action === 'approve' ? ctx.userId : null,
            rejected_reason: action === 'reject' ? reason : null,
            updated_at: now
        }

        const { data, error } = await supabase
            .from('hr_timesheets')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        await supabase
            .from('hr_attendance_audit')
            .insert({
                organization_id: ctx.organizationId,
                actor_user_id: ctx.userId,
                entity_type: 'timesheet',
                entity_id: id,
                action: action === 'approve' ? 'approve_timesheet' : 'reject_timesheet',
                metadata: { reason }
            })

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to approve timesheet:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
