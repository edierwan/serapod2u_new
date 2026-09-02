import { toSmsE164 } from '@/lib/notifications/manualPhoneNumbers'

export const LOCAL_MY_SMS_PROVIDER = 'local_my'

export type LocalSmsGatewayConfig = {
  apiEndpoint: string
  apiUsername: string
  apiPassword: string
  senderId?: string
  smsType?: string
  httpMethod?: string
  requestFormat?: string
}

export type SmsSendResult = {
  success: boolean
  messageId?: string | null
  error?: string
  providerResponse?: {
    status?: number
    body?: string
  }
}

type SupabaseLikeClient = any

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseSmsProviderSecrets(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

export function localSmsConfigFromParts(
  publicConfig: Record<string, any> | null | undefined,
  secrets: Record<string, any> | null | undefined,
): LocalSmsGatewayConfig {
  const pub = publicConfig || {}
  const sec = secrets || {}
  return {
    apiEndpoint: asString(pub.api_endpoint),
    apiUsername: asString(pub.api_username),
    apiPassword: asString(sec.api_password || pub.api_password),
    senderId: asString(pub.sender_id),
    smsType: asString(pub.sms_type) || 'transactional',
    httpMethod: asString(pub.http_method) || 'GET',
    requestFormat: asString(pub.request_format) || 'query',
  }
}

const PLACEHOLDER_KEYS = ['username', 'password', 'to', 'message', 'sender_id', 'sms_type'] as const

function substitutePlaceholders(template: string, values: Record<(typeof PLACEHOLDER_KEYS)[number], string>): string {
  return template.replace(/\{\{(username|password|to|message|sender_id|sms_type)\}\}/g, (_, key: string) => {
    return encodeURIComponent(values[key as (typeof PLACEHOLDER_KEYS)[number]] || '')
  })
}

function hasPlaceholders(endpoint: string): boolean {
  return /\{\{(username|password|to|message|sender_id|sms_type)\}\}/.test(endpoint)
}

function appendQueryParams(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

function truncateBody(body: string): string {
  if (body.length <= 2000) return body
  return `${body.slice(0, 2000)}…`
}

function isGatewaySuccess(httpOk: boolean, body: string): boolean {
  const trimmed = body.trim()
  const lower = trimmed.toLowerCase()

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed) > 0
  }

  if (/(invalid|denied|unauthorized|forbidden|failed|failure|error)/.test(lower) && !/success/.test(lower)) {
    return false
  }

  if (/(success|2000|\bok\b)/.test(lower)) {
    return true
  }

  return httpOk
}

function extractMessageId(body: string): string | null {
  const trimmed = body.trim()
  if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return trimmed
  try {
    const parsed = JSON.parse(trimmed)
    const id = parsed?.messageId || parsed?.message_id || parsed?.id || parsed?.msgid
    return id ? String(id) : null
  } catch {
    return null
  }
}

