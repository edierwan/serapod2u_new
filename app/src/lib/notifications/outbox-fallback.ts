import {
    isNotificationRoutingPreset,
    nextFallbackChannels,
    resolveNotificationRoutingPreset,
    type NotificationDeliveryChannel,
} from '@/lib/notifications/routing'
import { isSingleCreatorSource, ownerPhoneFromPayload, resolveRecipientTargets } from '@/lib/notifications/orderOwnerNotify'
import { notificationPhoneKey } from '@/lib/notifications/manualPhoneNumbers'

type SupabaseLikeClient = any

function payloadObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, any>) }
        : {}
}

/**
 * Insert the next fallback outbox row after WhatsApp or SMS fails.
 * WhatsApp → SMS → Email queues SMS first; if SMS has no provider or no phone,
 * it skips to Email.
 */
export async function queueRoutingFallback(
    supabase: SupabaseLikeClient,
    item: any,
    failedChannel: NotificationDeliveryChannel,
    recipientPhone: string | null,
    reason: string,
): Promise<boolean> {
    const { data: setting } = await supabase
        .from('notification_settings')
        .select('recipient_config, channels_enabled')
        .eq('org_id', item.org_id)
        .eq('event_code', item.event_code)
        .maybeSingle()

    const preset = resolveNotificationRoutingPreset(setting)
    if (!isNotificationRoutingPreset(preset)) return false

    const remaining = nextFallbackChannels(preset, failedChannel)
    if (!remaining.length) return false

    const { data: activeProviders } = await supabase
        .from('notification_provider_configs')
        .select('channel, provider_name')
        .eq('org_id', item.org_id)
        .eq('is_active', true)
        .in('channel', remaining)

    const providerByChannel = new Map<string, string>(
        (activeProviders || []).map((provider: any) => [provider.channel, provider.provider_name]),
    )
    const payload = payloadObject(item.payload_json)
    const targets = resolveRecipientTargets(item.event_code, setting?.recipient_config)
    const ownerPhone = targets.order_creator ? ownerPhoneFromPayload(payload) : null
    const phone = String(ownerPhone || recipientPhone || item.to_phone || '').trim() || null

    const nextChannel = remaining.find((channel) => {
        if (!providerByChannel.has(channel)) return false
        if (channel !== 'email' && !phone) return false
        return true
    }) as NotificationDeliveryChannel | undefined

    if (!nextChannel) return false

    const orderNo = String(payload.order_no || '').trim()
    const phoneKey = notificationPhoneKey(phone)
    if (orderNo && nextChannel !== 'email') {
        const { data: existingForOrder } = await supabase
            .from('notifications_outbox')
            .select('id, to_phone')
            .eq('org_id', item.org_id)
            .eq('event_code', item.event_code)
            .eq('channel', nextChannel)
            .contains('payload_json', { order_no: orderNo })
            .in('status', ['queued', 'processing', 'sent', 'delivered', 'failed'])
        const alreadyQueued = (existingForOrder || []).some((row: { to_phone?: string | null }) => {
            if (phoneKey) return notificationPhoneKey(row.to_phone) === phoneKey
            return isSingleCreatorSource(item.event_code, setting?.recipient_config)
        })
        if (alreadyQueued) return true
    } else if (orderNo && isSingleCreatorSource(item.event_code, setting?.recipient_config)) {
        const { data: existingForOrder } = await supabase
            .from('notifications_outbox')
            .select('id')
            .eq('org_id', item.org_id)
            .eq('event_code', item.event_code)
            .eq('channel', nextChannel)
            .contains('payload_json', { order_no: orderNo })
            .in('status', ['queued', 'processing', 'sent', 'delivered', 'failed'])
            .limit(1)
        if (existingForOrder?.length) return true
    }

    const fallbackMarker = { _routing_fallback_for: item.id }
    const { data: existing } = await supabase
        .from('notifications_outbox')
        .select('id')
        .eq('org_id', item.org_id)
        .eq('channel', nextChannel)
        .contains('payload_json', fallbackMarker)
        .limit(1)

    if (existing?.length) return true

    let toEmail: string | null = nextChannel === 'email' ? (item.to_email || payload.created_by_email || null) : null
    if (nextChannel === 'email' && !toEmail && phone) {
        const { data: matchingUser } = await supabase
            .from('users')
            .select('email')
            .eq('organization_id', item.org_id)
            .eq('phone', phone)
            .maybeSingle()
        toEmail = matchingUser?.email || null
    }

    const { error } = await supabase.from('notifications_outbox').insert({
        org_id: item.org_id,
        event_code: item.event_code,
        channel: nextChannel,
        to_phone: nextChannel === 'email' ? null : phone,
        to_email: toEmail,
        template_code: item.template_code,
        payload_json: {
            ...payload,
            ...fallbackMarker,
            _routing_fallback_channel: nextChannel,
            _routing_fallback_reason: reason,
        },
        priority: item.priority || 'normal',
        provider_name: providerByChannel.get(nextChannel) || null,
        status: 'queued',
        retry_count: 0,
        max_retries: 3,
    })

    return !error
}
