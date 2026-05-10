import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageObjectives } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET() {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { data, error } = await supabase
        .from('hr_kpi_periods')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .order('start_date', { ascending: false })

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
    const { name, period_type, start_date, end_date, status } = body || {}
    if (!name || !period_type || !start_date || !end_date) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('hr_kpi_periods')
        .insert({
            organization_id: auth.data.organizationId,
            name: String(name).trim(),
            period_type,
            start_date,
            end_date,
            status: status ?? 'draft',
            created_by: auth.data.userId,
        })
        .select('*')
        .single()

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'period', entityId: data.id, action: 'create',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
