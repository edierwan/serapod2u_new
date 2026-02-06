import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageAttendance(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const { data: ts } = await supabase
            .from('hr_timesheets')
            .select('id, status')
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (!ts) return NextResponse.json({ success: false, error: 'Timesheet not found' }, { status: 404 })
        if (!['submitted', 'pending'].includes(ts.status)) return NextResponse.json({ success: false, error: 'Can only reject submitted timesheets' }, { status: 400 })

        const { data, error } = await supabase
            .from('hr_timesheets')
            .update({ status: 'rejected' })
            .eq('id', id)
            .select()
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
