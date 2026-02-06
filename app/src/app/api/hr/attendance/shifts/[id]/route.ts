import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageAttendance, getAttendanceAuthContext } from '@/lib/server/attendanceAccess'

export async function PATCH(
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

        if (!(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { id } = await params
        const body = await request.json()

        const updateData: Record<string, any> = {}
        if (body.name !== undefined) updateData.name = String(body.name).trim()
        if (body.start_time !== undefined) updateData.start_time = body.start_time
        if (body.end_time !== undefined) updateData.end_time = body.end_time
        if (body.break_minutes !== undefined) updateData.break_minutes = Number(body.break_minutes || 0)
        if (body.is_active !== undefined) updateData.is_active = !!body.is_active

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ success: false, error: 'No updates provided' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_shifts')
            .update(updateData)
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
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
                entity_type: 'shift',
                entity_id: id,
                action: 'update_shift',
                metadata: updateData
            })

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to update shift:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function DELETE(
    _request: NextRequest,
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

        if (!(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { id } = await params

        const { error } = await supabase
            .from('hr_shifts')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        await supabase
            .from('hr_attendance_audit')
            .insert({
                organization_id: ctx.organizationId,
                actor_user_id: ctx.userId,
                entity_type: 'shift',
                entity_id: id,
                action: 'delete_shift'
            })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Failed to delete shift:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
