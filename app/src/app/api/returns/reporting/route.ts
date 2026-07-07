import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
import { decorateCase } from '@/lib/returns/compute'
import { RETURN_STATUSES } from '@/lib/returns/constants'
import type { ReturnSettings } from '@/lib/returns/types'

const ORG_SELECT = 'id, org_code, org_name'

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
 * GET /api/returns/reporting
 * KPI card counts + a filtered list of return cases with computed metrics.
 */
export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const shopId = sp.get('shop')
    const warehouseId = sp.get('warehouse')
    const reason = sp.get('reason')
    const search = sp.get('search')?.trim()
    const from = sp.get('from')
    const to = sp.get('to')

    let query = ctx.admin
        .from('return_cases')
        .select(`*, items:return_case_items (*)`)
        .order('created_at', { ascending: false })

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

    const orgIds = Array.from(new Set(
        (data || []).flatMap((r: any) => [r.shop_org_id, r.return_warehouse_id]).filter(Boolean),
    ))
    let orgMap: Record<string, any> = {}
    if (orgIds.length > 0) {
        const { data: orgs } = await ctx.admin.from('organizations').select(ORG_SELECT).in('id', orgIds)
        orgMap = Object.fromEntries((orgs || []).map((o: any) => [o.id, o]))
    }

    let rows = (data || []).map((r: any) =>
        decorateCase({ ...r, shop: orgMap[r.shop_org_id] || null, warehouse: orgMap[r.return_warehouse_id] || null }, settings),
    )

    // Reason / SKU / product search is applied over the joined items.
    if (reason) {
        rows = rows.filter((r) => (r.items || []).some((it: any) => it.reason === reason))
    }
    if (search) {
        const q = search.toLowerCase()
        rows = rows.filter((r) =>
            r.return_no.toLowerCase().includes(q) ||
            (r.items || []).some((it: any) =>
                [it.sku, it.product_name, it.variant_name].filter(Boolean).some((v: string) => v.toLowerCase().includes(q)),
            ),
        )
    }

    // KPI cards.
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const kpi: Record<string, number> = {
        return_draft: 0,
        return_submitted: 0,
        return_received: 0,
        return_processing: 0,
        completed_this_month: 0,
        overdue: 0,
    }
    for (const r of rows) {
        if ((RETURN_STATUSES as readonly string[]).includes(r.status) && r.status !== 'return_completed') {
            kpi[r.status] = (kpi[r.status] || 0) + 1
        }
        if (r.status === 'return_completed' && r.completed_at && new Date(r.completed_at) >= monthStart) {
            kpi.completed_this_month += 1
        }
        if (r.is_overdue) kpi.overdue += 1
    }

    return NextResponse.json({ kpi, cases: rows })
}
