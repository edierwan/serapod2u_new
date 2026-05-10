import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageObjectives } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageObjectives(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const allowed: any = {}
    for (const k of ['name', 'period_type', 'start_date', 'end_date', 'status']) {
        if (body[k] !== undefined) allowed[k] = body[k]
    }
    if (!Object.keys(allowed).length) {
        return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 })
    }

    const { data: prev } = await supabase
        .from('hr_kpi_periods')
        .select('*')
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .single()
    if (!prev) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const { data, error } = await supabase
        .from('hr_kpi_periods')
        .update(allowed)
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .select('*')
        .single()

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'period', entityId: id, action: 'update',
        oldValues: prev, newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
