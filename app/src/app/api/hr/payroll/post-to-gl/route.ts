import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/hr/payroll/post-to-gl
 * Post an approved payroll run to GL
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient() as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, roles!inner(role_level)')
            .eq('id', user.id)
            .single()

        if (!userData) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const roleLevel = (userData.roles as any)?.role_level || 999
        if (roleLevel > 20) {
            return NextResponse.json({ error: 'Insufficient permissions. HQ Admin required.' }, { status: 403 })
        }

        const body = await request.json()
        const { payroll_run_id, posting_date } = body

        if (!payroll_run_id) {
            return NextResponse.json({ error: 'payroll_run_id is required' }, { status: 400 })
        }

        const { data, error } = await supabase.rpc('post_payroll_run_to_gl', {
            p_payroll_run_id: payroll_run_id,
            p_posting_date: posting_date || new Date().toISOString().split('T')[0],
        })

        if (error) {
            console.error('Error posting payroll to GL:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const result = data as any
        if (result && !result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 })
        }

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error in payroll post-to-gl API:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/hr/payroll/post-to-gl
 * Reverse a payroll GL posting (for rerun)
 */
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient() as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, roles!inner(role_level)')
            .eq('id', user.id)
            .single()

        if (!userData) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        const roleLevel = (userData.roles as any)?.role_level || 999
        if (roleLevel > 20) {
            return NextResponse.json({ error: 'Insufficient permissions. HQ Admin required.' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const payrollRunId = searchParams.get('payroll_run_id')
        const reason = searchParams.get('reason') || 'Payroll rerun'

        if (!payrollRunId) {
            return NextResponse.json({ error: 'payroll_run_id query param required' }, { status: 400 })
        }

        const { data, error } = await supabase.rpc('reverse_payroll_gl_posting', {
            p_payroll_run_id: payrollRunId,
            p_reason: reason,
        })

        if (error) {
            console.error('Error reversing payroll GL posting:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const result = data as any
        if (result && !result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 })
        }

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error in payroll GL reversal API:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
