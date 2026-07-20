import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext, loadActiveHqReturnWarehouses, validateReturnWarehouse } from '@/lib/returns/server'

/** GET /api/returns/settings — settings + reason/condition master lists. */
export async function GET() {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const [settingsRes, reasonsRes, conditionsRes, warehousesRes] = await Promise.all([
        ctx.admin.from('return_settings').select('*').eq('id', 1).maybeSingle(),
        ctx.admin.from('return_reasons').select('*').order('sort_order'),
        ctx.admin.from('return_conditions').select('*').order('sort_order'),
        loadActiveHqReturnWarehouses(ctx.admin, 'id, org_code, org_name'),
    ])

    const err = settingsRes.error || reasonsRes.error || conditionsRes.error || warehousesRes.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })

    return NextResponse.json({
        settings: settingsRes.data,
        reasons: reasonsRes.data || [],
        conditions: conditionsRes.data || [],
        warehouses: warehousesRes.data || [],
        canEdit: ctx.isManager,
    })
}

/** PUT /api/returns/settings — update settings + reason/condition lists (managers only). */
export async function PUT(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx
    if (!ctx.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))

    if (body.settings) {
        const s = body.settings
        if (s.default_return_warehouse_id) {
            const warehouseCheck = await validateReturnWarehouse(ctx, s.default_return_warehouse_id)
            if (!warehouseCheck.ok) {
                return NextResponse.json({ error: warehouseCheck.error }, { status: 400 })
            }
        }
        const { error } = await ctx.admin.from('return_settings').upsert({
            id: 1,
            default_return_warehouse_id: s.default_return_warehouse_id || null,
            sla_submitted_to_received_days: clampInt(s.sla_submitted_to_received_days, 3),
            sla_received_to_processing_days: clampInt(s.sla_received_to_processing_days, 2),
            sla_processing_to_completed_days: clampInt(s.sla_processing_to_completed_days, 5),
            pdf_instruction_text: s.pdf_instruction_text || null,
            shop_self_service_enabled: s.shop_self_service_enabled !== false,
            updated_at: new Date().toISOString(),
            updated_by: ctx.userId,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Reasons / conditions are full replaces of the active list when provided.
    if (Array.isArray(body.reasons)) {
        const err = await syncMaster(ctx.admin, 'return_reasons', body.reasons)
        if (err) return NextResponse.json({ error: err }, { status: 500 })
    }
    if (Array.isArray(body.conditions)) {
        const err = await syncMaster(ctx.admin, 'return_conditions', body.conditions)
        if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}

function clampInt(value: any, fallback: number): number {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

/** Upsert master rows by code and deactivate any dropped. */
async function syncMaster(admin: any, table: string, items: any[]): Promise<string | null> {
    const rows = items
        .map((it, i) => ({
            code: String(it.code || slug(it.label)).trim(),
            label: String(it.label || '').trim(),
            sort_order: Number(it.sort_order ?? (i + 1) * 10),
            is_active: it.is_active !== false,
        }))
        .filter((r) => r.code && r.label)

    if (rows.length === 0) return null

    const { error } = await admin.from(table).upsert(rows, { onConflict: 'code' })
    if (error) return error.message

    // Deactivate any existing active codes no longer present in the submitted list.
    const keepCodes = new Set(rows.map((r) => r.code))
    const { data: existing } = await admin.from(table).select('code').eq('is_active', true)
    const toDeactivate = (existing || []).map((r: any) => r.code).filter((c: string) => !keepCodes.has(c))
    if (toDeactivate.length > 0) {
        const { error: deErr } = await admin.from(table).update({ is_active: false }).in('code', toDeactivate)
        if (deErr) return deErr.message
    }
    return null
}

function slug(label: string): string {
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
