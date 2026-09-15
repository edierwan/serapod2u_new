import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, makeQrCodes, type FakeSupabase } from '@/lib/warehouse/test-utils/fake-supabase'
import { fakePostWarehouseReceipt } from '@/lib/warehouse/test-utils/fake-warehouse-receipt-rpc'
import { resolveConsumerScanStatus } from '@/lib/consumer/qr-scan-eligibility'
import { isQrEligibleForCollectPoints } from '@/lib/consumer/collect-points-qr-status'

/**
 * H2M partial warehouse receiving — end-to-end through the real routes
 * (confirm-receipt → warehouse-receiving-worker → receipt-summary) against an
 * in-memory database. The inventory RPC fake mirrors post_warehouse_receipt:
 * it posts only received_now and rejects receipts on fully received lines.
 *
 * Consumer scanning is evaluated with the same gates the consumer routes use
 * (resolveConsumerScanStatus → isQrEligibleForCollectPoints, and the verify /
 * claim-gift accepted status received_warehouse). QR lifecycle statuses needed
 * by packing and Mode C must stay as they are.
 */

let db: FakeSupabase
let failInventoryPost: string | null

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: (name: string, args: any) => db.rpc(name, args),
    from: (table: string) => db.from(table),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: any) => db.rpc(name, args),
    from: (table: string) => db.from(table),
  }),
}))
vi.mock('@/lib/cron/auth', () => ({ requireCronOrSessionAuth: async () => null }))
vi.mock('@/lib/notifications/supplyChainEventQueue', () => ({ queueNotificationEvent: async () => ({ queued: true }) }))

const ORDER = 'order-1'
const BATCH = 'batch-1'
const GRAPE = 'variant-grape'
const GUAVA = 'variant-guava'

function seed() {
  db = createFakeSupabase(
    {
      organizations: [
        { id: 'hq-1', org_type_code: 'HQ', warranty_bonus: 1 },
        { id: 'wh-1', org_type_code: 'WH', parent_org_id: 'hq-1', is_active: true, created_at: '2026-01-01' },
        { id: 'mfg-1', org_type_code: 'MFG', warranty_bonus: 0.5 },
      ],
      orders: [{ id: ORDER, order_no: 'ORD260001', display_doc_no: 'ORD260001', buyer_org_id: 'hq-1', seller_org_id: 'mfg-1', units_per_case: 100 }],
      order_items: [
        { order_id: ORDER, product_id: 'p-1', variant_id: GRAPE, qty: 600, unit_price: 14, units_per_case: null, products: { product_name: 'Cellera Hero', units_per_case: 1 }, product_variants: { variant_name: 'Grape', product_code: 'GRP' } },
        { order_id: ORDER, product_id: 'p-1', variant_id: GUAVA, qty: 400, unit_price: 14, units_per_case: null, products: { product_name: 'Cellera Hero', units_per_case: 1 }, product_variants: { variant_name: 'Guava', product_code: 'GUA' } },
      ],
      inventory_stock_configurations: [
        { id: 'cfg-grape', variant_id: GRAPE, default_for_ord: true, allow_ord: true, status: 'active', is_variant_default: true, sort_order: 0 },
        { id: 'cfg-guava', variant_id: GUAVA, default_for_ord: true, allow_ord: true, status: 'active', is_variant_default: true, sort_order: 0 },
      ],
      qr_batches: [{
        id: BATCH, company_id: 'co-1', order_id: ORDER, receiving_status: 'idle', receiving_mode: null, created_at: '2026-01-01', created_by: 'user-1',
        total_master_codes: 10, total_unique_codes: 1010,
        orders: { id: ORDER, order_no: 'ORD260001', buyer_org_id: 'hq-1', seller_org_id: 'mfg-1', company_id: 'co-1', order_items: [{ variant_id: GRAPE, unit_price: 14 }, { variant_id: GUAVA, unit_price: 14 }] },
      }],
      qr_master_codes: Array.from({ length: 10 }, (_, i) => ({ id: `m-${i}`, master_code: `M-${i}`, batch_id: BATCH, status: 'ready_to_ship' })),
      // 1,000 ordered cases → 1,000 unique QR + 10 generated buffer QR = 1,010.
      // The manufacturer warranty is 0.5%, so the existing worker moves only 5
      // of the 10 buffer codes to received_warehouse; the other 5 stay spares.
      qr_codes: [
        ...makeQrCodes(BATCH, { count: 600, status: 'ready_to_ship', isBuffer: false, variantId: GRAPE, prefix: 'grape' }),
        ...makeQrCodes(BATCH, { count: 400, status: 'ready_to_ship', isBuffer: false, variantId: GUAVA, prefix: 'guava' }),
        ...makeQrCodes(BATCH, { count: 6, status: 'buffer_available', isBuffer: true, variantId: GRAPE, prefix: 'grape-buf' }),
        ...makeQrCodes(BATCH, { count: 4, status: 'buffer_available', isBuffer: true, variantId: GUAVA, prefix: 'guava-buf' }),
      ].map((qr) => ({ ...qr, order_id: ORDER })),
      warehouse_receipts: [],
      warehouse_receipt_items: [],
      stock_movements: [],
      qr_movements: [],
    },
    {
      post_warehouse_receipt: fakePostWarehouseReceipt(() => db, { fail: () => failInventoryPost }),
      record_stock_movement: (a) => {
        db.tables.stock_movements.push({ movement_type: a.p_movement_type, variant_id: a.p_variant_id, quantity_change: a.p_quantity_change })
        return { data: 'movement-id', error: null }
      },
      get_batch_variant_counts: (a) => {
        const counts = new Map<string, number>()
        for (const r of db.tables.qr_codes) {
          if (r.batch_id === a.p_batch_id && r.status === a.p_status && !r.is_buffer) counts.set(r.variant_id, (counts.get(r.variant_id) || 0) + 1)
        }
        return { data: Array.from(counts, ([variant_id, count]) => ({ variant_id, count })), error: null }
      },
      next_warehouse_receipt_no: () => ({ data: 'WR-ORD260001-01', error: null }),
    },
  )
}

