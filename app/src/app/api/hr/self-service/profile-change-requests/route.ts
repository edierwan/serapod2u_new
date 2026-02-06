import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function GET() {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const { organizationId } = ctxResult.data
        if (!organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_profile_change_requests')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to list profile change requests:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const body = await request.json()
        const employeeUserId = String(body.employee_user_id || ctx.userId || '').trim()
        if (!employeeUserId || !body.change_payload) {
            return NextResponse.json({ success: false, error: 'Employee and change payload are required' }, { status: 400 })
        }

        const isManager = await canManageHr(ctx)
        const status = isManager && body.status ? body.status : 'pending'

        const { data, error } = await supabase
            .from('hr_profile_change_requests')
            .insert({
                organization_id: ctx.organizationId,
                employee_user_id: employeeUserId,
                change_payload: body.change_payload,
                status,
                reviewed_by: isManager ? body.reviewed_by || null : null,
                reviewed_at: isManager ? body.reviewed_at || null : null
            })
            .select('*')
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to create profile change request:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
