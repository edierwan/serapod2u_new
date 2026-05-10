import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageTargets } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const periodId = req.nextUrl.searchParams.get('period_id')
    const assignmentId = req.nextUrl.searchParams.get('assignment_id')

    let q = supabase
        .from('hr_kpi_actuals')
        .select('*, hr_kpi_metrics(id, kpi_code, name, unit)')
        .eq('organization_id', auth.data.organizationId)
        .order('calculated_at', { ascending: false })
    if (periodId) q = q.eq('period_id', periodId)
    if (assignmentId) q = q.eq('assignment_id', assignmentId)

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageTargets(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const { period_id, assignment_id, metric_id, actual_value } = body || {}
    if (!period_id || !assignment_id || !metric_id || actual_value == null) {
        return NextResponse.json({ success: false, error: 'period_id, assignment_id, metric_id, actual_value required' }, { status: 400 })
    }
    const upsert: any = {
        organization_id: auth.data.organizationId,
        period_id,
        assignment_id,
        metric_id,
        actual_value,
        actual_unit: body.actual_unit ?? null,
        calculated_at: body.calculated_at ?? new Date().toISOString(),
        calculation_source: body.calculation_source ?? 'manual',
        calculation_meta: body.calculation_meta ?? {},
        status: body.status ?? 'final',
        created_by: auth.data.userId,
    }
    const { data, error } = await supabase.from('hr_kpi_actuals')
        .upsert(upsert, { onConflict: 'assignment_id,period_id' })
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'actual', entityId: data.id, action: 'upsert',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
