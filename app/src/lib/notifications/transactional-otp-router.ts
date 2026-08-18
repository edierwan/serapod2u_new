import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { DELETE_USER_OTP_EVENT } from '@/lib/notifications/notificationEventCatalog'
import {
    deliveryChainForPreset,
    resolveDeleteUserOtpPreset,
    type NotificationDeliveryChannel,
    type NotificationRoutingPreset,
} from '@/lib/notifications/routing'
import { getTemplatesForEvent } from '@/config/notificationTemplates'

export const OTP_EXPIRY_MINUTES = 5

export type TransactionalOtpChannel = NotificationDeliveryChannel

export type TransactionalOtpVars = {
    verification_code: string
    target_user_name: string
    requester_email: string
    otp_expiry_minutes: string | number
}

export type TransactionalOtpSendResult = {
    success: boolean
    channel: TransactionalOtpChannel | null
    preset: NotificationRoutingPreset
    chain: TransactionalOtpChannel[]
    fallbackUsed: boolean
    provider: string | null
    errors: Partial<Record<TransactionalOtpChannel, string>>
}

type Senders = {
    sendWhatsApp: (input: { to: string; text: string }) => Promise<void>
    sendSms: (input: { to: string; text: string }) => Promise<{ success: boolean; error?: string; providerName?: string | null }>
    sendEmail: (input: { to: string; subject: string; text: string; html: string }) => Promise<{ success: boolean; error?: string; providerName?: string | null }>
}

const HARDCODED_FALLBACK: Record<TransactionalOtpChannel, { subject?: string; body: string }> = {
    whatsapp: {
        body: `⚠️ DELETION VERIFICATION\n\nCode: *{{verification_code}}*\n\nUser: {{target_user_name}}\nRequested by: {{requester_email}}\n\nThis code expires in {{otp_expiry_minutes}} minutes. Only enter this code if you authorize this deletion.`,
    },
    sms: {
        body: `DELETION VERIFICATION\nCode: {{verification_code}}\nUser: {{target_user_name}}\nRequested by: {{requester_email}}\nExpires in {{otp_expiry_minutes}} minutes.`,
    },
    email: {
        subject: 'Serapod2U deletion verification code',
        body: `DELETION VERIFICATION\n\nCode: {{verification_code}}\nUser: {{target_user_name}}\nRequested by: {{requester_email}}\n\nThis code expires in {{otp_expiry_minutes}} minutes.\nOnly enter this code if you authorize this deletion.`,
    },
}

export function renderOtpTemplate(template: string, vars: Record<string, string | number>): string {
    let result = String(template || '')
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''))
    }
    return result
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

export function textToSimpleHtml(text: string): string {
    return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;white-space:pre-wrap">${escapeHtml(text)}</div>`
}

export function resolveOtpChannelContent(
    channel: TransactionalOtpChannel,
    setting: { templates?: Record<string, string> } | null | undefined,
    vars: TransactionalOtpVars,
    eventCode: string = DELETE_USER_OTP_EVENT,
): { subject: string; body: string } {
    const catalog = getTemplatesForEvent(eventCode, channel)
    const saved = String(setting?.templates?.[channel] || '').trim()
    const byId = saved ? catalog.find((template) => template.id === saved) : undefined
    const catalogDefault = catalog[0]
    const hardcoded = HARDCODED_FALLBACK[channel]

    const rawBody = byId?.body || saved || catalogDefault?.body || hardcoded.body
    const rawSubject = byId?.subject || catalogDefault?.subject || hardcoded.subject || 'Serapod2U verification code'
    const normalizedVars = {
        verification_code: vars.verification_code,
        target_user_name: vars.target_user_name,
        requester_email: vars.requester_email,
        otp_expiry_minutes: String(vars.otp_expiry_minutes),
    }

    return {
        subject: renderOtpTemplate(rawSubject, normalizedVars),
        body: renderOtpTemplate(rawBody, normalizedVars),
    }
}

