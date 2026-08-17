import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export type SmsMonitorStatus = 'pending' | 'delivered' | 'failed'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toMonitorStatus(raw: string): SmsMonitorStatus {
  const status = raw.toLowerCase()
  if (['failed', 'error', 'cancelled', 'canceled', 'undelivered', 'rejected', 'bounced'].includes(status)) {
    return 'failed'
  }
  if (['sent', 'delivered', 'success', 'ok', 'accepted', 'completed'].includes(status)) {
    return 'delivered'
  }
  return 'pending'
}

function truncate(value: unknown, max = 2000): string | null {
  if (value == null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function payloadMessage(payload: unknown, eventCode?: string): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const row = payload as Record<string, unknown>
    const stored = asString(row._sms_body) || asString(row.message) || asString(row.message_body)
    if (stored) return stored
  }
  if (eventCode === 'system_sms_check') {
    return 'Serapod2U SMS check. If you received this, Local Malaysian SMS is working.'
  }
  return ''
}

async function canViewSmsMonitor(supabase: any, userId: string) {
  const { data } = await supabase
    .from('users')
    .select('organization_id, roles:role_code(role_level, role_code), organizations:organization_id(org_type_code)')
    .eq('id', userId)
    .single()

  const role = Array.isArray(data?.roles) ? data.roles[0] : data?.roles
  const org = Array.isArray(data?.organizations) ? data.organizations[0] : data?.organizations
  const roleLevel = Number(role?.role_level)
  const roleCode = String(role?.role_code || '')
  if (roleLevel <= 20 || ['super_admin', 'admin', 'org_admin'].includes(roleCode)) return true
  return org?.org_type_code === 'HQ' && roleLevel > 0 && roleLevel <= 40
}

