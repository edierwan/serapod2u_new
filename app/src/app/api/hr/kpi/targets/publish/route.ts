import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageTargets } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

/**
 * Publish all draft targets for a given period scope. Validates that targets
 * sum to ≤ 100% per assignment scope before flipping to published.
 *
 * body: { period_id, scope?: 'company'|'department'|'role'|'employee', scope_id?: uuid }
 */
export async function POST(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageTargets(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const { period_id } = body || {}
    if (!period_id) return NextResponse.json({ success: false, error: 'period_id required' }, { status: 400 })

    // Fetch draft targets (with assignment scope) for the period
    const { data: rows, error: fetchErr } = await supabase
        .from('hr_kpi_targets')
        .select('id, weight_percent, hr_kpi_assignments!inner(assignment_level, department_id, position_id, employee_user_id)')
        .eq('organization_id', auth.data.organizationId)
        .eq('period_id', period_id)
        .eq('status', 'draft')
    if (fetchErr) return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 })

    // Group total weight per scope and validate ≤ 100
    const scopeTotals = new Map<string, number>()
    for (const row of (rows ?? []) as any[]) {
        const a = row.hr_kpi_assignments
        const key = `${a.assignment_level}|${a.department_id ?? ''}|${a.position_id ?? ''}|${a.employee_user_id ?? ''}`
        scopeTotals.set(key, (scopeTotals.get(key) ?? 0) + Number(row.weight_percent ?? 0))
    }
    const violations = [...scopeTotals.entries()].filter(([, total]) => total > 100)
    if (violations.length > 0) {
        return NextResponse.json({
            success: false,
            error: `Scope weight exceeds 100% in ${violations.length} group(s). Adjust weights before publishing.`,
            details: violations.map(([k, total]) => ({ scope_key: k, total })),
        }, { status: 400 })
    }

    const ids = (rows ?? []).map((r: any) => r.id)
    if (!ids.length) return NextResponse.json({ success: true, data: { published_count: 0 } })

    const { error: updErr } = await supabase
        .from('hr_kpi_targets')
        .update({ status: 'published' })
        .in('id', ids)
        .eq('organization_id', auth.data.organizationId)
    if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'targets', entityId: period_id, action: 'publish',
        newValues: { period_id, count: ids.length }, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data: { published_count: ids.length } })
}
