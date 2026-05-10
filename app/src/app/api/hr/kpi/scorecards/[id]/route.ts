import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { data: scorecard, error: sErr } = await supabase
        .from('hr_kpi_scorecards')
        .select('*')
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .single()
    if (sErr || !scorecard) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const { data: items, error: iErr } = await supabase
        .from('hr_kpi_scorecard_items')
        .select('*, hr_kpi_metrics(id, kpi_code, name, unit, perspective, measurement_direction)')
        .eq('scorecard_id', id)
        .order('created_at', { ascending: true })
    if (iErr) return NextResponse.json({ success: false, error: iErr.message }, { status: 500 })

    const { data: reviews } = await supabase
        .from('hr_kpi_reviews')
        .select('*')
        .eq('scorecard_id', id)
        .order('created_at', { ascending: false })

    return NextResponse.json({ success: true, data: { scorecard, items: items ?? [], reviews: reviews ?? [] } })
}
