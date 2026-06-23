/**
 * Meta (WhatsApp Cloud API) webhook receiver.
 *
 *   GET  /api/webhooks/whatsapp/meta  — subscription handshake (hub.challenge)
 *   POST /api/webhooks/whatsapp/meta  — message + status events
 *
 * This endpoint is UNAUTHENTICATED (Meta calls it directly), so trust is
 * established differently per method:
 *   - GET  validates `hub.verify_token` against the configured Webhook Verify Token.
 *   - POST validates the `X-Hub-Signature-256` HMAC against the provider App Secret.
 *
 * Provider credentials live on `notification_provider_configs.config_encrypted`
 * (a JSON blob of { access_token, app_secret, webhook_verify_token }). We read
 * them with the service-role client because there is no user session here. We
 * never log or return any secret.
 *
 * Delivery-log matching reuses the existing `whatsapp_message_logs` table: the
 * outbound test/notification row stores the Meta WAMID in `external_message_id`,
 * and status webhooks are matched back to it by WAMID.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  verifyChallenge,
  verifyMetaSignature,
  parseStatusUpdates,
  parseInboundMessages,
  extractWabaIds,
  shouldAdvanceStatus,
  type StatusUpdate,
} from '@/lib/whatsapp/meta-webhook'

export const dynamic = 'force-dynamic'

type ProviderSecrets = { access_token?: string; app_secret?: string; webhook_verify_token?: string }
type ProviderConfigRow = {
  id: string
  org_id: string
  config_public: Record<string, any> | null
  config_encrypted: string | null
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

function parseSecrets(row: ProviderConfigRow): ProviderSecrets {
  if (!row.config_encrypted) return {}
  try {
    return typeof row.config_encrypted === 'string'
      ? JSON.parse(row.config_encrypted)
      : (row.config_encrypted as ProviderSecrets)
  } catch {
    return {}
  }
}

async function loadWhatsappConfigs(): Promise<ProviderConfigRow[]> {
  const supabase = serviceClient()
  const { data } = await supabase
    .from('notification_provider_configs')
    .select('id, org_id, config_public, config_encrypted')
    .eq('channel', 'whatsapp')
  return (data as ProviderConfigRow[]) || []
}

// ---------------------------------------------------------------------------
// GET — subscription handshake
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const verifyToken = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const configs = await loadWhatsappConfigs()
  for (const row of configs) {
    const { webhook_verify_token } = parseSecrets(row)
    if (!webhook_verify_token) continue
    const echoed = verifyChallenge({ mode, verifyToken, challenge }, webhook_verify_token)
    if (echoed !== null) {
      // Meta requires the raw challenge echoed back as text/plain.
      return new NextResponse(echoed, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
  }

  return new NextResponse('Forbidden', { status: 403 })
}

// ---------------------------------------------------------------------------
// POST — message + status events
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // Read the RAW body first — signature must be computed over the exact bytes.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Find the provider config for this WABA so we can validate the signature with
  // the matching App Secret. We never trust the body until the signature checks out.
  const wabaIds = extractWabaIds(payload)
  const configs = await loadWhatsappConfigs()
  const matched = configs.find(row => {
    const waba = String(row.config_public?.waba_id || '')
    return waba && wabaIds.includes(waba)
  })

  if (!matched) {
    // Unknown WABA — acknowledge (avoid retries storms) but do nothing.
    console.warn('[meta-webhook] no provider config for WABA', { waba_ids: wabaIds })
    return NextResponse.json({ received: true, matched: false }, { status: 200 })
  }

  const { app_secret } = parseSecrets(matched)
  if (!verifyMetaSignature(rawBody, signature, app_secret)) {
    console.warn('[meta-webhook] signature validation failed', { org_id: matched.org_id })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const supabase = serviceClient()
  const statusUpdates = parseStatusUpdates(payload)
  const inbound = parseInboundMessages(payload)
  let applied = 0

  for (const update of statusUpdates) {
    applied += (await applyStatusUpdate(supabase, matched.org_id, update)) ? 1 : 0
  }

  // Log inbound customer messages (these open the 24h window). Best-effort.
  for (const msg of inbound) {
    try {
      await supabase.from('whatsapp_message_logs').insert({
        tenant_id: matched.org_id,
        action: 'meta_inbound',
        direction: 'inbound',
        phone_e164: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
        external_message_id: msg.wamid,
        status: 'received',
        metadata: { provider: 'whatsapp_business', type: msg.type, received_at: msg.timestamp },
      })
    } catch (err) {
      console.error('[meta-webhook] failed to log inbound message', err)
    }
  }

  return NextResponse.json({
    received: true,
    matched: true,
    statuses: statusUpdates.length,
    applied,
    inbound: inbound.length,
  }, { status: 200 })
}

/**
 * Match a status webhook to its outbound log row by WAMID and advance the status
 * (never regress). Returns true if a row was updated.
 */
async function applyStatusUpdate(
  supabase: ReturnType<typeof serviceClient>,
  orgId: string,
  update: StatusUpdate,
): Promise<boolean> {
  const { data: rows } = await supabase
    .from('whatsapp_message_logs')
    .select('id, status, metadata, error_message')
    .eq('external_message_id', update.wamid)
    .eq('direction', 'outbound')
    .limit(1)

  const row = rows?.[0] as { id: string; status: string | null; metadata: any; error_message: string | null } | undefined
  if (!row) {
    // No matching outbound row (e.g. a message sent before this feature shipped).
    console.warn('[meta-webhook] no outbound row for WAMID', { wamid: update.wamid, status: update.status })
    return false
  }

  if (!shouldAdvanceStatus(row.status, update.status)) return false

  const metadata = (row.metadata && typeof row.metadata === 'object') ? { ...row.metadata } : {}
  const timestamps = { ...(metadata.timestamps || {}) }
  timestamps[update.status] = update.timestamp || new Date().toISOString()
  metadata.timestamps = timestamps
  if (update.status === 'failed') {
    metadata.meta_error = { code: update.errorCode, message: update.errorMessage }
  }

  const patch: Record<string, any> = { status: update.status, metadata }
  if (update.status === 'failed' && update.errorMessage) {
    patch.error_message = update.errorMessage
  }

  const { error } = await supabase.from('whatsapp_message_logs').update(patch).eq('id', row.id)
  if (error) {
    console.error('[meta-webhook] failed to update status', { wamid: update.wamid, error: error.message })
    return false
  }
  return true
}
