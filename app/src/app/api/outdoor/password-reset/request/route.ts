import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureUserRow } from '@/server/auth/ensureUserRow'
import { issuePasswordResetOtp } from '@/server/auth/passwordResetService'

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

async function findAuthUserId(email: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) return null

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=20&filter=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      cache: 'no-store',
    },
  )
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const users = Array.isArray(body?.users) ? body.users : []
  const match = users.find((user: { email?: string }) => String(user.email || '').trim().toLowerCase() === email)
  return match?.id ? String(match.id) : null
}

/**
 * POST /api/outdoor/password-reset/request
 * Sends the existing email reset code. Does not change the portal reset route.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = normalizeEmail(body.email || body.identifier)
    if (!email.includes('@') || email.length > 254) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle()

    if (!profile) {
      const authUserId = await findAuthUserId(email)
      if (authUserId) {
        await ensureUserRow(authUserId, email, { provider: 'email' })
      }
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null
    const ua = request.headers.get('user-agent') || null
    const result = await issuePasswordResetOtp(admin, {
      identifierRaw: email,
      delivery: 'email',
      disclose: true,
      ip,
      ua,
      isResend: body.resend === true,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    }

    return NextResponse.json({
      message: result.message,
      resendCooldown: result.resendCooldown,
      channel: result.channel,
    })
  } catch (err) {
    console.error('[outdoor/password-reset]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again later.' }, { status: 500 })
  }
}
