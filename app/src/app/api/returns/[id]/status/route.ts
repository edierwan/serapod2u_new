import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext, loadAccessibleCase, statusTimestampColumn } from '@/lib/returns/server'
import { RETURN_NEXT_STATUS, canAdvanceStatus, type ReturnStatus } from '@/lib/returns/constants'

/**
 * POST /api/returns/[id]/status
 * Advance a return case to the next status in the flow:
 *   draft -> submitted -> received -> processing -> completed
 *
 * Shop users may only take a Draft to Submitted; warehouse/support/admin/HQ
 * users drive the rest of the flow. Records an activity-log entry each time.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const rc = await loadAccessibleCase(ctx, id)
    if (rc instanceof NextResponse) return rc

    const current = rc.status as ReturnStatus
    const next = RETURN_NEXT_STATUS[current]
    if (!next) {
        return NextResponse.json({ error: `No further status after "${current}"` }, { status: 409 })
    }
    if (!canAdvanceStatus(current, ctx.isManager)) {
        return NextResponse.json(
            { error: 'Only warehouse/support can move this return to the next step' },
            { status: 403 },
        )
    }

    const body = await request.json().catch(() => ({}))
    const now = new Date().toISOString()

    const patch: Record<string, any> = { status: next }
    const tsCol = statusTimestampColumn(next)
    if (tsCol && tsCol !== 'created_at') patch[tsCol] = now

    // When moving into Received, capture who received it (default to actor).
    if (next === 'return_received' && !rc.received_by) {
        patch.received_by = body.received_by || null
        patch.received_date = body.received_date || now.slice(0, 10)
    }
    if (next === 'return_completed' && !rc.completed_date) {
        patch.completed_date = now.slice(0, 10)
    }

    const { error } = await ctx.admin.from('return_cases').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await ctx.admin.from('return_case_status_history').insert({
        return_case_id: id,
        from_status: current,
        to_status: next,
        changed_by: ctx.userId,
        notes: body.notes || null,
    })

    return NextResponse.json({ ok: true, status: next })
}
