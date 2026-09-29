import { NextRequest, NextResponse } from 'next/server'
import { userAllowed } from '@/lib/security-access/operation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isMissingTableError,
  isOutdoorMessageEvent,
  listOutdoorMessageSettings,
  OUTDOOR_MESSAGE_SETTINGS_TABLE,
} from '@/lib/outdoor/customer-messages'

async function getAuthenticatedAdmin() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('id, organization_id, organizations!fk_users_organization(id, org_type_code), roles(role_level)')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  const orgType = (profile.organizations as any)?.org_type_code
  const roleLevel = (profile.roles as any)?.role_level
  if (!(await userAllowed(user.id, 'ecommerce.order.manage', () => orgType === 'HQ' && roleLevel != null && roleLevel <= 30 && !!profile.organization_id, { organizationId: profile.organization_id }))) return null

  return { userId: user.id }
}

/** GET — every Outdoor order event with the channels it messages the customer on. */
export async function GET() {
  try {
    if (!(await getAuthenticatedAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(await listOutdoorMessageSettings(createAdminClient()))
  } catch (err) {
    console.error('[customer-messages] load failed:', err)
    return NextResponse.json({ error: 'Could not load the customer message settings.' }, { status: 500 })
  }
}

/** PUT { event, email, sms } — switch the customer's email and SMS for one event. */
export async function PUT(request: NextRequest) {
  try {
    const staff = await getAuthenticatedAdmin()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    if (!isOutdoorMessageEvent(body.event) || typeof body.email !== 'boolean' || typeof body.sms !== 'boolean') {
      return NextResponse.json({ error: 'Choose an event and whether it sends an email and an SMS.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { error } = await admin.from(OUTDOOR_MESSAGE_SETTINGS_TABLE).upsert(
      {
        event_code: body.event,
        email_enabled: body.email,
        sms_enabled: body.sms,
        updated_by: staff.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_code' },
    )
    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: 'Saving is not ready yet: the customer message settings migration has not been applied.' }, { status: 503 })
      }
      throw error
    }

    return NextResponse.json(await listOutdoorMessageSettings(admin))
  } catch (err) {
    console.error('[customer-messages] save failed:', err)
    return NextResponse.json({ error: 'Could not save the customer message settings.' }, { status: 500 })
  }
}
