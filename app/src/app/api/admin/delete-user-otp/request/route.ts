import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateOtp,
  hashOtp,
  invalidateExistingCodes,
  createVerificationCode,
  sendOtpViaWhatsApp,
  logNotificationEvent,
  resolveOrgForWhatsApp,
} from '@/server/auth/passwordResetService'

const PURPOSE = 'user_deletion'
const MAX_SENDS_PER_15MIN = 3

/**
 * POST /api/admin/delete-user-otp/request
 * 
 * Step 1: Super Admin requests a deletion OTP.
 * OTP is sent to the ORGANIZATION's registered phone number (not the user's).
 * 
 * Body: { targetUserId: string }
 * 
 * Security layers:
 * - Must be authenticated
 * - Must be role_level === 1 (Super Admin)
 * - OTP sent to org phone (separate physical device)
 * - Rate limited (3 per 15 min)
 * - Full audit trail
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

    // --- Gate 2: Super Admin (role_level === 1) ---
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, organization_id, roles(role_level)')
      .eq('id', user.id)
      .single()

    const roleLevel = (profile as any)?.roles?.role_level
    if (roleLevel !== 1) {
      await logDeletionAudit(admin, {
        operation: 'delete_user_otp_request',
        userId: user.id,
        userEmail: user.email || null,
        allowed: false,
        reason: `Insufficient role (role_level=${roleLevel})`,
        ip,
      })
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
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

    // --- Get org phone for OTP delivery ---
    const orgId = profile?.organization_id
    if (!orgId) {
      return NextResponse.json(
        { error: 'No organization found. OTP cannot be sent.' },
        { status: 400 }
      )
    }

    const { data: org } = await admin
      .from('organizations')
      .select('contact_phone, org_name')
      .eq('id', orgId)
      .single()

    if (!org?.contact_phone) {
      return NextResponse.json(
        { error: 'Organization phone not configured. Set it in Settings > Organization.' },
        { status: 400 }
      )
    }

    // Normalize phone
    const orgPhone = org.contact_phone.replace(/[^0-9+]/g, '')
    const phoneForSend = orgPhone.startsWith('+') ? orgPhone : orgPhone.startsWith('60') ? `+${orgPhone}` : `+60${orgPhone}`

    // --- Rate limit ---
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await db
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_phone', phoneForSend)
      .eq('purpose', PURPOSE)
      .eq('event_type', 'delete_user_otp_requested')
      .gte('created_at', since)

    if ((count ?? 0) >= MAX_SENDS_PER_15MIN) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait before trying again.' },
        { status: 429 }
      )
    }

    // --- Get target user info for audit ---
    const { data: targetUser } = await admin
      .from('users')
      .select('full_name, email, phone')
      .eq('id', targetUserId)
      .single()

    if (!targetUser) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
    }

    // --- Generate & send OTP ---
    // Invalidate any prior deletion codes for this org phone
    await db
      .from('auth_verification_codes')
      .update({ invalidated_at: new Date().toISOString() })
      .eq('phone_normalized', phoneForSend)
      .eq('purpose', PURPOSE)
      .is('invalidated_at', null)
      .is('used_at', null)

    const code = generateOtp()
    const codeHash = hashOtp(code)

    // Store with target user info in meta
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const { data: codeRow, error: codeError } = await db
      .from('auth_verification_codes')
      .insert({
        purpose: PURPOSE,
        channel: 'whatsapp',
        phone_normalized: phoneForSend,
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

    // Send via WhatsApp
    const waOrgId = await resolveOrgForWhatsApp(admin)
    if (!waOrgId) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 500 })
    }

    const message = `⚠️ DELETION VERIFICATION\n\nCode: *${code}*\n\nUser: ${targetUser.full_name || targetUser.email}\nRequested by: ${user.email}\n\nThis code expires in 5 minutes. Only enter this code if you authorize this deletion.`

    const { getWhatsAppConfig, callGateway } = await import('@/app/api/settings/whatsapp/_utils')
    const waConfig = await getWhatsAppConfig(admin, waOrgId)

    if (!waConfig?.baseUrl || !waConfig?.apiKey) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 500 })
    }

    const recipientDigits = phoneForSend.replace(/^\+/, '')
    await callGateway(
      waConfig.baseUrl, waConfig.apiKey, 'POST', '/messages/send',
      { to: recipientDigits, text: message },
      waConfig.tenantId
    )

    // Audit log
    await logNotificationEvent(admin, {
      eventType: 'delete_user_otp_requested',
      phone: phoneForSend,
      userId: user.id,
      status: 'sent',
      meta: {
        target_user_id: targetUserId,
        target_user_name: targetUser.full_name,
        code_id: codeRow.id,
      },
      ip,
    })

    await logDeletionAudit(admin, {
      operation: 'delete_user_otp_request',
      userId: user.id,
      userEmail: user.email || null,
      allowed: true,
      reason: `OTP sent to org phone for deleting ${targetUser.full_name || targetUser.email}`,
      ip,
    })

    // Mask phone for display
    const masked = phoneForSend.replace(/^(\+?\d{4})\d+(\d{4})$/, '$1****$2')

    return NextResponse.json({
      success: true,
      message: `Verification code sent to ${masked}`,
      maskedPhone: masked,
      codeId: codeRow.id,
    })
  } catch (err: any) {
    console.error('Delete OTP request error:', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
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
