import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

const CHANNELS = ['whatsapp', 'sms', 'email'] as const
type NotificationChannel = (typeof CHANNELS)[number]

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    const orgId = profile?.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const body = await request.json()
    const channel = asString(body.channel) as NotificationChannel
    const providerName = asString(body.provider_name)
    const existingId = asString(body.id)

    if (!CHANNELS.includes(channel) || !providerName) {
      return NextResponse.json({ error: 'channel and provider_name are required' }, { status: 400 })
    }

    const publicConfig = (body.config_public && typeof body.config_public === 'object' && !Array.isArray(body.config_public))
      ? body.config_public
      : {}
    const credentials = (body.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials))
      ? body.credentials
      : {}

    const saveRow = {
      org_id: orgId,
      channel,
      provider_name: providerName,
      is_active: Boolean(body.is_active),
      is_sandbox: body.is_sandbox !== false,
      config_public: publicConfig,
      config_encrypted: JSON.stringify(credentials),
      config_iv: 'placeholder-iv',
      updated_at: new Date().toISOString(),
      created_by: user.id,
    }

    const admin = createAdminClient()

    if (existingId) {
      const { data, error } = await admin
        .from('notification_provider_configs')
        .update(saveRow)
        .eq('id', existingId)
        .eq('org_id', orgId)
        .select('id, channel, provider_name, is_active, is_sandbox, config_public, last_test_status, last_test_at, last_test_error')
        .maybeSingle()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (!data) {
        return NextResponse.json({ error: 'Provider configuration not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, config: data })
    }

    const { data: existing } = await admin
      .from('notification_provider_configs')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel', channel)
      .eq('provider_name', providerName)
      .maybeSingle()

    if (existing?.id) {
      const { data, error } = await admin
        .from('notification_provider_configs')
        .update(saveRow)
        .eq('id', existing.id)
        .eq('org_id', orgId)
        .select('id, channel, provider_name, is_active, is_sandbox, config_public, last_test_status, last_test_at, last_test_error')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true, config: data })
    }

    const { data, error } = await admin
      .from('notification_provider_configs')
      .insert(saveRow)
      .select('id, channel, provider_name, is_active, is_sandbox, config_public, last_test_status, last_test_at, last_test_error')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, config: data })
  } catch (error: any) {
    console.error('[notification providers save]', error)
    return NextResponse.json({ error: error.message || 'Failed to save provider' }, { status: 500 })
  }
}
