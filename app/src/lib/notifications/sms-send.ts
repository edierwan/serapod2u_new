import { toSmsE164 } from '@/lib/notifications/manualPhoneNumbers'

export const LOCAL_MY_SMS_PROVIDER = 'local_my'
export const VONAGE_SMS_PROVIDER = 'vonage'
export const SMS_FINAL_STATUSES = ['delivered', 'failed'] as const
export type SmsDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed'

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
  externalId?: string | null
  gatewayStatus?: string | null
  error?: string
  providerName?: string
  providerResponse?: {
    status?: number
    body?: string
    message_id?: string | null
    external_id?: string | null
    gateway_status?: string | null
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

function envGatewayUrl(): string {
  return asString(process.env.SMS_GATEWAY_URL)
}

function envGatewayUsername(): string {
  return asString(process.env.SMS_GATEWAY_USERNAME)
}

function envGatewayPassword(): string {
  return asString(process.env.SMS_GATEWAY_PASSWORD)
}

function stripEnvQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function envVonageApiKey(): string {
  return stripEnvQuotes(asString(process.env.VONAGE_API_KEY))
}

function envVonageApiSecret(): string {
  return stripEnvQuotes(asString(process.env.VONAGE_API_SECRET))
}

function envVonageFrom(): string {
  return stripEnvQuotes(asString(process.env.VONAGE_FROM)) || 'Vonage APIs'
}

function toVonageMsisdn(to: string): string {
  return String(to || '').replace(/^\+/, '').replace(/\D/g, '')
}

export function localSmsConfigFromParts(
  publicConfig: Record<string, any> | null | undefined,
  secrets: Record<string, any> | null | undefined,
): LocalSmsGatewayConfig {
  const pub = publicConfig || {}
  const sec = secrets || {}
  return {
    apiEndpoint: asString(pub.api_endpoint) || envGatewayUrl(),
    apiUsername: asString(pub.api_username) || envGatewayUsername(),
    apiPassword: asString(sec.api_password || pub.api_password) || envGatewayPassword(),
    senderId: asString(pub.sender_id),
    smsType: asString(pub.sms_type) || 'transactional',
    httpMethod: asString(pub.http_method) || 'GET',
    requestFormat: asString(pub.request_format) || 'query',
  }
}

function envOnlySmsConfig(): LocalSmsGatewayConfig | null {
  const apiUsername = envGatewayUsername()
  const apiPassword = envGatewayPassword()
  const apiEndpoint = envGatewayUrl()
  if (!apiUsername || !apiPassword || !apiEndpoint) return null
  return { apiEndpoint, apiUsername, apiPassword }
}

function withEnvGatewayFallback(config: LocalSmsGatewayConfig): LocalSmsGatewayConfig {
  return {
    ...config,
    apiEndpoint: envGatewayUrl() || asString(config.apiEndpoint),
    apiUsername: envGatewayUsername() || asString(config.apiUsername),
    apiPassword: envGatewayPassword() || asString(config.apiPassword),
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

function describeGatewayFetchError(error: any, endpoint?: string): string {
  if (error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError') {
    return 'SMS gateway request timed out. The tunnel may be down or too slow.'
  }
  const cause = error?.cause
  const code = String(cause?.code || cause?.cause?.code || error?.code || '')
  const causeMessage = String(cause?.message || cause?.cause?.message || '').trim()
  const host = (() => {
    try { return endpoint ? new URL(endpoint).host : '' } catch { return '' }
  })()
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /getaddrinfo/i.test(causeMessage)) {
    return `Cannot resolve SMS gateway host${host ? ` (${host})` : ''}. Check SMS_GATEWAY_URL — trycloudflare tunnels expire and need a new URL.`
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)
    || /connection.*closed|fetch failed/i.test(`${error?.message || ''} ${causeMessage}`)) {
    return `Cannot reach SMS gateway${host ? ` (${host})` : ''}. Start the Android SMS app and Cloudflare tunnel, then update SMS_GATEWAY_URL if the hostname changed.`
  }
  const detail = [error?.message, causeMessage].filter(Boolean).join(' — ')
  return detail && detail !== 'fetch failed'
    ? `Failed to reach SMS gateway: ${detail}`
    : `Failed to reach SMS gateway${host ? ` (${host})` : ''}.`
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
    const parsed = unwrapGatewayPayload(JSON.parse(trimmed))
    const id = parsed?.message_id || parsed?.messageId || parsed?.id || parsed?.msgid
    return id != null && String(id).trim() ? String(id) : null
  } catch {
    return null
  }
}

