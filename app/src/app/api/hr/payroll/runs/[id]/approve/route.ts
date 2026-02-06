import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: runId } = await params
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageHr(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const { data: run, error: runError } = await supabase
            .from('hr_payroll_runs')
            .select('*')
            .eq('id', runId)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (runError || !run) return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 })
        if (run.status !== 'calculated') return NextResponse.json({ success: false, error: 'Can only approve calculated runs' }, { status: 400 })

        const { data: updatedRun, error: updateError } = await supabase
            .from('hr_payroll_runs')
            .update({
                status: 'approved',
                is_locked: true,
                locked_at: new Date().toISOString(),
                posted_at: new Date().toISOString(),
                posted_by: ctx.userId
            })
            .eq('id', runId)
            .select()
            .single()

        if (updateError) return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })

        // Update all items to approved
        await supabase
            .from('hr_payroll_run_items')
            .update({ status: 'approved' })
            .eq('payroll_run_id', runId)

        // Audit
        await supabase.from('hr_payroll_audit').insert({
            organization_id: ctx.organizationId,
            payroll_run_id: runId,
            action: 'approve',
            performed_by: ctx.userId,
            details: { approved_at: new Date().toISOString() }
        })

        return NextResponse.json({ success: true, data: updatedRun })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
