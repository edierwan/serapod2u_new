import { callGateway, getWhatsAppConfig } from '@/app/api/settings/whatsapp/_utils'
import { buildRoadTourUrl } from '@/lib/roadtour/url'

function normalizePhone(phone?: string | null) {
    const digits = String(phone || '').trim().replace(/[^\d+]/g, '')
    if (!digits) return null
    if (digits.startsWith('+')) return digits.slice(1)
    if (digits.startsWith('0')) return `6${digits}`
    return digits
}

function applyTemplate(template: string, values: Record<string, string | number | null | undefined>) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values[key] ?? ''))
}

async function resolveRecipients(supabase: any, orgId: string, settings: any) {
    if (settings.claim_whatsapp_recipient_mode === 'hq_org') {
        const { data } = await (supabase as any)
            .from('users')
            .select('id, full_name, phone, roles(role_code, role_level)')
            .eq('organization_id', orgId)

        return (data || [])
            .filter((user: any) => {
                const role = Array.isArray(user.roles) ? user.roles[0] : user.roles
                return user.phone && role && (role.role_level <= 20 || ['super_admin', 'admin', 'org_admin'].includes(role.role_code))
            })
            .map((user: any) => ({
                phone_number: String(user.phone),
                recipient_label: user.full_name || 'HQ',
            }))
    }

    return String(settings.claim_whatsapp_manual_numbers || '')
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((phone) => ({
            phone_number: phone,
            recipient_label: 'Manual recipient',
        }))
}

export async function sendRoadtourClaimNotifications(params: {
    supabase: any
    orgId: string
    scanEventId?: string | null
    campaignId: string
    qrCodeId?: string | null
    accountManagerUserId?: string | null
    notificationType: 'success' | 'failed' | 'duplicate' | 'test'
    campaignName: string
    referenceName?: string | null
    shopName?: string | null
    consumerName?: string | null
    pointsAwarded?: number | null
    balanceAfter?: number | null
    canonicalPath?: string | null
    forceSend?: boolean
    message: string
}) {
    const { supabase, orgId } = params
    const { data: settings } = await (supabase as any)
        .from('roadtour_settings')
        .select('claim_whatsapp_enabled, claim_whatsapp_recipient_mode, claim_whatsapp_manual_numbers, claim_whatsapp_success_template, claim_whatsapp_failure_template')
        .eq('org_id', orgId)
        .maybeSingle()

    if (!settings?.claim_whatsapp_enabled && !params.forceSend) {
        return
    }

    const config = await getWhatsAppConfig(supabase, orgId)
    if (!config?.baseUrl || !config?.apiKey) {
        return
    }

    const recipients = await resolveRecipients(supabase, orgId, settings || {})
    if (!recipients.length) {
        return
    }

    const template = params.notificationType === 'success'
        ? (settings?.claim_whatsapp_success_template || 'RoadTour claim success\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nPoints: {points_awarded}\nBalance: {balance_after}\nStatus: {status}')
        : (settings?.claim_whatsapp_failure_template || 'RoadTour claim {status}\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nReason: {message}')

    const shortLink = buildRoadTourUrl(
        process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com',
        params.canonicalPath || null,
    )

    for (const recipient of recipients) {
        const phone = normalizePhone(recipient.phone_number)
        if (!phone) continue

        const renderedMessage = applyTemplate(template, {
            campaign_name: params.campaignName,
            reference_name: params.referenceName || 'Reference',
            shop_name: params.shopName || 'Unknown shop',
            consumer_name: params.consumerName || 'Unknown consumer',
            points_awarded: params.pointsAwarded ?? 0,
            balance_after: params.balanceAfter ?? 0,
            status: params.notificationType,
            message: params.message,
            short_link: shortLink || '',
        })

        let sendStatus = 'sent'
        let providerMessageId: string | null = null
        let errorMessage: string | null = null

        try {
            const result = await callGateway(
                config.baseUrl,
                config.apiKey,
                'POST',
                '/messages/send',
                { to: phone, text: renderedMessage },
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

        await (supabase as any).from('roadtour_claim_notification_logs').insert({
            scan_event_id: params.scanEventId || null,
            campaign_id: params.campaignId,
            qr_code_id: params.qrCodeId || null,
            account_manager_user_id: params.accountManagerUserId || null,
            phone_number: recipient.phone_number,
            recipient_label: recipient.recipient_label,
            notification_type: params.notificationType,
            send_status: sendStatus,
            provider_message_id: providerMessageId,
            template_used: template,
            rendered_message: renderedMessage,
            error_message: errorMessage,
            metadata: {
                shop_name: params.shopName || null,
                consumer_name: params.consumerName || null,
            },
            sent_at: new Date().toISOString(),
        })
    }
}