function extractExternalId(payload: any): string | null {
  const parsed = unwrapGatewayPayload(payload)
  const id = parsed?.external_id || parsed?.externalId
  return id != null && String(id).trim() ? String(id) : null
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export function isAndroidSmsGateEndpoint(endpoint: string): boolean {
  const lower = endpoint.toLowerCase()
  return lower.includes('/api/v1/messages') || lower.includes('trycloudflare.com')
}

export function localSmsMessagesUrl(config: LocalSmsGatewayConfig): string {
  const endpoint = asString(config.apiEndpoint).replace(/\/+$/, '')
  if (/\/api\/v1\/messages$/i.test(endpoint)) return endpoint
  try {
    return `${new URL(endpoint).origin}/api/v1/messages`
  } catch {
    return `${endpoint}/api/v1/messages`
  }
}

export function localSmsMessageStatusUrl(config: LocalSmsGatewayConfig, messageId: string): string {
  return `${localSmsMessagesUrl(config)}/${encodeURIComponent(messageId)}`
}

function unwrapGatewayPayload(payload: any): any {
  if (Array.isArray(payload)) return payload[0] || payload
  if (Array.isArray(payload?.data)) return payload.data[0] || payload
  if (payload?.data && typeof payload.data === 'object') return payload.data
  if (payload?.message && typeof payload.message === 'object' && !Array.isArray(payload.message)) {
    return { ...payload, ...payload.message }
  }
  return payload
}

function stateFromStatesMap(states: any): string {
  if (!states || typeof states !== 'object' || Array.isArray(states)) return ''
  const keys = Object.keys(states).filter((key) => states[key] != null && states[key] !== '')
  for (const rank of ['Failed', 'Delivered', 'Sent', 'Processed', 'Pending']) {
    const hit = keys.find((key) => key.toLowerCase() === rank.toLowerCase())
    if (hit) return hit
  }
  return keys[keys.length - 1] || ''
}

function pickGatewayState(payload: any): string {
  const body = unwrapGatewayPayload(payload)
  const recipient = Array.isArray(body?.recipients) ? body.recipients[0] : null
  const candidates = [
    body?.state,
    body?.status,
    body?.deliveryStatus,
    body?.delivery_status,
    body?.message_status,
    body?.messageStatus,
    recipient?.state,
    recipient?.status,
    recipient?.deliveryStatus,
    stateFromStatesMap(body?.states),
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() && !/^\d+$/.test(value.trim())) {
      return value.trim()
    }
  }
  return ''
}

export function mapSmsGatewayState(raw: string): SmsDeliveryStatus {
  const state = raw.toLowerCase().replace(/[_-]+/g, '')
  if (['delivered', 'delivery', 'completed', 'success', 'delivrd'].includes(state)) return 'delivered'
  if (['failed', 'fail', 'undelivered', 'error', 'canceled', 'cancelled', 'rejected', 'expired', 'undeliv'].includes(state)) {
    return 'failed'
  }
  if (['sent', 'processed', 'pending', 'accepted', 'queued'].includes(state)) return 'sent'
  return 'sent'
}

function gatewayErrorMessage(payload: any, fallback?: string): string | null {
  const recipient = Array.isArray(payload?.recipients) ? payload.recipients[0] : null
  const message = asString(payload?.error || payload?.message || recipient?.error)
  if (message && !/^ok$/i.test(message) && !/success/i.test(message)) return message
  return fallback || null
}

