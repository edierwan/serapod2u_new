import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canGenerateScorecards } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'
import { computeAchievementPct, computeWeightedScore, classifyStatus, computeGrade } from '@/lib/server/kpi/score'

/** Recalculate item achievement/score from current target+actual. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canGenerateScorecards(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data: settings } = await supabase
        .from('hr_kpi_settings').select('*')
        .eq('organization_id', auth.data.organizationId).maybeSingle()
    const cap = Number(settings?.achievement_cap ?? 150)
    const green = Number(settings?.green_threshold ?? 90)
    const yellow = Number(settings?.yellow_threshold ?? 70)
    const gradeTable = (settings?.grade_table as any[]) ?? undefined

    const { data: scorecard } = await supabase
        .from('hr_kpi_scorecards').select('*')
        .eq('id', id).eq('organization_id', auth.data.organizationId).single()
    if (!scorecard) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    const { data: items } = await supabase
        .from('hr_kpi_scorecard_items')
        .select('*, hr_kpi_metrics(measurement_direction, formula_config)')
        .eq('scorecard_id', id)
    let total = 0
    for (const it of (items ?? []) as any[]) {
        const direction = it.hr_kpi_metrics?.measurement_direction ?? 'higher_is_better'
        const formula = it.hr_kpi_metrics?.formula_config ?? {}
        const ach = computeAchievementPct(direction as any, it.target_value, it.actual_value, formula)
        const ws = computeWeightedScore(ach, Number(it.weight_percent ?? 0), cap)
        const status = classifyStatus(ach, green, yellow)
        if (ws != null) total += ws
        await supabase.from('hr_kpi_scorecard_items')
            .update({ achievement_percent: ach, weighted_score: ws, status })
            .eq('id', it.id)
    }
    const grade = computeGrade(total, gradeTable)
    const { data: updated } = await supabase
        .from('hr_kpi_scorecards')
        .update({ overall_score: total, grade })
        .eq('id', id)
        .select('*').single()

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'scorecard', entityId: id, action: 'recalculate',
        newValues: updated, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data: updated })
}
