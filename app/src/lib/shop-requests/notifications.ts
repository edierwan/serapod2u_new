import { callGateway, getWhatsAppConfig } from '@/app/api/settings/whatsapp/_utils'
import {
    normalizeShopRequestNotificationSettings,
    type ShopRequestNotificationSettings,
} from '@/lib/engagement/shop-request-settings'
import { applyShopRequestTemplate, buildShopRequestTemplateValues, type ShopRequestRecord } from './core'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

async function resolveRecipients(supabase: any, orgId: string, settings: ShopRequestNotificationSettings) {
    if (settings.recipientMode === 'hq_org') {
        const { data } = await (supabase as any)
            .from('users')
            .select('full_name, phone, roles(role_code, role_level)')
            .eq('organization_id', orgId)

        return (data || [])
            .filter((user: any) => {
                const role = Array.isArray(user.roles) ? user.roles[0] : user.roles
                return user.phone && role && (role.role_level <= 20 || ['super_admin', 'admin', 'org_admin', 'hq_admin'].includes(String(role.role_code || '').toLowerCase()))
            })
            .map((user: any) => ({
                phone_number: String(user.phone),
                recipient_label: user.full_name || 'HQ',
            }))
    }

    return settings.manualNumbers.map((phone) => ({
        phone_number: phone,
        recipient_label: 'Manual recipient',
    }))
}

async function logNotification(params: {
    supabase: any
    shopRequestId: string
    notificationType: 'admin_request' | 'requester_approved' | 'requester_rejected'
    phoneNumber: string
    recipientLabel?: string | null
    renderedMessage: string
    sendStatus: 'sent' | 'failed'
    providerMessageId?: string | null
    errorMessage?: string | null
}) {
    await (params.supabase as any).from('shop_request_notification_logs').insert({
        shop_request_id: params.shopRequestId,
        notification_type: params.notificationType,
        phone_number: params.phoneNumber,
        recipient_label: params.recipientLabel || null,
        rendered_message: params.renderedMessage,
        send_status: params.sendStatus,
        provider_message_id: params.providerMessageId || null,
        error_message: params.errorMessage || null,
        sent_at: new Date().toISOString(),
    })
}

export async function sendShopRequestNotifications(params: {
    supabase: any
    orgId: string
    settings: any
    request: ShopRequestRecord
    notificationType: 'admin_request' | 'requester_approved' | 'requester_rejected'
}) {
    const settings = normalizeShopRequestNotificationSettings(params.settings)
    if (!settings.enabled) {
        return
    }

    const config = await getWhatsAppConfig(params.supabase, params.orgId)
    if (!config?.baseUrl || !config?.apiKey) {
        return
    }

    const template = params.notificationType === 'admin_request'
        ? settings.requestTemplate
        : params.notificationType === 'requester_approved'
            ? settings.approvalTemplate
            : settings.rejectionTemplate

    const recipients = params.notificationType === 'admin_request'
        ? await resolveRecipients(params.supabase, params.orgId, settings)
        : [{ phone_number: params.request.requesterPhone || '', recipient_label: params.request.requesterName || 'Requester' }]

    const values = buildShopRequestTemplateValues(params.request)

    for (const recipient of recipients) {
        const canonicalPhone = normalizePhoneE164(recipient.phone_number || '')
        const providerPhone = canonicalPhone ? toProviderPhone(canonicalPhone) : null
        if (!canonicalPhone || !providerPhone) continue

        const renderedMessage = applyShopRequestTemplate(template, values)

        let sendStatus: 'sent' | 'failed' = 'sent'
        let providerMessageId: string | null = null
        let errorMessage: string | null = null

        try {
            const result = await callGateway(
                config.baseUrl,
                config.apiKey,
                'POST',
                '/messages/send',
                { to: providerPhone, text: renderedMessage },
                config.tenantId,
            )

            if (result?.ok === false) {
                sendStatus = 'failed'
                errorMessage = result.error || 'Gateway send failed'
            } else {
                providerMessageId = result?.messageId || result?.message_id || null
            }
        } catch (error: any) {
            sendStatus = 'failed'
            errorMessage = error?.message || 'Gateway send failed'
        }

        await logNotification({
            supabase: params.supabase,
            shopRequestId: params.request.id,
            notificationType: params.notificationType,
            phoneNumber: canonicalPhone,
            recipientLabel: recipient.recipient_label,
            renderedMessage,
            sendStatus,
            providerMessageId,
            errorMessage,
        })
    }
}