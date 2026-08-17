import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateOtp, hashOtp } from '@/server/auth/passwordResetService'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { maskEmail } from '@/lib/auth/registration-otp-email'
import { maskPhone, normalizePhoneE164 } from '@/utils/phone'

const PURPOSE = 'user_deletion'
const MAX_SENDS_PER_15MIN = 3
type UserRemovalMode = 'delete' | 'archive'
type DeliveryChannel = 'whatsapp' | 'sms' | 'email'

async function getUserRemovalMode(admin: any, userId: string): Promise<UserRemovalMode> {
    const checks = await Promise.all([
        admin.from('orders').select('id', { count: 'exact', head: true })
            .or(`created_by.eq.${userId},approved_by.eq.${userId},updated_by.eq.${userId}`),
        admin.from('documents').select('id', { count: 'exact', head: true })
            .or(`created_by.eq.${userId},acknowledged_by.eq.${userId}`),
        admin.from('document_files').select('id', { count: 'exact', head: true })
            .eq('uploaded_by', userId),
        admin.from('document_signatures').select('id', { count: 'exact', head: true })
            .eq('signer_user_id', userId),
    ])

    // Conservatively retain the account if a dependency check itself fails.
    // This avoids hard-deleting a user when the dependency picture is incomplete.
    if (checks.some(({ error }: { error: unknown }) => Boolean(error))) return 'archive'
    return checks.some(({ count }: { count: number | null }) => (count ?? 0) > 0)
        ? 'archive'
        : 'delete'
}

function normalizeOrgEmail(email: string | null | undefined): string | null {
    const value = String(email || '').trim().toLowerCase()
    if (!value || !value.includes('@')) return null
    return value
}

