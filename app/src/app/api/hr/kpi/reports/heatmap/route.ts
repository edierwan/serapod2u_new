import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

/** Heatmap matrix: rows=metrics, cols=scorecards, cells=achievement_percent + status. */
export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const periodId = req.nextUrl.searchParams.get('period_id')
    if (!periodId) return NextResponse.json({ success: false, error: 'period_id required' }, { status: 400 })

    const { data: scorecards } = await supabase
        .from('hr_kpi_scorecards')
        .select('id, scorecard_level, department_id, employee_user_id')
        .eq('organization_id', auth.data.organizationId)
        .eq('period_id', periodId)

    const ids = (scorecards ?? []).map((s: any) => s.id)
    const { data: items } = await supabase
        .from('hr_kpi_scorecard_items')
        .select('scorecard_id, metric_id, achievement_percent, status, hr_kpi_metrics(kpi_code, name, perspective)')
        .in('scorecard_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

    return NextResponse.json({
        success: true,
        data: {
            scorecards: scorecards ?? [],
            cells: items ?? [],
        },
    })
}
