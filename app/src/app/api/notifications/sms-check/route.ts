import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { sendSmsWithActiveProvider, recordSmsDelivery } from '@/lib/notifications/sms-send'
import { normalizeManualPhone } from '@/lib/notifications/manualPhoneNumbers'
import {
  REQUIRED_NOTIFICATION_TYPES,
  SYSTEM_SMS_CHECK_EVENT,
  SYSTEM_SMS_CHECK_MESSAGE,
} from '@/lib/notifications/notificationEventCatalog'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: profile } = await supabase
      .from('users')
      .select('organization_id, phone')
      .eq('id', user.id)
      .single()
    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const requestedTo = typeof body?.to === 'string' ? body.to.trim() : ''
    const phone = normalizeManualPhone(requestedTo || profile.phone || '')
    if (!('normalized' in phone)) {
      return NextResponse.json({
        error: requestedTo
          ? `Invalid phone number: ${phone.reason}`
          : 'Enter a phone number to send the SMS check',
      }, { status: 400 })
    }

    const admin = createAdminClient()
    await (admin as any)
      .from('notification_types')
      .upsert(REQUIRED_NOTIFICATION_TYPES.filter((type) => type.event_code === SYSTEM_SMS_CHECK_EVENT), {
        onConflict: 'event_code',
      })

    const { data: queued, error: queueError } = await admin
      .from('notifications_outbox')
      .insert({
        org_id: profile.organization_id,
        event_code: SYSTEM_SMS_CHECK_EVENT,
        channel: 'sms',
        to_phone: phone.normalized,
        to_email: null,
        template_code: null,
        payload_json: {
          checked_by: user.id,
          checked_at: new Date().toISOString(),
          _sms_body: SYSTEM_SMS_CHECK_MESSAGE,
        },
        priority: 'high',
        provider_name: 'local_my',
        status: 'queued',
        retry_count: 0,
        max_retries: 3,
      })
      .select('id')
      .single()

    if (queueError || !queued) {
      return NextResponse.json({
        error: queueError?.message || 'Failed to queue SMS check event',
      }, { status: 500 })
    }

    const sent = await sendSmsWithActiveProvider(
      admin,
      profile.organization_id,
      phone.normalized,
      SYSTEM_SMS_CHECK_MESSAGE,
    )

    await recordSmsDelivery(admin, {
      orgId: profile.organization_id,
      outboxId: queued.id,
      to: phone.normalized,
      eventCode: SYSTEM_SMS_CHECK_EVENT,
      result: sent,
    })

    if (!sent.success) {
      return NextResponse.json({
        error: sent.error || 'SMS check failed',
        event_code: SYSTEM_SMS_CHECK_EVENT,
        outbox_id: queued.id,
        data: sent.providerResponse,
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'SMS check sent via Local Malaysian Provider',
      event_code: SYSTEM_SMS_CHECK_EVENT,
      outbox_id: queued.id,
      to: phone.normalized,
      provider_id: sent.messageId || null,
    })
  } catch (error: any) {
    console.error('SMS check error:', error)
    return NextResponse.json({ error: error.message || 'SMS check failed' }, { status: 500 })
  }
}
