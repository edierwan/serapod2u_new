/**
 * POST /api/auth/password-reset/resend
 *
 * Resend OTP via WhatsApp. Invalidates prior code & generates a fresh one.
 * Rate-limited separately from initial request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import {
  lookupConsumerByPhone,
  checkResendRateLimit,
  invalidateExistingCodes,
  generateOtp,
  hashOtp,
  createVerificationCode,
  sendOtpViaWhatsApp,
  logNotificationEvent,
  resolveOrgForWhatsApp,
  RESEND_COOLDOWN_SECONDS,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phoneRaw: string | undefined = body?.phone

    if (!phoneRaw || typeof phoneRaw !== 'string' || phoneRaw.trim().length < 6) {
      return NextResponse.json(
        { error: 'Please enter a valid phone number.' },
        { status: 400 }
      )
    }

    const phone = normalizePhoneE164(phoneRaw.trim())
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const ua = req.headers.get('user-agent') || null
    const admin = createAdminClient()

    // Rate limit resends
    const rateCheck = await checkResendRateLimit(admin, phone)
    if (!rateCheck.allowed) {
      await logNotificationEvent(admin, {
        eventType: 'password_reset_resend_rate_limited',
        phone,
        status: 'rate_limited',
        meta: { reason: 'resend_limit_exceeded' },
        ip,
      })
      return NextResponse.json({
        message: 'If this phone number exists, we will send a verification code via WhatsApp.',
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      })
    }

    // Lookup consumer
    const consumer = await lookupConsumerByPhone(admin, phoneRaw)
    if (!consumer) {
      // Generic response
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_resend',
        phone,
        status: 'no_account',
        meta: { anonymous: true },
        ip,
      })
      return NextResponse.json({
        message: 'If this phone number exists, we will send a verification code via WhatsApp.',
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      })
    }

    // Invalidate prior codes
    await invalidateExistingCodes(admin, phone)

    // Generate new OTP
    const code = generateOtp()
    const codeHash = hashOtp(code)
    const codeId = await createVerificationCode(admin, phone, codeHash, consumer.userId, ip, ua)

    // Resolve org for WhatsApp config
    const orgId = await resolveOrgForWhatsApp(admin)
    if (!orgId) {
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_send_failed',
        phone,
        userId: consumer.userId,
        status: 'failed',
        errorMessage: 'No WhatsApp provider configured',
        ip,
      })
      return NextResponse.json({
        message: 'If this phone number exists, we will send a verification code via WhatsApp.',
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      })
    }

    // Send OTP
    const sendResult = await sendOtpViaWhatsApp(admin, phone, code, orgId)

    if (sendResult.success) {
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_resend_sent',
        phone,
        userId: consumer.userId,
        status: 'sent',
        providerMessageId: sendResult.providerMessageId,
        meta: { codeId },
        ip,
      })
    } else {
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_send_failed',
        phone,
        userId: consumer.userId,
        status: 'failed',
        errorMessage: sendResult.error,
        meta: { codeId, isResend: true },
        ip,
      })
    }

    // Log resend event
    await logNotificationEvent(admin, {
      eventType: 'password_reset_otp_resend',
      phone,
      userId: consumer.userId,
      status: sendResult.success ? 'sent' : 'send_failed',
      ip,
    })

    return NextResponse.json({
      message: 'If this phone number exists, we will send a verification code via WhatsApp.',
      resendCooldown: RESEND_COOLDOWN_SECONDS,
    })
  } catch (err: any) {
    console.error('Password reset resend error:', err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again later.' },
      { status: 500 }
    )
  }
}
