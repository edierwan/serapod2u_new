/**
 * Consumer scan-issue logger.
 *
 * Fire-and-forget: every public function returns a Promise<void> and swallows
 * its own errors so calling code can `await logScanIssue(...).catch(() => {})`
 * or omit the await entirely without breaking the user response.
 *
 * Includes:
 *   - logScanIssue()       : insert or bump dedup'd row
 *   - dispatchNotifications() : kick off consumer + admin WhatsApp messages
 *
 * The logger purposely uses the service-role admin client so it can write
 * past RLS — public scan endpoints never see SERVICE_ROLE on the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

export type ScanIssueType =
    | 'not_shipped_yet'
    | 'qr_not_found'
    | 'qr_not_active'
    | 'already_collected'
    | 'expired_qr'
    | 'blocked_qr'
    | 'invalid_status'
    | 'authentication_failed'
    | 'system_error'
    | 'unknown_error'
    | 'buffer_unpromoted'

export type ScanIssuePriority = 'low' | 'medium' | 'high' | 'urgent'

export interface LogScanIssueInput {
    qrCodeText: string
    issueType: ScanIssueType
    errorMessage: string
    errorCode?: string | null
    userFacingMessage?: string | null
    priority?: ScanIssuePriority
    qrCodeId?: string | null
    masterCodeId?: string | null
    orderId?: string | null
    productId?: string | null
    shopId?: string | null
    consumerUserId?: string | null
    orgId?: string | null
    // Snapshots
    orderNoSnapshot?: string | null
    displayDocNoSnapshot?: string | null
    masterCodeSnapshot?: string | null
    productCodeSnapshot?: string | null
    productNameSnapshot?: string | null
    shopNameSnapshot?: string | null
    consumerNameSnapshot?: string | null
    consumerPhoneSnapshot?: string | null
    consumerEmailSnapshot?: string | null
    // Request metadata
    sourcePage?: string | null
    scanUrl?: string | null
    ipAddress?: string | null
    userAgent?: string | null
    metadata?: Record<string, any>
}

const HIGH_PRIORITY_TYPES: ScanIssueType[] = ['authentication_failed', 'blocked_qr', 'system_error']

function inferPriority(t: ScanIssueType, explicit?: ScanIssuePriority): ScanIssuePriority {
    if (explicit) return explicit
    if (HIGH_PRIORITY_TYPES.includes(t)) return 'high'
    if (t === 'unknown_error') return 'medium'
    return 'medium'
}

/**
 * Insert a new issue row OR bump attempt_count on an existing pending row.
 * Returns the row id when known, or null when the operation could not be
 * completed (errors swallowed and logged).
 */
