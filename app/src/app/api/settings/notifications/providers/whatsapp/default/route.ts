import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await isAdminUser(supabase, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single()
  if (!profile?.organization_id) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const providerName = typeof body.providerName === 'string' ? body.providerName.trim() : ''
  if (!providerName) return NextResponse.json({ error: 'Provider name is required' }, { status: 400 })

  const { data: provider, error: readError } = await supabase
    .from('notification_provider_configs')
    .select('id,provider_name,is_active,config_public,config_encrypted')
    .eq('org_id', profile.organization_id)
    .eq('channel', 'whatsapp')
    .eq('provider_name', providerName)
    .maybeSingle()

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!provider) return NextResponse.json({ error: 'WhatsApp provider is not configured' }, { status: 400 })
  if (!provider.is_active) return NextResponse.json({ error: 'Enable this provider before setting it as default' }, { status: 400 })
  const publicConfig = (provider.config_public || {}) as Record<string, any>
  let secrets: Record<string, any> = {}
  try { secrets = typeof provider.config_encrypted === 'string' ? JSON.parse(provider.config_encrypted) : (provider.config_encrypted || {}) as Record<string, any> } catch { /* invalid secrets remain unconfigured */ }
  const configured = provider.provider_name === 'whatsapp_business'
    ? Boolean(publicConfig.phone_number_id && secrets.access_token)
    : provider.provider_name === 'baileys' || provider.provider_name === 'baileys_home'
      ? Boolean(publicConfig.base_url && secrets.api_key)
      : provider.provider_name === 'twilio'
        ? Boolean(secrets.account_sid && secrets.auth_token && (publicConfig.from_number || publicConfig.messaging_service_sid))
        : provider.provider_name === 'messagebird'
          ? Boolean(secrets.api_key && publicConfig.channel_id)
          : false
  if (!configured) return NextResponse.json({ error: 'Configure all required provider credentials before setting it as default' }, { status: 400 })

  const { error: setError } = await (supabase as any).rpc('set_default_whatsapp_provider', {
    p_org_id: profile.organization_id,
    p_provider_name: provider.provider_name,
  })
  if (setError) return NextResponse.json({ error: setError.message }, { status: 500 })

  return NextResponse.json({ success: true, providerName: provider.provider_name })
}
