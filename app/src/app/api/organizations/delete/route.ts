import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertDestructiveOpsAllowed } from '@/lib/server/destructive-ops-guard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/organizations/delete
 * Hard-delete an organization via the service_role client.
 * Protected by the destructive-ops-guard (env gate + auth + Super Admin check).
 */
export async function POST(request: NextRequest) {
    const guard = await assertDestructiveOpsAllowed(request, 'hard-delete-organization')
    if (guard.blocked) return guard.response

    const body = await request.json()
    const { orgId } = body

    if (!orgId || typeof orgId !== 'string') {
        return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    console.log(`🗑️ Super Admin ${guard.userEmail} hard-deleting organization ${orgId}`)

    const { data, error } = await admin.rpc('hard_delete_organization', { p_org_id: orgId })

    if (error) {
        console.error('hard_delete_organization RPC error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}
