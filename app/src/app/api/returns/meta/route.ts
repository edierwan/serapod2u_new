import { NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'

/**
 * GET /api/returns/meta
 * Dropdown + config data for the Return Product form:
 * shops, warehouses, reasons, conditions, settings, and the caller's role/org.
 */
export async function GET() {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const orgSelect = 'id, org_code, org_name, contact_name, contact_phone, contact_email, address, city, postal_code'

    // Shops: managers see all active shops; a shop user only sees their own shop.
    let shopsQuery = ctx.admin
        .from('organizations')
        .select(orgSelect)
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
        .order('org_name', { ascending: true })
    if (!ctx.isManager && ctx.orgId) {
        shopsQuery = shopsQuery.eq('id', ctx.orgId)
    }

    const [shopsRes, warehousesRes, reasonsRes, conditionsRes, settingsRes] = await Promise.all([
        shopsQuery,
        ctx.admin
            .from('organizations')
            .select(orgSelect)
            .in('org_type_code', ['WH', 'HQ', 'DIST'])
            .eq('is_active', true)
            .order('org_name', { ascending: true }),
        ctx.admin.from('return_reasons').select('*').eq('is_active', true).order('sort_order'),
        ctx.admin.from('return_conditions').select('*').eq('is_active', true).order('sort_order'),
        ctx.admin.from('return_settings').select('*').eq('id', 1).maybeSingle(),
    ])

    const err = shopsRes.error || warehousesRes.error || reasonsRes.error || conditionsRes.error || settingsRes.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })

    return NextResponse.json({
        isManager: ctx.isManager,
        userOrgId: ctx.orgId,
        orgTypeCode: ctx.orgTypeCode,
        shops: shopsRes.data || [],
        warehouses: warehousesRes.data || [],
        reasons: reasonsRes.data || [],
        conditions: conditionsRes.data || [],
        settings: settingsRes.data || {
            default_return_warehouse_id: null,
            sla_submitted_to_received_days: 3,
            sla_received_to_processing_days: 2,
            sla_processing_to_completed_days: 5,
            pdf_instruction_text: null,
            shop_self_service_enabled: true,
        },
    })
}
