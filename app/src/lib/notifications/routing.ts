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

/**
 * Destructive OTP routing. Prefer an explicit saved preset.
 * Do not infer from channels_enabled — the Types UI stores only the first hop there.
 */
export function resolveDeleteUserOtpPreset(setting: unknown): NotificationRoutingPreset {
    const routing = (setting as { recipient_config?: { routing?: { preset?: unknown } } } | null)?.recipient_config?.routing
    if (isNotificationRoutingPreset(routing?.preset)) return routing.preset
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
