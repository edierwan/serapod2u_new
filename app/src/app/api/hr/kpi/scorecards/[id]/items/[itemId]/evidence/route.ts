import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
    const { itemId } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { data, error } = await supabase
        .from('hr_kpi_evidence')
        .select('*')
        .eq('scorecard_item_id', itemId)
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
    const { itemId } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => ({}))
    const insert: any = {
        organization_id: auth.data.organizationId,
        scorecard_item_id: itemId,
        evidence_type: body.evidence_type ?? null,
        title: body.title ?? null,
        description: body.description ?? null,
        file_url: body.file_url ?? null,
        source_module: body.source_module ?? null,
        source_record_id: body.source_record_id ?? null,
        uploaded_by: auth.data.userId,
    }
    const { data, error } = await supabase.from('hr_kpi_evidence').insert(insert).select('*').single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'evidence', entityId: data.id, action: 'create',
        newValues: data, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data })
}
