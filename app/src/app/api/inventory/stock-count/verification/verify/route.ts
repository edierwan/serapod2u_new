import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { hashStockCountCode } from '@/lib/inventory/stock-count-verification-server'
import {
    createStockCountErrorReference,
    mapStockCountDatabaseError,
    STOCK_COUNT_POST_PERMISSION,
    stockCountVerificationError,
} from '@/lib/inventory/stock-count-verification-errors'

export const dynamic = 'force-dynamic'

function jsonError(friendly: ReturnType<typeof stockCountVerificationError>) {
    return NextResponse.json({
        error: friendly.message,
        code: friendly.code,
        guidance: friendly.guidance,
        reference: friendly.reference,
        stage: friendly.stage || 'verify',
    }, { status: friendly.status })
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return jsonError(stockCountVerificationError('authentication_required', { stage: 'verify' }))
    }
    let requestIdForAudit: string | null = null
    try {
        const { requestId, sessionId, code } = await request.json()
        requestIdForAudit = typeof requestId === 'string' ? requestId : null
        if (!requestId || !sessionId || !/^\d{8}$/.test(String(code || ''))) {
            return jsonError(stockCountVerificationError('invalid_code', { stage: 'verify' }))
        }
        const { data: accessibleSession } = await (supabase as any).from('stock_count_sessions').select('id,status,count_type').eq('id', sessionId).maybeSingle()
        if (!accessibleSession) {
            return jsonError(stockCountVerificationError('stock_count_access_denied', { stage: 'verify' }))
        }
        if (accessibleSession.status === 'posted') {
            return jsonError(stockCountVerificationError('already_posted', { stage: 'post' }))
        }
        const permission = await checkPermissionForUser(user.id, STOCK_COUNT_POST_PERMISSION)
        if (!permission.allowed || !permission.context?.organization_id) {
            return jsonError(stockCountVerificationError('permission_denied', { stage: 'verify' }))
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
        const reference = createStockCountErrorReference()
        const mapped = mapStockCountDatabaseError(error?.message || '', 'post')
        const friendly = mapped.code === 'unexpected_error'
            ? stockCountVerificationError('unexpected_error', { stage: 'post', reference })
            : { ...mapped, stage: mapped.stage || 'post' }
        console.error('[stock-count-verification/verify] failed', {
            reference: friendly.reference || reference,
            requestId: requestIdForAudit,
            code: friendly.code,
            message: error?.message,
            // Never log secrets / plaintext codes / stack traces to clients; server log only.
        })
        if (requestIdForAudit) {
            try {
                const admin = createAdminClient() as any
                await admin.from('stock_count_verification_requests').update({
                    posting_result: {
                        status: 'failed',
                        error_code: friendly.code,
                        reference: friendly.reference || reference,
                        recorded_at: new Date().toISOString(),
                    },
                }).eq('id', requestIdForAudit).eq('requesting_user_id', user.id)
            } catch (auditError: any) {
                console.error('[stock-count-verification/verify] audit update failed', {
                    requestId: requestIdForAudit,
                    message: auditError?.message,
                })
            }
        }
        return jsonError(friendly)
    }
}