async function confirm(body: Record<string, any>) {
  const { POST } = await import('./route')
  const res = await POST(new NextRequest('http://localhost/api/warehouse/confirm-receipt', {
    method: 'POST', body: JSON.stringify({ order_id: ORDER, batch_id: BATCH, ...body }),
  }))
  return { status: res.status, body: await res.json() }
}

const partial = (grape: number, guava: number, key: string) =>
  confirm({
    receipt_type: 'partial',
    idempotency_key: key,
    items: [
      { variant_id: GRAPE, product_id: 'p-1', received_now: grape },
      { variant_id: GUAVA, product_id: 'p-1', received_now: guava },
    ].filter((i) => i.received_now > 0),
  })

async function runWorker() {
  const { GET } = await import('../../cron/warehouse-receiving-worker/route')
  const res = await GET(new NextRequest('http://localhost/api/cron/warehouse-receiving-worker'))
  return res.json()
}

async function summary() {
  const { GET } = await import('../receipt-summary/route')
  const res = await GET(new NextRequest(`http://localhost/api/warehouse/receipt-summary?order_id=${ORDER}`))
  return res.json()
}

const inventory = () => db.tables.stock_movements.reduce((s, m) => s + m.quantity_change, 0)
const batchRow = () => db.tables.qr_batches[0]
const statusCounts = () => db.tables.qr_codes.reduce<Record<string, number>>((acc, r) => {
  acc[`${r.is_buffer ? 'B' : 'N'}:${r.status}`] = (acc[`${r.is_buffer ? 'B' : 'N'}:${r.status}`] || 0) + 1
  return acc
}, {})

