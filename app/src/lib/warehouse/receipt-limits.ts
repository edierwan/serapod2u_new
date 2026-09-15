/**
 * H2M warehouse receipt — maximum receivable quantity per order line.
 *
 * One business rule, shared by the Receive screen (usability), the
 * confirm-receipt API (server pre-check) and mirrored exactly inside
 * public.post_warehouse_receipt (migration 20260915140000, authoritative):
 *
 *   buffer allowance      = floor(ordered × manufacturer warranty_bonus % ÷ 100)
 *   maximum cumulative    = ordered + buffer allowance
 *   maximum receive now   = max(maximum cumulative − previously received, 0)
 *
 * All quantities are cases. "ordered" is the sum of order_items.qty for the
 * variant and "previously received" the sum of posted receipt lines — the same
 * values post_warehouse_receipt reads. The warranty % is the manufacturer
 * organisation's warranty_bonus, the value behind "Expected Buffer" and the
 * Receive All warranty posting; buffer already received is consumed because it
 * is part of "previously received".
 */
import { formatCases } from '@/lib/orders/packaging'

export const RECEIPT_EXCEEDS_ALLOWED_ERROR = 'warehouse_receipt_exceeds_allowed_quantity'
export const RECEIPT_FULLY_RECEIVED_ERROR = 'warehouse_receipt_order_already_fully_received'

export interface ReceiptLineLimit {
  orderedQty: number
  previouslyReceived: number
  bufferAllowance: number
  maxCumulative: number
  maxReceiveNow: number
  /** Part of maxReceiveNow still within the ordered quantity. */
  orderedBalance: number
  /** Part of maxReceiveNow that would come from the remaining buffer. */
  remainingBuffer: number
}

const wholeCases = (value: unknown) => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * floor(ordered × percent ÷ 100), exact for warranty_bonus numeric(5,2) — the
 * product is rounded to cents first so binary floating point can never floor
 * 29.0 down to 28 the way plain JavaScript arithmetic would.
 */
export function warrantyBufferAllowance(orderedQty: number, warrantyBonusPercent: number | null | undefined): number {
  const ordered = wholeCases(orderedQty)
  const percent = Number(warrantyBonusPercent)
  if (!ordered || !Number.isFinite(percent) || percent <= 0) return 0
  return Math.floor(Math.round(ordered * percent * 100) / 10000)
}

export function receiptLineLimit(input: {
  orderedQty: number
  previouslyReceived: number
  warrantyBonusPercent: number | null | undefined
}): ReceiptLineLimit {
  const orderedQty = wholeCases(input.orderedQty)
  const previouslyReceived = wholeCases(input.previouslyReceived)
  const bufferAllowance = warrantyBufferAllowance(orderedQty, input.warrantyBonusPercent)
  const maxCumulative = orderedQty + bufferAllowance
  const orderedBalance = Math.max(orderedQty - previouslyReceived, 0)
  const remainingBuffer = Math.max(maxCumulative - Math.max(previouslyReceived, orderedQty), 0)
  return {
    orderedQty,
    previouslyReceived,
    bufferAllowance,
    maxCumulative,
    maxReceiveNow: orderedBalance + remainingBuffer,
    orderedBalance,
    remainingBuffer,
  }
}

/** "Maximum receivable now is 31 cases (30 ordered balance + 1 remaining buffer)." */
export function maxReceivableMessage(limit: ReceiptLineLimit): string {
  const base = `Maximum receivable now is ${formatCases(limit.maxReceiveNow)}`
  return limit.remainingBuffer > 0
    ? `${base} (${limit.orderedBalance.toLocaleString()} ordered balance + ${limit.remainingBuffer.toLocaleString()} remaining buffer).`
    : `${base}.`
}

export function validateReceiveNow(
  receiveNow: number,
  limit: ReceiptLineLimit | null | undefined,
): { valid: true; message: null } | { valid: false; message: string } {
  if (!limit) return { valid: true, message: null }
  const qty = Number(receiveNow) || 0
  return qty <= limit.maxReceiveNow ? { valid: true, message: null } : { valid: false, message: maxReceivableMessage(limit) }
}

/** Server error code for an over-limit line, matching post_warehouse_receipt. */
export function receiptLimitErrorCode(limit: ReceiptLineLimit): string {
  return limit.previouslyReceived >= limit.maxCumulative ? RECEIPT_FULLY_RECEIVED_ERROR : RECEIPT_EXCEEDS_ALLOWED_ERROR
}
