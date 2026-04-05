/**
 * POST /api/auth/password-reset/request
 *
 * Step A+B: Accept phone, normalize, lookup consumer, generate OTP,
 * send via WhatsApp, log everything. Always returns generic success.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import {
  lookupConsumerByPhone,
  checkSendRateLimit,
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

    // Rate limit
    const rateCheck = await checkSendRateLimit(admin, phone)
    if (!rateCheck.allowed) {
      // Still return generic message — do not hint whether phone exists
      await logNotificationEvent(admin, {
        eventType: 'password_reset_rate_limited',
        phone,
        status: 'rate_limited',
        meta: { reason: 'send_limit_exceeded' },
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
      // Log anonymous attempt without revealing existence
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_requested',
        phone,
        status: 'no_account',
        meta: { anonymous: true },
        ip,
      })
      // Generic response — same shape as success
      return NextResponse.json({
        message: 'If this phone number exists, we will send a verification code via WhatsApp.',
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      })
    }

    // Invalidate previous active codes
    await invalidateExistingCodes(admin, phone)

    // Generate & store OTP
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

    // Send OTP via WhatsApp
    const sendResult = await sendOtpViaWhatsApp(admin, phone, code, orgId)

    if (sendResult.success) {
      await logNotificationEvent(admin, {
        eventType: 'password_reset_otp_sent',
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
        meta: { codeId },
        ip,
      })
    }

    // Log the request event
    await logNotificationEvent(admin, {
      eventType: 'password_reset_otp_requested',
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
    console.error('Password reset request error:', err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again later.' },
      { status: 500 }
    )
  }
}
