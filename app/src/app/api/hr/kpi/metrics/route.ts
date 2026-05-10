import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const status = req.nextUrl.searchParams.get('status')
    const perspective = req.nextUrl.searchParams.get('perspective')
    const search = req.nextUrl.searchParams.get('q')

    let q = supabase
        .from('hr_kpi_metrics')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .order('name', { ascending: true })
    if (status) q = q.eq('status', status)
    if (perspective) q = q.eq('perspective', perspective)
    if (search) q = q.or(`name.ilike.%${search}%,kpi_code.ilike.%${search}%`)

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { kpi_code, name, unit } = body || {}
    if (!kpi_code || !name || !unit) {
        return NextResponse.json({ success: false, error: 'kpi_code, name, unit are required' }, { status: 400 })
    }

    const insert: any = {
        organization_id: auth.data.organizationId,
        kpi_code: String(kpi_code).trim().toUpperCase(),
        name: String(name).trim(),
        description: body.description ?? null,
        category: body.category ?? null,
        perspective: body.perspective ?? null,
        unit,
        measurement_direction: body.measurement_direction ?? 'higher_is_better',
        calculation_type: body.calculation_type ?? 'manual',
        formula_description: body.formula_description ?? null,
        formula_config: body.formula_config ?? {},
        data_source_status: body.data_source_status ?? 'unmapped',
        owner_user_id: body.owner_user_id ?? null,
        status: body.status ?? 'draft',
        is_active: body.is_active ?? true,
        created_by: auth.data.userId,
    }

    const { data, error } = await supabase.from('hr_kpi_metrics').insert(insert).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'metric', entityId: data.id, action: 'create',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
