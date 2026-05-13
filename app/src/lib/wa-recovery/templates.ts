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
    /** Body in plain text. Use {{name}} placeholder if needed. */
    body: string
    /** Optional preview hint shown in UI. */
    hint?: string
    active: boolean
    updated_at: string
}

const NOW = '2026-05-13T00:00:00Z'

export const RECOVERY_TEMPLATES: RecoveryTemplate[] = [
    {
        key: 'recovery_notice',
        name: 'System Restored',
        purpose: 'recovery_notice',
        body: [
            'Hello 👋',
            '',
            'We noticed your earlier request may not have been delivered due to a temporary WhatsApp service interruption.',
            '',
            'Our WhatsApp system is now restored.',
            '',
            'Please try again from the app/system.',
            '',
            'We apologize for the inconvenience 🙏',
        ].join('\n'),
        hint: 'Hello 👋 Our WhatsApp system is now back...',
        active: true,
        updated_at: NOW,
    },
    {
        key: 'password_reset_recovery',
        name: 'Password Reset Recovery',
        purpose: 'password_reset_recovery',
        body: [
            'Hello 👋',
            '',
            'Your earlier password reset request may not have been delivered successfully due to a temporary WhatsApp gateway interruption.',
            '',
            'Our system is now back online.',
            '',
            'You may now retry your password reset request.',
            '',
            'Thank you for your patience 🙏',
        ].join('\n'),
        hint: 'Hello 👋 You may now retry your password...',
        active: true,
        updated_at: NOW,
    },
    {
        key: 'registration_recovery',
        name: 'Registration Recovery',
        purpose: 'registration_recovery',
        body: [
            'Hello 👋',
            '',
            'Your earlier registration verification may not have been delivered due to a temporary WhatsApp service interruption.',
            '',
            'Our system is now restored.',
            '',
            'Please try registering again.',
            '',
            'Thank you 🙏',
        ].join('\n'),
        hint: 'Hello 👋 You may now complete your...',
        active: true,
        updated_at: NOW,
    },
    {
        key: 'qr_claim_recovery',
        name: 'QR Claim Recovery',
        purpose: 'qr_claim_recovery',
        body: [
            'Hello 👋',
            '',
            'We detected an earlier issue during your QR scan / point collection notification.',
            '',
            'Our WhatsApp system is now restored.',
            '',
            'You may try again from the app.',
            '',
            'Thank you for your patience 🙏',
        ].join('\n'),
        hint: 'Hello 👋 You may try claiming again...',
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