export async function logScanIssue(
    supabaseAdmin: SupabaseClient,
    input: LogScanIssueInput,
): Promise<{ id: string; issue_no: string } | null> {
    try {
        const priority = inferPriority(input.issueType, input.priority)
        const phoneNormalized = input.consumerPhoneSnapshot
            ? normalizePhoneE164(input.consumerPhoneSnapshot).replace(/^\+/, '') || null
            : null

        // Dedup: find an existing pending issue within the last 60 minutes
        if (phoneNormalized) {
            const dedupSinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
            const { data: existing } = await supabaseAdmin
                .from('consumer_scan_issues')
                .select('id, issue_no, attempt_count')
                .eq('qr_code_text', input.qrCodeText)
                .eq('consumer_whatsapp_number', phoneNormalized)
                .eq('issue_type', input.issueType)
                .eq('status', 'pending')
                .gte('last_attempt_at', dedupSinceIso)
                .order('last_attempt_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (existing?.id) {
                await supabaseAdmin
                    .from('consumer_scan_issues')
                    .update({
                        attempt_count: (existing.attempt_count || 1) + 1,
                        last_attempt_at: new Date().toISOString(),
                    })
                    .eq('id', existing.id)
                return { id: existing.id, issue_no: existing.issue_no }
            }
        }

        // Auto-snapshot from related tables when caller didn't pass values.
        let orderNoSnap = input.orderNoSnapshot ?? null
        let displayDocNoSnap = input.displayDocNoSnapshot ?? null
        let productNameSnap = input.productNameSnapshot ?? null
        let productCodeSnap = input.productCodeSnapshot ?? null
        let shopNameSnap = input.shopNameSnapshot ?? null
        let masterCodeSnap = input.masterCodeSnapshot ?? null

        if (input.orderId && (!orderNoSnap || !displayDocNoSnap)) {
            const { data: ord } = await supabaseAdmin
                .from('orders')
                .select('order_no, display_doc_no')
                .eq('id', input.orderId)
                .maybeSingle()
            if (ord) {
                orderNoSnap = orderNoSnap || ord.order_no || null
                displayDocNoSnap = displayDocNoSnap || ord.display_doc_no || null
            }
        }
        if (input.productId && (!productNameSnap || !productCodeSnap)) {
            const { data: prod } = await supabaseAdmin
                .from('products')
                .select('product_name, product_code')
                .eq('id', input.productId)
                .maybeSingle()
            if (prod) {
                productNameSnap = productNameSnap || prod.product_name || null
                productCodeSnap = productCodeSnap || prod.product_code || null
            }
        }
        if (input.shopId && !shopNameSnap) {
            const { data: shop } = await supabaseAdmin
                .from('organizations')
                .select('org_name')
                .eq('id', input.shopId)
                .maybeSingle()
            if (shop) shopNameSnap = shop.org_name || null
        }
        if (input.masterCodeId && !masterCodeSnap) {
            const { data: mc } = await supabaseAdmin
                .from('qr_master_codes')
                .select('master_code')
                .eq('id', input.masterCodeId)
                .maybeSingle()
            if (mc) masterCodeSnap = (mc as any).master_code || null
        }

        const row = {
            qr_code_text: input.qrCodeText,
            qr_code_id: input.qrCodeId ?? null,
            master_code_id: input.masterCodeId ?? null,
            order_id: input.orderId ?? null,
            product_id: input.productId ?? null,
            shop_id: input.shopId ?? null,
            consumer_user_id: input.consumerUserId ?? null,
            org_id: input.orgId ?? null,
            order_no_snapshot: orderNoSnap,
            display_doc_no_snapshot: displayDocNoSnap,
            master_code_snapshot: masterCodeSnap,
            product_code_snapshot: productCodeSnap,
            product_name_snapshot: productNameSnap,
            shop_name_snapshot: shopNameSnap,
            consumer_name_snapshot: input.consumerNameSnapshot ?? null,
            consumer_phone_snapshot: input.consumerPhoneSnapshot ?? null,
            consumer_email_snapshot: input.consumerEmailSnapshot ?? null,
            issue_type: input.issueType,
            error_code: input.errorCode ?? null,
            error_message: input.errorMessage,
            user_facing_message: input.userFacingMessage ?? null,
            status: 'pending',
            priority,
            source_page: input.sourcePage ?? null,
            scan_url: input.scanUrl ?? null,
            ip_address: input.ipAddress ?? null,
            user_agent: input.userAgent ?? null,
            metadata: input.metadata || {},
            consumer_whatsapp_number: phoneNormalized,
        }

        const { data, error } = await supabaseAdmin
            .from('consumer_scan_issues')
            .insert(row)
            .select('id, issue_no')
            .single()

        if (error || !data) {
            console.error('[scan-issues] insert failed:', error)
            return null
        }

        return { id: data.id, issue_no: data.issue_no }
    } catch (err) {
        console.error('[scan-issues] logScanIssue threw:', err)
        return null
    }
}

/* ---------------------------------------------------------------------------
 * Template rendering — supports {{var}} and {var}
 * ------------------------------------------------------------------------ */
function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>) {
    return body
        .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => String(vars[key] ?? ''))
        .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_m, key) => String(vars[key] ?? ''))
}

async function loadTemplate(supabaseAdmin: SupabaseClient, orgId: string | null, key: string) {
    // Prefer org-specific, fall back to global (org_id IS NULL)
    if (orgId) {
        const { data } = await supabaseAdmin
            .from('consumer_scan_issue_templates')
            .select('body, template_key')
            .eq('org_id', orgId)
            .eq('template_key', key)
            .eq('is_active', true)
            .maybeSingle()
        if (data?.body) return data
    }
    const { data } = await supabaseAdmin
        .from('consumer_scan_issue_templates')
        .select('body, template_key')
        .is('org_id', null)
        .eq('template_key', key)
        .eq('is_active', true)
        .maybeSingle()
    return data || null
}

async function callWa(
    supabaseAdmin: SupabaseClient,
    orgId: string | null,
    providerPhone: string,
    text: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
        if (!orgId) return { ok: false, error: 'No org_id for WA config' }
        const { getWhatsAppConfig, callGateway } = await import('@/app/api/settings/whatsapp/_utils')
        const cfg = await getWhatsAppConfig(supabaseAdmin as any, orgId)
        if (!cfg?.baseUrl || !cfg?.apiKey) {
            return { ok: false, error: 'No active WhatsApp gateway config' }
        }
        const result = await callGateway(cfg.baseUrl, cfg.apiKey, 'POST', '/messages/send', {
            to: providerPhone,
            text,
        }, cfg.tenantId)
        if (result?.success === false || result?.ok === false) {
            return { ok: false, error: result?.error || 'gateway-rejected' }
        }
        return { ok: true, messageId: result?.messageId || result?.message_id }
    } catch (err: any) {
        return { ok: false, error: err?.message || 'gateway-threw' }
    }
}

