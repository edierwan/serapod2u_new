import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageAttendance, getAttendanceAuthContext } from '@/lib/server/attendanceAccess'

const DEFAULT_POLICY = {
    workdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    grace_minutes: 10,
    timezone: 'Asia/Kuala_Lumpur',
    require_shift: false
}

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
            .from('hr_attendance_policies')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .single()

        if (error && error.code !== 'PGRST116') {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        if (!data) {
            const { data: inserted, error: insertError } = await supabase
                .from('hr_attendance_policies')
                .insert({
                    organization_id: ctx.organizationId,
                    ...DEFAULT_POLICY,
                    created_by: ctx.userId,
                    updated_by: ctx.userId
                })
                .select('*')
                .single()

            if (insertError) {
                return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
            }

            return NextResponse.json({ success: true, data: inserted })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to load attendance policy:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function PUT(request: NextRequest) {
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

        const payload = {
            workdays: Array.isArray(body.workdays) ? body.workdays : DEFAULT_POLICY.workdays,
            grace_minutes: Number.isFinite(body.grace_minutes) ? Number(body.grace_minutes) : DEFAULT_POLICY.grace_minutes,
            timezone: body.timezone ? String(body.timezone) : DEFAULT_POLICY.timezone,
            require_shift: !!body.require_shift,
            late_after_minutes: Number.isFinite(body.late_after_minutes) ? Number(body.late_after_minutes) : 15,
            early_leave_before_minutes: Number.isFinite(body.early_leave_before_minutes) ? Number(body.early_leave_before_minutes) : 15,
            max_open_entry_hours: Number.isFinite(body.max_open_entry_hours) ? Number(body.max_open_entry_hours) : 16,
            allow_clock_out_without_clock_in: !!body.allow_clock_out_without_clock_in,
            overtime_policy_json: body.overtime_policy_json ?? { enabled: false, autoApprove: false, maxDailyMinutes: 120, rate: 1.5 },
            updated_by: ctx.userId,
            updated_at: new Date().toISOString()
        }

        const { data, error } = await supabase
            .from('hr_attendance_policies')
            .upsert({
                organization_id: ctx.organizationId,
                ...payload
            }, { onConflict: 'organization_id' })
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
                entity_type: 'policy',
                entity_id: data.id,
                action: 'update_policy',
                metadata: payload
            })

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to update attendance policy:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
