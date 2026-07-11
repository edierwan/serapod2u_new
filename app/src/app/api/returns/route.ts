import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
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

/**
 * GET /api/returns
 * List return cases visible to the caller, with optional filters.
 */
export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const shopId = sp.get('shop')
    const warehouseId = sp.get('warehouse')
    const search = sp.get('search')?.trim()
    const from = sp.get('from')
    const to = sp.get('to')

    let query = ctx.admin
        .from('return_cases')
        .select(`*, items:return_case_items (*)`)
        .order('created_at', { ascending: false })

    // Shop users only ever see their own shop's returns.
    if (!ctx.isManager) {
        query = query.eq('shop_org_id', ctx.orgId || '00000000-0000-0000-0000-000000000000')
    } else if (shopId) {
        query = query.eq('shop_org_id', shopId)
    }
    if (status) query = query.eq('status', status)
    if (warehouseId) query = query.eq('return_warehouse_id', warehouseId)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)
    if (search) query = query.ilike('return_no', `%${search}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const settings = await loadSettings(ctx.admin)

    // Resolve shop/warehouse names for the rows.
    const orgIds = Array.from(new Set(
        (data || []).flatMap((r: any) => [r.shop_org_id, r.return_warehouse_id]).filter(Boolean),
    ))
    let orgMap: Record<string, any> = {}
    if (orgIds.length > 0) {
        const { data: orgs } = await ctx.admin.from('organizations').select(ORG_SELECT).in('id', orgIds)
        orgMap = Object.fromEntries((orgs || []).map((o: any) => [o.id, o]))
    }

    const rows = (data || []).map((r: any) =>
        decorateCase({ ...r, shop: orgMap[r.shop_org_id] || null, warehouse: orgMap[r.return_warehouse_id] || null }, settings),
    )

    return NextResponse.json({ cases: rows })
}

/**
 * POST /api/returns
 * Create a new return draft (header + optional items).
 */
export async function POST(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const body = await request.json().catch(() => ({}))

    // Shop users always return from their own shop; managers must pick one.
    const shopOrgId = ctx.isManager ? body.shop_org_id : ctx.orgId
    if (!shopOrgId) {
        return NextResponse.json({ error: 'Return From Shop is required' }, { status: 400 })
    }

    const settings = await loadSettings(ctx.admin)
    const warehouseId = body.return_warehouse_id || settings.default_return_warehouse_id || null

    const { data: created, error } = await ctx.admin
        .from('return_cases')
        .insert({
            shop_org_id: shopOrgId,
            return_warehouse_id: warehouseId,
            contact_person: body.contact_person || null,
            contact_phone: body.contact_phone || null,
            notes: body.notes || null,
            status: 'return_draft',
            created_by: ctx.userId,
        })
        .select('*')
        .single()

    if (error || !created) {
        return NextResponse.json({ error: error?.message || 'Failed to create return' }, { status: 500 })
    }

    // Optional initial items.
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length > 0) {
        const rows = items.map((it: any) => ({
            return_case_id: created.id,
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
        await ctx.admin.from('return_case_items').insert(rows)
    }

    await ctx.admin.from('return_case_status_history').insert({
        return_case_id: created.id,
        from_status: null,
        to_status: 'return_draft',
        changed_by: ctx.userId,
        notes: 'Return draft created',
    })

    return NextResponse.json({ id: created.id, return_no: created.return_no }, { status: 201 })
}
