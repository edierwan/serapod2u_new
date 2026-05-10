import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { data, error } = await supabase
        .from('hr_kpi_reviews')
        .select('*, hr_kpi_scorecards(id, period_id, scorecard_level, overall_score, grade, status)')
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .single()
    if (error || !data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
}
