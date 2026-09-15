/**
 * Consumer scan eligibility after warehouse receipt.
 *
 * Warehouse receiving records a QUANTITY, not QR identities. Once an H2M order
 * has its first posted warehouse receipt (> 0), every generated QR of that order
 * — unique and warranty/buffer — must be accepted by the consumer scan flow.
 *
 * QR lifecycle statuses are NOT changed to achieve this: manufacturer packing
 * (printed → packed), Master QR linking and Mode C (buffer_available spares →
 * buffer_used) all depend on those statuses, and a partial shipment can arrive
 * while the rest of the order is still being produced.
 *
 * Instead, consumer scan checks treat a code that is still in a pre-warehouse
 * lifecycle status exactly like `received_warehouse` once the order has been
 * received. No new status and no new DB field: the gate is the existing
 * receipt state —
 *   - a posted `warehouse_receipt_items` line for the order with received_now > 0
 *     (written only by the atomic post_warehouse_receipt RPC), or
 *   - the order's QR batch `receiving_status = 'completed'` (Receive All / legacy).
 *
 * The same rule is mirrored in the consumer_collect_points and
 * consumer_claim_gift database functions
 * (supabase/migrations/20260915120000_consumer_scan_after_first_warehouse_receipt.sql).
 */

/** Existing lifecycle statuses a generated QR can hold before warehouse receipt. */
export const PRE_WAREHOUSE_QR_STATUSES = [
  'generated',
  'printed',
  'packed',
  'ready_to_ship',
  'buffer_available',
  'buffer_used',
  'available',
  'created',
] as const

/** The existing status consumer scan checks already accept after warehouse receipt. */
export const WAREHOUSE_RECEIVED_QR_STATUS = 'received_warehouse'

export function isPreWarehouseQrStatus(status?: string | null): boolean {
  return !!status && (PRE_WAREHOUSE_QR_STATUSES as readonly string[]).includes(status)
}

/**
 * Status a consumer scan check should evaluate. Returns `received_warehouse` for
 * a pre-warehouse code of a received order; otherwise the stored status as-is
 * (spoiled, shipped, redeemed… are never altered).
 */
export function consumerScanStatus(status: string | null | undefined, orderWarehouseReceived: boolean): string | null {
  if (orderWarehouseReceived && isPreWarehouseQrStatus(status)) return WAREHOUSE_RECEIVED_QR_STATUS
  return status ?? null
}

/**
 * Has this order had a successful warehouse receipt? Fails closed (false) on
 * any lookup error so an unreceived order never becomes scannable by accident.
 */
export async function hasOrderWarehouseReceipt(supabase: any, orderId: string | null | undefined): Promise<boolean> {
  if (!orderId) return false

  const { data: receiptLines, error: receiptError } = await supabase
    .from('warehouse_receipt_items')
    .select('id')
    .eq('order_id', orderId)
    .gt('received_now', 0)
    .limit(1)
  if (!receiptError && receiptLines && receiptLines.length > 0) return true

  const { data: completedBatches, error: batchError } = await supabase
    .from('qr_batches')
    .select('id')
    .eq('order_id', orderId)
    .eq('receiving_status', 'completed')
    .limit(1)
  return !batchError && !!completedBatches && completedBatches.length > 0
}

/**
 * Resolve the status for a consumer scan check. The receipt lookup only runs for
 * pre-warehouse codes, so already-received codes cost no extra query.
 */
export async function resolveConsumerScanStatus(
  supabase: any,
  qr: { status?: string | null; order_id?: string | null },
): Promise<string | null> {
  if (!isPreWarehouseQrStatus(qr.status)) return qr.status ?? null
  const received = await hasOrderWarehouseReceipt(supabase, qr.order_id)
  return consumerScanStatus(qr.status, received)
}
