/**
 * Collect Points QR lifecycle eligibility.
 *
 * Product decision (2026-08): buffer spare stickers must also award points.
 * Unused / Mode C buffers are therefore treated as valid for Collect Points.
 */

const STANDARD_COLLECT_STATUSES = [
  'received_warehouse',
  'warehouse_packed',
  'shipped_distributor',
  'activated',
  'verified',
  'redeemed',
  'scanned',
] as const

/** Buffer spare / replacement statuses that may award points immediately. */
const BUFFER_COLLECT_STATUSES = [
  'buffer_available',
  'buffer_used',
  'available',
  'created',
  'generated',
  'printed',
  'packed',
] as const

const BLOCKED_COLLECT_STATUSES = [
  'spoiled',
  'revoked',
  'cancelled',
  'destroyed',
  'void',
  'invalid',
] as const

export function isBlockedCollectPointsStatus(status?: string | null): boolean {
  if (!status) return false
  return (BLOCKED_COLLECT_STATUSES as readonly string[]).includes(status)
}

export function isQrEligibleForCollectPoints(input: {
  status?: string | null
  isBuffer?: boolean | null
}): boolean {
  const status = String(input.status || '')
  if (!status) return false
  if (isBlockedCollectPointsStatus(status)) return false

  if ((STANDARD_COLLECT_STATUSES as readonly string[]).includes(status)) {
    return true
  }

  // Manager decision: simplify — buffer stickers award points.
  if (input.isBuffer === true && (BUFFER_COLLECT_STATUSES as readonly string[]).includes(status)) {
    return true
  }

  return false
}

export function getCollectPointsInactiveQrMessage(input: {
  status?: string | null
  isBuffer?: boolean | null
}): string {
  const status = String(input.status || '')

  if (isBlockedCollectPointsStatus(status)) {
    return 'This QR code is no longer valid and cannot be used to collect points.'
  }

  if (input.isBuffer === true) {
    return (
      'This buffer QR cannot be used to collect points in its current state. ' +
      'Please contact support if you believe this is a valid product sticker.'
    )
  }

  return 'QR code is not active or has not been shipped yet'
}

/** @deprecated Prefer isQrEligibleForCollectPoints — kept for older call sites/tests. */
export function isUnpromotedBufferQr(input: {
  status?: string | null
  isBuffer?: boolean | null
}): boolean {
  const status = String(input.status || '')
  return input.isBuffer === true && (status === 'buffer_available' || status === 'available' || status === 'created')
}
