import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateOtp,
  hashOtp,
  logNotificationEvent,
} from '@/server/auth/passwordResetService'
import { maskPhone, normalizePhoneE164 } from '@/utils/phone'

export const dynamic = 'force-dynamic'

const PURPOSE = 'organization_deletion'
const MAX_SENDS_PER_15MIN = 3

function getJoinedRole(profile: any) {
  return Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles
}

function getRoleLevel(profile: any) {
  const rawLevel = getJoinedRole(profile)?.role_level
  const roleLevel = typeof rawLevel === 'number' ? rawLevel : Number(rawLevel)

  return Number.isFinite(roleLevel) ? roleLevel : null
}

function getRoleCodes(profile: any) {
  const joinedRole = getJoinedRole(profile)

  return [profile?.role_code, joinedRole?.role_code]
    .filter(Boolean)
    .map((code) => String(code).trim().toLowerCase())
}

function canDeleteOrganizations(profile: any) {
  const roleLevel = getRoleLevel(profile)
  const roleCodes = getRoleCodes(profile)

  return (roleLevel !== null && roleLevel <= 10) ||
    roleCodes.some((roleCode) => ['super_admin', 'superadmin', 'sa', 'super', 'hq_admin', 'hq', 'admin_hq'].includes(roleCode))
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = request.headers.get('user-agent') || null

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const db: any = admin

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('organization_id, role_code, roles(role_level, role_code)')
      .eq('id', user.id)
      .single()

    const roleLevel = getRoleLevel(profile)
    if (profileError || !canDeleteOrganizations(profile)) {
      await logOrganizationDeletionAudit(admin, {
        operation: 'delete_organization_otp_request',
        userId: user.id,
        userEmail: user.email || null,
        allowed: false,
        reason: profileError
          ? `Profile lookup failed: ${profileError.message}`
          : `Insufficient role (role_level=${roleLevel}, role_code=${getRoleCodes(profile).join(',') || 'null'})`,
        ip,
      })
      return NextResponse.json({ error: 'Access denied. HQ Admin or Super Admin only.' }, { status: 403 })
    }

    const { orgId } = await request.json()
    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    if (orgId === profile?.organization_id) {
      return NextResponse.json({ error: 'Cannot delete your current organization.' }, { status: 400 })
    }

    const { data: targetOrg } = await admin
      .from('organizations')
      .select('id, org_name, org_code')
      .eq('id', orgId)
      .single()

    if (!targetOrg) {
      return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    }

    const { data: dependencyCheck, error: dependencyError } = await admin
      .rpc('check_organization_dependencies', { p_org_id: orgId })

    if (dependencyError) {
      console.error('check_organization_dependencies RPC error before OTP:', dependencyError)
      return NextResponse.json({ error: 'Failed to verify organization dependencies.' }, { status: 500 })
    }

    if (!dependencyCheck?.can_delete) {
      return NextResponse.json(
        { error: dependencyCheck?.error || 'Organization has blocking dependencies and cannot be deleted.' },
        { status: 400 },
      )
    }

    const currentOrgId = profile?.organization_id
    if (!currentOrgId) {
      return NextResponse.json({ error: 'No organization found. OTP cannot be sent.' }, { status: 400 })
    }

    const { data: currentOrg } = await admin
      .from('organizations')
      .select('contact_phone, org_name')
      .eq('id', currentOrgId)
      .single()

    if (!currentOrg?.contact_phone) {
      return NextResponse.json({ error: 'Organization phone not configured. Set it in Settings > Organization.' }, { status: 400 })
    }

    const phoneForSend = normalizePhoneE164(currentOrg.contact_phone)
    if (!phoneForSend) {
      return NextResponse.json({ error: 'Organization phone is invalid. Update it in Settings > Organization.' }, { status: 400 })
    }

    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await db
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_phone', phoneForSend)
      .eq('purpose', PURPOSE)
      .eq('event_type', 'delete_organization_otp_requested')
      .gte('created_at', since)

    if ((count ?? 0) >= MAX_SENDS_PER_15MIN) {
      return NextResponse.json({ error: 'Too many OTP requests. Please wait before trying again.' }, { status: 429 })
    }

    await db
      .from('auth_verification_codes')
      .update({ invalidated_at: new Date().toISOString() })
      .eq('phone_normalized', phoneForSend)
      .eq('purpose', PURPOSE)
      .is('invalidated_at', null)
      .is('used_at', null)

    const code = generateOtp()
    const codeHash = hashOtp(code)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    const { data: codeRow, error: codeError } = await db
      .from('auth_verification_codes')
      .insert({
        purpose: PURPOSE,
        channel: 'whatsapp',
        phone_normalized: phoneForSend,
        user_id: user.id,
        code_hash: codeHash,
        expires_at: expiresAt,
        max_attempts: 5,
        request_ip: ip,
        request_user_agent: userAgent,
        meta: {
          target_org_id: orgId,
          target_org_name: targetOrg.org_name,
          target_org_code: targetOrg.org_code,
        },
      })
      .select('id')
      .single()

    if (codeError) {
      console.error('Failed to create organization delete OTP:', codeError)
      return NextResponse.json({ error: 'Failed to create verification code' }, { status: 500 })
    }

    const message = `⚠️ ORGANIZATION DELETION VERIFICATION\n\nCode: *${code}*\n\nOrganization: ${targetOrg.org_name} (${targetOrg.org_code})\nRequested by: ${user.email}\n\nThis code expires in 5 minutes. Only enter it if you authorize this deletion.`

    const { getWhatsAppConfig, callGateway } = await import('@/app/api/settings/whatsapp/_utils')
    const waConfig = await getWhatsAppConfig(admin, currentOrgId)

    if (!waConfig?.baseUrl || !waConfig?.apiKey) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 500 })
    }

    const recipientDigits = phoneForSend.replace(/^\+/, '')
    await callGateway(
      waConfig.baseUrl,
      waConfig.apiKey,
      'POST',
      '/messages/send',
      { to: recipientDigits, text: message },
      waConfig.tenantId,
    )

    await logNotificationEvent(admin, {
      eventType: 'delete_organization_otp_requested',
      phone: phoneForSend,
      userId: user.id,
      status: 'sent',
      meta: {
        target_org_id: orgId,
        target_org_name: targetOrg.org_name,
        target_org_code: targetOrg.org_code,
        code_id: codeRow.id,
      },
      ip,
      purpose: PURPOSE,
    } as any)

    await logOrganizationDeletionAudit(admin, {
      operation: 'delete_organization_otp_request',
      userId: user.id,
      userEmail: user.email || null,
      allowed: true,
      reason: `OTP sent to org phone for deleting ${targetOrg.org_name} (${targetOrg.org_code})`,
      ip,
    })

    return NextResponse.json({
      success: true,
      message: `Verification code sent to ${maskPhone(phoneForSend)}`,
      maskedPhone: maskPhone(phoneForSend),
      codeId: codeRow.id,
    })
  } catch (error: any) {
    console.error('Organization delete OTP request error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

async function logOrganizationDeletionAudit(
  admin: any,
  entry: { operation: string; userId: string; userEmail: string | null; allowed: boolean; reason: string; ip: string | null }
) {
  const prefix = entry.allowed ? '✅ ORG-DELETE ALLOWED' : '🚫 ORG-DELETE BLOCKED'
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
  } catch {
    // best effort
  }
}