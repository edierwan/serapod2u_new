import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function GET(_request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })

        const { data, error } = await supabase
            .from('hr_settings')
            .select('config')
            .eq('organization_id', ctx.organizationId)
            .eq('config_key', 'statutory_rates')
            .single()

        if (error && error.code !== 'PGRST116') return NextResponse.json({ success: false, error: error.message }, { status: 500 })

        const defaults = {
            epf_employee_rate: 11, epf_employer_rate: 13,
            socso_employee_rate: 0.5, socso_employer_rate: 1.75,
            eis_employee_rate: 0.2, eis_employer_rate: 0.2,
            pcb_enabled: true
        }

        return NextResponse.json({ success: true, data: data?.config || defaults })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function PUT(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageHr(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const body = await request.json()

        const { data, error } = await supabase
            .from('hr_settings')
            .upsert({
                organization_id: ctx.organizationId,
                config_key: 'statutory_rates',
                config: body,
                updated_at: new Date().toISOString()
            }, { onConflict: 'organization_id,config_key' })
            .select('config')
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data: data?.config || body })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
