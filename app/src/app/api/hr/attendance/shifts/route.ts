import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageAttendance, getAttendanceAuthContext } from '@/lib/server/attendanceAccess'

export async function GET() {
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

        const { data, error } = await supabase
            .from('hr_shifts')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .order('start_time')

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to load shifts:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
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

        if (!(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const body = await request.json()
        const name = String(body.name || '').trim()

        if (!name) {
            return NextResponse.json({ success: false, error: 'Shift name is required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_shifts')
            .insert({
                organization_id: ctx.organizationId,
                name,
                start_time: body.start_time,
                end_time: body.end_time,
                break_minutes: Number(body.break_minutes || 0),
                is_active: body.is_active !== false
            })
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
                entity_id: data.id,
                action: 'create_shift',
                metadata: { name }
            })

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to create shift:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
