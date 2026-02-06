import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

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

        const { searchParams } = new URL(request.url)
        const scope = searchParams.get('scope') || 'mine'
        const from = searchParams.get('from')
        const to = searchParams.get('to')

        let userIds: string[] = []

        if (scope === 'team') {
            const isManager = await canManageAttendance(ctx)
            const { data: directReports } = await supabase
                .from('users')
                .select('id')
                .eq('manager_user_id', ctx.userId)

            const { data: deptManaged } = await supabase
                .from('departments')
                .select('id')
                .eq('manager_user_id', ctx.userId)

            const deptIds = (deptManaged || []).map((d: any) => d.id)
            let deptUsers: any[] = []

            if (deptIds.length > 0) {
                const { data } = await supabase
                    .from('users')
                    .select('id')
                    .in('department_id', deptIds)
                deptUsers = data || []
            }

            userIds = Array.from(new Set([
                ...(directReports || []).map((u: any) => u.id),
                ...deptUsers.map((u: any) => u.id)
            ]))

            if (!isManager && userIds.length === 0) {
                return NextResponse.json({ success: true, data: [] })
            }
        }

        let query = supabase
            .from('hr_timesheets')
            .select('*, user:users(id, full_name, email, role_code)')
            .eq('organization_id', ctx.organizationId)
            .order('period_start', { ascending: false })

        if (scope === 'mine') {
            query = query.eq('user_id', ctx.userId)
        }

        if (scope === 'team' && userIds.length > 0) {
            query = query.in('user_id', userIds)
        }

        if (from) query = query.gte('period_start', from)
        if (to) query = query.lte('period_end', to)

        const { data, error } = await query

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to load timesheets:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })

        const body = await request.json()
        const { period_start, period_end, period_type } = body

        if (!period_start || !period_end) return NextResponse.json({ success: false, error: 'period_start and period_end are required' }, { status: 400 })

        // Aggregate attendance entries for the period
        const { data: entries, error: entryError } = await supabase
            .from('hr_attendance_entries')
            .select('worked_minutes, overtime_minutes, attendance_flag, clock_in_at')
            .eq('user_id', ctx.userId)
            .eq('organization_id', ctx.organizationId)
            .gte('clock_in_at', `${period_start}T00:00:00`)
            .lte('clock_in_at', `${period_end}T23:59:59`)
            .not('clock_out_at', 'is', null)

        if (entryError) return NextResponse.json({ success: false, error: entryError.message }, { status: 500 })

        const totalWorkMinutes = (entries || []).reduce((s: number, e: any) => s + (e.worked_minutes || 0), 0)
        const totalOvertimeMinutes = (entries || []).reduce((s: number, e: any) => s + (e.overtime_minutes || 0), 0)
        const totalDays = new Set((entries || []).map((e: any) => new Date(e.clock_in_at).toISOString().split('T')[0])).size
        const lateCount = (entries || []).filter((e: any) => e.attendance_flag === 'late' || e.attendance_flag === 'late_and_early').length
        const earlyLeaveCount = (entries || []).filter((e: any) => e.attendance_flag === 'early_leave' || e.attendance_flag === 'late_and_early').length

        const { data, error } = await supabase
            .from('hr_timesheets')
            .upsert({
                user_id: ctx.userId,
                organization_id: ctx.organizationId,
                period_start, period_end,
                period_type: period_type || 'monthly',
                total_days: totalDays,
                total_work_minutes: totalWorkMinutes,
                total_overtime_minutes: totalOvertimeMinutes,
                late_count: lateCount,
                early_leave_count: earlyLeaveCount,
                status: 'draft'
            }, { onConflict: 'user_id,period_start' })
            .select()
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