/**
 * Send consumer acknowledgement + admin alert for a freshly-logged issue.
 * Fire-and-forget. Updates issue notification status columns when possible.
 */
export async function dispatchNotifications(
    supabaseAdmin: SupabaseClient,
    issueId: string,
): Promise<void> {
    try {
        const { data: issue } = await supabaseAdmin
            .from('consumer_scan_issues')
            .select('*')
            .eq('id', issueId)
            .maybeSingle()
        if (!issue) return

        const orgId: string | null = issue.org_id || null
        const scanTimeKL = new Date(issue.scan_attempted_at).toLocaleString('en-MY', {
            timeZone: 'Asia/Kuala_Lumpur',
        })

        const vars = {
            name: issue.consumer_name_snapshot || 'there',
            consumer_phone: issue.consumer_phone_snapshot || '',
            qr_code: issue.qr_code_text,
            order_no: issue.display_doc_no_snapshot || issue.order_no_snapshot || '',
            product_name: issue.product_name_snapshot || '',
            issue_type: issue.issue_type,
            error_message: issue.error_message,
            scan_time: scanTimeKL,
            issue_no: issue.issue_no,
            priority: issue.priority,
            support_note: '',
            rescan_link: '',
        }

        /* ----- consumer acknowledgement ----- */
        if (issue.notify_consumer_enabled && issue.consumer_whatsapp_number) {
            const tpl = await loadTemplate(supabaseAdmin, orgId, 'issue_acknowledgement')
            if (tpl?.body) {
                const provider = toProviderPhone('+' + issue.consumer_whatsapp_number)
                if (provider) {
                    const text = renderTemplate(tpl.body, vars)
                    const result = await callWa(supabaseAdmin, orgId, provider, text)
                    await supabaseAdmin
                        .from('consumer_scan_issues')
                        .update({
                            consumer_notification_status: result.ok ? 'sent' : 'failed',
                            consumer_notification_template_key: 'issue_acknowledgement',
                            consumer_notification_sent_at: result.ok ? new Date().toISOString() : null,
                            consumer_notification_error: result.ok ? null : result.error,
                        })
                        .eq('id', issueId)
                }
            }
        }

        /* ----- admin alert ----- */
        if (orgId) {
            const { data: settings } = await supabaseAdmin
                .from('consumer_scan_issue_settings')
                .select('admin_whatsapp_numbers, notify_on_new_issue, notify_on_high_priority')
                .eq('org_id', orgId)
                .maybeSingle()

            const wantsAdmin = settings && (
                settings.notify_on_new_issue ||
                (settings.notify_on_high_priority && (issue.priority === 'high' || issue.priority === 'urgent'))
            )

            if (wantsAdmin) {
                const numbers: string[] = Array.isArray(settings.admin_whatsapp_numbers)
                    ? settings.admin_whatsapp_numbers
                    : []
                if (numbers.length > 0) {
                    const tpl = await loadTemplate(supabaseAdmin, orgId, 'admin_new_issue_alert')
                    if (tpl?.body) {
                        const text = renderTemplate(tpl.body, vars)
                        let anySent = false
                        let lastErr: string | null = null
                        for (const raw of numbers) {
                            const provider = toProviderPhone('+' + String(raw).replace(/^\+/, ''))
                            if (!provider) continue
                            const result = await callWa(supabaseAdmin, orgId, provider, text)
                            if (result.ok) anySent = true
                            else lastErr = result.error || lastErr
                        }
                        await supabaseAdmin
                            .from('consumer_scan_issues')
                            .update({
                                admin_notification_status: anySent ? 'sent' : 'failed',
                                admin_notification_sent_at: anySent ? new Date().toISOString() : null,
                                admin_notification_error: anySent ? null : lastErr,
                            })
                            .eq('id', issueId)
                    }
                }
            }
        }
    } catch (err) {
        console.error('[scan-issues] dispatchNotifications threw:', err)
    }
}

/** Convenience — log + dispatch in one call. */
export async function reportScanIssue(
    supabaseAdmin: SupabaseClient,
    input: LogScanIssueInput,
): Promise<void> {
    const logged = await logScanIssue(supabaseAdmin, input)
    if (logged?.id) {
        // do not await — keep response fast
        dispatchNotifications(supabaseAdmin, logged.id).catch((e) =>
            console.error('[scan-issues] notify dispatch error:', e),
        )
    }
}
