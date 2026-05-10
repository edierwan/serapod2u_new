import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageTargets } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const periodId = req.nextUrl.searchParams.get('period_id')
    const level = req.nextUrl.searchParams.get('level')
    const departmentId = req.nextUrl.searchParams.get('department_id')
    const employeeUserId = req.nextUrl.searchParams.get('employee_user_id')
    const metricId = req.nextUrl.searchParams.get('metric_id')

    let q = supabase
        .from('hr_kpi_assignments')
        .select('*, hr_kpi_metrics(id, kpi_code, name, unit, perspective)')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (periodId) q = q.eq('period_id', periodId)
    if (level) q = q.eq('assignment_level', level)
    if (departmentId) q = q.eq('department_id', departmentId)
    if (employeeUserId) q = q.eq('employee_user_id', employeeUserId)
    if (metricId) q = q.eq('metric_id', metricId)

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
    const { period_id, metric_id, assignment_level } = body || {}
    if (!period_id || !metric_id || !assignment_level) {
        return NextResponse.json({ success: false, error: 'period_id, metric_id, assignment_level required' }, { status: 400 })
    }
    const insert: any = {
        organization_id: auth.data.organizationId,
        period_id,
        metric_id,
        assignment_level,
        department_id: body.department_id ?? null,
        position_id: body.position_id ?? null,
        employee_user_id: body.employee_user_id ?? null,
        owner_user_id: body.owner_user_id ?? null,
        inherited_from_assignment_id: body.inherited_from_assignment_id ?? null,
        status: body.status ?? 'draft',
        created_by: auth.data.userId,
    }
    const { data, error } = await supabase.from('hr_kpi_assignments').insert(insert).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'assignment', entityId: data.id, action: 'create',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
