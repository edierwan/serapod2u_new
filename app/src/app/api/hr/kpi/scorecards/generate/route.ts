import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canGenerateScorecards } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'
import { computeAchievementPct, computeWeightedScore, classifyStatus, computeGrade } from '@/lib/server/kpi/score'

interface AssignmentRow {
    id: string
    period_id: string
    metric_id: string
    assignment_level: 'company' | 'department' | 'role' | 'employee'
    department_id: string | null
    position_id: string | null
    employee_user_id: string | null
}

/**
 * Generate scorecards for a given period from published targets + actuals.
 * One scorecard per unique (period, level, scope-id) — reuses if already exists.
 *
 * body: { period_id, level?: 'company'|'department'|'role'|'employee' }
 */
export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canGenerateScorecards(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const { period_id, level } = body || {}
    if (!period_id) return NextResponse.json({ success: false, error: 'period_id required' }, { status: 400 })

    // load org settings for thresholds
    const { data: settings } = await supabase
        .from('hr_kpi_settings')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .maybeSingle()
    const cap = Number(settings?.achievement_cap ?? 150)
    const green = Number(settings?.green_threshold ?? 90)
    const yellow = Number(settings?.yellow_threshold ?? 70)
    const gradeTable = (settings?.grade_table as any[]) ?? undefined

    // load assignments + their published targets + actuals
    let aQ = supabase
        .from('hr_kpi_assignments')
        .select('id, period_id, metric_id, assignment_level, department_id, position_id, employee_user_id')
        .eq('organization_id', auth.data.organizationId)
        .eq('period_id', period_id)
        .eq('status', 'published')
    if (level) aQ = aQ.eq('assignment_level', level)
    const { data: assignments, error: aErr } = await aQ
    if (aErr) return NextResponse.json({ success: false, error: aErr.message }, { status: 500 })

    if (!assignments?.length) {
        return NextResponse.json({ success: true, data: { scorecards_created: 0, items_created: 0 } })
    }

    const ids = (assignments as AssignmentRow[]).map(a => a.id)
    const { data: targets } = await supabase
        .from('hr_kpi_targets')
        .select('*')
        .in('assignment_id', ids)
        .eq('status', 'published')
    const { data: actuals } = await supabase
        .from('hr_kpi_actuals')
        .select('*')
        .in('assignment_id', ids)
        .eq('period_id', period_id)
    const { data: metrics } = await supabase
        .from('hr_kpi_metrics')
        .select('id, measurement_direction, formula_config')
        .in('id', (assignments as AssignmentRow[]).map(a => a.metric_id))

    const targetByAssignment = new Map<string, any>((targets ?? []).map((t: any) => [t.assignment_id, t]))
    const actualByAssignment = new Map<string, any>((actuals ?? []).map((a: any) => [a.assignment_id, a]))
    const metricById = new Map<string, any>((metrics ?? []).map((m: any) => [m.id, m]))

    // group assignments by (level, scope-id) -> scorecard
    function scopeKey(a: AssignmentRow) {
        return `${a.assignment_level}|${a.department_id ?? ''}|${a.position_id ?? ''}|${a.employee_user_id ?? ''}`
    }
    const groups = new Map<string, AssignmentRow[]>()
    for (const a of assignments as AssignmentRow[]) {
        const k = scopeKey(a)
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(a)
    }

    let scorecardsCreated = 0
    let itemsCreated = 0

    for (const [, scopedAssignments] of groups) {
        const sample = scopedAssignments[0]
        const scorecardKey: any = {
            organization_id: auth.data.organizationId,
            period_id,
            scorecard_level: sample.assignment_level,
            department_id: sample.department_id,
            position_id: sample.position_id,
            employee_user_id: sample.employee_user_id,
        }

        // find existing
        let existingQ = supabase
            .from('hr_kpi_scorecards')
            .select('id, overall_score, status')
            .eq('organization_id', auth.data.organizationId)
            .eq('period_id', period_id)
            .eq('scorecard_level', sample.assignment_level)
        existingQ = sample.department_id ? existingQ.eq('department_id', sample.department_id) : existingQ.is('department_id', null)
        existingQ = sample.position_id ? existingQ.eq('position_id', sample.position_id) : existingQ.is('position_id', null)
        existingQ = sample.employee_user_id ? existingQ.eq('employee_user_id', sample.employee_user_id) : existingQ.is('employee_user_id', null)

        const { data: existing } = await existingQ.maybeSingle()
        let scorecardId: string

        if (existing?.id) {
            scorecardId = existing.id
            await supabase.from('hr_kpi_scorecard_items').delete().eq('scorecard_id', scorecardId)
        } else {
            const { data: newCard, error: nErr } = await supabase
                .from('hr_kpi_scorecards')
                .insert({
                    ...scorecardKey,
                    status: 'generated',
                    generated_at: new Date().toISOString(),
                    created_by: auth.data.userId,
                })
                .select('id')
                .single()
            if (nErr || !newCard) continue
            scorecardId = newCard.id
            scorecardsCreated++
        }

        let totalScore = 0
        const itemRows: any[] = []
        for (const a of scopedAssignments) {
            const tgt = targetByAssignment.get(a.id)
            const act = actualByAssignment.get(a.id)
            const m = metricById.get(a.metric_id)
            const direction = (m?.measurement_direction ?? 'higher_is_better') as any
            const formula = m?.formula_config ?? {}
            const ach = computeAchievementPct(direction, tgt?.target_value ?? null, act?.actual_value ?? null, formula)
            const w = Number(tgt?.weight_percent ?? 0)
            const ws = computeWeightedScore(ach, w, cap)
            const status = classifyStatus(ach, green, yellow)
            if (ws != null) totalScore += ws
            itemRows.push({
                organization_id: auth.data.organizationId,
                scorecard_id: scorecardId,
                assignment_id: a.id,
                metric_id: a.metric_id,
                target_id: tgt?.id ?? null,
                actual_id: act?.id ?? null,
                weight_percent: w,
                target_value: tgt?.target_value ?? null,
                actual_value: act?.actual_value ?? null,
                achievement_percent: ach,
                weighted_score: ws,
                status,
            })
        }

        if (itemRows.length) {
            const { error: insErr } = await supabase.from('hr_kpi_scorecard_items').insert(itemRows)
            if (!insErr) itemsCreated += itemRows.length
        }
        const grade = computeGrade(totalScore, gradeTable)
        await supabase
            .from('hr_kpi_scorecards')
            .update({ overall_score: totalScore, grade })
            .eq('id', scorecardId)
    }

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'scorecard', entityId: period_id, action: 'generate',
        newValues: { period_id, level, scorecards_created: scorecardsCreated, items_created: itemsCreated },
        actorUserId: auth.data.userId,
    })

    return NextResponse.json({ success: true, data: { scorecards_created: scorecardsCreated, items_created: itemsCreated } })
}