async function sendViaAndroidSmsGate(
  config: LocalSmsGatewayConfig,
  toE164: string,
  text: string,
): Promise<SmsSendResult> {
  const resolved = withEnvGatewayFallback(config)
  const username = asString(resolved.apiUsername)
  const password = asString(resolved.apiPassword)
  const url = localSmsMessagesUrl(resolved)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(username, password),
    },
    body: JSON.stringify({
      to: toE164,
      message: text,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.text()
  let parsed: any = null
  try { parsed = JSON.parse(body) } catch { /* plain text gateway */ }

  const messageId = extractMessageId(body)
  const externalId = extractExternalId(parsed)
  const gatewayStatus = pickGatewayState(parsed) || asString(unwrapGatewayPayload(parsed)?.status)
  const providerResponse = {
    status: response.status,
    body: truncateBody(body),
    message_id: messageId,
    external_id: externalId,
    gateway_status: gatewayStatus || null,
  }

  if (response.status !== 200 || !messageId) {
    const errorText = gatewayErrorMessage(parsed) || truncateBody(body) || 'empty response'
    return {
      success: false,
      messageId,
      externalId,
      gatewayStatus,
      error: response.status !== 200
        ? `SMS gateway returned HTTP ${response.status}: ${errorText}`
        : 'SMS gateway did not return a valid message_id',
      providerResponse,
    }
  }

  return {
    success: true,
    messageId,
    externalId,
    gatewayStatus: gatewayStatus || 'accepted',
    providerResponse,
  }
}

export async function fetchLocalSmsMessageStatus(
  config: LocalSmsGatewayConfig,
  messageId: string,
): Promise<{ status: SmsDeliveryStatus; raw?: any; error?: string }> {
  const id = asString(messageId)
  if (!id) return { status: 'sent', error: 'Missing gateway message id' }
  const resolved = withEnvGatewayFallback(config)

  try {
    const response = await fetch(localSmsMessageStatusUrl(resolved, id), {
      method: 'GET',
      headers: {
        Authorization: basicAuthHeader(asString(resolved.apiUsername), asString(resolved.apiPassword)),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.text()
    let parsed: any = null
    try { parsed = JSON.parse(body) } catch { parsed = { body: truncateBody(body) } }

    const gatewayState = pickGatewayState(parsed) || pickGatewayState({ body })
    const mapped = response.ok ? mapSmsGatewayState(gatewayState || body) : 'sent'
    console.log(`[SMS status] id=${id} http=${response.status} gateway=${gatewayState || 'n/a'} mapped=${mapped}`)

    if (!response.ok) {
      return {
        status: 'sent',
        raw: parsed,
        error: `Status lookup returned ${response.status}: ${truncateBody(body)}`,
      }
    }

    return {
      status: mapped,
      raw: parsed,
      error: mapped === 'failed' ? (gatewayErrorMessage(unwrapGatewayPayload(parsed), 'SMS delivery failed') || undefined) : undefined,
    }
  } catch (error: any) {
    return {
      status: 'sent',
      error: error?.message || 'Failed to query SMS gateway status',
    }
  }
}

async function loadActiveSmsConfigs(supabase: SupabaseLikeClient): Promise<Map<string, LocalSmsGatewayConfig>> {
  const { data } = await supabase
    .from('notification_provider_configs')
    .select('*')
    .eq('channel', 'sms')
    .eq('is_active', true)
    .eq('provider_name', LOCAL_MY_SMS_PROVIDER)
    .order('created_at', { ascending: false })

  const configs = new Map<string, LocalSmsGatewayConfig>()
  for (const row of data || []) {
    if (!row?.org_id || configs.has(row.org_id)) continue
    const publicConfig = (row.config_public && typeof row.config_public === 'object')
      ? row.config_public as Record<string, any>
      : {}
    configs.set(row.org_id, withEnvGatewayFallback(localSmsConfigFromParts(publicConfig, parseSmsProviderSecrets(row.config_encrypted))))
  }
  return configs
}

export type RefreshOpenSmsStatusesOptions = {
  /** How many gateway status checks may run at once. Default 5. */
  concurrency?: number
  /**
   * Hard wall-clock budget for the whole call, in ms. Once it elapses, no new checks are
   * started and the function returns with whatever it has -- checks already in flight keep
   * running in the background and still write their result to the DB when they finish, but
   * the caller is never held up past this budget. Default 20s (safe for the background cron
   * worker); pass a much smaller value (e.g. 8000) when this is called from an interactive
   * "refresh now" button so a dead gateway can't stall the request.
   */
  overallTimeoutMs?: number
}

export async function refreshOpenSmsStatuses(
  supabase: SupabaseLikeClient,
  limit = 40,
  options: RefreshOpenSmsStatusesOptions = {},
): Promise<{ checked: number; updated: number; timedOut: boolean }> {
  const concurrency = Math.max(1, options.concurrency ?? 5)
  const overallTimeoutMs = Math.max(1000, options.overallTimeoutMs ?? 20_000)

  const configs = await loadActiveSmsConfigs(supabase)
  const fallbackConfig = (configs.values().next().value as LocalSmsGatewayConfig | undefined)
    || envOnlySmsConfig()
  if (!fallbackConfig) return { checked: 0, updated: 0, timedOut: false }

  const { data: logs, error } = await supabase
    .from('notification_logs')
    .select('id, org_id, outbox_id, status, provider_message_id, provider_response')
    .eq('channel', 'sms')
    .in('status', ['sent', 'pending', 'queued', 'accepted', 'processed'])
    .not('provider_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !logs?.length) return { checked: 0, updated: 0, timedOut: false }

  const eligible = logs.filter((log: any) => {
    const current = String(log.status || '').toLowerCase()
    return !SMS_FINAL_STATUSES.includes(current as typeof SMS_FINAL_STATUSES[number]) && asString(log.provider_message_id)
  })

  let checked = 0
  let updated = 0
  let cursor = 0
  let timedOut = false
  const deadline = Date.now() + overallTimeoutMs

  async function checkOne(log: (typeof eligible)[number]) {
    checked++
    const messageId = asString(log.provider_message_id)
    const config = configs.get(log.org_id) || fallbackConfig
    const result = await fetchLocalSmsMessageStatus(config, messageId)

    if (result.status !== 'delivered' && result.status !== 'failed') {
      if (result.raw || result.error) {
        await supabase.from('notification_logs').update({
          provider_response: result.raw || { error: result.error },
          status_details: result.error || pickGatewayState(result.raw) || String(log.status),
        }).eq('id', log.id)
      }
      return
    }

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      status: result.status,
      provider_response: result.raw || log.provider_response || null,
      status_details: result.status,
    }
    if (result.status === 'delivered') {
      patch.delivered_at = now
      patch.error_message = null
    } else {
      patch.failed_at = now
      patch.error_message = result.error || 'SMS delivery failed'
    }

    await supabase.from('notification_logs').update(patch).eq('id', log.id)
    if (log.outbox_id) {
      await supabase.from('notifications_outbox').update({
        status: result.status,
        error: result.status === 'failed' ? (result.error || 'SMS delivery failed') : null,
      }).eq('id', log.outbox_id)
    }
    updated++
  }

  async function worker() {
    while (cursor < eligible.length) {
      if (Date.now() >= deadline) {
        timedOut = true
        return
      }
      const log = eligible[cursor++]
      await checkOne(log)
    }
  }

  // Bounded-concurrency pool capped to an overall wall-clock budget: a dead/slow gateway can
  // never block the caller for longer than overallTimeoutMs, no matter how many open messages
  // there are or how long each individual gateway call takes to time out.
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(concurrency, eligible.length) }, worker)),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve() }, overallTimeoutMs)),
  ])

  return { checked, updated, timedOut }
}

