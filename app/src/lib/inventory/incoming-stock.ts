/**
 * Incoming / On Order stock — business rules.
 *
 * Incoming Stock = SUM of GREATEST(ordered − received, 0) over confirmed
 * H2M (HQ → Manufacturer) orders, scoped by company, destination warehouse
 * and product variant.
 *
 * These pure functions mirror the SQL in
 * supabase/migrations/20260716_incoming_stock_on_order_06.sql
 * (v_incoming_stock / v_incoming_stock_detail). The database views are the
 * runtime source of truth; this module encodes the same rules for UI
 * decision-making and for unit tests. Keep the two in sync.
 *
 * Received source of truth: warehouse_receipt_items (partial receiving).
 * Two receipt flows never write receipt items and must be zeroed explicitly:
 *  - "Receive All" posts only a warehouse_receipts header (receipt_type='full').
 *  - Legacy/QR-only receives (before receipt tables existed) completed the
 *    qr_batches receiving flow without any receipt rows.
 */

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'closed'
  | 'cancelled'
  | 'warehouse_packed'
  | 'shipped_distributor'

export type OrderType = 'H2M' | 'D2H' | 'S2D'

/** Statuses that represent a confirmed order to the manufacturer. */
export const INCOMING_CONFIRMED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'approved',
  // 'closed' means fully PAID, not fully received — goods may still be inbound.
  // Fully received orders self-zero via GREATEST(ordered − received, 0).
  'closed',
])

export interface IncomingOrderLine {
  company_id: string
  /** Destination warehouse resolved the same way warehouse receiving resolves it. */
  destination_warehouse_org_id: string
  variant_id: string
  order_type: OrderType
  status: OrderStatus
  ordered_qty: number
  /** SUM(warehouse_receipt_items.received_now) for this order + variant. */
  received_qty: number
  /** A posted warehouse_receipts row with receipt_type='full' exists for the order. */
  full_receipt_posted: boolean
  /**
   * The order has NO warehouse_receipt_items at all and its QR batch finished
   * receiving (receiving_completed_at set) — a legacy/QR-only full receive.
   */
  legacy_qr_completed: boolean
}

/** Remaining incoming for one order line: GREATEST(ordered − received, 0). */
export function clampIncoming(orderedQty: number, receivedQty: number): number {
  return Math.max(0, (orderedQty || 0) - (receivedQty || 0))
}

/**
 * Incoming contribution of a single order line after all business rules.
 * Returns 0 for anything that must not count.
 */
export function computeLineIncoming(line: IncomingOrderLine): number {
  if (line.order_type !== 'H2M') return 0
  if (!INCOMING_CONFIRMED_STATUSES.has(line.status)) return 0
  if (line.full_receipt_posted) return 0
  if (line.legacy_qr_completed) return 0
  return clampIncoming(line.ordered_qty, line.received_qty)
}

export interface IncomingAggregate {
  company_id: string
  destination_warehouse_org_id: string
  variant_id: string
  incoming_qty: number
  open_order_count: number
}

/**
 * Aggregate order lines into per company + warehouse + variant incoming totals.
 * Lines contributing 0 are dropped so fully received orders disappear.
 */
export function aggregateIncoming(lines: IncomingOrderLine[]): IncomingAggregate[] {
  const buckets = new Map<string, IncomingAggregate>()
  for (const line of lines) {
    const qty = computeLineIncoming(line)
    if (qty <= 0) continue
    const key = `${line.company_id}|${line.destination_warehouse_org_id}|${line.variant_id}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.incoming_qty += qty
      bucket.open_order_count += 1
    } else {
      buckets.set(key, {
        company_id: line.company_id,
        destination_warehouse_org_id: line.destination_warehouse_org_id,
        variant_id: line.variant_id,
        incoming_qty: qty,
        open_order_count: 1,
      })
    }
  }
  return Array.from(buckets.values())
}

export type ReplenishmentDecisionCode =
  | 'normal'
  | 'reorder_required'
  | 'replenishment_incoming'
  | 'additional_reorder_required'

export interface ReplenishmentDecision {
  code: ReplenishmentDecisionCode
  label: string
  /** Available + Incoming */
  inventoryPosition: number
  /** True when a new manufacturer order should be raised. */
  reorderNeeded: boolean
  /** True when physical available stock is at/below the reorder point. */
  lowStock: boolean
}

/**
 * Replenishment decision matrix. Low Stock is never hidden: when available is
 * at/below the reorder point the decision is always a warning state, even if
 * enough stock is already on order.
 *
 *  - Available > RP                                → Normal
 *  - Available ≤ RP, Incoming = 0                  → Reorder Required
 *  - Available ≤ RP, Incoming > 0, Position > RP   → Low Stock — Replenishment Incoming
 *  - Available ≤ RP, Position ≤ RP                 → Additional Reorder Required
 */
export function getReplenishmentDecision(
  available: number,
  incoming: number,
  reorderPoint: number
): ReplenishmentDecision {
  const inventoryPosition = (available || 0) + (incoming || 0)

  if (available > reorderPoint) {
    return { code: 'normal', label: 'Normal', inventoryPosition, reorderNeeded: false, lowStock: false }
  }
  if (incoming <= 0) {
    return { code: 'reorder_required', label: 'Reorder Required', inventoryPosition, reorderNeeded: true, lowStock: true }
  }
  if (inventoryPosition > reorderPoint) {
    return {
      code: 'replenishment_incoming',
      label: 'Low Stock — Replenishment Incoming',
      inventoryPosition,
      reorderNeeded: false,
      lowStock: true,
    }
  }
  return {
    code: 'additional_reorder_required',
    label: 'Additional Reorder Required',
    inventoryPosition,
    reorderNeeded: true,
    lowStock: true,
  }
}

// ─── Warehouse transfer incoming (migration 07) ────────────────────────────

export type TransferStatus = 'pending' | 'in_transit' | 'received' | 'cancelled'

export interface IncomingTransferLine {
  company_id: string
  source_warehouse_org_id: string
  destination_warehouse_org_id: string
  variant_id: string
  status: TransferStatus
  quantity: number
  /**
   * The destination transfer_in stock movement has been posted. The current
   * transfer creation flow posts it immediately, which means the quantity is
   * already inside destination On Hand — counting it again would double count.
   */
  destination_posted: boolean
}

/**
 * Incoming contribution of one transfer line after all business rules.
 * Mirrors v_incoming_transfers_detail in migration 07.
 */
export function computeTransferLineIncoming(line: IncomingTransferLine): number {
  if (line.status !== 'in_transit') return 0
  if (line.destination_posted) return 0
  if (line.source_warehouse_org_id === line.destination_warehouse_org_id) return 0
  return Math.max(0, line.quantity || 0)
}

/**
 * Aggregate transfer lines per company + destination warehouse + variant.
 * Incoming is attributed to the DESTINATION warehouse only — never the source.
 */
export function aggregateTransferIncoming(lines: IncomingTransferLine[]): IncomingAggregate[] {
  const buckets = new Map<string, IncomingAggregate>()
  for (const line of lines) {
    const qty = computeTransferLineIncoming(line)
    if (qty <= 0) continue
    const key = `${line.company_id}|${line.destination_warehouse_org_id}|${line.variant_id}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.incoming_qty += qty
      bucket.open_order_count += 1
    } else {
      buckets.set(key, {
        company_id: line.company_id,
        destination_warehouse_org_id: line.destination_warehouse_org_id,
        variant_id: line.variant_id,
        incoming_qty: qty,
        open_order_count: 1,
      })
    }
  }
  return Array.from(buckets.values())
}

