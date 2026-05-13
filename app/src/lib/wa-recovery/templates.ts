/**
 * WhatsApp Recovery Templates
 *
 * Hardcoded recovery message templates used by the WhatsApp Recovery
 * Operations Center to notify users after a Baileys gateway interruption.
 *
 * These messages are NOT OTPs and do NOT include sensitive codes. They simply
 * inform users that the WhatsApp system is restored and ask them to retry.
 *
 * TODO: If template editing/A-B-testing is required, migrate these to a
 * `whatsapp_recovery_templates` table (template_key, body, active, updated_at)
 * and add a small admin CRUD. For now constants keep deploys simple.
 */

export type RecoveryPurpose =
    | 'recovery_notice'
    | 'password_reset_recovery'
    | 'registration_recovery'
    | 'qr_claim_recovery'

export interface RecoveryTemplate {
    key: RecoveryPurpose
    name: string
    purpose: RecoveryPurpose
    /** Body in plain text. Supports placeholders like {{greeting}}, {{date}}, {{time}}. */
    body: string
    /** Optional preview hint shown in UI. */
    hint?: string
    /** Supported variables for template rendering. */
    variables?: string[]
    active: boolean
    updated_at: string
}

export interface RecoveryMessageContext {
    failedPurpose?: string | null
    failedAt?: string | Date | null
    recipientName?: string | null
    appName?: string
}

export interface RecoveryMessageResult {
    template: RecoveryTemplate
    variables: Record<string, string>
    body: string
}

const NOW = '2026-05-13T00:00:00Z'

export const RECOVERY_TEMPLATES: RecoveryTemplate[] = [
    {
        key: 'recovery_notice',
        name: 'System Restored',
        purpose: 'recovery_notice',
        body: [
            '{{greeting}}',
            '',
            'Our WhatsApp notification service has now been restored.',
            '',
            'If you were unable to complete your action earlier, you may try again now.',
            '',
            'Sorry for the inconvenience caused.',
        ].join('\n'),
        hint: 'Hi there, our WhatsApp notification service has now been restored...',
        variables: ['greeting'],
        active: true,
        updated_at: NOW,
    },
    {
        key: 'password_reset_recovery',
        name: 'Password Reset Recovery',
        purpose: 'password_reset_recovery',
        body: [
            '{{greeting}}',
            '',
            'We noticed that on {{date}} at {{time}}, you tried to reset your {{app_name}} password, but the WhatsApp OTP message may not have reached you because our WhatsApp gateway was having an issue.',
            '',
            'The service has now been restored. You may try resetting your password again.',
            '',
            'Sorry for the inconvenience caused.',
        ].join('\n'),
        hint: 'Hi there, you may now retry your password reset...',
        variables: ['greeting', 'date', 'time', 'app_name'],
        active: true,
        updated_at: NOW,
    },
    {
        key: 'registration_recovery',
        name: 'Registration Recovery',
        purpose: 'registration_recovery',
        body: [
            '{{greeting}}',
            '',
            'We noticed that on {{date}} at {{time}}, you tried to register with {{app_name}}, but the WhatsApp OTP message may not have reached you because our WhatsApp gateway was having an issue.',
            '',
            'The service has now been restored. You may try registering again.',
            '',
            'Sorry for the inconvenience caused.',
        ].join('\n'),
        hint: 'Hi there, you may now complete your registration...',
        variables: ['greeting', 'date', 'time', 'app_name'],
        active: true,
        updated_at: NOW,
    },
    {
        key: 'qr_claim_recovery',
        name: 'QR Claim Recovery',
        purpose: 'qr_claim_recovery',
        body: [
            '{{greeting}}',
            '',
            'We noticed that on {{date}} at {{time}}, you tried to complete a QR claim, but the WhatsApp message may not have reached you because our WhatsApp gateway was having an issue.',
            '',
            'The service has now been restored. You may try again now.',
            '',
            'Sorry for the inconvenience caused.',
        ].join('\n'),
        hint: 'Hi there, you may now retry your QR claim...',
        variables: ['greeting', 'date', 'time'],
        active: true,
        updated_at: NOW,
    },
]

export function getTemplateByKey(key: string): RecoveryTemplate | null {
    return RECOVERY_TEMPLATES.find(t => t.key === key) || null
}

/** Map an original failed purpose to the right recovery template. */
export function inferRecoveryTemplate(failedPurpose: string | null | undefined): RecoveryTemplate {
    const p = String(failedPurpose || '').toLowerCase()
    if (p.includes('password_reset')) return RECOVERY_TEMPLATES.find(t => t.key === 'password_reset_recovery')!
    if (p.includes('registration') || p.includes('phone_verification')) {
        return RECOVERY_TEMPLATES.find(t => t.key === 'registration_recovery')!
    }
    if (p.includes('qr') || p.includes('claim')) return RECOVERY_TEMPLATES.find(t => t.key === 'qr_claim_recovery')!
    return RECOVERY_TEMPLATES.find(t => t.key === 'recovery_notice')!
}

export function renderTemplate(body: string, vars: Record<string, string> = {}): string {
    return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

function formatDateParts(value?: string | Date | null) {
    if (!value) {
        return { date: 'an earlier time', time: 'an earlier time' }
    }

    const dt = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(dt.getTime())) {
        return { date: 'an earlier time', time: 'an earlier time' }
    }

    return {
        date: dt.toLocaleDateString('en-MY', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        }),
        time: dt.toLocaleTimeString('en-MY', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }),
    }
}

function buildGreeting(recipientName?: string | null) {
    const trimmed = String(recipientName || '').trim()
    return trimmed ? `Hi ${trimmed},` : 'Hi there,'
}

export function buildRecoveryMessageVariables(context: RecoveryMessageContext = {}): Record<string, string> {
    const { date, time } = formatDateParts(context.failedAt)
    return {
        greeting: buildGreeting(context.recipientName),
        name: String(context.recipientName || '').trim(),
        date,
        time,
        app_name: context.appName || 'Serapod2U',
    }
}

export function buildRecoveryMessage(context: RecoveryMessageContext & { templateKey?: string | null } = {}): RecoveryMessageResult {
    const template = context.templateKey
        ? (getTemplateByKey(context.templateKey) || inferRecoveryTemplate(context.failedPurpose))
        : inferRecoveryTemplate(context.failedPurpose)

    const variables = buildRecoveryMessageVariables(context)
    return {
        template,
        variables,
        body: renderTemplate(template.body, variables),
    }
}
