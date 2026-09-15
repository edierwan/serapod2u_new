/**
 * In-memory stand-in for public.post_warehouse_receipt used by route tests.
 *
 * Mirrors the SQL function's observable contract:
 *  - idempotent replay by idempotency_key
 *  - per item, in request order: destination resolution → not-ordered →
 *    receive limit (ordered + floor(ordered × warranty %), migration 20260915140000;
 *    `limit: 'legacy'` keeps the pre-limit rule: reject once previous >= ordered)
 *  - posts only received_now, cumulative / extra per line
 *  - all-or-nothing: any raised error leaves every table untouched
 *
 * `rule: 'explicit_only'` reproduces the installed 20260726 behaviour (explicit
 * order-item configuration required); the default reproduces migration
 * 20260915130000 via the shared TypeScript mirror.
 */
import { RECEIPT_CONFIG_ERROR, resolveReceiptStockConfig } from '@/lib/warehouse/receipt-stock-config'
import { receiptLineLimit, receiptLimitErrorCode } from '@/lib/warehouse/receipt-limits'
import type { FakeSupabase } from './fake-supabase'

export interface FakeReceiptRpcOptions {
  rule?: 'explicit_only' | 'resolved'
  limit?: 'legacy' | 'ordered_plus_buffer'
  fail?: () => string | null
}

export function fakePostWarehouseReceipt(getDb: () => FakeSupabase, options: FakeReceiptRpcOptions = {}) {
  return (a: any) => {
    const db = getDb()
    const t = db.tables
    const forced = options.fail?.()
    if (forced) return { data: null, error: { message: forced } }

    const existing = (t.warehouse_receipts || []).find((r) => a.p_idempotency_key && r.idempotency_key === a.p_idempotency_key)
    if (existing) {
      return { data: { receipt_no: existing.receipt_no, total_received: existing.total_received, idempotent_replay: true }, error: null }
    }

    const staged: { item: any; configId: string; source: string; ordered: number; previous: number }[] = []
    for (const item of a.p_items) {
      const variantId = item.variant_id
      const received = Number(item.received_now) || 0
      const orderRows = (t.order_items || []).filter((o) => o.order_id === a.p_order_id && o.variant_id === variantId)
      const priorLines = (t.warehouse_receipt_items || []).filter((r) => r.order_id === a.p_order_id && r.variant_id === variantId)

      let configId: string
      let source: string
      if (options.rule === 'explicit_only') {
        const explicit = Array.from(new Set(orderRows.map((o) => o.stock_config_id).filter(Boolean)))
        const cfg = (t.inventory_stock_configurations || []).find((c) => c.id === explicit[0])
        if (explicit.length !== 1 || !cfg || cfg.variant_id !== variantId || cfg.status !== 'active' || !cfg.allow_ord) {
          return { data: null, error: { message: `${RECEIPT_CONFIG_ERROR}: variant ${variantId}` } }
        }
        configId = explicit[0]
        source = 'order_item'
      } else {
        const movementConfig = new Map((t.stock_movements || []).map((m) => [m.id, m.stock_config_id]))
        const resolution = resolveReceiptStockConfig({
          variantId,
          orderItemConfigIds: orderRows.map((o) => o.stock_config_id),
          previousReceiptConfigIds: priorLines.filter((r) => r.received_now > 0).map((r) => r.stock_config_id || movementConfig.get(r.stock_movement_id) || null),
          configs: t.inventory_stock_configurations || [],
        })
        if (!resolution.ok) return { data: null, error: { message: resolution.error } }
        configId = resolution.stockConfigId
        source = resolution.source
      }

      const ordered = orderRows.reduce((s, o) => s + (o.qty || 0), 0)
      if (ordered <= 0) return { data: null, error: { message: 'warehouse_receipt_variant_not_ordered' } }
      const previous = priorLines.reduce((s, r) => s + (r.received_now || 0), 0)
      if (options.limit === 'legacy') {
        if (received > 0 && previous >= ordered) {
          return { data: null, error: { message: `warehouse_receipt_order_already_fully_received: variant ${variantId}` } }
        }
      } else if (received > 0) {
        const order = (t.orders || []).find((o) => o.id === a.p_order_id)
        const seller = (t.organizations || []).find((org) => org.id === order?.seller_org_id)
        const limit = receiptLineLimit({ orderedQty: ordered, previouslyReceived: previous, warrantyBonusPercent: seller?.warranty_bonus })
        if (previous + received > limit.maxCumulative) {
          const code = receiptLimitErrorCode(limit)
          return { data: null, error: { message: code.endsWith('fully_received') ? `${code}: variant ${variantId}` : `${code}: variant ${variantId} (maximum receivable now ${limit.maxReceiveNow})` } }
        }
      }
      staged.push({ item: { ...item, received_now: received }, configId, source, ordered, previous })
    }

    // Commit.
    t.warehouse_receipts ||= []
    t.warehouse_receipt_items ||= []
    t.stock_movements ||= []
    const receiptNo = `WR-${a.p_order_id}-${String(t.warehouse_receipts.filter((r) => r.order_id === a.p_order_id).length + 1).padStart(2, '0')}`
    const receiptId = `receipt-${t.warehouse_receipts.length + 1}`
    let total = 0
    let extraAdded = 0
    const itemsOut: any[] = []
    for (const { item, configId, source, ordered, previous } of staged) {
      const received = item.received_now
      const cumulative = previous + received
      const extra = Math.max(cumulative - ordered, 0)
      let movementId: string | null = null
      if (received > 0) {
        movementId = `mv-${t.stock_movements.length + 1}`
        t.stock_movements.push({ id: movementId, movement_type: 'addition', reference_id: a.p_order_id, variant_id: item.variant_id, stock_config_id: configId, quantity_change: received })
      }
      t.warehouse_receipt_items.push({
        receipt_id: receiptId, order_id: a.p_order_id, variant_id: item.variant_id, stock_config_id: configId,
        ordered_qty: ordered, previously_received: previous, received_now: received, cumulative_received: cumulative,
        extra_received: extra, stock_movement_id: movementId,
      })
      total += received
      extraAdded += Math.max(extra - Math.max(previous - ordered, 0), 0)
      itemsOut.push({ variant_id: item.variant_id, stock_config_id: configId, stock_config_source: source, cumulative_received: cumulative, extra_received: extra })
    }
    t.warehouse_receipts.push({ id: receiptId, order_id: a.p_order_id, receipt_no: receiptNo, idempotency_key: a.p_idempotency_key, total_received: total })
    return { data: { receipt_id: receiptId, receipt_no: receiptNo, total_received: total, extra_received: extraAdded, items: itemsOut, idempotent_replay: false }, error: null }
  }
}
