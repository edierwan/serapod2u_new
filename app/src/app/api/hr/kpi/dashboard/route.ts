import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

/**
 * KPI dashboard summary for a given period (or active period).
 * Aggregates: scorecard counts by status, average overall_score,
 * item status distribution (on_track / at_risk / below_target / no_data),
 * and per-perspective breakdown.
 */
export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    let periodId = req.nextUrl.searchParams.get('period_id')
    if (!periodId) {
        const { data: activePeriod } = await supabase
            .from('hr_kpi_periods')
            .select('id')
            .eq('organization_id', auth.data.organizationId)
            .eq('status', 'active')
            .order('start_date', { ascending: false })
            .limit(1).maybeSingle()
        periodId = activePeriod?.id ?? null
    }

    if (!periodId) {
        return NextResponse.json({ success: true, data: { period_id: null, scorecards: { total: 0 }, items: {}, perspectives: [] } })
    }

    const [{ data: scorecards }, { data: items }] = await Promise.all([
        supabase.from('hr_kpi_scorecards')
            .select('id, status, overall_score, scorecard_level')
            .eq('organization_id', auth.data.organizationId)
            .eq('period_id', periodId),
        supabase.from('hr_kpi_scorecard_items')
            .select('id, status, weighted_score, hr_kpi_metrics(perspective)')
            .eq('organization_id', auth.data.organizationId)
            .in('scorecard_id', (await supabase
                .from('hr_kpi_scorecards')
                .select('id')
                .eq('organization_id', auth.data.organizationId)
                .eq('period_id', periodId)
            ).data?.map((s: any) => s.id) ?? []),
    ])

    const sc = (scorecards ?? []) as any[]
    const it = (items ?? []) as any[]

    const scorecardsByStatus = sc.reduce<Record<string, number>>((acc, s) => {
        acc[s.status] = (acc[s.status] ?? 0) + 1; return acc
    }, {})
    const scorecardsByLevel = sc.reduce<Record<string, number>>((acc, s) => {
        acc[s.scorecard_level] = (acc[s.scorecard_level] ?? 0) + 1; return acc
    }, {})
    const scoresWithValue = sc.map(s => Number(s.overall_score)).filter(n => !isNaN(n))
    const avgScore = scoresWithValue.length
        ? Math.round((scoresWithValue.reduce((a, b) => a + b, 0) / scoresWithValue.length) * 100) / 100
        : null

    const itemsByStatus = it.reduce<Record<string, number>>((acc, x) => {
        acc[x.status] = (acc[x.status] ?? 0) + 1; return acc
    }, {})

    const persMap = new Map<string, { count: number; total: number }>()
    for (const x of it) {
        const p = x.hr_kpi_metrics?.perspective ?? 'unspecified'
        const cur = persMap.get(p) ?? { count: 0, total: 0 }
        cur.count++
        if (x.weighted_score != null) cur.total += Number(x.weighted_score)
        persMap.set(p, cur)
    }
    const perspectives = [...persMap.entries()].map(([perspective, v]) => ({
        perspective, count: v.count, avg_score: v.count ? Math.round((v.total / v.count) * 100) / 100 : null,
    }))

    return NextResponse.json({
        success: true,
        data: {
            period_id: periodId,
            scorecards: { total: sc.length, by_status: scorecardsByStatus, by_level: scorecardsByLevel, avg_overall_score: avgScore },
            items: { total: it.length, by_status: itemsByStatus },
            perspectives,
        },
    })
}
