import { normalizeAndDedupeManualEmails } from './manualEmailAddresses'

export function sanitizeStockCountNotificationConfig(config: any, manualEmails: unknown) {
    return {
        ...config,
        include_consumer: false,
        dynamic_target: null,
        roles: [],
        manual_whatsapp_numbers: [],
        manual_email_addresses: normalizeAndDedupeManualEmails(manualEmails),
        recipient_users: Array.isArray(config?.recipient_users) ? config.recipient_users : [],
        recipient_targets: {
            roles: false,
            dynamic_org: false,
            users: Boolean(config?.recipient_targets?.users),
            consumer: false,
        },
        routing: { ...(config?.routing || {}), preset: 'email_only', source: 'event' },
    }
}
