import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const allowed: any = {}
    for (const k of [
        'name','description','category','perspective','unit','measurement_direction',
        'calculation_type','formula_description','formula_config','data_source_status',
        'owner_user_id','status','is_active',
    ]) {
        if (body[k] !== undefined) allowed[k] = body[k]
    }
    if (!Object.keys(allowed).length) {
        return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 })
    }
    const { data: prev } = await supabase.from('hr_kpi_metrics').select('*')
        .eq('id', id).eq('organization_id', auth.data.organizationId).single()
    if (!prev) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const { data, error } = await supabase.from('hr_kpi_metrics').update(allowed)
        .eq('id', id).eq('organization_id', auth.data.organizationId)
        .select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'metric', entityId: id, action: 'update',
        oldValues: prev, newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const { data, error } = await supabase.from('hr_kpi_metrics')
        .update({ status: 'archived', is_active: false })
        .eq('id', id).eq('organization_id', auth.data.organizationId).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'metric', entityId: id, action: 'archive',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
