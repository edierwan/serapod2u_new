import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { id } = await params
        const body = await request.json()

        const { data: current, error: currentError } = await supabase
            .from('hr_positions')
            .select('id, organization_id')
            .eq('id', id)
            .single()

        if (currentError || !current) {
            return NextResponse.json({ success: false, error: 'Position not found' }, { status: 404 })
        }

        if (current.organization_id !== ctx.organizationId && ctx.roleLevel !== 1) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const updateData: Record<string, any> = {}
        if (body.name !== undefined) updateData.name = String(body.name).trim()
        if (body.level !== undefined) {
            updateData.level = body.level === null || body.level === '' ? null : Number(body.level)
        }
        if (body.category !== undefined) updateData.category = body.category ? String(body.category) : null
        if (body.is_active !== undefined) updateData.is_active = !!body.is_active

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ success: false, error: 'No updates provided' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('hr_positions')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to update HR position:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { id } = await params

        const { data: current, error: currentError } = await supabase
            .from('hr_positions')
            .select('id, organization_id')
            .eq('id', id)
            .single()

        if (currentError || !current) {
            return NextResponse.json({ success: false, error: 'Position not found' }, { status: 404 })
        }

        if (current.organization_id !== ctx.organizationId && ctx.roleLevel !== 1) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { count, error: countError } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('position_id', id)

        if (countError) {
            return NextResponse.json({ success: false, error: countError.message }, { status: 500 })
        }

        if ((count || 0) > 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: `This position is assigned to ${count} user(s). Please reassign them before deleting.`
                },
                { status: 409 }
            )
        }

        const { error } = await supabase
            .from('hr_positions')
            .delete()
            .eq('id', id)

        if (error) {
            if (error.code === '23503') {
                return NextResponse.json(
                    { success: false, error: 'This position is in use and cannot be deleted.' },
                    { status: 409 }
                )
            }
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Failed to delete HR position:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