export async function sendLocalMalaysianSms(
  config: LocalSmsGatewayConfig,
  to: string,
  message: string,
): Promise<SmsSendResult> {
  const phone = toSmsE164(to)
  if (!('e164' in phone)) {
    return { success: false, error: `Invalid phone number: ${phone.reason}` }
  }

  const endpoint = asString(config.apiEndpoint)
  if (!endpoint) {
    return { success: false, error: 'SMS gateway API endpoint is required' }
  }
  if (!/^https?:\/\//i.test(endpoint)) {
    return { success: false, error: 'SMS gateway API endpoint must be an http or https URL' }
  }

  const username = asString(config.apiUsername)
  const password = asString(config.apiPassword)
  if (!username || !password) {
    return { success: false, error: 'SMS gateway username and password are required' }
  }

  const text = String(message || '').trim()
  if (!text) {
    return { success: false, error: 'SMS message body is required' }
  }

  const values = {
    username,
    password,
    to: phone.e164,
    message: text,
    sender_id: asString(config.senderId),
    sms_type: asString(config.smsType) || 'transactional',
  }

  const method = asString(config.httpMethod).toUpperCase() === 'POST' ? 'POST' : 'GET'
  const format = asString(config.requestFormat).toLowerCase() || 'query'
  const templated = hasPlaceholders(endpoint)

  let url = templated ? substitutePlaceholders(endpoint, values) : endpoint
  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(20_000),
  }

  try {
    if (templated && method === 'GET') {
      init.method = 'GET'
    } else if (!templated && (method === 'GET' || format === 'query')) {
      url = appendQueryParams(endpoint, {
        apiusername: username,
        apipassword: password,
        mobileno: values.to,
        senderid: values.sender_id,
        message: text,
      })
      init.method = 'GET'
    } else if (format === 'json') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify({
        username,
        password,
        to: values.to,
        from: values.sender_id,
        message: text,
        type: values.sms_type,
      })
    } else {
      init.method = 'POST'
      const form = new URLSearchParams()
      form.set('username', username)
      form.set('password', password)
      form.set('to', values.to)
      form.set('from', values.sender_id)
      form.set('message', text)
      form.set('type', values.sms_type)
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      init.body = form.toString()
    }

    const response = await fetch(url, init)
    const body = await response.text()
    const providerResponse = { status: response.status, body: truncateBody(body) }
    const success = isGatewaySuccess(response.ok, body)

    if (!success) {
      return {
        success: false,
        error: `SMS gateway returned ${response.status}: ${truncateBody(body) || 'empty response'}`,
        providerResponse,
      }
    }

    return {
      success: true,
      messageId: extractMessageId(body),
      providerResponse,
    }
  } catch (error: any) {
    const reason = error?.name === 'TimeoutError'
      ? 'SMS gateway request timed out'
      : (error?.message || 'Failed to reach SMS gateway')
    return { success: false, error: reason }
  }
}

export async function sendSmsWithActiveProvider(
  supabase: SupabaseLikeClient,
  orgId: string,
  to: string,
  message: string,
): Promise<SmsSendResult> {
  const { data: config } = await supabase
    .from('notification_provider_configs')
    .select('*')
    .eq('org_id', orgId)
    .eq('channel', 'sms')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!config) {
    return { success: false, error: 'SMS provider not configured' }
  }

  if (config.provider_name !== LOCAL_MY_SMS_PROVIDER) {
    return {
      success: false,
      error: `SMS provider ${config.provider_name} is not implemented. Only Local Malaysian Provider is supported.`,
    }
  }

  const publicConfig = (config.config_public && typeof config.config_public === 'object')
    ? config.config_public as Record<string, any>
    : {}
  const secrets = parseSmsProviderSecrets(config.config_encrypted)

  return sendLocalMalaysianSms(localSmsConfigFromParts(publicConfig, secrets), to, message)
}

export async function recordSmsDelivery(
  supabase: SupabaseLikeClient,
  input: {
    orgId: string
    outboxId?: string | null
    to: string
    eventCode: string
    result: SmsSendResult
  },
): Promise<void> {
  const now = new Date().toISOString()
  const success = Boolean(input.result.success)
  const status = success ? 'sent' : 'failed'

  if (input.outboxId) {
    await supabase.from('notifications_outbox').update({
      status,
      sent_at: success ? now : null,
      error: success ? null : (input.result.error || 'SMS delivery failed'),
      provider_name: 'local_my',
      provider_message_id: input.result.messageId || null,
    }).eq('id', input.outboxId)

    try {
      await supabase.rpc('log_notification_attempt', success ? {
        p_outbox_id: input.outboxId,
        p_status: 'sent',
        p_provider_message_id: input.result.messageId || null,
        p_provider_response: input.result.providerResponse || { provider: 'local_my' },
      } : {
        p_outbox_id: input.outboxId,
        p_status: 'failed',
        p_error_message: input.result.error || 'SMS delivery failed',
        p_provider_response: input.result.providerResponse || null,
      })
    } catch {
      // Direct notification_logs insert below is the source of truth for the monitor.
    }
  }

  await supabase.from('notification_logs').insert({
    org_id: input.orgId,
    outbox_id: input.outboxId || null,
    event_code: input.eventCode,
    channel: 'sms',
    recipient_value: input.to,
    recipient_type: 'phone',
    status,
    provider_name: 'local_my',
    provider_message_id: input.result.messageId || null,
    provider_response: input.result.providerResponse || null,
    error_message: success ? null : (input.result.error || 'SMS delivery failed'),
    queued_at: now,
    sent_at: success ? now : null,
    failed_at: success ? null : now,
    created_at: now,
  })
}
