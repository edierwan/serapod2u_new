import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        const ctx = ctxResult.data
        if (!ctx.organizationId) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        if (!(await canManageHr(ctx))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })

        const body = await request.json()
        const { data, error } = await supabase
            .from('hr_deduction_types')
            .update(body)
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
