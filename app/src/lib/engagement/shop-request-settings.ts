export type ShopRequestRecipientMode = 'manual' | 'hq_org'

export interface ShopRequestNotificationSettings {
    enabled: boolean
    recipientMode: ShopRequestRecipientMode
    manualNumbers: string[]
    requestTemplate: string
    approvalTemplate: string
    rejectionTemplate: string
}

const DEFAULT_REQUEST_TEMPLATE = [
    'New shop request pending review',
    'Requester: {requester_name}',
    'Phone: {requester_phone}',
    'Shop: {shop_name}',
    'Branch: {branch}',
    'State: {state}',
    'Contact: {contact_name}',
    'Contact Phone: {contact_phone}',
    'Address: {address}',
    'Notes: {notes}',
].join('\n')

const DEFAULT_APPROVAL_TEMPLATE = [
    'Your shop request is ready',
    'Shop: {shop_name}',
    'Branch: {branch}',
    'Please open Profile Information and select the approved shop before claiming as shop staff.',
].join('\n')

const DEFAULT_REJECTION_TEMPLATE = [
    'Your shop request was reviewed',
    'Shop: {shop_name}',
    'Status: rejected',
    'Notes: {review_notes}',
].join('\n')

export function getDefaultShopRequestNotificationSettings(): ShopRequestNotificationSettings {
    return {
        enabled: false,
        recipientMode: 'manual',
        manualNumbers: [],
        requestTemplate: DEFAULT_REQUEST_TEMPLATE,
        approvalTemplate: DEFAULT_APPROVAL_TEMPLATE,
        rejectionTemplate: DEFAULT_REJECTION_TEMPLATE,
    }
}

export function normalizeShopRequestNotificationSettings(rawSettings: any): ShopRequestNotificationSettings {
    const defaults = getDefaultShopRequestNotificationSettings()
    const raw = rawSettings?.shop_request_notifications || rawSettings || {}

    return {
        enabled: Boolean(raw.enabled ?? defaults.enabled),
        recipientMode: (raw.recipient_mode || raw.recipientMode) === 'hq_org' ? 'hq_org' : defaults.recipientMode,
        manualNumbers: Array.isArray(raw.manual_numbers || raw.manualNumbers)
            ? (raw.manual_numbers || raw.manualNumbers).map((value: unknown) => String(value || '').trim()).filter(Boolean)
            : defaults.manualNumbers,
        requestTemplate: String(raw.request_template || raw.requestTemplate || defaults.requestTemplate),
        approvalTemplate: String(raw.approval_template || raw.approvalTemplate || defaults.approvalTemplate),
        rejectionTemplate: String(raw.rejection_template || raw.rejectionTemplate || defaults.rejectionTemplate),
    }
}

export function serializeShopRequestNotificationSettings(settings: ShopRequestNotificationSettings) {
    return {
        enabled: settings.enabled,
        recipient_mode: settings.recipientMode,
        manual_numbers: settings.manualNumbers,
        request_template: settings.requestTemplate,
        approval_template: settings.approvalTemplate,
        rejection_template: settings.rejectionTemplate,
    }
}

export function manualNumbersToTextarea(manualNumbers: string[]): string {
    return manualNumbers.join('\n')
}

export function textareaToManualNumbers(value: string): string[] {
    return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
}