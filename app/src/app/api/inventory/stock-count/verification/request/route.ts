import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import {
    finalizeStockCountVerificationDelivery, generateStockCountCode, hashStockCountCode, maskEmail,
} from '@/lib/inventory/stock-count-verification-server'
import { buildStockCountEmail } from '@/lib/inventory/stock-count-verification-email'
import { createStockCountPreflightDependencies, evaluateStockCountPreflight } from '@/lib/inventory/stock-count-verification-preflight'
import {
    createStockCountErrorReference,
    mapStockCountDatabaseError,
    stockCountVerificationError,
} from '@/lib/inventory/stock-count-verification-errors'

export const dynamic = 'force-dynamic'

function jsonError(friendly: ReturnType<typeof stockCountVerificationError>) {
    return NextResponse.json({
        error: friendly.message,
        code: friendly.code,
        guidance: friendly.guidance,
        reference: friendly.reference,
        stage: friendly.stage || 'request',
    }, { status: friendly.status })
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return jsonError(stockCountVerificationError('authentication_required', { stage: 'request' }))
    }
    let preparedRequestId: string | null = null
    try {
        const { sessionId } = await request.json()
        if (!sessionId) {
            return jsonError(stockCountVerificationError('stock_count_not_found', { stage: 'request' }))
        }
        const admin = createAdminClient(20_000) as any
        const preflight = await evaluateStockCountPreflight(createStockCountPreflightDependencies(supabase, admin), user.id, sessionId)
        if (!preflight.ok) {
            return jsonError(stockCountVerificationError(preflight.code, { stage: 'request' }))
        }
        const { organizationId: orgId, recipients, session } = preflight
        const [warehouseResult, organizationResult, requestedByResult] = await Promise.all([
            admin.from('organizations').select('org_name').eq('id', session.warehouse_organization_id).single(),
            admin.from('organizations').select('org_name').eq('id', orgId).single(),
            admin.from('users').select('full_name,email').eq('id', user.id).single(),
        ])
        const summary = {
            total_variants_counted: preflight.summary.totalVariantsCounted,
            variance_items: preflight.summary.varianceItems,
            net_quantity_adjustment: preflight.summary.netQuantityAdjustment,
            estimated_adjustment_value: preflight.summary.estimatedAdjustmentValue,
        }
        const code = generateStockCountCode()
        const codeHash = hashStockCountCode(code, orgId, sessionId, user.id)
        const maskedRecipients = recipients.map(maskEmail)
        // Render before persisting a request so a rendering failure cannot
        // leave behind an active code.
        const email = buildStockCountEmail({
            ...session, ...summary,
            warehouse_name: warehouseResult.data?.org_name || 'Warehouse',
            organization_name: organizationResult.data?.org_name || null,
            requested_by: requestedByResult.data?.full_name || requestedByResult.data?.email || 'Authorized user',
            requested_at: new Date(),
            high_impact: Math.abs(summary.estimated_adjustment_value) >= 10_000 || Math.abs(summary.net_quantity_adjustment) >= 1_000,
        }, code)
        const metadata = { user_agent: request.headers.get('user-agent')?.slice(0, 500) || null, forwarded_for_present: Boolean(request.headers.get('x-forwarded-for')) }
        const { data: prepared, error: prepareError } = await (supabase as any).rpc('prepare_stock_count_verification', {
            p_session_id: sessionId, p_organization_id: orgId, p_code_hash: codeHash,
            p_recipient_summary: maskedRecipients, p_request_metadata: metadata,
        })
        if (prepareError) throw prepareError
        preparedRequestId = prepared?.request_id || null

        const deliveries = await Promise.all(recipients.map((to) => sendTransactionalHtmlEmail(admin, orgId, {
            to, subject: email.subject, text: email.text, html: email.html, fromName: 'Serapod2U Notifications',
        })))
        const delivered = deliveries.every((result) => result.success)

        try {
            await finalizeStockCountVerificationDelivery(supabase, prepared.request_id, delivered)
        } catch (finalizeError: any) {
            // The provider may already have accepted the message. Never claim a
            // generic "request failed" without distinguishing delivery vs activate.
            const reference = createStockCountErrorReference()
            console.error('[stock-count-verification/request] finalize failed', {
                reference,
                requestId: prepared.request_id,
                delivered,
                message: finalizeError?.message,
            })
            if (delivered) {
                return NextResponse.json({
                    error: 'Verification code was generated and emailed, but activation failed. Please resend the code or contact your administrator.',
                    code: 'unexpected_error',
                    reference,
                    stage: 'request',
                }, { status: 500 })
            }
            return jsonError(stockCountVerificationError('email_delivery_failed', { stage: 'request' }))
        }

        if (!delivered) {
            return jsonError(stockCountVerificationError('email_delivery_failed', { stage: 'request' }))
        }
        return NextResponse.json({
            requestId: prepared.request_id, recipients: maskedRecipients, expiresAt: prepared.expires_at,
            resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
        })
    } catch (error: any) {
        const reference = createStockCountErrorReference()
        console.error('[stock-count-verification/request] failed', {
            reference,
            requestId: preparedRequestId,
            message: error?.message,
            code: error?.code,
        })
        const mapped = mapStockCountDatabaseError(error?.message || '', 'request', error?.code)
        return jsonError(mapped.code === 'unexpected_error'
            ? stockCountVerificationError('unexpected_error', { stage: 'request', reference })
            : { ...mapped, stage: 'request' })
    }
}
