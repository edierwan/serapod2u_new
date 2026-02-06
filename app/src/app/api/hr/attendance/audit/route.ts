import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

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

        if (!(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { data, error } = await supabase
            .from('hr_attendance_audit')
            .select('*, actor:actor_user_id(full_name, email)')
            .eq('organization_id', ctx.organizationId)
            .order('created_at', { ascending: false })
            .limit(200)

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to load audit log:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