/** Row shape of public.v_incoming_stock (see migrations 06 + 07). */
export interface IncomingStockRow {
  company_id: string
  destination_warehouse_org_id: string
  variant_id: string
  /** Total Incoming = manufacturer_incoming_qty + transfer_incoming_qty. */
  incoming_qty: number
  open_order_count: number
  oldest_approved_at: string | null
  has_warehouse_mismatch: boolean
  /** Appended by migration 07 — absent when only migration 06 is applied. */
  manufacturer_incoming_qty?: number
  transfer_incoming_qty?: number
  in_transit_transfer_count?: number
}

export interface IncomingBreakdown {
  manufacturer: number
  transfer: number
  total: number
}

/**
 * Manufacturer/transfer split of a v_incoming_stock row. Backwards compatible
 * with migration 06 (no split columns): everything counts as manufacturer.
 */
export function getIncomingBreakdown(row?: IncomingStockRow | null): IncomingBreakdown {
  if (!row) return { manufacturer: 0, transfer: 0, total: 0 }
  const total = row.incoming_qty ?? 0
  if (typeof row.manufacturer_incoming_qty !== 'number' || typeof row.transfer_incoming_qty !== 'number') {
    return { manufacturer: total, transfer: 0, total }
  }
  return {
    manufacturer: row.manufacturer_incoming_qty,
    transfer: row.transfer_incoming_qty,
    total,
  }
}

/** Row shape of public.v_incoming_transfers_detail (see migration 07). */
export interface IncomingTransferDetailRow {
  company_id: string
  transfer_id: string
  transfer_no: string
  status: TransferStatus
  source_warehouse_org_id: string
  source_warehouse_name: string | null
  destination_warehouse_org_id: string
  destination_warehouse_name: string | null
  variant_id: string
  quantity: number
  dispatched_at: string | null
  received_at: string | null
  destination_posted: boolean
  incoming_qty: number
  excluded_reason: 'destination_already_posted' | null
}

/** Row shape of public.v_incoming_stock_detail (see migration). */
export interface IncomingStockDetailRow {
  company_id: string
  order_id: string
  order_no: string
  display_doc_no: string | null
  order_status: OrderStatus
  approved_at: string | null
  manufacturer_org_id: string | null
  manufacturer_name: string | null
  declared_warehouse_org_id: string | null
  destination_warehouse_org_id: string
  warehouse_mismatch: boolean
  variant_id: string
  product_id: string | null
  ordered_qty: number
  received_qty: number
  incoming_qty: number
  excluded_reason: 'full_receipt_posted' | 'legacy_qr_completed' | null
  qr_stage: string
}

/** Map keyed by `${warehouseOrgId}:${variantId}` for O(1) UI lookups. */
export function buildIncomingMap(rows: IncomingStockRow[]): Map<string, IncomingStockRow> {
  const map = new Map<string, IncomingStockRow>()
  for (const row of rows) {
    map.set(`${row.destination_warehouse_org_id}:${row.variant_id}`, row)
  }
  return map
}

export function incomingKey(warehouseOrgId?: string | null, variantId?: string | null): string {
  return `${warehouseOrgId || ''}:${variantId || ''}`
}

const QR_STAGE_LABELS: Record<string, string> = {
  awaiting_qr_generation: 'Awaiting QR generation',
  qr_generated: 'QR generated',
  packing: 'Manufacturer packing',
  in_transit: 'Shipped / in transit',
  receiving_in_progress: 'Warehouse receiving',
  receiving_completed: 'Receiving completed',
}

export function formatQrStage(stage?: string | null): string {
  if (!stage) return '—'
  return QR_STAGE_LABELS[stage] || stage
}