function buildDeletionOtpEmail(input: {
    code: string
    targetName: string
    requesterEmail: string | null | undefined
}) {
    const subject = 'Serapod2U deletion verification code'
    const text = [
        'DELETION VERIFICATION',
        '',
        `Code: ${input.code}`,
        `User: ${input.targetName}`,
        `Requested by: ${input.requesterEmail || 'unknown'}`,
        '',
        'This code expires in 5 minutes.',
        'Only enter this code if you authorize this deletion.',
    ].join('\n')
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 12px;color:#b91c1c">Deletion verification</h2>
        <p style="margin:0 0 12px">Use this code to confirm removing <strong>${input.targetName}</strong>.</p>
        <p style="margin:0 0 12px;font-size:28px;letter-spacing:6px;font-weight:700">${input.code}</p>
        <p style="margin:0 0 8px">Requested by: ${input.requesterEmail || 'unknown'}</p>
        <p style="margin:0;color:#666;font-size:13px">This code expires in 5 minutes. Ignore this email if you did not request the deletion.</p>
      </div>
    `
    return { subject, text, html }
}

/**
 * POST /api/admin/delete-user-otp/request
 *
 * Step 1: HQ Admin or Super Admin requests a deletion OTP.
 * Primary delivery: organization contact phone via WhatsApp.
 * Fallbacks: SMS (Local MY provider), then organization contact email.
 */
export async function POST(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const ua = request.headers.get('user-agent') || null

    try {
        const supabase = await createClient()
        const admin = createAdminClient()
        // Untyped alias for tables not in generated Database types
        const db: any = admin

        // --- Gate 1: Authentication ---
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // --- Gate 2: HQ Admin / Super Admin (role_level <= 10) ---
        const { data: profile } = await supabase
            .from('users')
            .select('role_code, organization_id, roles(role_level)')
            .eq('id', user.id)
            .single()

        const roleLevel = (profile as any)?.roles?.role_level
        if (typeof roleLevel !== 'number' || roleLevel > 10) {
            await logDeletionAudit(admin, {
                operation: 'delete_user_otp_request',
                userId: user.id,
                userEmail: user.email || null,
                allowed: false,
                reason: `Insufficient role (role_level=${roleLevel})`,
                ip,
            })
            return NextResponse.json(
                { error: 'Access denied. HQ Admin or Super Admin only.' },
                { status: 403 }
            )
        }

        const { targetUserId } = await request.json()
        if (!targetUserId) {
            return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 })
        }

        // Cannot delete yourself
        if (targetUserId === user.id) {
            return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
        }

        // --- Get org phone / email for OTP delivery ---
        const orgId = profile?.organization_id
        if (!orgId) {
            return NextResponse.json(
                { error: 'No organization found. OTP cannot be sent.' },
                { status: 400 }
            )
        }

        const { data: org } = await admin
            .from('organizations')
            .select('contact_phone, contact_email, org_name')
            .eq('id', orgId)
            .single()

        if (!org?.contact_phone) {
            return NextResponse.json(
                { error: 'Organization phone not configured. Set it in Settings > Organization.' },
                { status: 400 }
            )
        }

        const phoneForSend = normalizePhoneE164(org.contact_phone)
        if (!phoneForSend) {
            return NextResponse.json(
                { error: 'Organization phone is invalid. Update it in Settings > Organization.' },
                { status: 400 }
            )
        }

        const emailForSend = normalizeOrgEmail(org.contact_email)

        // --- Rate limit (phone + email combined for this purpose) ---
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
        let rateQuery = db
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('purpose', PURPOSE)
            .eq('event_type', 'delete_user_otp_requested')
            .gte('created_at', since)

        rateQuery = emailForSend
            ? rateQuery.or(`recipient_phone.eq.${phoneForSend},recipient_email.eq.${emailForSend}`)
            : rateQuery.eq('recipient_phone', phoneForSend)

        const { count } = await rateQuery

        if ((count ?? 0) >= MAX_SENDS_PER_15MIN) {
            return NextResponse.json(
                { error: 'Too many OTP requests. Please wait before trying again.' },
                { status: 429 }
            )
        }

        // --- Get target user info for audit ---
        const { data: targetUser } = await admin
            .from('users')
            .select('full_name, email, phone, role_code, roles:role_code(role_level)')
            .eq('id', targetUserId)
            .single()

        if (!targetUser) {
            return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
        }

        const targetRoleLevel = (targetUser as any)?.roles?.role_level
        if (typeof targetRoleLevel === 'number' && targetRoleLevel < roleLevel) {
            await logDeletionAudit(admin, {
                operation: 'delete_user_otp_request',
                userId: user.id,
                userEmail: user.email || null,
                allowed: false,
                reason: `Target has higher privilege (target role_level=${targetRoleLevel}, requester role_level=${roleLevel})`,
                ip,
            })
            return NextResponse.json(
                { error: 'You cannot delete a user with higher privileges than your own.' },
                { status: 403 }
            )
        }

        const removalMode = await getUserRemovalMode(admin, targetUserId)
        const targetLabel = targetUser.full_name || targetUser.email || targetUserId

        // Invalidate any prior deletion codes for this org phone / email
        await db
            .from('auth_verification_codes')
            .update({ invalidated_at: new Date().toISOString() })
            .eq('phone_normalized', phoneForSend)
            .eq('purpose', PURPOSE)
            .is('invalidated_at', null)
            .is('used_at', null)

        if (emailForSend) {
            await db
                .from('auth_verification_codes')
                .update({ invalidated_at: new Date().toISOString() })
                .eq('email_normalized', emailForSend)
                .eq('purpose', PURPOSE)
                .is('invalidated_at', null)
                .is('used_at', null)
        }

        const code = generateOtp()
        const codeHash = hashOtp(code)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

        const { data: codeRow, error: codeError } = await db
            .from('auth_verification_codes')
            .insert({
                purpose: PURPOSE,
                channel: 'whatsapp',
                phone_normalized: phoneForSend,
                email_normalized: emailForSend,
                user_id: user.id, // requester (super admin)
                code_hash: codeHash,
                expires_at: expiresAt,
                max_attempts: 5,
                request_ip: ip,
                request_user_agent: ua,
                meta: {
                    target_user_id: targetUserId,
                    target_user_name: targetUser.full_name,
                    target_user_email: targetUser.email,
                },
            })
            .select('id')
            .single()

        if (codeError) {
            console.error('Failed to create OTP:', codeError)
            return NextResponse.json({ error: 'Failed to create verification code' }, { status: 500 })
        }

        const whatsappMessage = `⚠️ DELETION VERIFICATION\n\nCode: *${code}*\n\nUser: ${targetLabel}\nRequested by: ${user.email}\n\nThis code expires in 5 minutes. Only enter this code if you authorize this deletion.`
        const smsMessage = `DELETION VERIFICATION\nCode: ${code}\nUser: ${targetLabel}\nRequested by: ${user.email || 'unknown'}\nExpires in 5 minutes.`

        let channel: DeliveryChannel = 'whatsapp'
        let whatsappError: string | null = null
        let smsError: string | null = null
        let emailError: string | null = null
        let emailProvider: string | null = null
        let smsProvider: string | null = null

        try {
            const { sendWhatsAppMessage } = await import('@/app/api/settings/whatsapp/_utils')
            const recipientDigits = phoneForSend.replace(/^\+/, '')
            await sendWhatsAppMessage(admin, orgId, { to: recipientDigits, text: whatsappMessage })
        } catch (err: any) {
            whatsappError = err?.message || 'WhatsApp delivery failed'
            console.warn('Delete OTP WhatsApp failed; trying SMS fallback:', whatsappError)

            const { sendSmsWithActiveProvider, recordSmsDelivery } = await import('@/lib/notifications/sms-send')
            const smsResult = await sendSmsWithActiveProvider(admin, orgId, phoneForSend, smsMessage)
            await recordSmsDelivery(admin, {
                orgId,
                to: phoneForSend,
                eventCode: 'delete_user_otp',
                result: smsResult,
            })

            if (smsResult.success) {
                channel = 'sms'
                smsProvider = 'local_my'
                await db
                    .from('auth_verification_codes')
                    .update({
                        channel: 'sms',
                        meta: {
                            target_user_id: targetUserId,
                            target_user_name: targetUser.full_name,
                            target_user_email: targetUser.email,
                            delivery_channel: 'sms',
                            whatsapp_error: whatsappError,
                        },
                    })
                    .eq('id', codeRow.id)
            } else {
                smsError = smsResult.error || 'SMS delivery failed'
                console.warn('Delete OTP SMS failed; trying org email fallback:', smsError)

                if (!emailForSend) {
                    await db
                        .from('auth_verification_codes')
                        .update({ invalidated_at: new Date().toISOString() })
                        .eq('id', codeRow.id)

                    return NextResponse.json({
                        error: `Unable to send via WhatsApp (${whatsappError}) or SMS (${smsError}), and organization contact email is not configured.`,
                        whatsappError,
                        smsError,
                    }, { status: 500 })
                }

                const emailPayload = buildDeletionOtpEmail({
                    code,
                    targetName: String(targetLabel),
                    requesterEmail: user.email,
                })
                const emailResult = await sendTransactionalHtmlEmail(admin, orgId, {
                    to: emailForSend,
                    subject: emailPayload.subject,
                    text: emailPayload.text,
                    html: emailPayload.html,
                    fromName: 'Serapod2U',
                })

                if (!emailResult.success) {
                    emailError = emailResult.error || 'Email delivery failed'
                    await db
                        .from('auth_verification_codes')
                        .update({ invalidated_at: new Date().toISOString() })
                        .eq('id', codeRow.id)

                    return NextResponse.json({
                        error: `Unable to send the verification code. WhatsApp failed (${whatsappError}). SMS failed (${smsError}). Email fallback also failed (${emailError}).`,
                        whatsappError,
                        smsError,
                        emailError,
                    }, { status: 500 })
                }

                channel = 'email'
                emailProvider = emailResult.providerName || null
                await db
                    .from('auth_verification_codes')
                    .update({
                        channel: 'email',
                        meta: {
                            target_user_id: targetUserId,
                            target_user_name: targetUser.full_name,
                            target_user_email: targetUser.email,
                            delivery_channel: 'email',
                            whatsapp_error: whatsappError,
                            sms_error: smsError,
                        },
                    })
                    .eq('id', codeRow.id)
            }
        }

        const maskedPhone = maskPhone(phoneForSend)
        const maskedRecipient = channel === 'email' && emailForSend
            ? maskEmail(emailForSend)
            : maskedPhone

        const providerForEvent = channel === 'email'
            ? (emailProvider || 'email')
            : channel === 'sms'
                ? (smsProvider || 'local_my')
                : 'whatsapp'

        await db.from('notification_events').insert({
            channel,
            provider: providerForEvent,
            event_type: 'delete_user_otp_requested',
            purpose: PURPOSE,
            recipient_email: channel === 'email' ? emailForSend : null,
            recipient_phone: phoneForSend,
            user_id: user.id,
            status: 'sent',
            meta: {
                target_user_id: targetUserId,
                target_user_name: targetUser.full_name,
                code_id: codeRow.id,
                delivery_channel: channel,
                fallback_used: channel !== 'whatsapp',
                whatsapp_error: whatsappError,
                sms_error: smsError,
            },
            request_ip: ip,
            requested_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
        })

        const deliveryReason = channel === 'email'
            ? `OTP emailed to org contact after WhatsApp/SMS failure for deleting ${targetLabel}`
            : channel === 'sms'
                ? `OTP sent via SMS after WhatsApp failure for deleting ${targetLabel}`
                : `OTP sent to org phone for deleting ${targetLabel}`

        await logDeletionAudit(admin, {
            operation: 'delete_user_otp_request',
            userId: user.id,
            userEmail: user.email || null,
            allowed: true,
            reason: deliveryReason,
            ip,
        })

        const successMessage = channel === 'email'
            ? `WhatsApp and SMS delivery failed, so the verification code was emailed to ${maskedRecipient}`
            : channel === 'sms'
                ? `WhatsApp delivery failed, so the verification code was sent by SMS to ${maskedRecipient}`
                : `Verification code sent to ${maskedRecipient}`

        return NextResponse.json({
            success: true,
            message: successMessage,
            channel,
            fallbackUsed: channel !== 'whatsapp',
            maskedPhone,
            maskedEmail: channel === 'email' && emailForSend ? maskEmail(emailForSend) : null,
            maskedRecipient,
            codeId: codeRow.id,
            removalMode,
        })
    } catch (err: any) {
        console.error('Delete OTP request error:', err)
        return NextResponse.json({
            error: 'Unable to send the verification code. Check WhatsApp/SMS/email delivery configuration and try again.',
        }, { status: 500 })
    }
}

async function logDeletionAudit(
    admin: any,
    entry: { operation: string; userId: string; userEmail: string | null; allowed: boolean; reason: string; ip: string | null }
) {
    const prefix = entry.allowed ? '✅ DELETE-OP ALLOWED' : '🚫 DELETE-OP BLOCKED'
    console.log(`${prefix} | op=${entry.operation} | user=${entry.userEmail ?? entry.userId} | reason=${entry.reason}`)

    try {
        await admin.from('destructive_ops_audit_log').insert({
            operation: entry.operation,
            user_id: entry.userId,
            user_email: entry.userEmail,
            allowed: entry.allowed,
            reason: entry.reason,
            ip_address: entry.ip,
            created_at: new Date().toISOString(),
        })
    } catch { /* best effort */ }
}