export async function sendLocalMalaysianSms(
  config: LocalSmsGatewayConfig,
  to: string,
  message: string,
): Promise<SmsSendResult> {
  config = withEnvGatewayFallback(config)
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

  if (isAndroidSmsGateEndpoint(endpoint)) {
    try {
      return await sendViaAndroidSmsGate(config, phone.e164, text)
    } catch (error: any) {
      return { success: false, error: describeGatewayFetchError(error, endpoint) }
    }
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
    return { success: false, error: describeGatewayFetchError(error, endpoint) }
  }
}

export async function sendVonageSms(input: {
  apiKey?: string
  apiSecret?: string
  from?: string
  to: string
  text: string
}): Promise<SmsSendResult> {
  const apiKey = envVonageApiKey() || asString(input.apiKey)
  const apiSecret = envVonageApiSecret() || asString(input.apiSecret)
  const from = asString(input.from) || envVonageFrom()
  const text = asString(input.text)
  const to = toVonageMsisdn(input.to)

  if (!apiKey) return { success: false, error: 'Vonage API key is missing. Set VONAGE_API_KEY in .env.' }
  if (!apiSecret) return { success: false, error: 'Vonage API secret is missing. Set VONAGE_API_SECRET in .env.' }
  if (!to) return { success: false, error: 'Vonage SMS recipient is required' }
  if (!text) return { success: false, error: 'SMS message body is required' }

  try {
    const { Vonage } = await import('@vonage/server-sdk')
    const { Channels } = await import('@vonage/messages')
    const vonage = new Vonage({ apiKey, apiSecret })
    const result = await vonage.messages.send({
      messageType: 'text',
      channel: Channels.SMS,
      text,
      to,
      from,
    } as any)
    const messageUUID = asString((result as any)?.messageUUID || (result as any)?.message_uuid)
    if (!messageUUID) {
      return {
        success: false,
        error: 'Vonage did not return a messageUUID',
        providerResponse: result as any,
      }
    }
    return {
      success: true,
      messageId: messageUUID,
      gatewayStatus: 'accepted',
      providerName: VONAGE_SMS_PROVIDER,
      providerResponse: { messageUUID, to, from },
    }
  } catch (error: any) {
    const detail = error?.response?.data || error?.body || error?.message || 'Vonage request failed'
    return {
      success: false,
      error: `Vonage SMS failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
      providerResponse: { status: error?.status || error?.response?.status, body: truncateBody(String(typeof detail === 'string' ? detail : JSON.stringify(detail))) },
    }
  }
}

function firstRow<T>(data: T | T[] | null | undefined): T | null {
  if (!data) return null
  return Array.isArray(data) ? (data[0] || null) : data
}

/** Active SMS config for this org, then HQ — avoids maybeSingle() failing when two rows exist. */
export async function loadActiveSmsProviderConfig(
  supabase: SupabaseLikeClient,
  orgId: string,
): Promise<any | null> {
  const loadForOrg = async (id: string) => {
    const { data } = await supabase
      .from('notification_provider_configs')
      .select('*')
      .eq('org_id', id)
      .eq('channel', 'sms')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
    return firstRow(data)
  }

  const local = await loadForOrg(orgId)
  if (local) return local

  const { data: hq } = await supabase
    .from('organizations')
    .select('id')
    .eq('org_type_code', 'HQ')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  const hqId = firstRow(hq)?.id
  if (hqId && String(hqId) !== String(orgId)) {
    const hqConfig = await loadForOrg(String(hqId))
    if (hqConfig) return hqConfig
  }

  return null
}

export async function sendSmsWithActiveProvider(
  supabase: SupabaseLikeClient,
  orgId: string,
  to: string,
  message: string,
): Promise<SmsSendResult> {
  const config = await loadActiveSmsProviderConfig(supabase, orgId)

  if (!config) {
    return { success: false, error: 'SMS provider not configured' }
  }

  const publicConfig = (config.config_public && typeof config.config_public === 'object')
    ? config.config_public as Record<string, any>
    : {}
  const secrets = parseSmsProviderSecrets(config.config_encrypted)

  if (config.provider_name === VONAGE_SMS_PROVIDER) {
    return sendVonageSms({
      apiKey: asString(secrets.api_key || publicConfig.api_key),
      apiSecret: asString(secrets.api_secret || publicConfig.api_secret),
      from: asString(publicConfig.from_number),
      to,
      text: message,
    })
  }

  if (config.provider_name !== LOCAL_MY_SMS_PROVIDER) {
    return {
      success: false,
      error: `SMS provider ${config.provider_name} is not implemented. Only Local Malaysian Provider and Vonage are supported.`,
    }
  }

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
    providerName?: string
  },
): Promise<void> {
  const now = new Date().toISOString()
  const success = Boolean(input.result.success)
  const status = success ? 'sent' : 'failed'
  const providerName = asString(input.result.providerName)
    || asString(input.providerName)
    || (success ? LOCAL_MY_SMS_PROVIDER : null)

  if (input.outboxId) {
    await supabase.from('notifications_outbox').update({
      status,
      sent_at: success ? now : null,
      error: success ? null : (input.result.error || 'SMS delivery failed'),
      provider_name: providerName,
      provider_message_id: input.result.messageId || null,
    }).eq('id', input.outboxId)

    const { data: existingLog } = await supabase
      .from('notification_logs')
      .select('id')
      .eq('outbox_id', input.outboxId)
      .limit(1)
    if (existingLog?.length) {
      await supabase.from('notification_logs').update({
        status,
        recipient_value: input.to,
        provider_message_id: input.result.messageId || null,
        provider_response: input.result.providerResponse || null,
        error_message: success ? null : (input.result.error || 'SMS delivery failed'),
        sent_at: success ? now : null,
        failed_at: success ? null : now,
      }).eq('id', existingLog[0].id)
      return
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
    provider_name: providerName,
    provider_message_id: input.result.messageId || null,
    provider_response: input.result.providerResponse || null,
    error_message: success ? null : (input.result.error || 'SMS delivery failed'),
    queued_at: now,
    sent_at: success ? now : null,
    failed_at: success ? null : now,
    created_at: now,
  })
}

export function mapSmsWebhookEvent(event: string, fallbackStatus?: string): SmsDeliveryStatus | null {
  const raw = `${event || ''} ${fallbackStatus || ''}`.toLowerCase()
  if (raw.includes('sms:delivered') || raw.includes('delivered')) return 'delivered'
  if (raw.includes('sms:failed') || raw.includes('failed')) return 'failed'
  if (raw.includes('sms:sent') || /\bsent\b/.test(raw)) return 'sent'
  return null
}

export async function applySmsGatewayWebhook(
  supabase: SupabaseLikeClient,
  payload: any,
): Promise<{ updated: number; status: SmsDeliveryStatus | null; messageId: string | null }> {
  const body = unwrapGatewayPayload(payload) || {}
  const event = asString(payload?.event || payload?.type || payload?.event_type || body?.event || body?.type)
  const messageId = asString(
    body?.message_id || body?.messageId || payload?.message_id || payload?.messageId || body?.id,
  )
  const externalId = asString(
    body?.external_id || body?.externalId || payload?.external_id || payload?.externalId,
  )
  const mapped = mapSmsWebhookEvent(event, pickGatewayState(body) || asString(body?.status))
  if (!mapped || (!messageId && !externalId)) {
    return { updated: 0, status: mapped, messageId: messageId || externalId || null }
  }

  const ids = Array.from(new Set([messageId, externalId].filter(Boolean)))
  const { data: logs } = await supabase
    .from('notification_logs')
    .select('id, outbox_id, status, provider_message_id, provider_response')
    .eq('channel', 'sms')
    .in('provider_message_id', ids)
    .order('created_at', { ascending: false })
    .limit(20)

  const now = new Date().toISOString()
  let updated = 0
  for (const log of logs || []) {
    const current = String(log.status || '').toLowerCase()
    if (SMS_FINAL_STATUSES.includes(current as typeof SMS_FINAL_STATUSES[number])) continue
    if (current === mapped) continue

    const patch: Record<string, unknown> = {
      status: mapped,
      provider_response: {
        ...(log.provider_response && typeof log.provider_response === 'object' ? log.provider_response : {}),
        webhook: payload,
        message_id: messageId || log.provider_message_id,
        external_id: externalId || extractExternalId(log.provider_response),
        gateway_status: mapped,
      },
      status_details: event || mapped,
    }
    if (mapped === 'sent') {
      patch.sent_at = now
      patch.error_message = null
    } else if (mapped === 'delivered') {
      patch.delivered_at = now
      patch.error_message = null
    } else {
      patch.failed_at = now
      patch.error_message = gatewayErrorMessage(body, 'SMS delivery failed')
    }

    await supabase.from('notification_logs').update(patch).eq('id', log.id)
    if (log.outbox_id) {
      await supabase.from('notifications_outbox').update({
        status: mapped,
        error: mapped === 'failed' ? (patch.error_message as string) : null,
      }).eq('id', log.outbox_id)
    }
    updated++
  }

  return { updated, status: mapped, messageId: messageId || externalId || null }
}
