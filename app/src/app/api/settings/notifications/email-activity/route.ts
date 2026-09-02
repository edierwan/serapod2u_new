import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { emailProviderBlockedByUiTest } from '@/lib/notifications/emailProviderReady'
import {
  emailOrderFields,
  extractEmailBody,
  extractEmailReceiver,
  extractEmailSubject,
  overlayEmailStatusForFailedProvider,
  toEmailMonitorStatus,
} from '@/lib/notifications/emailActivity'

export const dynamic = 'force-dynamic'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(value: unknown, max = 2000): string | null {
  if (value == null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

type ProviderBlock = { error: string; lastTestAt: string | null }

function applyProviderTestFailure(
  orgId: string | null | undefined,
  rawStatus: string,
  createdAt: string | null,
  sentAt: string | null,
  existingError: string | null,
  providerBlockByOrg: Map<string, ProviderBlock>,
) {
  const mapped = toEmailMonitorStatus(rawStatus)
  const block = orgId ? providerBlockByOrg.get(orgId) : undefined
  const overlay = overlayEmailStatusForFailedProvider({
    status: mapped,
    createdAt,
    sentAt,
    lastTestAt: block?.lastTestAt,
    providerBlockError: block?.error,
    existingError,
  })
  return {
    status: overlay.status,
    rawStatus: overlay.status === 'failed' && mapped !== 'failed' ? 'failed' : rawStatus,
    errorMessage: overlay.errorMessage,
    failedAt: overlay.status === 'failed' ? sentAt || createdAt : null,
  }
}

async function canViewEmailMonitor(supabase: any, userId: string) {
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

async function resolveEmailOrgIds(admin: any, userOrgId: string | null) {
  const ids = new Set<string>()
  if (userOrgId) ids.add(userOrgId)

  const [{ data: hq }, { data: providers }] = await Promise.all([
    admin.from('organizations').select('id').eq('org_type_code', 'HQ').eq('is_active', true).limit(5),
    admin.from('notification_provider_configs').select('org_id').eq('channel', 'email'),
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
    if (!await canViewEmailMonitor(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    const orgIds = await resolveEmailOrgIds(admin, profile?.organization_id || null)

    let logsQuery = admin
      .from('notification_logs')
      .select('id, org_id, created_at, queued_at, sent_at, delivered_at, failed_at, status, recipient_value, recipient_type, event_code, provider_name, provider_message_id, error_message, retry_count, provider_response, outbox_id')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(500)

    let outboxQuery = admin
      .from('notifications_outbox')
      .select('id, org_id, created_at, scheduled_for, sent_at, status, to_email, event_code, provider_name, provider_message_id, error, retry_count, max_retries, payload_json, template_code, priority')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(500)

    if (orgIds.length > 0) {
      logsQuery = logsQuery.in('org_id', orgIds)
      outboxQuery = outboxQuery.in('org_id', orgIds)
    }

    const [logsRes, outboxRes, providersRes] = await Promise.all([
      logsQuery,
      outboxQuery,
      admin
        .from('notification_provider_configs')
        .select('org_id, last_test_status, last_test_error, last_test_at')
        .eq('channel', 'email')
        .eq('is_active', true),
    ])

    if (logsRes.error) return NextResponse.json({ error: logsRes.error.message }, { status: 500 })
    if (outboxRes.error) return NextResponse.json({ error: outboxRes.error.message }, { status: 500 })

    const providerBlockByOrg = new Map<string, ProviderBlock>()
    for (const provider of providersRes.data || []) {
      const blocked = emailProviderBlockedByUiTest(provider)
      if (!blocked || !provider.org_id) continue
      providerBlockByOrg.set(provider.org_id, { error: blocked, lastTestAt: provider.last_test_at || null })
    }

    const outboxById = new Map((outboxRes.data || []).map((row: any) => [row.id, row]))
    const missingOutboxIds = Array.from(new Set(
      (logsRes.data || [])
        .map((log: any) => log.outbox_id)
        .filter((id: string | null) => id && !outboxById.has(id)),
    ))
    if (missingOutboxIds.length > 0) {
      const { data: extraOutbox } = await admin
        .from('notifications_outbox')
        .select('id, org_id, created_at, scheduled_for, sent_at, status, to_email, event_code, provider_name, provider_message_id, error, retry_count, max_retries, payload_json, template_code, priority')
        .in('id', missingOutboxIds)
      for (const row of extraOutbox || []) outboxById.set(row.id, row)
    }

    const loggedOutboxIds = new Set<string>()
    const messages = []

    for (const log of logsRes.data || []) {
      if (log.outbox_id && loggedOutboxIds.has(log.outbox_id)) continue
      const outbox = log.outbox_id ? outboxById.get(log.outbox_id) : null
      if (log.outbox_id) loggedOutboxIds.add(log.outbox_id)
      const rawStatus = asString(log.status) || asString(outbox?.status)
      const eventCode = asString(log.event_code) || asString(outbox?.event_code) || null
      const payload = outbox?.payload_json || null
      const createdAt = log.created_at || log.queued_at || outbox?.created_at || null
      const sentAt = log.sent_at || outbox?.sent_at || null
      const overlay = applyProviderTestFailure(
        log.org_id || outbox?.org_id,
        rawStatus,
        createdAt,
        sentAt,
        asString(log.error_message) || asString(outbox?.error) || null,
        providerBlockByOrg,
      )
      messages.push({
        id: log.id,
        source: 'log',
        outboxId: log.outbox_id || null,
        createdAt,
        queuedAt: log.queued_at || outbox?.created_at || null,
        sentAt,
        deliveredAt: overlay.status === 'delivered' ? (log.delivered_at || sentAt) : log.delivered_at,
        failedAt: overlay.status === 'failed' ? (log.failed_at || overlay.failedAt) : log.failed_at,
        status: overlay.status,
        rawStatus: overlay.rawStatus,
        receiver: extractEmailReceiver(log.recipient_value, outbox, payload),
        eventCode,
        providerName: asString(log.provider_name) || asString(outbox?.provider_name) || 'email',
        providerMessageId: asString(log.provider_message_id) || asString(outbox?.provider_message_id) || null,
        errorMessage: overlay.errorMessage,
        retryCount: Number(log.retry_count ?? outbox?.retry_count ?? 0),
        maxRetries: outbox?.max_retries != null ? Number(outbox.max_retries) : null,
        templateCode: asString(outbox?.template_code) || null,
        priority: asString(outbox?.priority) || null,
        payload,
        subject: extractEmailSubject(payload, eventCode),
        messageBody: extractEmailBody(payload),
        ...emailOrderFields(payload),
        providerResponse: log.provider_response || null,
        statusDetails: truncate(log.provider_response),
      })
    }

    for (const outbox of outboxRes.data || []) {
      if (loggedOutboxIds.has(outbox.id)) continue
      const rawStatus = asString(outbox.status)
      const eventCode = asString(outbox.event_code) || null
      const payload = outbox.payload_json || null
      const createdAt = outbox.created_at || null
      const sentAt = outbox.sent_at || null
      const overlay = applyProviderTestFailure(
        outbox.org_id,
        rawStatus,
        createdAt,
        sentAt,
        asString(outbox.error) || null,
        providerBlockByOrg,
      )
      messages.push({
        id: outbox.id,
        source: 'outbox',
        outboxId: outbox.id,
        createdAt,
        queuedAt: outbox.created_at || outbox.scheduled_for || null,
        sentAt,
        deliveredAt: overlay.status === 'delivered' ? sentAt : null,
        failedAt: overlay.status === 'failed' ? overlay.failedAt || createdAt : null,
        status: overlay.status,
        rawStatus: overlay.rawStatus,
        receiver: extractEmailReceiver(outbox.to_email, payload),
        eventCode,
        providerName: asString(outbox.provider_name) || 'email',
        providerMessageId: asString(outbox.provider_message_id) || null,
        errorMessage: overlay.errorMessage,
        retryCount: Number(outbox.retry_count || 0),
        maxRetries: outbox.max_retries != null ? Number(outbox.max_retries) : null,
        templateCode: asString(outbox.template_code) || null,
        priority: asString(outbox.priority) || null,
        payload,
        subject: extractEmailSubject(payload, eventCode),
        messageBody: extractEmailBody(payload),
        ...emailOrderFields(payload),
        providerResponse: null,
        statusDetails: null,
      })
    }

    messages.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    const kpis = {
      pending: messages.filter((row) => row.status === 'pending').length,
      sent: messages.filter((row) => row.status === 'sent').length,
      delivered: messages.filter((row) => row.status === 'delivered').length,
      failed: messages.filter((row) => row.status === 'failed').length,
      total: messages.length,
    }

    return NextResponse.json({ success: true, kpis, messages })
  } catch (error: any) {
    console.error('[email-activity]', error)
    return NextResponse.json({ error: error.message || 'Failed to load email activity' }, { status: 500 })
  }
}
