import { NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
import { DEFAULT_RETURN_SETTINGS } from '@/lib/returns/meta'

/**
 * GET /api/returns/meta
 * Dropdown + config data for the Return Product form:
 * shops, warehouses, reasons, conditions, settings, and the caller's role/org.
 */
export async function GET() {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const orgSelect = 'id, org_code, org_name, org_type_code, branch, contact_name, contact_phone, contact_email, address, city, postal_code'

    // The Return From source (Shop/Distributor) is selected via server-side
    // search (GET /api/returns/organizations) so we no longer bulk-load the full
    // shop list into the browser. A self-service shop user still needs their own
    // org, returned as the single-entry `shops` list for backward compatibility.
    const selfOrg = (!ctx.isManager && ctx.orgId)
        ? await ctx.admin.from('organizations').select(orgSelect).eq('id', ctx.orgId).maybeSingle()
        : { data: null }

    const [warehousesRes, reasonsRes, conditionsRes, categoriesRes, settingsRes] = await Promise.all([
        ctx.admin
            .from('organizations')
            .select(orgSelect)
            .in('org_type_code', ['WH', 'HQ', 'DIST'])
            .eq('is_active', true)
            .order('org_name', { ascending: true }),
        ctx.admin.from('return_reasons').select('*').eq('is_active', true).order('sort_order'),
        ctx.admin.from('return_conditions').select('*').eq('is_active', true).order('sort_order'),
        ctx.admin
            .from('product_categories')
            .select('id, category_code, category_name')
            .eq('is_active', true)
            .order('category_name', { ascending: true }),
        ctx.admin.from('return_settings').select('*').eq('id', 1).maybeSingle(),
    ])

    const err = warehousesRes.error || reasonsRes.error || conditionsRes.error || categoriesRes.error || settingsRes.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })

    return NextResponse.json({
        isManager: ctx.isManager,
        userOrgId: ctx.orgId,
        orgTypeCode: ctx.orgTypeCode,
        shops: selfOrg.data ? [selfOrg.data] : [],
        warehouses: warehousesRes.data || [],
        reasons: reasonsRes.data || [],
        conditions: conditionsRes.data || [],
        categories: categoriesRes.data || [],
        settings: settingsRes.data || DEFAULT_RETURN_SETTINGS,
    })
}
