import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import {
  RESEND_COOLDOWN_SECONDS,
  checkRegistrationAvailability,
  checkSendRateLimit,
  createVerificationCode,
  generateOtp,
  hashOtp,
  invalidateExistingCodes,
  logNotificationEvent,
  sendOtpViaWhatsApp,
} from '@/server/auth/registrationVerificationService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    const phoneRaw = String(body?.phone || '').trim()
    const fullName = String(body?.fullName || '').trim()
    const orgId = String(body?.orgId || '').trim()

    if (!email || !phoneRaw || !fullName || !orgId) {
      return NextResponse.json({ error: 'Email, full name, phone number, and organization are required.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const phone = normalizePhoneE164(phoneRaw)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const ua = req.headers.get('user-agent') || null

    const availability = await checkRegistrationAvailability(admin, email, phoneRaw)
    if (!availability.emailAvailable) {
      return NextResponse.json({ field: 'email', error: 'This email address is already linked to an existing account. Please sign in or use a different email.' }, { status: 409 })
    }
    if (!availability.phoneAvailable) {
      return NextResponse.json({ field: 'phone', error: 'This mobile number is already linked to an existing account. Please sign in or use a different number.' }, { status: 409 })
    }

    const rateCheck = await checkSendRateLimit(admin, phone)
    if (!rateCheck.allowed) {
      await logNotificationEvent(admin, {
        eventType: 'registration_rate_limited',
        phone,
        status: 'rate_limited',
        meta: { reason: 'send_limit_exceeded', email },
        ip,
      })
      return NextResponse.json({
        success: false,
        error: 'Too many verification requests were submitted for this number. Please wait a moment before trying again.',
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      }, { status: 429 })
    }

    await invalidateExistingCodes(admin, phone)

    const code = generateOtp()
    const codeId = await createVerificationCode(
      admin,
      phone,
      hashOtp(code),
      { email, full_name: fullName, org_id: orgId },
      ip,
      ua,
    )

    const sendResult = await sendOtpViaWhatsApp(admin, phone, code, orgId)

    if (sendResult.success) {
      await logNotificationEvent(admin, {
        eventType: 'registration_otp_sent',
        phone,
        status: 'sent',
        providerMessageId: sendResult.providerMessageId,
        meta: { codeId, email, org_id: orgId },
        ip,
      })
    } else {
      await logNotificationEvent(admin, {
        eventType: 'registration_otp_send_failed',
        phone,
        status: 'failed',
        errorMessage: sendResult.error,
        meta: { codeId, email, org_id: orgId },
        ip,
      })
      return NextResponse.json({
        success: false,
        error: 'We could not send the WhatsApp verification code right now. Please try again shortly.',
      }, { status: 500 })
    }

    await logNotificationEvent(admin, {
      eventType: 'registration_otp_requested',
      phone,
      status: 'sent',
      meta: { codeId, email, org_id: orgId },
      ip,
    })

    return NextResponse.json({
      success: true,
      message: 'A 4-digit WhatsApp verification code has been sent to your mobile number.',
      resendCooldown: RESEND_COOLDOWN_SECONDS,
    })
  } catch (error: any) {
    console.error('Registration OTP request error:', error)
    return NextResponse.json(
      { error: 'Unable to start registration verification. Please try again later.' },
      { status: 500 },
    )
  }
}
