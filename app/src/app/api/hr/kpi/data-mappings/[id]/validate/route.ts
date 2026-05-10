import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext, canManageMetrics } from '@/lib/server/kpi/access'
import { kpiAudit } from '@/lib/server/kpi/audit'

/**
 * Validate that the configured source_table exists and is accessible.
 * Lightweight check via information_schema (read-only).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    if (!(await canManageMetrics(auth.data))) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    const { data: mapping, error: mErr } = await supabase
        .from('hr_kpi_data_mappings')
        .select('*')
        .eq('id', id)
        .eq('organization_id', auth.data.organizationId)
        .single()
    if (mErr || !mapping) return NextResponse.json({ success: false, error: 'Mapping not found' }, { status: 404 })

    let valid = false
    let lastError: string | null = null
    if (!mapping.source_table) {
        lastError = 'No source_table configured'
    } else {
        const { data: tableRows, error: tErr } = await supabase
            .from('information_schema.tables' as any)
            .select('table_name')
            .eq('table_schema', 'public')
            .eq('table_name', mapping.source_table)
        if (tErr) lastError = tErr.message
        else valid = Array.isArray(tableRows) && tableRows.length > 0
        if (!valid && !lastError) lastError = `Table ${mapping.source_table} not found in public schema`
    }

    const { data: updated, error: uErr } = await supabase
        .from('hr_kpi_data_mappings')
        .update({
            validation_status: valid ? 'valid' : 'invalid',
            last_validated_at: new Date().toISOString(),
            last_error: valid ? null : lastError,
        })
        .eq('id', id).eq('organization_id', auth.data.organizationId)
        .select('*').single()
    if (uErr) return NextResponse.json({ success: false, error: uErr.message }, { status: 500 })

    await kpiAudit(supabase, {
        organizationId: auth.data.organizationId,
        entityType: 'data_mapping', entityId: id, action: 'validate',
        newValues: { valid, lastError }, actorUserId: auth.data.userId,
    })
    return NextResponse.json({ success: true, data: updated })
}
