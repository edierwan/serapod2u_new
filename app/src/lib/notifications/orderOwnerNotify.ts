export const ORDER_CREATOR_DEFAULT_EVENTS = new Set([
    'order_rejected',
    'order_approved',
    'order_closed',
])

/** @deprecated Use resolveRecipientTargets — kept for older tests and call sites. */
export const ORDER_OWNER_NOTIFY_EVENTS = ORDER_CREATOR_DEFAULT_EVENTS

export type RecipientTargets = {
    roles: boolean
    dynamic_org: boolean
    users: boolean
    consumer: boolean
    order_creator: boolean
}

export function isOrderOwnerNotifyEvent(eventCode: string | null | undefined): boolean {
    return ORDER_CREATOR_DEFAULT_EVENTS.has(String(eventCode || ''))
}

/**
 * Recipients come from Notification Types (recipient_targets).
 * If Order creator was never saved on reject/approve/close, default to creator
 * only so existing rows match the new UI default without a manual visit.
 */
export function resolveRecipientTargets(
    eventCode: string | null | undefined,
    recipientConfig: Record<string, any> | null | undefined,
): RecipientTargets {
    const raw = (recipientConfig?.recipient_targets && typeof recipientConfig.recipient_targets === 'object')
        ? recipientConfig.recipient_targets as Record<string, unknown>
        : {}
    const migratingCreatorDefault = isOrderOwnerNotifyEvent(eventCode) && raw.order_creator === undefined

    return {
        order_creator: migratingCreatorDefault ? true : Boolean(raw.order_creator),
        roles: migratingCreatorDefault ? false : Boolean(raw.roles),
        dynamic_org: Boolean(raw.dynamic_org),
        users: Boolean(raw.users),
        consumer: Boolean(raw.consumer),
    }
}

export function hasExtraRecipientSources(
    targets: RecipientTargets,
    recipientConfig: Record<string, any> | null | undefined,
): boolean {
    const config = recipientConfig || {}
    if (targets.roles || targets.users || targets.consumer || targets.dynamic_org) return true
    if (Array.isArray(config.manual_whatsapp_numbers) && config.manual_whatsapp_numbers.length > 0) return true
    if (Array.isArray(config.manual_email_addresses) && config.manual_email_addresses.length > 0) return true
    if (String(config.custom_phones || '').trim()) return true
    if (String(config.custom_emails || '').trim()) return true
    return false
}

export function isSingleCreatorSource(
    eventCode: string | null | undefined,
    recipientConfig: Record<string, any> | null | undefined,
): boolean {
    const targets = resolveRecipientTargets(eventCode, recipientConfig)
    return targets.order_creator && !hasExtraRecipientSources(targets, recipientConfig)
}

export function ownerPhoneFromPayload(payload: Record<string, any> | null | undefined): string | null {
    const row = payload || {}
    const value = String(row.created_by_phone || row.owner_phone || '').trim()
    return value || null
}

export function ownerEmailFromPayload(payload: Record<string, any> | null | undefined): string | null {
    const row = payload || {}
    const value = String(row.created_by_email || row.owner_email || '').trim()
    return value || null
}
