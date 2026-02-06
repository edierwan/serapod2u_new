import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function GET(_request: NextRequest) {
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

        const { data, error } = await supabase
            .from('hr_payroll_runs')
            .select('id, period_start, period_end, payroll_date, status, currency, total_net, total_gross, total_deductions, total_employer_contributions, created_at')
            .eq('organization_id', ctx.organizationId)
            .order('created_at', { ascending: false })

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: data || [] })
    } catch (error: any) {
        console.error('Failed to load payroll runs:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageHr(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const body = await request.json()

        // Count employees with active compensation in this org
        const { count } = await supabase
            .from('hr_employee_compensation')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', ctx.organizationId)
            .eq('status', 'active')

        const { data, error } = await supabase
            .from('hr_payroll_runs')
            .insert({
                organization_id: ctx.organizationId,
                name: body.name,
                period_start: body.period_start,
                period_end: body.period_end,
                payroll_date: body.period_end,
                status: 'draft',
                currency: 'MYR',
                employee_count: count || 0,
                notes: body.notes || null
            })
            .select()
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
