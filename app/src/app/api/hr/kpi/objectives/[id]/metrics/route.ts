import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageObjectives, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageObjectives(auth.data)) && !(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const { metric_id, weight_percent, sort_order } = body || {}
    if (!metric_id) return NextResponse.json({ success: false, error: 'metric_id required' }, { status: 400 })

    // confirm objective belongs to caller's org
    const { data: obj } = await supabase.from('hr_kpi_objectives').select('id, organization_id')
        .eq('id', id).eq('organization_id', auth.data.organizationId).single()
    if (!obj) return NextResponse.json({ success: false, error: 'Objective not found' }, { status: 404 })

    const { data, error } = await supabase.from('hr_kpi_objective_metrics').upsert({
        objective_id: id,
        metric_id,
        weight_percent: weight_percent ?? 0,
        sort_order: sort_order ?? 0,
    }, { onConflict: 'objective_id,metric_id' }).select('*').single()

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'objective_metric', entityId: id, action: 'link',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const metricId = req.nextUrl.searchParams.get('metric_id')
    if (!metricId) return NextResponse.json({ success: false, error: 'metric_id required' }, { status: 400 })

    const { error } = await supabase.from('hr_kpi_objective_metrics')
        .delete().eq('objective_id', id).eq('metric_id', metricId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'objective_metric', entityId: id, action: 'unlink',
        oldValues: { metric_id: metricId }, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { data, error } = await supabase
        .from('hr_kpi_objective_metrics')
        .select('weight_percent, sort_order, hr_kpi_metrics(id, kpi_code, name, perspective, unit, status)')
        .eq('objective_id', id)
        .order('sort_order', { ascending: true })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}
