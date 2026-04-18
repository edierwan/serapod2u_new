/**
 * WhatsApp Ingest Endpoint
 *
 * POST /api/support/whatsapp/ingest
 *
 * Accepts both the legacy app-shaped payload and the native Baileys gateway
 * webhook payload so inbound Daily Reporting replies can be processed end to end.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneE164, jidToPhone } from '@/utils/phone'
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils'
import {
  buildDailyReportingDetailMessage,
  buildDailyReportingMenuMessage,
  buildDailyReportingNoContextMessage,
  buildDailyReportingUnsupportedReplyMessage,
  parseDailyReportingReplyCommand,
  type DailyReportingCustomerDetail,
  type DailyReportingData,
} from '@/lib/reporting/dailyReporting'

export const dynamic = 'force-dynamic'

const AGENT_KEYS = [
  process.env.WHATSAPP_AGENT_KEY,
  process.env.AGENT_API_KEY,
  process.env.MOLTBOT_WEBHOOK_SECRET,
  process.env.BAILEYS_API_KEY,
].filter(Boolean) as string[]

const REPORT_SESSION_WINDOW_HOURS = Number(process.env.WHATSAPP_REPORT_SESSION_WINDOW_HOURS || 24)
const REPORT_SESSION_WINDOW_MS = REPORT_SESSION_WINDOW_HOURS * 60 * 60 * 1000

interface IngestPayload {
  tenantId?: string
  from: string
  to?: string
  messageId: string
  chatId?: string
  text: string
  timestamp?: number
  metadata?: Record<string, any>
}

interface GatewayWebhookPayload {
  event: 'INBOUND_USER' | 'OUTBOUND_ADMIN'
  tenantId?: string
  wa: {
    phoneDigits: string
    remoteJid: string
    fromMe: boolean
    messageId: string
    timestamp?: number
    pushName?: string
    text: string
    gatewayPhone?: string
    quotedMessageId?: string
    quotedParticipant?: string
    quotedRemoteJid?: string
  }
}

type ParsedIngestPayload = IngestPayload & {
  source: 'legacy' | 'gateway'
  directionHint: 'inbound' | 'outbound'
  providerMessageId?: string | null
  providerChatId?: string | null
  quotedMessageId?: string | null
  quotedParticipant?: string | null
  quotedRemoteJid?: string | null
  gatewayPhone?: string | null
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}

async function getConfiguredWhatsAppApiKeys(
  supabase: ReturnType<typeof getServiceClient>,
) {
  const { data, error } = await supabase
    .from('notification_provider_configs')
    .select('config_encrypted')
    .eq('channel', 'whatsapp')

  if (error || !data) {
    return [] as string[]
  }

  const keys = new Set<string>()

  for (const row of data as Array<{ config_encrypted?: unknown }>) {
    if (!row?.config_encrypted) continue

    try {
      const config = typeof row.config_encrypted === 'string'
        ? JSON.parse(row.config_encrypted)
        : row.config_encrypted

      if (config && typeof config === 'object' && typeof (config as any).api_key === 'string') {
        const apiKey = (config as any).api_key.trim()
        if (apiKey) keys.add(apiKey)
      }
    } catch {
      continue
    }
  }

  return Array.from(keys)
}

function isGatewayWebhookPayload(value: any): value is GatewayWebhookPayload {
  return !!value?.event && !!value?.wa?.messageId && typeof value?.wa?.text === 'string'
}

function normalizeOptionalPhone(value?: string | null) {
  if (!value) return null

  try {
    return normalizePhoneE164(value)
  } catch {
    return value
  }
}

function parseIncomingPayload(body: IngestPayload | GatewayWebhookPayload): ParsedIngestPayload {
  if (isGatewayWebhookPayload(body)) {
    const gatewayPhone = normalizeOptionalPhone(body.wa.gatewayPhone)
    const senderPhone = body.wa.fromMe
      ? gatewayPhone || normalizePhoneE164(body.wa.phoneDigits)
      : normalizePhoneE164(body.wa.phoneDigits)

    return {
      source: 'gateway',
      directionHint: body.wa.fromMe ? 'outbound' : 'inbound',
      tenantId: body.tenantId,
      from: senderPhone,
      to: gatewayPhone || undefined,
      messageId: body.wa.messageId,
      chatId: body.wa.remoteJid,
      text: body.wa.text,
      timestamp: body.wa.timestamp,
      providerMessageId: body.wa.messageId,
      providerChatId: body.wa.remoteJid,
      quotedMessageId: body.wa.quotedMessageId || null,
      quotedParticipant: body.wa.quotedParticipant || null,
      quotedRemoteJid: body.wa.quotedRemoteJid || null,
      gatewayPhone: gatewayPhone || null,
      metadata: {
        gateway_event: body.event,
        from_me: body.wa.fromMe,
        push_name: body.wa.pushName,
        quoted_message_id: body.wa.quotedMessageId || null,
        quoted_participant: body.wa.quotedParticipant || null,
        quoted_remote_jid: body.wa.quotedRemoteJid || null,
        gateway_phone: gatewayPhone || null,
        raw_payload: body,
      },
    }
  }

  return {
    source: 'legacy',
    directionHint: 'inbound',
    ...body,
    providerMessageId: body.messageId,
    providerChatId: body.chatId || null,
    quotedMessageId: body.metadata?.quoted_message_id || body.metadata?.quotedMessageId || null,
    quotedParticipant: body.metadata?.quoted_participant || body.metadata?.quotedParticipant || null,
    quotedRemoteJid: body.metadata?.quoted_remote_jid || body.metadata?.quotedRemoteJid || null,
    gatewayPhone: body.metadata?.gateway_phone || body.to || null,
  }
}

function isInteractiveReportCommand(text: string) {
  const normalized = text.trim().toLowerCase()
  return normalized === '1' || normalized === '2' || normalized === 'help' || normalized === 'menu'
}

function isPotentialInteractiveReply(text: string) {
  const trimmed = text.trim()
  return isInteractiveReportCommand(trimmed) || trimmed.length <= 20
}

function getProviderMessageCandidates(payload: ParsedIngestPayload) {
  return [
    payload.quotedMessageId,
    payload.metadata?.quoted_message_id,
    payload.metadata?.quotedMessageId,
    payload.metadata?.contextInfo?.stanzaId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

async function logWhatsAppEvent(
  supabase: ReturnType<typeof getServiceClient>,
  params: {
    tenantId?: string
    direction: 'inbound' | 'outbound'
    phone: string
    externalMessageId?: string | null
    externalChatId?: string | null
    action: string
    status: string
    errorMessage?: string | null
    metadata?: Record<string, any>
  },
) {
  await supabase.from('whatsapp_message_logs').insert({
    tenant_id: params.tenantId || 'default',
    direction: params.direction,
    phone_e164: params.phone,
    external_message_id: params.externalMessageId || null,
    external_chat_id: params.externalChatId || null,
    action: params.action,
    status: params.status,
    error_message: params.errorMessage || null,
    metadata: params.metadata || {},
  })
}

async function findDailyReportingContext(
  supabase: ReturnType<typeof getServiceClient>,
  senderPhoneE164: string,
  payload: ParsedIngestPayload,
) {
  const quotedMessageIds = getProviderMessageCandidates(payload)

  for (const matchedBy of ['provider_message_id', 'last_outbound_message_id'] as const) {
    if (quotedMessageIds.length === 0) break

    const { data: matchedSession } = await (supabase as any)
      .from('marketing_report_sessions')
      .select('*')
      .eq('reply_enabled', true)
      .eq('status', 'active')
      .in(matchedBy, quotedMessageIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (matchedSession) {
      return {
        activeSession: matchedSession,
        latestSession: matchedSession,
        matchedBy,
      }
    }
  }

  const { data: phoneSessions } = await (supabase as any)
    .from('marketing_report_sessions')
    .select('*')
    .eq('recipient_phone', senderPhoneE164)
    .eq('reply_enabled', true)
    .order('created_at', { ascending: false })
    .limit(5)

  const sessions = (phoneSessions || []) as any[]
  const latestSession = sessions[0] || null
  const now = Date.now()

  const activeSession = sessions.find((session) => {
    if (session.status !== 'active') return false

    const createdAt = new Date(session.created_at).getTime()
    const expiresAt = session.expires_at
      ? new Date(session.expires_at).getTime()
      : createdAt + REPORT_SESSION_WINDOW_MS

    return createdAt >= now - REPORT_SESSION_WINDOW_MS && expiresAt >= now
  }) || null

  return {
    activeSession,
    latestSession,
    matchedBy: activeSession ? 'recipient_phone_recent' : null,
  }
}

async function sendSessionReply(
  supabase: ReturnType<typeof getServiceClient>,
  session: any,
  params: {
    tenantId?: string
    inboundText: string
    inboundMessageId: string
    responseText: string
    replyAction: string
    requestedPage: number | null
    matchedBy: string | null
    providerContext: Record<string, any>
    nextPageToPersist?: number | null
  },
) {
  const config = await getWhatsAppConfig(supabase as any, session.org_id)

  if (!config || !config.baseUrl) {
    await (supabase as any).from('marketing_reply_logs').insert({
      session_id: session.id,
      campaign_id: session.campaign_id,
      org_id: session.org_id,
      recipient_phone: session.recipient_phone,
      reply_received: params.inboundText,
      reply_action: params.replyAction,
      requested_page: params.requestedPage,
      response_snapshot: params.responseText,
      inbound_message_id: params.inboundMessageId,
      matched_by: params.matchedBy,
      provider_context: params.providerContext,
      status: 'failed',
      error_message: 'WhatsApp configuration not found',
      created_at: new Date().toISOString(),
    })

    await logWhatsAppEvent(supabase, {
      tenantId: params.tenantId,
      direction: 'outbound',
      phone: session.recipient_phone,
      action: 'daily_reporting_reply',
      status: 'failed',
      errorMessage: 'WhatsApp configuration not found',
      metadata: {
        session_id: session.id,
        reply_action: params.replyAction,
      },
    })

    return { success: false, outboundMessageId: null as string | null }
  }

  const result = await callGateway(
    config.baseUrl,
    config.apiKey,
    'POST',
    '/messages/send',
    {
      to: session.recipient_phone,
      text: params.responseText,
    },
    config.tenantId,
  )

  const success = result?.success ?? result?.ok ?? false
  const outboundMessageId = result?.message_id || result?.provider_message_id || null

  await (supabase as any).from('marketing_reply_logs').insert({
    session_id: session.id,
    campaign_id: session.campaign_id,
    org_id: session.org_id,
    recipient_phone: session.recipient_phone,
    reply_received: params.inboundText,
    reply_action: params.replyAction,
    requested_page: params.requestedPage,
    response_snapshot: params.responseText,
    inbound_message_id: params.inboundMessageId,
    outbound_message_id: outboundMessageId,
    matched_by: params.matchedBy,
    provider_context: params.providerContext,
    status: success ? 'success' : 'failed',
    error_message: success ? null : (result?.error || 'Failed to send reply'),
    created_at: new Date().toISOString(),
  })

  await logWhatsAppEvent(supabase, {
    tenantId: params.tenantId,
    direction: 'outbound',
    phone: session.recipient_phone,
    externalMessageId: outboundMessageId,
    externalChatId: session.provider_chat_id || null,
    action: 'daily_reporting_reply',
    status: success ? 'success' : 'failed',
    errorMessage: success ? null : (result?.error || 'Failed to send reply'),
    metadata: {
      session_id: session.id,
      campaign_id: session.campaign_id,
      reply_action: params.replyAction,
      requested_page: params.requestedPage,
      matched_by: params.matchedBy,
    },
  })

  await (supabase as any)
    .from('marketing_report_sessions')
    .update({
      last_detail_page_sent: success && params.nextPageToPersist != null ? params.nextPageToPersist : session.last_detail_page_sent,
      last_reply_received: params.inboundText,
      last_reply_action_triggered: params.replyAction,
      last_reply_received_at: new Date().toISOString(),
      last_outbound_message_id: success ? outboundMessageId : session.last_outbound_message_id,
      last_outbound_sent_at: success ? new Date().toISOString() : session.last_outbound_sent_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  return { success, outboundMessageId }
}

async function handleDailyReportingReply(
  supabase: ReturnType<typeof getServiceClient>,
  senderPhoneE164: string,
  payload: ParsedIngestPayload,
) {
  const trimmedText = payload.text.trim()
  const { activeSession, latestSession, matchedBy } = await findDailyReportingContext(supabase, senderPhoneE164, payload)

  if (!activeSession) {
    if (!isInteractiveReportCommand(trimmedText) || !latestSession) {
      return { handled: false }
    }

    const fallbackResult = await sendSessionReply(supabase, latestSession, {
      tenantId: payload.tenantId,
      inboundText: trimmedText,
      inboundMessageId: payload.messageId,
      responseText: buildDailyReportingNoContextMessage(),
      replyAction: 'daily_reporting_no_context',
      requestedPage: null,
      matchedBy,
      providerContext: {
        provider_message_id: payload.providerMessageId,
        provider_chat_id: payload.providerChatId,
        quoted_message_id: payload.quotedMessageId,
        quoted_participant: payload.quotedParticipant,
        quoted_remote_jid: payload.quotedRemoteJid,
      },
    })

    return { handled: true, success: fallbackResult.success }
  }

  const parsedCommand = parseDailyReportingReplyCommand(trimmedText, activeSession.last_detail_page_sent || 0)

  if (parsedCommand.type === 'help' || parsedCommand.type === 'menu') {
    const helpResult = await sendSessionReply(supabase, activeSession, {
      tenantId: payload.tenantId,
      inboundText: trimmedText,
      inboundMessageId: payload.messageId,
      responseText: buildDailyReportingMenuMessage(),
      replyAction: `daily_reporting_${parsedCommand.type}`,
      requestedPage: null,
      matchedBy,
      providerContext: {
        provider_message_id: payload.providerMessageId,
        provider_chat_id: payload.providerChatId,
        quoted_message_id: payload.quotedMessageId,
        quoted_participant: payload.quotedParticipant,
        quoted_remote_jid: payload.quotedRemoteJid,
      },
    })

    return { handled: true, success: helpResult.success }
  }

  if (parsedCommand.type === 'unsupported') {
    if (!isPotentialInteractiveReply(trimmedText)) {
      return { handled: false }
    }

    const unsupportedResult = await sendSessionReply(supabase, activeSession, {
      tenantId: payload.tenantId,
      inboundText: trimmedText,
      inboundMessageId: payload.messageId,
      responseText: buildDailyReportingUnsupportedReplyMessage(),
      replyAction: 'daily_reporting_unsupported',
      requestedPage: null,
      matchedBy,
      providerContext: {
        provider_message_id: payload.providerMessageId,
        provider_chat_id: payload.providerChatId,
        quoted_message_id: payload.quotedMessageId,
        quoted_participant: payload.quotedParticipant,
        quoted_remote_jid: payload.quotedRemoteJid,
      },
    })

    return { handled: true, success: unsupportedResult.success }
  }

  const reportData: DailyReportingData = {
    reportDateIso: activeSession.report_date,
    reportDateLabel: activeSession.report_date,
    reportType: activeSession.report_type,
    periodStartIso: activeSession.period_start,
    periodEndIso: activeSession.period_end,
    todayScans: 0,
    yesterdayScans: 0,
    thisWeekScans: 0,
    uniqueCustomers: Number(activeSession.unique_customer_count || 0),
    uniqueCustomerDetails: (activeSession.unique_customer_details || []) as DailyReportingCustomerDetail[],
  }

  const detailMessage = buildDailyReportingDetailMessage(reportData, parsedCommand.page)
  const replyResult = await sendSessionReply(supabase, activeSession, {
    tenantId: payload.tenantId,
    inboundText: trimmedText,
    inboundMessageId: payload.messageId,
    responseText: detailMessage.text,
    replyAction: detailMessage.isExhausted
      ? 'daily_reporting_no_more_records'
      : `daily_reporting_page_${parsedCommand.page}`,
    requestedPage: parsedCommand.page,
    matchedBy,
    providerContext: {
      provider_message_id: payload.providerMessageId,
      provider_chat_id: payload.providerChatId,
      quoted_message_id: payload.quotedMessageId,
      quoted_participant: payload.quotedParticipant,
      quoted_remote_jid: payload.quotedRemoteJid,
    },
    nextPageToPersist: detailMessage.isExhausted
      ? activeSession.last_detail_page_sent
      : parsedCommand.page,
  })

  return { handled: true, success: replyResult.success }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const agentKey = request.headers.get('x-agent-key') || request.headers.get('x-api-key') || request.headers.get('x-moltbot-secret')
    const supabase = getServiceClient()
    const configuredApiKeys = await getConfiguredWhatsAppApiKeys(supabase)
    const acceptedKeys = new Set([...AGENT_KEYS, ...configuredApiKeys])

    if (acceptedKeys.size === 0) {
      console.error('[WhatsApp Ingest] webhook auth secret not configured')
      return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 })
    }

    if (!agentKey || !acceptedKeys.has(agentKey)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsedBody = parseIncomingPayload(rawBody)
    const { from, messageId, chatId, text, metadata, tenantId } = parsedBody

    if (!from || !messageId || !text) {
      return NextResponse.json({ ok: false, error: 'Missing required fields: from, messageId, text' }, { status: 400 })
    }

    const senderPhoneE164 = normalizePhoneE164(from)
    const chatJid = chatId || `${senderPhoneE164.replace(/\D/g, '')}@s.whatsapp.net`

    console.log(`[WhatsApp Ingest] Processing ${parsedBody.source} message from ${senderPhoneE164}, messageId=${messageId}`)

    if (parsedBody.source === 'gateway' && parsedBody.directionHint === 'outbound') {
      await logWhatsAppEvent(supabase, {
        tenantId,
        direction: 'outbound',
        phone: senderPhoneE164,
        externalMessageId: parsedBody.providerMessageId || messageId,
        externalChatId: parsedBody.providerChatId || chatJid,
        action: 'ingest_gateway_echo',
        status: 'ignored',
        metadata: {
          source: parsedBody.source,
          direction_hint: parsedBody.directionHint,
          gateway_phone: parsedBody.gatewayPhone,
        },
      })

      return NextResponse.json({ ok: true, ignored: true, reason: 'gateway outbound echo' })
    }

    const { data: existingMessage } = await supabase
      .from('support_conversation_messages')
      .select('id, conversation_id')
      .eq('external_message_id', messageId)
      .eq('channel', 'whatsapp')
      .single()

    if (existingMessage) {
      await logWhatsAppEvent(supabase, {
        tenantId,
        direction: 'inbound',
        phone: senderPhoneE164,
        externalMessageId: messageId,
        externalChatId: chatJid,
        action: 'ingest',
        status: 'duplicate',
        metadata: {
          dedup: true,
          source: parsedBody.source,
        },
      })

      return NextResponse.json({
        ok: true,
        threadId: existingMessage.conversation_id,
        messageId: existingMessage.id,
        dedup: true,
      })
    }

    const { data: adminIdentity } = await supabase
      .from('admin_whatsapp_identities')
      .select('admin_user_id, display_name')
      .eq('phone_e164', senderPhoneE164)
      .eq('enabled', true)
      .single()

    const isAdmin = parsedBody.directionHint === 'outbound' || !!adminIdentity
    let conversationId: string
    let direction: 'inbound' | 'outbound'
    let senderType: 'user' | 'admin'
    let senderUserId: string | null = null
    let senderAdminId: string | null = null

    if (isAdmin) {
      direction = 'outbound'
      senderType = 'admin'
      senderAdminId = adminIdentity?.admin_user_id || null

      const endUserPhone = jidToPhone(chatJid)
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('whatsapp_user_phone', endUserPhone)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!conv) {
        const { data: newConv, error: convError } = await supabase
          .from('support_conversations')
          .insert({
            case_number: `CASE${Date.now().toString().slice(-6)}`,
            created_by_user_id: '00000000-0000-0000-0000-000000000000',
            subject: 'WhatsApp Conversation',
            status: 'pending_user',
            primary_channel: 'whatsapp',
            whatsapp_user_phone: endUserPhone,
            external_chat_id: chatJid,
            admin_whatsapp_phone: senderPhoneE164,
            assigned_admin_id: senderAdminId,
          })
          .select('id')
          .single()

        if (convError) throw convError
        conversationId = newConv.id
      } else {
        conversationId = conv.id
      }
    } else {
      direction = 'inbound'
      senderType = 'user'

      const { data: user } = await supabase
        .from('users')
        .select('id')
        .or(`phone.eq.${from},phone.eq.${senderPhoneE164}`)
        .limit(1)
        .single()

      if (user) {
        senderUserId = user.id
      }

      const { data: existingConv } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('whatsapp_user_phone', senderPhoneE164)
        .not('status', 'in', '("closed","spam")')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (existingConv) {
        conversationId = existingConv.id

        await supabase
          .from('support_conversations')
          .update({
            external_chat_id: chatJid,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId)
          .is('external_chat_id', null)
      } else {
        const { data: newConv, error: convError } = await supabase
          .from('support_conversations')
          .insert({
            case_number: `CASE${Date.now().toString().slice(-6)}`,
            created_by_user_id: senderUserId || '00000000-0000-0000-0000-000000000000',
            subject: `WhatsApp: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
            status: 'open',
            primary_channel: 'whatsapp',
            whatsapp_user_phone: senderPhoneE164,
            external_chat_id: chatJid,
            admin_unread_count: 1,
          })
          .select('id')
          .single()

        if (convError) throw convError
        conversationId = newConv.id
      }
    }

    const messageMetadata = {
      ...(metadata || {}),
      ingest_source: parsedBody.source,
      direction_hint: parsedBody.directionHint,
      provider_message_id: parsedBody.providerMessageId || messageId,
      provider_chat_id: parsedBody.providerChatId || chatJid,
    }

    const { data: newMessage, error: msgError } = await supabase
      .from('support_conversation_messages')
      .insert({
        conversation_id: conversationId,
        direction,
        channel: 'whatsapp',
        sender_type: senderType,
        sender_user_id: senderUserId,
        sender_admin_id: senderAdminId,
        sender_phone: senderPhoneE164,
        body_text: text,
        external_message_id: messageId,
        external_chat_id: chatJid,
        origin: 'whatsapp',
        metadata: messageMetadata,
      })
      .select('id')
      .single()

    if (msgError) throw msgError

    const updateData: Record<string, any> = {
      last_message_at: new Date().toISOString(),
      last_message_preview: text.substring(0, 100),
      last_message_sender_type: senderType,
      updated_at: new Date().toISOString(),
    }

    if (direction === 'inbound') {
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('admin_unread_count, status')
        .eq('id', conversationId)
        .single()

      updateData.admin_unread_count = (conv?.admin_unread_count || 0) + 1

      if (conv?.status === 'resolved' || conv?.status === 'pending_user') {
        updateData.status = 'open'
      }
    } else {
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('user_unread_count, status')
        .eq('id', conversationId)
        .single()

      updateData.user_unread_count = (conv?.user_unread_count || 0) + 1

      if (conv?.status === 'open') {
        updateData.status = 'pending_user'
      }
    }

    await supabase
      .from('support_conversations')
      .update(updateData)
      .eq('id', conversationId)

    await logWhatsAppEvent(supabase, {
      tenantId,
      direction,
      phone: senderPhoneE164,
      externalMessageId: messageId,
      externalChatId: chatJid,
      action: 'ingest',
      status: 'success',
      metadata: {
        conversation_id: conversationId,
        message_id: newMessage.id,
        is_admin: isAdmin,
        source: parsedBody.source,
        direction_hint: parsedBody.directionHint,
      },
    })

    if (direction === 'inbound') {
      try {
        await handleDailyReportingReply(supabase, senderPhoneE164, parsedBody)
      } catch (replyError) {
        console.error('[WhatsApp Ingest] Daily reporting reply error:', replyError)
      }
    }

    console.log(`[WhatsApp Ingest] Success: convId=${conversationId}, msgId=${newMessage.id}`)

    return NextResponse.json({
      ok: true,
      threadId: conversationId,
      messageId: newMessage.id,
      dedup: false,
    })
  } catch (error: any) {
    console.error('[WhatsApp Ingest] Error:', error)
    return NextResponse.json({ ok: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}
