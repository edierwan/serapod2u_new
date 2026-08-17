import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser, sendWhatsAppMessage } from '@/app/api/settings/whatsapp/_utils'
import { toSmsE164 } from '@/lib/notifications/manualPhoneNumbers'
import {
  LOCAL_MY_SMS_PROVIDER,
  localSmsConfigFromParts,
  parseSmsProviderSecrets,
  recordSmsDelivery,
  sendLocalMalaysianSms,
} from '@/lib/notifications/sms-send'

// Normalize phone number for Baileys (Malaysia preferred)
// Removes non-digits, replaces leading 0 with 60
function normalizeBaileysPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '') // Remove all non-digits
  
  // If starts with 0, replace with 60 (Malaysia)
  // Example: 0123456789 -> 60123456789
  if (cleaned.startsWith('0')) {
    cleaned = '60' + cleaned.substring(1)
  }
  
  return cleaned
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { channel, to, provider, credentials, config } = body

    if (!to) {
      return NextResponse.json({ error: 'Recipient number (to) is required' }, { status: 400 })
    }

    if (channel !== 'whatsapp' && channel !== 'sms') {
      return NextResponse.json({ error: 'Only WhatsApp and SMS channels are supported for now' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single()
    if (!profile?.organization_id) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    if (channel === 'whatsapp') {
        const normalizedPhone = normalizeBaileysPhone(to)
        const message = 'This is a test message from Serapod2u Notification Settings.'
        try {
            const sent = await sendWhatsAppMessage(supabase, profile.organization_id, { to: normalizedPhone, text: message })
            return NextResponse.json({ success: true, message: `Test message sent via ${sent.providerName}`, data: sent.response })
        } catch (error: any) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
    }

    const requestedProvider = typeof provider === 'string' ? provider.trim() : ''
    if (requestedProvider && requestedProvider !== LOCAL_MY_SMS_PROVIDER) {
      return NextResponse.json({
        error: 'Only Local Malaysian Provider is implemented for SMS testing',
      }, { status: 400 })
    }

    const formConfig = (config && typeof config === 'object') ? config as Record<string, any> : {}
    const formSecrets = (credentials && typeof credentials === 'object') ? credentials as Record<string, any> : {}

    let publicConfig = { ...formConfig }
    let secrets = { ...formSecrets }

    const needsSavedFallback = !String(publicConfig.api_endpoint || '').trim()
      || !String(publicConfig.api_username || '').trim()
      || !String(secrets.api_password || publicConfig.api_password || '').trim()

    if (needsSavedFallback) {
      const { data: saved } = await supabase
        .from('notification_provider_configs')
        .select('provider_name, config_public, config_encrypted, is_active')
        .eq('org_id', profile.organization_id)
        .eq('channel', 'sms')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!saved) {
        return NextResponse.json({ error: 'No active SMS provider is configured. Save Local Malaysian Provider first.' }, { status: 400 })
      }
      if (saved.provider_name !== LOCAL_MY_SMS_PROVIDER) {
        return NextResponse.json({
          error: 'Only Local Malaysian Provider is implemented for SMS testing',
        }, { status: 400 })
      }

      const savedPublic = (saved.config_public && typeof saved.config_public === 'object')
        ? saved.config_public as Record<string, any>
        : {}
      const savedSecrets = parseSmsProviderSecrets(saved.config_encrypted)
      publicConfig = { ...savedPublic, ...formConfig }
      secrets = { ...savedSecrets, ...formSecrets }
    }

    const smsConfig = localSmsConfigFromParts(publicConfig, secrets)
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'This is a test message from Serapod2u Notification Settings.'
    const formatted = toSmsE164(String(to))
    if (!('e164' in formatted)) {
      return NextResponse.json({ error: `Invalid phone number: ${formatted.reason}` }, { status: 400 })
    }
    const sent = await sendLocalMalaysianSms(smsConfig, formatted.e164, message)

    try {
      const admin = createAdminClient()
      await recordSmsDelivery(admin, {
        orgId: profile.organization_id,
        to: formatted.e164,
        eventCode: 'sms_test',
        result: sent,
      })
    } catch (logErr) {
      console.error('Failed to log SMS test send:', logErr)
    }

    if (!sent.success) {
      return NextResponse.json({ error: sent.error || 'SMS gateway test failed', data: sent.providerResponse }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'Test SMS sent via Local Malaysian Provider',
      to: formatted.e164,
      data: sent.providerResponse,
      provider_id: sent.messageId || null,
    })
  } catch (error: any) {
    console.error('Test API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
