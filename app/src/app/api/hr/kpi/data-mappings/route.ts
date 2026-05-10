import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const metricId = req.nextUrl.searchParams.get('metric_id')
    let q = supabase
        .from('hr_kpi_data_mappings')
        .select('*, hr_kpi_metrics(id, kpi_code, name)')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (metricId) q = q.eq('metric_id', metricId)

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
    const { metric_id, calculation_type } = body || {}
    if (!metric_id || !calculation_type) {
        return NextResponse.json({ success: false, error: 'metric_id, calculation_type required' }, { status: 400 })
    }
    const upsert: any = {
        organization_id: auth.data.organizationId,
        metric_id,
        calculation_type,
        source_module: body.source_module ?? null,
        source_table: body.source_table ?? null,
        source_fields: body.source_fields ?? {},
        formula_config: body.formula_config ?? {},
        validation_status: 'pending',
        created_by: auth.data.userId,
    }
    const { data, error } = await supabase.from('hr_kpi_data_mappings')
        .upsert(upsert, { onConflict: 'metric_id' })
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'data_mapping', entityId: data.id, action: 'upsert',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
