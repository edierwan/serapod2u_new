export type NotificationRoutingPreset =
    | 'whatsapp_only'
    | 'email_only'
    | 'sms_only'
    | 'whatsapp_email_fallback'
    | 'whatsapp_sms_email_fallback'

export type NotificationDeliveryChannel = 'whatsapp' | 'sms' | 'email'

export const DELETE_USER_OTP_DEFAULT_PRESET: NotificationRoutingPreset = 'whatsapp_sms_email_fallback'

const VALID_PRESETS: NotificationRoutingPreset[] = [
    'whatsapp_only',
    'email_only',
    'sms_only',
    'whatsapp_email_fallback',
    'whatsapp_sms_email_fallback',
]

export function isNotificationRoutingPreset(value: unknown): value is NotificationRoutingPreset {
    return typeof value === 'string' && VALID_PRESETS.includes(value as NotificationRoutingPreset)
}

/** Full send order for synchronous OTP. Outbox queueing still uses first hop only. */
export function deliveryChainForPreset(preset: NotificationRoutingPreset): NotificationDeliveryChannel[] {
    if (preset === 'email_only') return ['email']
    if (preset === 'sms_only') return ['sms']
    if (preset === 'whatsapp_only') return ['whatsapp']
    if (preset === 'whatsapp_email_fallback') return ['whatsapp', 'email']
    return ['whatsapp', 'sms', 'email']
}

const EXCLUSIVE_PRESETS: NotificationRoutingPreset[] = ['sms_only', 'email_only', 'whatsapp_only']

/**
 * Destructive OTP routing. Prefer an explicit saved preset.
 * Do not infer from channels_enabled — the Types UI stores only the first hop there.
 *
 * Effective order matches Notification Types: event override, then category
 * (e.g. Security & OTP = SMS Only), then Default Delivery.
 * A leftover catalog 3-step event override must not hide an exclusive category.
 */
export function resolveDeleteUserOtpPreset(setting: unknown): NotificationRoutingPreset {
    const routing = (setting as {
        recipient_config?: {
            routing?: {
                preset?: unknown
                source?: unknown
                default_preset?: unknown
                category_preset?: unknown
            }
        }
    } | null)?.recipient_config?.routing

    const eventPreset = isNotificationRoutingPreset(routing?.preset) ? routing.preset : null
    const defaultPreset = isNotificationRoutingPreset(routing?.default_preset) ? routing.default_preset : null
    const categoryPreset = isNotificationRoutingPreset(routing?.category_preset) ? routing.category_preset : null
    const source = routing?.source

    if (source === 'event' && eventPreset && EXCLUSIVE_PRESETS.includes(eventPreset)) {
        return eventPreset
    }
    if (
        eventPreset === DELETE_USER_OTP_DEFAULT_PRESET
        && categoryPreset
        && EXCLUSIVE_PRESETS.includes(categoryPreset)
    ) {
        return categoryPreset
    }
    if (source === 'event' && eventPreset) {
        if (defaultPreset && EXCLUSIVE_PRESETS.includes(defaultPreset)) return defaultPreset
        return eventPreset
    }
    if (categoryPreset) return categoryPreset
    if (defaultPreset) return defaultPreset
    if (eventPreset) return eventPreset
    return DELETE_USER_OTP_DEFAULT_PRESET
}

export function resolveNotificationRoutingPreset(setting: any, useSavedDefault = false): NotificationRoutingPreset {
    const routing = setting?.recipient_config?.routing
    const preset = useSavedDefault ? routing?.default_preset || routing?.preset : routing?.preset
    if (
        preset === 'whatsapp_only'
        || preset === 'email_only'
        || preset === 'sms_only'
        || preset === 'whatsapp_email_fallback'
        || preset === 'whatsapp_sms_email_fallback'
    ) {
        return preset
    }

    const channels = Array.isArray(setting?.channels_enabled) ? setting.channels_enabled : []
    if (channels.includes('whatsapp') && channels.includes('email')) return 'whatsapp_email_fallback'
    if (channels.includes('email')) return 'email_only'
    if (channels.includes('sms')) return 'sms_only'
    return 'whatsapp_only'
}
