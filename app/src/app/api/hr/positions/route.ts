import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const { organizationId } = ctxResult.data
        if (!organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        let includeDisabled = request.nextUrl.searchParams.get('include_disabled') === '1'
        if (includeDisabled && !(await canManageHr(ctxResult.data))) {
            includeDisabled = false
        }

        let query = supabase
            .from('hr_positions')
            .select('*')
            .eq('organization_id', organizationId)
            .order('level', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true })

        if (!includeDisabled) {
            query = query.eq('is_active', true)
        }

        const { data, error } = await query
        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        const positionIds = (data || []).map((p: any) => p.id)
        let counts: Record<string, number> = {}

        if (positionIds.length > 0) {
            const { data: users } = await supabase
                .from('users')
                .select('position_id')
                .in('position_id', positionIds)
                .eq('is_active', true)

            if (users) {
                counts = users.reduce((acc: Record<string, number>, u: any) => {
                    if (!u.position_id) return acc
                    acc[u.position_id] = (acc[u.position_id] || 0) + 1
                    return acc
                }, {})
            }
        }

        const positions = (data || []).map((p: any) => ({
            ...p,
            user_count: counts[p.id] || 0
        }))

        return NextResponse.json({ success: true, data: positions })
    } catch (error: any) {
        console.error('Failed to list HR positions:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
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

        const body = await request.json()
        const code = String(body.code || '').trim().toUpperCase()
        const name = String(body.name || '').trim()
        const level = body.level === null || body.level === undefined || body.level === ''
            ? null
            : Number(body.level)
        const category = body.category ? String(body.category) : null

        if (!code || !name) {
            return NextResponse.json({ success: false, error: 'Code and name are required' }, { status: 400 })
        }

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const { data, error } = await supabase
            .from('hr_positions')
            .insert({
                organization_id: ctx.organizationId,
                code,
                name,
                level: Number.isFinite(level) ? level : null,
                category,
                is_active: true
            })
            .select('*')
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        console.error('Failed to create HR position:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
