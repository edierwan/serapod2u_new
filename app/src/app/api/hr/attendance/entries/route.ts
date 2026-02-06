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
        const userId = searchParams.get('user_id') || ctx.userId
        const from = searchParams.get('from')
        const to = searchParams.get('to')

        if (userId !== ctx.userId && !(await canManageAttendance(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        let query = supabase
            .from('hr_attendance_entries')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .eq('user_id', userId)
            .order('clock_in_at', { ascending: false })

        if (from) query = query.gte('clock_in_at', `${from}T00:00:00.000Z`)
        if (to) query = query.lte('clock_in_at', `${to}T23:59:59.999Z`)

        const { data, error } = await query

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to load attendance entries:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
