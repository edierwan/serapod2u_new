import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const status = req.nextUrl.searchParams.get('status')
    const scorecardItemId = req.nextUrl.searchParams.get('scorecard_item_id')
    let q = supabase
        .from('hr_kpi_adjustments')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    if (scorecardItemId) q = q.eq('scorecard_item_id', scorecardItemId)
    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    const body = await req.json().catch(() => ({}))
    const { scorecard_item_id, adjusted_actual_value, reason } = body || {}
    if (!scorecard_item_id || adjusted_actual_value == null || !reason) {
        return NextResponse.json({ success: false, error: 'scorecard_item_id, adjusted_actual_value, reason required' }, { status: 400 })
    }
    const { data: item } = await supabase
        .from('hr_kpi_scorecard_items')
        .select('id, actual_value, organization_id')
        .eq('id', scorecard_item_id).single()
    if (!item || item.organization_id !== auth.data.organizationId) {
        return NextResponse.json({ success: false, error: 'Scorecard item not found' }, { status: 404 })
    }
    const insert: any = {
        organization_id: auth.data.organizationId,
        scorecard_item_id,
        original_actual_value: item.actual_value ?? null,
        adjusted_actual_value,
        reason,
        adjustment_type: body.adjustment_type ?? null,
        requested_by: auth.data.userId,
        status: 'pending',
    }
    const { data, error } = await supabase.from('hr_kpi_adjustments').insert(insert).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'adjustment', entityId: data.id, action: 'request',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
