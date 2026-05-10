import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageObjectives } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const periodId = req.nextUrl.searchParams.get('period_id')
    let q = supabase
        .from('hr_kpi_objectives')
        .select('*, hr_kpi_periods(name, status)')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (periodId) q = q.eq('period_id', periodId)

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageObjectives(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { period_id, objective_code, title } = body || {}
    if (!period_id || !objective_code || !title) {
        return NextResponse.json({ success: false, error: 'period_id, objective_code, title are required' }, { status: 400 })
    }

    const insert: any = {
        organization_id: auth.data.organizationId,
        period_id,
        objective_code: String(objective_code).trim().toUpperCase(),
        title: String(title).trim(),
        description: body.description ?? null,
        perspective: body.perspective ?? null,
        owner_user_id: body.owner_user_id ?? null,
        status: body.status ?? 'draft',
        start_date: body.start_date ?? null,
        end_date: body.end_date ?? null,
        progress_percent: body.progress_percent ?? 0,
        created_by: auth.data.userId,
    }

    const { data, error } = await supabase.from('hr_kpi_objectives').insert(insert).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'objective', entityId: data.id, action: 'create',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
