import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireOutdoorStaff(supabase: any) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('organizations!fk_users_organization(org_type_code), roles(role_level, role_code)')
    .eq('id', user.id)
    .single()

  const orgType = (profile?.organizations as any)?.org_type_code
  const role = (profile?.roles as any) || {}
  const roleLevel = Number(role.role_level ?? 99)
  const roleCode = String(role.role_code || '').toLowerCase()
  const allowed =
    orgType === 'HQ' &&
    (roleLevel <= 30 || ['super_admin', 'admin', 'org_admin', 'warehouse', 'fulfilment'].includes(roleCode))
  return allowed ? { userId: user.id } : null
}

/** POST /api/outdoor/contact — store contact form message. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 120)
    const email = String(body.email || '').trim().slice(0, 254)
    const message = String(body.message || '').trim().slice(0, 4000)

    if (!name || !email.includes('@') || message.length < 5) {
      return NextResponse.json({ error: 'Name, email, and message are required.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { error } = await admin.from('outdoor_contact_messages').insert({
      name,
      email,
      message,
      status: 'new',
    })

    if (error) {
      console.error('[outdoor/contact]', error)
      return NextResponse.json({ error: 'Could not send message.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/contact]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** GET — recent Outdoor contact messages for HQ staff. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const staff = await requireOutdoorStaff(supabase)
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 30), 100)
    const admin: any = createAdminClient()
    const { data, error } = await admin
      .from('outdoor_contact_messages')
      .select('id, name, email, message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[outdoor/contact GET]', error)
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }

    return NextResponse.json({ messages: data || [] })
  } catch (err) {
    console.error('[outdoor/contact GET]', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
