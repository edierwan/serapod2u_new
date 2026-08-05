import { SERAPP_ORDER_SOURCE_MARKER } from '@/lib/serapp/constants'

/** Default Serapp warehouse-acceptance window. */
export const SERAPP_HOLD_TTL_MS = 60 * 60 * 1000

export type SerappHoldStatus =
  | 'active'
  | 'accepted'
  | 'expired'
  | 'cancelled_by_distributor'

export function computeSerappHoldExpiry(from: Date = new Date(), ttlMs = SERAPP_HOLD_TTL_MS) {
  return new Date(from.getTime() + ttlMs)
}

export function isSerappHoldExpired(expiresAt: string | Date, now: Date = new Date()) {
  const expires = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return expires.getTime() <= now.getTime()
}

export function buildSerappHoldNotes(input: {
  orderNo?: string | null
  warehouseName?: string | null
}) {
  return [
    SERAPP_ORDER_SOURCE_MARKER,
    'Hold window: 1 hour pending warehouse acceptance',
    input.orderNo ? `Order: ${input.orderNo}` : null,
    input.warehouseName ? `Warehouse: ${input.warehouseName}` : null,
  ].filter(Boolean).join('\n')
}

/**
 * Pure decision helper for expiry processing.
 * Only active + past-expiry holds should be expired.
 */
export function shouldExpireSerappHold(hold: {
  status: SerappHoldStatus | string
  expires_at: string | Date
}, now: Date = new Date()) {
  if (hold.status !== 'active') return false
  return isSerappHoldExpired(hold.expires_at, now)
}
