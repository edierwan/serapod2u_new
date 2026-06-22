/**
 * Pure, framework-free helpers for the Meta (WhatsApp Cloud API) webhook receiver.
 *
 * Kept side-effect-free (no DB, no network, no `next/*`) so they can be unit
 * tested directly with fixtures. The route handler in
 * `app/api/webhooks/whatsapp/meta/route.ts` wires these to Supabase.
 *
 * Security notes:
 *  - `verifyMetaSignature` validates Meta's `X-Hub-Signature-256` header (HMAC
 *    SHA-256 of the RAW request body keyed with the app secret) using a
 *    timing-safe comparison.
 *  - `verifyChallenge` validates the GET handshake `hub.verify_token` against the
 *    configured token, again timing-safe.
 *  - Nothing here logs or returns secrets.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

// Lifecycle of an outbound message. `accepted` is our own initial state (Meta
// returned a WAMID); the rest come from Meta status webhooks. Higher rank = later
// in the lifecycle. `failed` is terminal and handled specially.
export const STATUS_RANK = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
} as const

export type MetaMessageStatus = keyof typeof STATUS_RANK

const WEBHOOK_STATUSES: MetaMessageStatus[] = ['accepted', 'sent', 'delivered', 'read', 'failed']

export function isMetaMessageStatus(value: unknown): value is MetaMessageStatus {
  return typeof value === 'string' && (WEBHOOK_STATUSES as string[]).includes(value)
}

/** Constant-time string compare that never throws on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ab.length !== bb.length) {
    // Still run a comparison to keep timing roughly constant, then fail.
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

/** `sha256=<hex>` HMAC of the raw body, exactly as Meta computes it. */
export function computeMetaSignature(rawBody: string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
}

/**
 * Validate Meta's `X-Hub-Signature-256` header against the raw body.
 * Returns false for any missing input rather than throwing.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | null | undefined,
): boolean {
  if (!signatureHeader || !appSecret || typeof rawBody !== 'string') return false
  const expected = computeMetaSignature(rawBody, appSecret)
  return timingSafeEqualStr(expected, signatureHeader)
}

export type ChallengeParams = {
  mode: string | null
  verifyToken: string | null
  challenge: string | null
}

/**
 * Validate the GET subscription handshake. Returns the challenge string to echo
 * back when the verify token matches and mode is `subscribe`, otherwise null.
 */
export function verifyChallenge(params: ChallengeParams, configuredToken: string | null | undefined): string | null {
  if (params.mode !== 'subscribe') return null
  if (!configuredToken || !params.verifyToken) return null
  if (!timingSafeEqualStr(params.verifyToken, configuredToken)) return null
  return params.challenge ?? ''
}

/** Meta sends unix-seconds strings; normalize to ISO-8601 (or null). */
export function metaTimestampToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

export type StatusUpdate = {
  wamid: string
  status: MetaMessageStatus
  timestamp: string | null
  recipient: string | null
  errorCode: number | null
  errorMessage: string | null
}

export type InboundMessage = {
  wamid: string
  from: string
  type: string
  timestamp: string | null
}

type MetaWebhookPayload = {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string }
        statuses?: Array<Record<string, any>>
        messages?: Array<Record<string, any>>
      }
    }>
  }>
}

/** The WABA id Meta puts on `entry[].id` — used to find the matching provider config. */
export function extractWabaIds(payload: MetaWebhookPayload): string[] {
  const ids = (payload?.entry || []).map(e => (e?.id ? String(e.id) : '')).filter(Boolean)
  return Array.from(new Set(ids))
}

/** Flatten all `statuses[]` across entries/changes into typed status updates. */
export function parseStatusUpdates(payload: MetaWebhookPayload): StatusUpdate[] {
  const out: StatusUpdate[] = []
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const st of change?.value?.statuses || []) {
        if (!st?.id || !isMetaMessageStatus(st.status)) continue
        const err = Array.isArray(st.errors) && st.errors.length ? st.errors[0] : null
        out.push({
          wamid: String(st.id),
          status: st.status,
          timestamp: metaTimestampToIso(st.timestamp),
          recipient: st.recipient_id ? String(st.recipient_id) : null,
          errorCode: err && typeof err.code === 'number' ? err.code : null,
          errorMessage: err ? String(err.title || err.message || '').slice(0, 300) || null : null,
        })
      }
    }
  }
  return out
}

/** Flatten all inbound `messages[]` across entries/changes. */
export function parseInboundMessages(payload: MetaWebhookPayload): InboundMessage[] {
  const out: InboundMessage[] = []
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const msg of change?.value?.messages || []) {
        if (!msg?.id) continue
        out.push({
          wamid: String(msg.id),
          from: msg.from ? String(msg.from) : '',
          type: msg.type ? String(msg.type) : 'unknown',
          timestamp: metaTimestampToIso(msg.timestamp),
        })
      }
    }
  }
  return out
}

/**
 * Decide whether an incoming webhook status should overwrite the stored one.
 *  - `failed` is recorded unless already failed (terminal).
 *  - otherwise only advance to a strictly later lifecycle stage, so a late/out-of-order
 *    `sent` can never clobber a `delivered`/`read`, and nothing moves off `failed`.
 */
export function shouldAdvanceStatus(current: string | null | undefined, next: MetaMessageStatus): boolean {
  if (current === 'failed') return false
  if (next === 'failed') return true
  const currentRank = current && current in STATUS_RANK ? STATUS_RANK[current as MetaMessageStatus] : -1
  return STATUS_RANK[next] > currentRank
}