/** How many of the order's QR the consumer scan gates accept right now. */
async function consumerScannable() {
  let collectPoints = 0
  let receivedEquivalent = 0 // verify (received_warehouse trigger) and claim-gift accept received_warehouse
  for (const qr of db.tables.qr_codes) {
    const scanStatus = await resolveConsumerScanStatus(db, qr)
    if (isQrEligibleForCollectPoints({ status: scanStatus, isBuffer: qr.is_buffer })) collectPoints++
    if (scanStatus === 'received_warehouse') receivedEquivalent++
  }
  return { collectPoints, receivedEquivalent }
}

beforeEach(() => {
  failInventoryPost = null
  seed()
})

describe('H2M partial receiving: inventory follows quantity, every order QR becomes scannable', () => {
  it('before any receipt, unique QR are not scannable (existing behaviour)', async () => {
    const scan = await consumerScannable()
    expect(scan.receivedEquivalent).toBe(0)
    // Buffer spares were already Collect-Points eligible by the 2026-08 product decision.
    expect(scan.collectPoints).toBe(10)
  })

  it('A → B → C: 300 / 400 / 300 cases; all 1,010 QR scannable from the first receipt, statuses preserved', async () => {
    // A. First partial receipt — only Grape arrives (multi-variant order, E).
    const first = await partial(300, 0, 'receipt-1')
    expect(first.status).toBe(200)
    expect(inventory()).toBe(300)

    // Scannable immediately after the receipt is posted, before the worker runs.
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })
    expect(statusCounts()).toEqual({ 'N:ready_to_ship': 1000, 'B:buffer_available': 10 })

    await runWorker() // existing QR worker, unchanged
    expect(batchRow().receiving_status).toBe('completed')
    expect(inventory()).toBe(300)
    // Existing transitions only; the remaining buffer spares keep buffer_available for Mode C.
    expect(statusCounts()).toEqual({ 'N:received_warehouse': 1000, 'B:received_warehouse': 5, 'B:buffer_available': 5 })
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })

    let s = await summary()
    expect(s.summary).toMatchObject({ ordered_qty: 1000, inventory_received: 300, remaining_ordered: 700, receipt_status: 'partially_received' })
    expect(s.batch).toMatchObject({ total_qr_codes: 1010, consumer_scan_enabled: true })
    expect(s.items.find((i: any) => i.variant_id === GRAPE)).toMatchObject({ ordered_qty: 600, previously_received: 300, ordered_balance: 300, cases_per_box: 100, pcs_per_case: 4 })

    // B. Second receipt — no worker re-run, no QR writes at all.
    const qrWritesBefore = db.updates.filter((u) => u.table === 'qr_codes').length
    const snapshot = JSON.stringify(db.tables.qr_codes)
    const second = await partial(200, 200, 'receipt-2')
    expect(second.body).toMatchObject({ success: true, qr_worker_triggered: false, qr_already_completed: true })
    expect(db.updates.filter((u) => u.table === 'qr_batches' && u.payload.receiving_status === 'queued')).toHaveLength(1)
    expect(db.updates.filter((u) => u.table === 'qr_codes').length).toBe(qrWritesBefore + /* existing idempotent %-reconcile, 0 rows */ 0)
    expect(JSON.stringify(db.tables.qr_codes)).toBe(snapshot)
    expect(inventory()).toBe(700)
    s = await summary()
    expect(s.summary).toMatchObject({ inventory_received: 700, remaining_ordered: 300, receipt_status: 'partially_received' })

    // C. Final receipt.
    await partial(100, 200, 'receipt-3')
    expect(inventory()).toBe(1000)
    expect(JSON.stringify(db.tables.qr_codes)).toBe(snapshot)
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })
    s = await summary()
    expect(s.summary).toMatchObject({ inventory_received: 1000, remaining_ordered: 0, receipt_status: 'fully_received' })
  })

  it('partial shipment while production continues: unpacked codes become scannable but keep printed/packed', async () => {
    let n = 0
    for (const qr of db.tables.qr_codes) {
      if (!qr.is_buffer && qr.variant_id === GUAVA) qr.status = n++ % 2 ? 'printed' : 'packed'
    }
    await partial(300, 0, 'receipt-1')
    await runWorker()

    const counts = statusCounts()
    expect(counts['N:printed']).toBe(200)
    expect(counts['N:packed']).toBe(200)
    expect(counts['B:buffer_available']).toBe(7) // warranty-% of the 600 received grape only
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })
  })

  it('D: a zero receipt posts nothing and enables no scanning', async () => {
    expect((await partial(0, 0, 'zero')).status).toBe(400)
    expect((await confirm({ receipt_type: 'partial', items: [{ variant_id: GRAPE, received_now: 0 }] })).status).toBe(400)
    expect(db.rpcCalls).toHaveLength(0)
    expect(inventory()).toBe(0)
    expect((await consumerScannable()).receivedEquivalent).toBe(0)
  })

  it('D: a zero-quantity receipt line in the ledger does not open the gate', async () => {
    db.tables.warehouse_receipt_items.push({ order_id: ORDER, variant_id: GRAPE, received_now: 0 })
    expect((await consumerScannable()).receivedEquivalent).toBe(0)
  })

  it('G: a failed inventory posting leaves scanning disabled and QR untouched', async () => {
    failInventoryPost = 'inventory_cutoff_frozen'
    const res = await partial(300, 0, 'will-fail')
    expect(res.status).toBe(500)
    expect(res.body.stage).toBe('inventory_posting')
    expect(batchRow().receiving_status).toBe('idle')
    expect(db.updates.filter((u) => u.table === 'qr_batches' || u.table === 'qr_codes')).toHaveLength(0)
    expect(inventory()).toBe(0)
    expect((await consumerScannable()).receivedEquivalent).toBe(0)

    failInventoryPost = null
    await partial(300, 0, 'will-fail')
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })
  })

  it('never makes spoiled codes scannable', async () => {
    db.tables.qr_codes[0].status = 'spoiled'
    await partial(300, 0, 'receipt-1')
    expect(await consumerScannable()).toEqual({ collectPoints: 1009, receivedEquivalent: 1009 })
  })

  it('allows the remaining warranty buffer after the ordered quantity, then rejects anything more', async () => {
    await partial(600, 0, 'r1')
    await runWorker()
    // Grape: 600 ordered × 0.5% → 3 cases of buffer allowance.
    const over = await partial(4, 0, 'r2')
    expect(over.status).toBe(422)
    expect(over.body.lines[0]).toMatchObject({ max_receive_now: 3, code: 'warehouse_receipt_exceeds_allowed_quantity' })
    expect((await partial(3, 0, 'r3')).status).toBe(200)
    const full = await partial(1, 0, 'r4')
    expect(full.status).toBe(422)
    expect(full.body.code).toBe('warehouse_receipt_order_already_fully_received')
    expect(full.body.error).toContain('Maximum receivable now is 0 cases.')
    expect(inventory()).toBe(603)
  })
})

describe('Receive All (full) flow still works', () => {
  it('posts ordered + warranty-% inventory as before; every generated QR is scannable', async () => {
    const res = await confirm({ receipt_type: 'full', idempotency_key: `full-${BATCH}` })
    expect(res.body).toMatchObject({ success: true, mode: 'full', qr_worker_triggered: true })
    expect(batchRow()).toMatchObject({ receiving_status: 'queued', receiving_mode: 'full' })

    await runWorker()
    expect(batchRow().receiving_status).toBe('completed')
    const additions = db.tables.stock_movements.filter((m) => m.movement_type === 'addition').reduce((s, m) => s + m.quantity_change, 0)
    const bonus = db.tables.stock_movements.filter((m) => m.movement_type === 'warranty_bonus').reduce((s, m) => s + m.quantity_change, 0)
    expect(additions).toBe(1000)
    expect(bonus).toBe(5) // floor(600 × 0.5%) + floor(400 × 0.5%)
    expect(db.tables.qr_master_codes.every((m) => m.status === 'received_warehouse')).toBe(true)
    expect(statusCounts()['B:buffer_available']).toBe(5)
    expect(await consumerScannable()).toEqual({ collectPoints: 1010, receivedEquivalent: 1010 })
  })
})
