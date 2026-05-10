import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

/** Tabular summary: per-scorecard rows with score, grade, status counts. */
export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    const periodId = req.nextUrl.searchParams.get('period_id')

    let q = supabase
        .from('hr_kpi_scorecards')
        .select('id, scorecard_level, department_id, position_id, employee_user_id, overall_score, grade, status, period_id')
        .eq('organization_id', auth.data.organizationId)
    if (periodId) q = q.eq('period_id', periodId)
    const { data: scorecards, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    const ids = (scorecards ?? []).map((s: any) => s.id)
    const itemAgg = new Map<string, Record<string, number>>()
    if (ids.length) {
        const { data: items } = await supabase
            .from('hr_kpi_scorecard_items')
            .select('scorecard_id, status')
            .in('scorecard_id', ids)
        for (const it of (items ?? []) as any[]) {
            const cur = itemAgg.get(it.scorecard_id) ?? {}
            cur[it.status] = (cur[it.status] ?? 0) + 1
            itemAgg.set(it.scorecard_id, cur)
        }
    }

    const rows = (scorecards ?? []).map((s: any) => ({
        ...s,
        item_status_counts: itemAgg.get(s.id) ?? {},
    }))
    return NextResponse.json({ success: true, data: rows })
}
