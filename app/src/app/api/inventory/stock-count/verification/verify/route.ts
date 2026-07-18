import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { hashStockCountCode } from '@/lib/inventory/stock-count-verification-server'
import { mapStockCountDatabaseError, STOCK_COUNT_POST_PERMISSION, stockCountVerificationError } from '@/lib/inventory/stock-count-verification-errors'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        const friendly = stockCountVerificationError('authentication_required')
        return NextResponse.json({ error: friendly.message, code: friendly.code }, { status: friendly.status })
    }
    let requestIdForAudit: string | null = null
    try {
        const { requestId, sessionId, code } = await request.json()
        requestIdForAudit = typeof requestId === 'string' ? requestId : null
        if (!requestId || !sessionId || !/^\d{8}$/.test(String(code || ''))) {
            const friendly = stockCountVerificationError('invalid_or_expired_code')
            return NextResponse.json({ error: friendly.message, code: friendly.code }, { status: friendly.status })
        }
        const { data: accessibleSession } = await (supabase as any).from('stock_count_sessions').select('id,status,count_type').eq('id', sessionId).maybeSingle()
        if (!accessibleSession) {
            const friendly = stockCountVerificationError('stock_count_access_denied')
            return NextResponse.json({ error: friendly.message, code: friendly.code }, { status: friendly.status })
        }
        const permission = await checkPermissionForUser(user.id, STOCK_COUNT_POST_PERMISSION)
        if (!permission.allowed || !permission.context?.organization_id) {
            const friendly = stockCountVerificationError('permission_denied')
            return NextResponse.json({ error: friendly.message, code: friendly.code }, { status: friendly.status })
        }
        const codeHash = hashStockCountCode(String(code), permission.context.organization_id, sessionId, user.id)
        const postingFunction = accessibleSession.count_type === 'initial_configuration_classification'
            ? 'verify_and_post_stock_classification'
            : 'verify_and_post_stock_count'
        const { data, error } = await (supabase as any).rpc(postingFunction, {
            p_request_id: requestId, p_code_hash: codeHash,
        })
        if (error) throw error
        if (data?.error_code) throw new Error(data.error_code)
        return NextResponse.json(data)
    } catch (error: any) {
        const mapped = mapStockCountDatabaseError(error?.message || '')
        if (requestIdForAudit) {
            const admin = createAdminClient() as any
            await admin.from('stock_count_verification_requests').update({
                posting_result: { status: 'failed', error_code: mapped.code, recorded_at: new Date().toISOString() },
            }).eq('id', requestIdForAudit).eq('requesting_user_id', user.id)
        }
        return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status })
    }
}
