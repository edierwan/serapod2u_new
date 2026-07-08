import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isReturnManagerOrgType, type ReturnStatus, RETURN_STATUS_TIMESTAMP_COLUMN } from './constants'

export interface ReturnContext {
    admin: ReturnType<typeof createAdminClient>
    userId: string
    orgId: string | null
    orgTypeCode: string | null
    roleCode: string | null
    isManager: boolean
}

/**
 * Resolve the caller's return context (auth + org type). Returns a NextResponse
 * on failure so route handlers can `if (ctx instanceof NextResponse) return ctx`.
 */
export async function getReturnContext(): Promise<ReturnContext | NextResponse> {
    const supabase = await createClient()
    const admin = createAdminClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileErr } = await admin
        .from('users')
        .select('organization_id, role_code')
        .eq('id', user.id)
        .single()

    if (profileErr) {
        return NextResponse.json({ error: 'Unable to load user profile' }, { status: 500 })
    }

    const orgId = (profile as any)?.organization_id ?? null
    let orgTypeCode: string | null = null
    if (orgId) {
        const { data: org } = await admin
            .from('organizations')
            .select('org_type_code')
            .eq('id', orgId)
            .single()
        orgTypeCode = (org as any)?.org_type_code ?? null
    }

    const roleCode = (profile as any)?.role_code ?? null
    const isManager = roleCode === 'SA' || isReturnManagerOrgType(orgTypeCode)

    return {
        admin,
        userId: user.id,
        orgId,
        orgTypeCode,
        roleCode,
        isManager,
    }
}

/** Fetch a case and verify the caller may access it. Returns the case row or a NextResponse error. */
export async function loadAccessibleCase(ctx: ReturnContext, id: string) {
    const { data, error } = await ctx.admin
        .from('return_cases')
        .select('*')
        .eq('id', id)
        .single()

    if (error || !data) {
        return NextResponse.json({ error: 'Return case not found' }, { status: 404 })
    }
    if (!ctx.isManager && data.shop_org_id !== ctx.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return data as Record<string, any>
}

/** Column that stamps the moment a case entered `status`. */
export function statusTimestampColumn(status: ReturnStatus): string | null {
    return RETURN_STATUS_TIMESTAMP_COLUMN[status] ?? null
}