async function resolveSmsOrgIds(admin: any, userOrgId: string | null) {
  const ids = new Set<string>()
  if (userOrgId) ids.add(userOrgId)

  const [{ data: hq }, { data: providers }] = await Promise.all([
    admin.from('organizations').select('id').eq('org_type_code', 'HQ').eq('is_active', true).limit(5),
    admin.from('notification_provider_configs').select('org_id').eq('channel', 'sms'),
  ])

  for (const row of hq || []) if (row?.id) ids.add(row.id)
  for (const row of providers || []) if (row?.org_id) ids.add(row.org_id)
  return Array.from(ids)
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await canViewSmsMonitor(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    const orgIds = await resolveSmsOrgIds(admin, profile?.organization_id || null)

    let logsQuery = admin
      .from('notification_logs')
      .select('id, created_at, queued_at, sent_at, delivered_at, failed_at, status, recipient_value, recipient_type, event_code, provider_name, provider_message_id, error_message, retry_count, provider_response, outbox_id')
      .eq('channel', 'sms')
      .order('created_at', { ascending: false })
      .limit(500)

    let outboxQuery = admin
      .from('notifications_outbox')
      .select('id, created_at, scheduled_for, sent_at, status, to_phone, event_code, provider_name, provider_message_id, error, retry_count, max_retries, payload_json, template_code, priority')
      .eq('channel', 'sms')
      .order('created_at', { ascending: false })
      .limit(500)

    if (orgIds.length > 0) {
      logsQuery = logsQuery.in('org_id', orgIds)
      outboxQuery = outboxQuery.in('org_id', orgIds)
    }

    const [logsRes, outboxRes] = await Promise.all([logsQuery, outboxQuery])

    if (logsRes.error) return NextResponse.json({ error: logsRes.error.message }, { status: 500 })
    if (outboxRes.error) return NextResponse.json({ error: outboxRes.error.message }, { status: 500 })

    const outboxById = new Map((outboxRes.data || []).map((row: any) => [row.id, row]))
    const loggedOutboxIds = new Set<string>()
    const messages = []

    for (const log of logsRes.data || []) {
      const outbox = log.outbox_id ? outboxById.get(log.outbox_id) : null
      if (log.outbox_id) loggedOutboxIds.add(log.outbox_id)
      const rawStatus = asString(log.status) || asString(outbox?.status)
      messages.push({
        id: log.id,
        source: 'log',
        outboxId: log.outbox_id || null,
        createdAt: log.created_at || log.queued_at || outbox?.created_at || null,
        queuedAt: log.queued_at || outbox?.created_at || null,
        sentAt: log.sent_at || outbox?.sent_at || null,
        deliveredAt: log.delivered_at || (toMonitorStatus(rawStatus) === 'delivered' ? log.sent_at : null),
        failedAt: log.failed_at || null,
        status: toMonitorStatus(rawStatus),
        rawStatus,
        phone: asString(log.recipient_value) || asString(outbox?.to_phone) || null,
        eventCode: asString(log.event_code) || asString(outbox?.event_code) || null,
        providerName: asString(log.provider_name) || asString(outbox?.provider_name) || 'local_my',
        providerMessageId: asString(log.provider_message_id) || asString(outbox?.provider_message_id) || null,
        errorMessage: asString(log.error_message) || asString(outbox?.error) || null,
        errorCode: null,
        retryCount: Number(log.retry_count ?? outbox?.retry_count ?? 0),
        maxRetries: outbox?.max_retries != null ? Number(outbox.max_retries) : null,
        templateCode: asString(outbox?.template_code) || null,
        priority: asString(outbox?.priority) || null,
        payload: outbox?.payload_json || null,
        messageBody: payloadMessage(outbox?.payload_json, asString(log.event_code) || asString(outbox?.event_code)),
        providerResponse: log.provider_response || null,
        statusDetails: truncate(log.provider_response),
      })
    }

    for (const outbox of outboxRes.data || []) {
      if (loggedOutboxIds.has(outbox.id)) continue
      const rawStatus = asString(outbox.status)
      messages.push({
        id: outbox.id,
        source: 'outbox',
        outboxId: outbox.id,
        createdAt: outbox.created_at || null,
        queuedAt: outbox.created_at || outbox.scheduled_for || null,
        sentAt: outbox.sent_at || null,
        deliveredAt: toMonitorStatus(rawStatus) === 'delivered' ? outbox.sent_at : null,
        failedAt: toMonitorStatus(rawStatus) === 'failed' ? outbox.sent_at || outbox.created_at : null,
        status: toMonitorStatus(rawStatus),
        rawStatus,
        phone: asString(outbox.to_phone) || null,
        eventCode: asString(outbox.event_code) || null,
        providerName: asString(outbox.provider_name) || 'local_my',
        providerMessageId: asString(outbox.provider_message_id) || null,
        errorMessage: asString(outbox.error) || null,
        errorCode: null,
        retryCount: Number(outbox.retry_count || 0),
        maxRetries: outbox.max_retries != null ? Number(outbox.max_retries) : null,
        templateCode: asString(outbox.template_code) || null,
        priority: asString(outbox.priority) || null,
        payload: outbox.payload_json || null,
        messageBody: payloadMessage(outbox.payload_json, asString(outbox.event_code)),
        providerResponse: null,
        statusDetails: null,
      })
    }

    messages.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    const kpis = {
      pending: messages.filter((row) => row.status === 'pending').length,
      delivered: messages.filter((row) => row.status === 'delivered').length,
      failed: messages.filter((row) => row.status === 'failed').length,
      total: messages.length,
    }

    return NextResponse.json({ success: true, kpis, messages })
  } catch (error: any) {
    console.error('[sms-activity]', error)
    return NextResponse.json({ error: error.message || 'Failed to load SMS activity' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await canViewSmsMonitor(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const source = asString(body.source)
    const id = asString(body.id)
    if (!id) {
      return NextResponse.json({ error: 'Message id is required' }, { status: 400 })
    }
    const outboxId = asString(body.outboxId) || (source === 'outbox' ? id : '')
    const eventCode = asString(body.eventCode) || 'sms_edit'
    const message = asString(body.message)
    const send = Boolean(body.send)

    const { normalizeManualPhone } = await import('@/lib/notifications/manualPhoneNumbers')
    const phone = normalizeManualPhone(asString(body.phone))
    if (!('normalized' in phone)) {
      return NextResponse.json({ error: `Invalid phone number${phone.reason ? `: ${phone.reason}` : ''}` }, { status: 400 })
    }
    if (send && !message) {
      return NextResponse.json({ error: 'Message text is required to send' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    const orgId = profile?.organization_id
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    const { sendSmsWithActiveProvider, recordSmsDelivery } = await import('@/lib/notifications/sms-send')

    let targetOutboxId = outboxId || null
    let resolvedEvent = eventCode

    if (targetOutboxId) {
      const { data: outbox } = await admin
        .from('notifications_outbox')
        .select('id, event_code, payload_json, status')
        .eq('id', targetOutboxId)
        .maybeSingle()

      if (outbox) {
        resolvedEvent = asString(outbox.event_code) || resolvedEvent
        const payload = {
          ...((outbox.payload_json && typeof outbox.payload_json === 'object' && !Array.isArray(outbox.payload_json))
            ? outbox.payload_json as Record<string, unknown>
            : {}),
          _sms_body: message,
          customer_phone: phone.normalized,
        }
        const outboxUpdate: Record<string, unknown> = {
          to_phone: phone.normalized,
          payload_json: payload,
        }
        if (send) outboxUpdate.error = null
        await admin.from('notifications_outbox').update(outboxUpdate).eq('id', targetOutboxId)
      }
    }

    if (source === 'log' && id) {
      await admin.from('notification_logs').update({
        recipient_value: phone.normalized,
      }).eq('id', id)
    }

    if (!send) {
      return NextResponse.json({ success: true, saved: true, to: phone.normalized, outbox_id: targetOutboxId })
    }

    if (!targetOutboxId) {
      const { data: queued, error: queueError } = await admin
        .from('notifications_outbox')
        .insert({
          org_id: orgId,
          event_code: resolvedEvent,
          channel: 'sms',
          to_phone: phone.normalized,
          payload_json: { _sms_body: message, customer_phone: phone.normalized, edited_from: id },
          priority: 'high',
          provider_name: 'local_my',
          status: 'queued',
          retry_count: 0,
          max_retries: 3,
        })
        .select('id')
        .single()
      if (queueError || !queued) {
        return NextResponse.json({ error: queueError?.message || 'Failed to queue SMS' }, { status: 500 })
      }
      targetOutboxId = queued.id
    }

    const sent = await sendSmsWithActiveProvider(admin, orgId, phone.normalized, message)
    await recordSmsDelivery(admin, {
      orgId,
      outboxId: targetOutboxId,
      to: phone.normalized,
      eventCode: resolvedEvent,
      result: sent,
    })

    if (!sent.success) {
      return NextResponse.json({
        error: sent.error || 'SMS send failed',
        outbox_id: targetOutboxId,
        to: phone.normalized,
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      sent: true,
      to: phone.normalized,
      outbox_id: targetOutboxId,
      provider_id: sent.messageId || null,
    })
  } catch (error: any) {
    console.error('[sms-activity:edit]', error)
    return NextResponse.json({ error: error.message || 'Failed to edit SMS' }, { status: 500 })
  }
}

