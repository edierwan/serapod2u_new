import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveNotificationRoutingPreset, type NotificationRoutingPreset } from '@/lib/notifications/routing'
import { maskPhone, normalizePhoneE164 } from '@/utils/phone'

export const DELETE_ORGANIZATION_EVENT_CODE = 'delete_organization_verification_code'
export const DELETE_ORGANIZATION_CATEGORY = 'Delete Organization Masterdata'

export type DeleteVerificationChannel = 'whatsapp' | 'email'

export class DeleteVerificationConfigurationError extends Error {
    constructor(message: string, public readonly status = 409) {
        super(message)
        this.name = 'DeleteVerificationConfigurationError'
    }
}

export function maskEmail(email: string) {
    const [local, domain] = email.split('@')
    if (!local || !domain) return email
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 2))}@${domain}`
}

export function resolveDeleteVerificationPreset(setting: any): NotificationRoutingPreset {
    if (!setting) {
        throw new DeleteVerificationConfigurationError(
            'Delete Organization Verification Code is not configured. Configure it under Notifications > Notification Types > Delete Organization Masterdata.',
        )
    }
    if (!setting.enabled) {
        throw new DeleteVerificationConfigurationError(
            'Delete Organization Verification Code is disabled. Enable it under Notifications > Notification Types > Delete Organization Masterdata.',
        )
    }
    return resolveNotificationRoutingPreset(setting)
}

export function buildDeleteOrganizationMessage(input: {
    code: string
    organizationName: string
    organizationCode: string
    requestedBy: string
}) {
    const text = `ORGANIZATION DELETION VERIFICATION\n\nCode: ${input.code}\n\nOrganization: ${input.organizationName} (${input.organizationCode})\nRequested by: ${input.requestedBy}\n\nThis code expires in 5 minutes. Only enter it if you authorize this deletion.`
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]!)
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>Organization deletion verification</h2><p>Use this security code to authorize deletion:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${escape(input.code)}</p><p><strong>Organization:</strong> ${escape(input.organizationName)} (${escape(input.organizationCode)})<br><strong>Requested by:</strong> ${escape(input.requestedBy)}</p><p>This code expires in 5 minutes. Only enter it if you authorize this deletion.</p></div>`
    return { text, html, subject: `Verification code to delete ${input.organizationName}` }
}

interface DeliveryInput {
    admin: any
    orgId: string
    preset: NotificationRoutingPreset
    phone: string | null | undefined
    email: string | null | undefined
    message: { text: string; html: string; subject: string }
    sendWhatsApp?: (admin: any, orgId: string, input: { to: string; text: string }) => Promise<any>
    sendEmail?: typeof sendTransactionalHtmlEmail
}

export async function deliverDeleteVerification(input: DeliveryInput): Promise<{
    channel: DeleteVerificationChannel
    recipient: string
    maskedRecipient: string
    provider: string | null
    providerMessageId: string | null
}> {
    const phone = input.phone ? normalizePhoneE164(input.phone) : null
    const email = String(input.email || '').trim().toLowerCase() || null

    const sendEmail = async () => {
        if (!email) {
            throw new DeleteVerificationConfigurationError(
                'Email delivery is selected, but the current organization and requesting admin have no email address configured.',
            )
        }
        const sender = input.sendEmail || sendTransactionalHtmlEmail
        const result = await sender(input.admin, input.orgId, {
            to: email,
            subject: input.message.subject,
            text: input.message.text,
            html: input.message.html,
            fromName: 'Serapod2U Notifications',
        })
        if (!result.success) {
            const detail = result.notConfigured ? 'No active email provider is configured.' : (result.error || 'Email delivery failed.')
            throw new DeleteVerificationConfigurationError(`${detail} Check Notifications > Providers and try again.`, 502)
        }
        return { channel: 'email' as const, recipient: email, maskedRecipient: maskEmail(email), provider: result.providerName || null, providerMessageId: null }
    }

    const sendWhatsApp = async () => {
        if (!phone) {
            throw new DeleteVerificationConfigurationError(
                'WhatsApp delivery is selected, but the current organization has no valid phone number configured in organization master data.',
            )
        }
        const sender = input.sendWhatsApp || (await import('@/app/api/settings/whatsapp/_utils')).sendWhatsAppMessage
        try {
            const result = await sender(input.admin, input.orgId, { to: phone.replace(/^\+/, ''), text: input.message.text })
            const response = result?.response || {}
            return {
                channel: 'whatsapp' as const,
                recipient: phone,
                maskedRecipient: maskPhone(phone),
                provider: result?.providerName || null,
                providerMessageId: response?.key?.id || response?.messageId || response?.messages?.[0]?.id || null,
            }
        } catch (error: any) {
            throw new DeleteVerificationConfigurationError(
                `${error?.message || 'WhatsApp delivery failed.'} Check Notifications > Providers and try again.`,
                502,
            )
        }
    }

    if (input.preset === 'email_only') return sendEmail()
    if (input.preset === 'sms_only') {
        throw new DeleteVerificationConfigurationError(
            'SMS Only is selected for Delete Organization Verification Code, but SMS verification delivery is not available. Choose Email Only, WhatsApp Only, or WhatsApp > Email.',
        )
    }
    if (input.preset === 'whatsapp_only') return sendWhatsApp()

    try {
        return await sendWhatsApp()
    } catch (whatsAppError) {
        try {
            return await sendEmail()
        } catch (emailError: any) {
            const whatsappMessage = whatsAppError instanceof Error ? whatsAppError.message : 'WhatsApp delivery failed.'
            throw new DeleteVerificationConfigurationError(
                `WhatsApp delivery failed and the email fallback could not be sent. WhatsApp: ${whatsappMessage} Email: ${emailError?.message || 'Email delivery failed.'}`,
                502,
            )
        }
    }
}
