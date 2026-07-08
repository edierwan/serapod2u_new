import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext, loadAccessibleCase } from '@/lib/returns/server'
import { decorateCase } from '@/lib/returns/compute'
import type { ReturnSettings } from '@/lib/returns/types'

const ORG_SELECT = 'id, org_code, org_name, contact_name, contact_phone, contact_email, address, city, postal_code'

async function loadSettings(admin: any): Promise<ReturnSettings> {
    const { data } = await admin.from('return_settings').select('*').eq('id', 1).maybeSingle()
    return data || {
        default_return_warehouse_id: null,
        sla_submitted_to_received_days: 3,
        sla_received_to_processing_days: 2,
        sla_processing_to_completed_days: 5,
        pdf_instruction_text: null,
        shop_self_service_enabled: true,
    }
}

/** GET /api/returns/[id] — full case detail. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const rc = await loadAccessibleCase(ctx, id)
    if (rc instanceof NextResponse) return rc

    const [itemsRes, historyRes, settings] = await Promise.all([
        ctx.admin.from('return_case_items').select('*').eq('return_case_id', id).order('created_at'),
        ctx.admin.from('return_case_status_history').select('*').eq('return_case_id', id).order('changed_at'),
        loadSettings(ctx.admin),
    ])

    const orgIds = [rc.shop_org_id, rc.return_warehouse_id].filter(Boolean)
    const { data: orgs } = await ctx.admin.from('organizations').select(ORG_SELECT).in('id', orgIds)
    const orgMap = Object.fromEntries((orgs || []).map((o: any) => [o.id, o]))

    // Resolve changer names for the history log.
    const changerIds = Array.from(new Set((historyRes.data || []).map((h: any) => h.changed_by).filter(Boolean)))
    let userMap: Record<string, string> = {}
    if (changerIds.length > 0) {
        const { data: users } = await ctx.admin.from('users').select('id, full_name').in('id', changerIds)
        userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u.full_name]))
    }

    const createdByName = rc.created_by ? (userMap[rc.created_by] || null) : null
    let creatorName = createdByName
    if (rc.created_by && !creatorName) {
        const { data: creator } = await ctx.admin.from('users').select('full_name').eq('id', rc.created_by).maybeSingle()
        creatorName = (creator as any)?.full_name || null
    }

    const decorated = decorateCase({
        ...(rc as any),
        items: itemsRes.data || [],
        status_history: (historyRes.data || []).map((h: any) => ({ ...h, changed_by_name: h.changed_by ? userMap[h.changed_by] || null : null })),
        shop: orgMap[rc.shop_org_id] || null,
        warehouse: rc.return_warehouse_id ? orgMap[rc.return_warehouse_id] || null : null,
        created_by_name: creatorName,
    }, settings)

    return NextResponse.json({ case: decorated })
}

/** PATCH /api/returns/[id] — update header, items (draft only), or warehouse processing fields. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const rc = await loadAccessibleCase(ctx, id)
    if (rc instanceof NextResponse) return rc

    if (rc.status === 'return_completed' || rc.status === 'return_cancelled') {
        return NextResponse.json({ error: 'Completed or cancelled returns are read-only' }, { status: 409 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: Record<string, any> = {}

    // Header fields — editable while not terminal.
    if ('contact_person' in body) patch.contact_person = body.contact_person || null
    if ('contact_phone' in body) patch.contact_phone = body.contact_phone || null
    if ('notes' in body) patch.notes = body.notes || null
    if ('return_warehouse_id' in body) patch.return_warehouse_id = body.return_warehouse_id || null
    if (ctx.isManager && 'shop_org_id' in body && rc.status === 'return_draft' && body.shop_org_id) {
        patch.shop_org_id = body.shop_org_id
    }

    // Warehouse processing fields — managers only, once received.
    if (ctx.isManager && (rc.status === 'return_received' || rc.status === 'return_processing')) {
        for (const f of ['received_by', 'received_date', 'processing_notes', 'action_taken', 'return_courier', 'tracking_no', 'completed_date']) {
            if (f in body) patch[f] = body[f] || null
        }
    }

    if (Object.keys(patch).length > 0) {
        const { error } = await ctx.admin.from('return_cases').update(patch).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Items — full replace, only while in draft.
    if (Array.isArray(body.items) && rc.status === 'return_draft') {
        await ctx.admin.from('return_case_items').delete().eq('return_case_id', id)
        const rows = body.items.map((it: any) => ({
            return_case_id: id,
            product_id: it.product_id || null,
            variant_id: it.variant_id || null,
            sku: it.sku || null,
            product_name: it.product_name || null,
            variant_name: it.variant_name || null,
            quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
            unit_cost: Number(it.unit_cost) >= 0 ? Number(it.unit_cost) : 0,
            reason: it.reason || null,
            condition: it.condition || null,
            photo_url: it.photo_url || null,
            notes: it.notes || null,
        }))
        if (rows.length > 0) {
            const { error: itemsErr } = await ctx.admin.from('return_case_items').insert(rows)
            if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
        }
    }

    return NextResponse.json({ ok: true })
}

/** DELETE /api/returns/[id] — cancel a return (only before completion). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const rc = await loadAccessibleCase(ctx, id)
    if (rc instanceof NextResponse) return rc

    if (rc.status === 'return_completed' || rc.status === 'return_cancelled') {
        return NextResponse.json({ error: 'This return can no longer be cancelled' }, { status: 409 })
    }
    // Shop users may only cancel their own draft.
    if (!ctx.isManager && rc.status !== 'return_draft') {
        return NextResponse.json({ error: 'Only warehouse/support can cancel a submitted return' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const { error } = await ctx.admin
        .from('return_cases')
        .update({ status: 'return_cancelled', cancelled_at: now })
        .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await ctx.admin.from('return_case_status_history').insert({
        return_case_id: id,
        from_status: rc.status,
        to_status: 'return_cancelled',
        changed_by: ctx.userId,
        notes: 'Return cancelled',
    })

    return NextResponse.json({ ok: true })
}
