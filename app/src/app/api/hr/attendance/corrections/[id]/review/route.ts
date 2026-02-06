import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceAuthContext, canManageAttendance } from '@/lib/server/attendanceAccess'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: correctionId } = await params
        const supabase = (await createClient()) as any
        const ctxResult = await getAttendanceAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageAttendance(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const body = await request.json()
        const action = body.action // 'approved' | 'rejected'
        if (!['approved', 'rejected'].includes(action)) return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })

        const { data: correction, error: fetchError } = await supabase
            .from('hr_attendance_corrections')
            .select('*, entry:hr_attendance_entries(*)')
            .eq('id', correctionId)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (fetchError || !correction) return NextResponse.json({ success: false, error: 'Correction not found' }, { status: 404 })
        if (correction.status !== 'pending') return NextResponse.json({ success: false, error: 'Already reviewed' }, { status: 400 })

        // Update correction status
        const { error: updateError } = await supabase
            .from('hr_attendance_corrections')
            .update({
                status: action,
                reviewed_by: ctx.userId,
                reviewed_at: new Date().toISOString(),
                review_note: body.note || null
            })
            .eq('id', correctionId)

        if (updateError) return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })

        // If approved, update the original entry
        if (action === 'approved' && correction.entry_id) {
            const updates: any = { status: 'adjusted' }
            if (correction.corrected_clock_in) updates.clock_in_at = correction.corrected_clock_in
            if (correction.corrected_clock_out) {
                updates.clock_out_at = correction.corrected_clock_out
                // Recalculate worked minutes
                const clockIn = correction.corrected_clock_in || correction.entry?.clock_in_at
                if (clockIn) {
                    updates.worked_minutes = Math.round((new Date(correction.corrected_clock_out).getTime() - new Date(clockIn).getTime()) / 60000)
                }
            }

            await supabase.from('hr_attendance_entries').update(updates).eq('id', correction.entry_id)

            // Audit
            await supabase.from('hr_attendance_audit').insert({
                organization_id: ctx.organizationId,
                entry_id: correction.entry_id,
                action: 'correction_approved',
                performed_by: ctx.userId,
                old_values: { clock_in: correction.entry?.clock_in_at, clock_out: correction.entry?.clock_out_at },
                new_values: updates
            })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