async function defaultSenders(admin: any, orgId: string): Promise<Senders> {
    return {
        sendWhatsApp: async ({ to, text }) => {
            const { sendWhatsAppMessage } = await import('@/app/api/settings/whatsapp/_utils')
            await sendWhatsAppMessage(admin, orgId, { to, text })
        },
        sendSms: async ({ to, text }) => {
            const { sendSmsWithActiveProvider, recordSmsDelivery } = await import('@/lib/notifications/sms-send')
            const result = await sendSmsWithActiveProvider(admin, orgId, to, text)
            await recordSmsDelivery(admin, {
                orgId,
                to,
                eventCode: DELETE_USER_OTP_EVENT,
                result,
            })
            return {
                success: Boolean(result.success),
                error: result.error,
                providerName: 'local_my',
            }
        },
        sendEmail: async ({ to, subject, text, html }) => {
            const result = await sendTransactionalHtmlEmail(admin, orgId, {
                to,
                subject,
                text,
                html,
                fromName: 'Serapod2U',
            })
            return {
                success: Boolean(result.success),
                error: result.error,
                providerName: result.providerName || null,
            }
        },
    }
}

export async function sendTransactionalOtp(input: {
    admin: any
    orgId: string
    setting: unknown
    phone: string | null
    email: string | null
    vars: TransactionalOtpVars
    senders?: Partial<Senders>
}): Promise<TransactionalOtpSendResult> {
    const preset = resolveDeleteUserOtpPreset(input.setting)
    const chain = deliveryChainForPreset(preset)
    const senders = { ...(await defaultSenders(input.admin, input.orgId)), ...input.senders }
    const errors: Partial<Record<TransactionalOtpChannel, string>> = {}
    const setting = (input.setting || null) as { templates?: Record<string, string> } | null

    for (const [index, channel] of chain.entries()) {
        const content = resolveOtpChannelContent(channel, setting, input.vars)

        if (channel === 'whatsapp') {
            if (!input.phone) {
                errors.whatsapp = 'Organization phone is not configured'
                continue
            }
            try {
                await senders.sendWhatsApp({
                    to: input.phone.replace(/^\+/, ''),
                    text: content.body,
                })
                return {
                    success: true,
                    channel: 'whatsapp',
                    preset,
                    chain,
                    fallbackUsed: index > 0,
                    provider: 'whatsapp',
                    errors,
                }
            } catch (err: any) {
                errors.whatsapp = err?.message || 'WhatsApp delivery failed'
                continue
            }
        }

        if (channel === 'sms') {
            if (!input.phone) {
                errors.sms = 'Organization phone is not configured'
                continue
            }
            const smsResult = await senders.sendSms({ to: input.phone, text: content.body })
            if (smsResult.success) {
                return {
                    success: true,
                    channel: 'sms',
                    preset,
                    chain,
                    fallbackUsed: index > 0,
                    provider: smsResult.providerName || 'local_my',
                    errors,
                }
            }
            errors.sms = smsResult.error || 'SMS delivery failed'
            continue
        }

        if (!input.email) {
            errors.email = 'Organization contact email is not configured'
            continue
        }
        const emailResult = await senders.sendEmail({
            to: input.email,
            subject: content.subject,
            text: content.body,
            html: textToSimpleHtml(content.body),
        })
        if (emailResult.success) {
            return {
                success: true,
                channel: 'email',
                preset,
                chain,
                fallbackUsed: index > 0,
                provider: emailResult.providerName || 'email',
                errors,
            }
        }
        errors.email = emailResult.error || 'Email delivery failed'
    }

    return {
        success: false,
        channel: null,
        preset,
        chain,
        fallbackUsed: false,
        provider: null,
        errors,
    }
}

export function describeOtpSendFailure(result: TransactionalOtpSendResult): string {
    const parts = result.chain.map((channel) => {
        const reason = result.errors[channel]
        return reason ? `${channel} failed (${reason})` : `${channel} skipped`
    })
    return `Unable to send the verification code. ${parts.join('. ')}.`
}
