export type NotificationRoutingPreset = 'whatsapp_only' | 'email_only' | 'sms_only' | 'whatsapp_email_fallback'

export function resolveNotificationRoutingPreset(setting: any, useSavedDefault = false): NotificationRoutingPreset {
    const routing = setting?.recipient_config?.routing
    const preset = useSavedDefault ? routing?.default_preset || routing?.preset : routing?.preset
    if (preset === 'whatsapp_only' || preset === 'email_only' || preset === 'sms_only' || preset === 'whatsapp_email_fallback') {
        return preset
    }

    const channels = Array.isArray(setting?.channels_enabled) ? setting.channels_enabled : []
    if (channels.includes('whatsapp') && channels.includes('email')) return 'whatsapp_email_fallback'
    if (channels.includes('email')) return 'email_only'
    if (channels.includes('sms')) return 'sms_only'
    return 'whatsapp_only'
}
