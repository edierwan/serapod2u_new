import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')
        const isManager = await canManageAttendance(ctx)

        let query = supabase
            .from('hr_attendance_corrections')
            .select('*, entry:hr_attendance_entries(id, clock_in_at, clock_out_at, user_id), requester:users!requested_by(id, full_name, email)')
            .eq('organization_id', ctx.organizationId)
            .order('created_at', { ascending: false })

        // Non-managers only see their own
        if (!isManager) query = query.eq('requested_by', ctx.userId)
        if (status) query = query.eq('status', status)

        const { data, error } = await query
        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
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
        if (!body.entry_id || !body.reason) return NextResponse.json({ success: false, error: 'entry_id and reason are required' }, { status: 400 })

        // Verify entry belongs to user
        const { data: entry } = await supabase
            .from('hr_attendance_entries')
            .select('id, user_id')
            .eq('id', body.entry_id)
            .eq('user_id', ctx.userId)
            .single()

        if (!entry) return NextResponse.json({ success: false, error: 'Entry not found or not yours' }, { status: 404 })

        const { data, error } = await supabase
            .from('hr_attendance_corrections')
            .insert({
                organization_id: ctx.organizationId,
                entry_id: body.entry_id,
                requested_by: ctx.userId,
                reason: body.reason,
                corrected_clock_in: body.corrected_clock_in || null,
                corrected_clock_out: body.corrected_clock_out || null,
                status: 'pending'
            })
            .select()
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
