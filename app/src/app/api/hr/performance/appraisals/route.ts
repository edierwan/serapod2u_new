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
            .from('hr_appraisal_cycles')
            .select('*')
            .eq('organization_id', organizationId)
            .order('start_date', { ascending: false })

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to list appraisal cycles:', error)
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

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const body = await request.json()
        const { name, description, cycle_type, start_date, end_date, self_review_enabled, peer_review_enabled, manager_review_required } = body

        if (!name || !start_date || !end_date) {
            return NextResponse.json({ success: false, error: 'Name, start date, and end date are required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_appraisal_cycles')
            .insert({
                organization_id: ctx.organizationId,
                name,
                description: description || null,
                cycle_type: cycle_type || 'annual',
                start_date,
                end_date,
                self_review_enabled: self_review_enabled ?? true,
                peer_review_enabled: peer_review_enabled ?? false,
                manager_review_required: manager_review_required ?? true,
                status: 'draft',
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to create appraisal cycle:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
