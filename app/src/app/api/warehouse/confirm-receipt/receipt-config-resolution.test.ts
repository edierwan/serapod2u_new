import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, makeQrCodes, type FakeSupabase } from '@/lib/warehouse/test-utils/fake-supabase'
import { fakePostWarehouseReceipt, type FakeReceiptRpcOptions } from '@/lib/warehouse/test-utils/fake-warehouse-receipt-rpc'
import { resolveConsumerScanStatus } from '@/lib/consumer/qr-scan-eligibility'

/**
 * Regression: staging ORD26000024 (ORD-HM-0726-01) — Warehouse Receive failed with
 *   warehouse_receipt_order_item_configuration_missing_or_conflicting: variant 3d13c8ac-…
 *
 * Its Corn line was created 2026-07-07 without order_items.stock_config_id and,
 * being fully received before the 2026-08-01 cut-off, was never linked; the
 * other three lines were linked to 20NB. Earlier receipts (2026-07-07) carry no
 * configuration. The installed RPC requires an explicit configuration, so any
 * receipt touching Corn raised. IDs and quantities below are the staging rows.
 */

let db: FakeSupabase
let rpcOptions: FakeReceiptRpcOptions

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: (name: string, args: any) => db.rpc(name, args),
    from: (table: string) => db.from(table),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: (name: string, args: any) => db.rpc(name, args), from: (table: string) => db.from(table) }),
}))

const ORDER = '3fb0fe41-37d4-493f-8ba3-ca1478c90309'
const BATCH = 'a45d1a49-03b1-486b-8422-ddab514f3491'
const CO = '3d13c8ac-25f1-4859-996e-0d59575e717d' // Corn — the failing line
const CV = 'a43cd2f8-49da-4112-82d2-6f46e73b3516' // Corn Vanilla
const SC = 'f7367fde-922e-44a6-b316-6f91926f0317' // Strawberry Corn
const HA = 'a05da275-3039-44c1-8bd0-432a17e1c169' // Hazelnut

const CFG = {
  CO_20NB: '2e1ca781-4dd1-4a1b-b1a4-c2ec8404e99e',
  CV_20NB: '59766e95-7444-4526-9792-211bb0e6dbb4',
  SC_20NB: '7d10b671-c4e6-4dcd-8cb7-677729dabcbf',
  HA_20NB: '89bb4416-e1de-408c-80a1-bdad70edbcf9',
}

/** The four staging configurations of a Cellera variant after LEGACY-CONFIG-CUTOVER-2026. */
function cellera(variant: string, code: string, id20nb: string) {
  return [
    { id: id20nb, variant_id: variant, config_code: '20NB', stock_sku: `${code}-20NB`, status: 'active', allow_ord: true, default_for_ord: true, is_variant_default: false, requires_repacking_before_sale: false, sort_order: 0 },
    { id: `${variant}-50NB`, variant_id: variant, config_code: '50NB', stock_sku: `${code}-50NB`, status: 'inactive', allow_ord: false, default_for_ord: false, is_variant_default: false, requires_repacking_before_sale: false, sort_order: 1 },
    { id: `${variant}-50OB`, variant_id: variant, config_code: '50OB', stock_sku: `${code}-50OB`, status: 'inactive', allow_ord: false, default_for_ord: false, is_variant_default: false, requires_repacking_before_sale: true, sort_order: 2 },
    { id: `${variant}-UNC`, variant_id: variant, config_code: 'UNCLASSIFIED', stock_sku: `${code}-UNC`, status: 'inactive', allow_ord: false, default_for_ord: false, is_variant_default: true, requires_repacking_before_sale: false, sort_order: 3 },
  ]
}

const product = (name: string, code: string) => ({ products: { product_name: 'Cellera Hero', units_per_case: 1 }, product_variants: { variant_name: `Deluxe Cellera Cartridge [ ${name} ]`, product_code: code } })

function seed() {
  db = createFakeSupabase(
    {
      organizations: [
        { id: 'hq', org_type_code: 'HQ', warranty_bonus: 1 },
        { id: 'wh', org_type_code: 'WH', parent_org_id: 'hq', is_active: true, created_at: '2026-01-01' },
        { id: 'mfg', org_type_code: 'MFG', warranty_bonus: 1 },
      ],
      orders: [{ id: ORDER, order_no: 'ORD-HM-0726-01', display_doc_no: 'ORD26000024', buyer_org_id: 'hq', seller_org_id: 'mfg', units_per_case: 100 }],
      order_items: [
        { order_id: ORDER, product_id: 'p', variant_id: HA, qty: 100, unit_price: 14, stock_config_id: CFG.HA_20NB, ...product('Hazelnut', 'HA') },
        { order_id: ORDER, product_id: 'p', variant_id: CO, qty: 100, unit_price: 14, stock_config_id: null, ...product('Corn', 'CO') },
        { order_id: ORDER, product_id: 'p', variant_id: SC, qty: 100, unit_price: 14, stock_config_id: CFG.SC_20NB, ...product('Strawberry Corn', 'SC') },
        { order_id: ORDER, product_id: 'p', variant_id: CV, qty: 600, unit_price: 14, stock_config_id: CFG.CV_20NB, ...product('Corn Vanilla', 'CV') },
      ],
      inventory_stock_configurations: [
        ...cellera(CO, 'OC', CFG.CO_20NB), ...cellera(CV, 'CV', CFG.CV_20NB), ...cellera(SC, 'SC', CFG.SC_20NB), ...cellera(HA, 'HA', CFG.HA_20NB),
      ],
      qr_batches: [{ id: BATCH, company_id: 'co', order_id: ORDER, receiving_status: 'completed', receiving_mode: 'partial', created_at: '2026-07-07', total_master_codes: 9, total_unique_codes: 990, orders: { id: ORDER, order_no: 'ORD-HM-0726-01', buyer_org_id: 'hq', seller_org_id: 'mfg', company_id: 'co' } }],
      qr_master_codes: [],
      qr_codes: [
        ...makeQrCodes(BATCH, { count: 600, status: 'received_warehouse', isBuffer: false, variantId: CV, prefix: 'cv' }),
        ...makeQrCodes(BATCH, { count: 100, status: 'received_warehouse', isBuffer: false, variantId: CO, prefix: 'co' }),
        ...makeQrCodes(BATCH, { count: 100, status: 'received_warehouse', isBuffer: false, variantId: SC, prefix: 'sc' }),
        ...makeQrCodes(BATCH, { count: 100, status: 'received_warehouse', isBuffer: false, variantId: HA, prefix: 'ha' }),
        ...makeQrCodes(BATCH, { count: 81, status: 'buffer_available', isBuffer: true, variantId: CV, prefix: 'buf' }),
      ].map((qr) => ({ ...qr, order_id: ORDER })),
      // Receipts WR-…-01 / -02 posted 2026-07-07, before configurations existed.
      warehouse_receipts: [
        { id: 'r1', order_id: ORDER, receipt_no: 'WR-ORD-HM-0726-01-01', idempotency_key: '229a9c29', total_received: 320 },
        { id: 'r2', order_id: ORDER, receipt_no: 'WR-ORD-HM-0726-01-02', idempotency_key: '1898c34d', total_received: 160 },
      ],
      warehouse_receipt_items: [
        { receipt_id: 'r1', order_id: ORDER, variant_id: CO, received_now: 100, stock_config_id: null, stock_movement_id: '818973ea' },
        { receipt_id: 'r1', order_id: ORDER, variant_id: SC, received_now: 20, stock_config_id: null, stock_movement_id: '5e593c78' },
        { receipt_id: 'r1', order_id: ORDER, variant_id: CV, received_now: 200, stock_config_id: null, stock_movement_id: '88a22ebf' },
        { receipt_id: 'r2', order_id: ORDER, variant_id: SC, received_now: 50, stock_config_id: null, stock_movement_id: '591437e7' },
        { receipt_id: 'r2', order_id: ORDER, variant_id: CV, received_now: 100, stock_config_id: null, stock_movement_id: 'd2ffbdbb' },
        { receipt_id: 'r2', order_id: ORDER, variant_id: HA, received_now: 10, stock_config_id: null, stock_movement_id: '598f2830' },
      ],
      stock_movements: [
        { id: '818973ea', variant_id: CO, stock_config_id: null, quantity_change: 100, reference_id: ORDER, movement_type: 'addition' },
        { id: '5e593c78', variant_id: SC, stock_config_id: null, quantity_change: 20, reference_id: ORDER, movement_type: 'addition' },
        { id: '88a22ebf', variant_id: CV, stock_config_id: null, quantity_change: 200, reference_id: ORDER, movement_type: 'addition' },
        { id: '591437e7', variant_id: SC, stock_config_id: null, quantity_change: 50, reference_id: ORDER, movement_type: 'addition' },
        { id: 'd2ffbdbb', variant_id: CV, stock_config_id: null, quantity_change: 100, reference_id: ORDER, movement_type: 'addition' },
        { id: '598f2830', variant_id: HA, stock_config_id: null, quantity_change: 10, reference_id: ORDER, movement_type: 'addition' },
      ],
    },
    { post_warehouse_receipt: (a) => fakePostWarehouseReceipt(() => db, rpcOptions)(a) },
  )
}

async function confirm(items: Record<string, number>, key: string) {
  const { POST } = await import('./route')
  const res = await POST(new NextRequest('http://localhost/api/warehouse/confirm-receipt', {
    method: 'POST',
    body: JSON.stringify({
      order_id: ORDER, batch_id: BATCH, receipt_type: 'partial', idempotency_key: key,
      items: Object.entries(items).filter(([, q]) => q > 0).map(([variant_id, received_now]) => ({ variant_id, product_id: 'p', received_now })),
    }),
  }))
  return { status: res.status, body: await res.json() }
}

async function summary() {
  const { GET } = await import('../receipt-summary/route')
  return (await GET(new NextRequest(`http://localhost/api/warehouse/receipt-summary?order_id=${ORDER}`))).json()
}

const snapshot = () => JSON.stringify({
  receipts: db.tables.warehouse_receipts, items: db.tables.warehouse_receipt_items, movements: db.tables.stock_movements,
  batches: db.tables.qr_batches, qr: db.tables.qr_codes, orderItems: db.tables.order_items,
})
const newMovements = () => db.tables.stock_movements.slice(6)
const received = (variant: string) => db.tables.warehouse_receipt_items.filter((r) => r.variant_id === variant).reduce((s, r) => s + r.received_now, 0)

/** The exact receipt from the manual test: CV 500 · SC 100 · CO 100 · HA 100. */
const MANUAL_RECEIPT = { [CV]: 500, [SC]: 100, [CO]: 100, [HA]: 100 }
/** The same lines at their maximum receivable (warranty 1%): ordered balance + remaining buffer. */
const MAX_RECEIPT = { [CV]: 306, [SC]: 31, [CO]: 1, [HA]: 91 }

beforeEach(() => {
  rpcOptions = {}
  seed()
})

describe('ORD26000024 reproduction', () => {
  it('reproduces the staging failure with the installed explicit-only rule, without writing anything', async () => {
    rpcOptions = { rule: 'explicit_only', limit: 'legacy' }
    const before = snapshot()
    const res = await confirm(MAX_RECEIPT, 'manual-1')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(`warehouse_receipt_order_item_configuration_missing_or_conflicting: variant ${CO}`)
    expect(res.body.stage).toBe('inventory_posting')
    expect(snapshot()).toBe(before)
  })

  it('shows the receipt summary figures from the screenshot', async () => {
    const s = await summary()
    expect(s.summary).toMatchObject({ inventory_received: 480, remaining_ordered: 420, receipt_status: 'partially_received' })
  })

  it('the exact manual receipt is now rejected before posting: every line exceeds its maximum', async () => {
    const before = snapshot()
    const res = await confirm(MANUAL_RECEIPT, 'manual-1')
    expect(res.status).toBe(422)
    expect(res.body.stage).toBe('validation')
    expect(res.body.lines.map((l: any) => [l.label, l.max_receive_now, l.message])).toEqual([
      ['Deluxe Cellera Cartridge [ Corn Vanilla ] - CV', 306, 'Maximum receivable now is 306 cases (300 ordered balance + 6 remaining buffer).'],
      ['Deluxe Cellera Cartridge [ Strawberry Corn ] - SC', 31, 'Maximum receivable now is 31 cases (30 ordered balance + 1 remaining buffer).'],
      ['Deluxe Cellera Cartridge [ Corn ] - CO', 1, 'Maximum receivable now is 1 case (0 ordered balance + 1 remaining buffer).'],
      ['Deluxe Cellera Cartridge [ Hazelnut ] - HA', 91, 'Maximum receivable now is 91 cases (90 ordered balance + 1 remaining buffer).'],
    ])
    expect(db.rpcCalls).toHaveLength(0)
    expect(snapshot()).toBe(before)
  })

  it('the corrected receipt (each line at its maximum) posts, Corn via the canonical 20NB', async () => {
    const res = await confirm(MAX_RECEIPT, 'manual-2')
    expect(res.status).toBe(200)
    const co = res.body.receipt.items.find((i: any) => i.variant_id === CO)
    expect(co).toMatchObject({ stock_config_id: CFG.CO_20NB, stock_config_source: 'canonical', cumulative_received: 101, extra_received: 1 })
    expect(newMovements().reduce((sum, m) => sum + m.quantity_change, 0)).toBe(429)
  })
})

describe('receipt stock configuration resolution', () => {
  it('1 + 8. legacy line without explicit configuration posts to the canonical 20NB; extra receipts unchanged', async () => {
    const res = await confirm({ [CV]: 306, [SC]: 31, [HA]: 91 }, 'manual-3')
    expect(res.status).toBe(200)
    expect(newMovements()).toEqual([
      expect.objectContaining({ variant_id: CV, stock_config_id: CFG.CV_20NB, quantity_change: 306 }),
      expect.objectContaining({ variant_id: SC, stock_config_id: CFG.SC_20NB, quantity_change: 31 }),
      expect.objectContaining({ variant_id: HA, stock_config_id: CFG.HA_20NB, quantity_change: 91 }),
    ])
    // Extra up to the warranty buffer allowance is still accepted.
    const items = res.body.receipt.items
    expect(items.find((i: any) => i.variant_id === CV)).toMatchObject({ cumulative_received: 606, extra_received: 6, stock_config_source: 'order_item' })
    expect(items.find((i: any) => i.variant_id === SC)).toMatchObject({ cumulative_received: 101, extra_received: 1 })
    expect(items.find((i: any) => i.variant_id === HA)).toMatchObject({ cumulative_received: 101, extra_received: 1 })
    // order_items are never rewritten by resolution.
    expect(db.tables.order_items.find((o) => o.variant_id === CO)!.stock_config_id).toBeNull()
  })

  it('1. an unlinked line with remaining quantity resolves canonically (source = canonical)', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300 // Corn now has 200 outstanding
    const res = await confirm({ [CO]: 50 }, 'co-1')
    expect(res.status).toBe(200)
    expect(res.body.receipt.items[0]).toMatchObject({ variant_id: CO, stock_config_id: CFG.CO_20NB, stock_config_source: 'canonical' })
    expect(newMovements()).toEqual([expect.objectContaining({ variant_id: CO, stock_config_id: CFG.CO_20NB, quantity_change: 50 })])
  })

  it('2. a later receipt of the same line keeps the configuration its previous receipt used', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    // A second active ORD configuration exists; the earlier receipt went there.
    db.tables.inventory_stock_configurations.push({ id: 'co-alt', variant_id: CO, config_code: '20NB_ALT', stock_sku: 'OC-ALT', status: 'active', allow_ord: true, default_for_ord: false, requires_repacking_before_sale: false })
    db.tables.warehouse_receipt_items.push({ receipt_id: 'r9', order_id: ORDER, variant_id: CO, received_now: 20, stock_config_id: 'co-alt', stock_movement_id: null })

    const res = await confirm({ [CO]: 30 }, 'co-2')
    expect(res.status).toBe(200)
    expect(res.body.receipt.items[0]).toMatchObject({ stock_config_id: 'co-alt', stock_config_source: 'previous_receipt' })

    const again = await confirm({ [CO]: 30 }, 'co-3')
    expect(again.body.receipt.items[0]).toMatchObject({ stock_config_id: 'co-alt', stock_config_source: 'previous_receipt' })
  })

  it('2. continuity also reads the previous stock movement when the receipt line has no configuration', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    db.tables.inventory_stock_configurations.push({ id: 'co-alt', variant_id: CO, config_code: '20NB_ALT', status: 'active', allow_ord: true, default_for_ord: false })
    db.tables.stock_movements.find((m) => m.id === '818973ea')!.stock_config_id = 'co-alt'
    const res = await confirm({ [CO]: 10 }, 'co-4')
    expect(res.body.receipt.items[0]).toMatchObject({ stock_config_id: 'co-alt', stock_config_source: 'previous_receipt' })
  })

  it('2. previous receipts that landed in a retired legacy configuration fall through to the canonical 20NB', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    db.tables.stock_movements.find((m) => m.id === '818973ea')!.stock_config_id = `${CO}-UNC`
    const res = await confirm({ [CO]: 10 }, 'co-5')
    expect(res.body.receipt.items[0]).toMatchObject({ stock_config_id: CFG.CO_20NB, stock_config_source: 'canonical' })
  })

  it('3. an explicit valid order-item configuration is used unchanged', async () => {
    const res = await confirm({ [CV]: 100 }, 'cv-1')
    expect(res.body.receipt.items[0]).toMatchObject({ stock_config_id: CFG.CV_20NB, stock_config_source: 'order_item' })
  })

  it('4. an explicit configuration of another variant is still rejected', async () => {
    db.tables.order_items.find((o) => o.variant_id === CV)!.stock_config_id = CFG.SC_20NB
    const before = snapshot()
    const res = await confirm({ [CV]: 100 }, 'cv-2')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain(`warehouse_receipt_order_item_configuration_missing_or_conflicting: variant ${CV}`)
    expect(snapshot()).toBe(before)
  })

  it('4. an explicit retired configuration is still rejected, not silently replaced by 20NB', async () => {
    db.tables.order_items.find((o) => o.variant_id === CV)!.stock_config_id = `${CV}-50NB`
    const res = await confirm({ [CV]: 100 }, 'cv-3')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('configuration_missing_or_conflicting')
    expect(newMovements()).toHaveLength(0)
  })

  it('5. ambiguous canonical configurations are rejected with no fallback', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    db.tables.inventory_stock_configurations.push({ id: 'co-2nd', variant_id: CO, config_code: '20XX', status: 'active', allow_ord: true, default_for_ord: true, requires_repacking_before_sale: false })
    const before = snapshot()
    const res = await confirm({ [CO]: 10 }, 'co-6')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('ambiguous canonical configuration')
    expect(snapshot()).toBe(before)
  })

  it('5. previous receipts in two different configurations are rejected', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    db.tables.inventory_stock_configurations.push(
      { id: 'co-a', variant_id: CO, config_code: 'A', status: 'active', allow_ord: true, default_for_ord: false },
      { id: 'co-b', variant_id: CO, config_code: 'B', status: 'active', allow_ord: true, default_for_ord: false },
    )
    db.tables.warehouse_receipt_items.push(
      { order_id: ORDER, variant_id: CO, received_now: 1, stock_config_id: 'co-a' },
      { order_id: ORDER, variant_id: CO, received_now: 1, stock_config_id: 'co-b' },
    )
    const res = await confirm({ [CO]: 10 }, 'co-7')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('previous receipts landed in more than one configuration')
  })

  it('5. a variant with no canonical configuration stays blocked', async () => {
    db.tables.order_items.find((o) => o.variant_id === CO)!.qty = 300
    db.tables.inventory_stock_configurations.find((c) => c.id === CFG.CO_20NB)!.status = 'phase_out'
    const res = await confirm({ [CO]: 10 }, 'co-8')
    expect(res.status).toBe(500)
    expect(res.body.error).toContain('no canonical configuration')
  })
})

describe('atomicity, inventory math and QR eligibility', () => {
  it('6. a failing line rolls back every other line of the receipt', async () => {
    db.tables.inventory_stock_configurations.push({ id: 'ha-2nd', variant_id: HA, config_code: '20XX', status: 'active', allow_ord: true, default_for_ord: true })
    db.tables.order_items.find((o) => o.variant_id === HA)!.stock_config_id = null
    const before = snapshot()
    const res = await confirm({ [CV]: 100, [SC]: 10, [HA]: 10 }, 'atomic-1')
    expect(res.status).toBe(500)
    expect(snapshot()).toBe(before)
    expect(db.updates.filter((u) => u.table === 'qr_batches' || u.table === 'qr_codes')).toHaveLength(0)
  })

  it('7. partial receipts accumulate exactly the posted quantities', async () => {
    await confirm({ [CV]: 100 }, 'math-1')
    await confirm({ [CV]: 150, [HA]: 40 }, 'math-2')
    expect(received(CV)).toBe(550)
    expect(received(HA)).toBe(50)
    expect(newMovements().reduce((s, m) => s + m.quantity_change, 0)).toBe(290)
    const s = await summary()
    expect(s.summary).toMatchObject({ inventory_received: 770, remaining_ordered: 130 })
    expect(s.items.find((i: any) => i.variant_id === CV)).toMatchObject({ previously_received: 550, ordered_balance: 50 })
  })

  it('7. an idempotent retry does not post twice', async () => {
    await confirm({ [CV]: 100 }, 'same-key')
    const replay = await confirm({ [CV]: 100 }, 'same-key')
    expect(replay.body.receipt.idempotent_replay).toBe(true)
    expect(received(CV)).toBe(400)
  })

  it('9. consumer scan eligibility opens only once a receipt has posted', async () => {
    // Fresh order state: no receipts yet, batch not completed, unpacked stock.
    db.tables.warehouse_receipts = []
    db.tables.warehouse_receipt_items = []
    db.tables.stock_movements = []
    db.tables.qr_batches[0].receiving_status = 'idle'
    const unpacked = { status: 'packed', order_id: ORDER }

    db.tables.order_items.find((o) => o.variant_id === HA)!.stock_config_id = 'missing-config'
    const failed = await confirm({ [HA]: 10 }, 'qr-1')
    expect(failed.status).toBe(500)
    expect(await resolveConsumerScanStatus(db, unpacked)).toBe('packed')

    db.tables.order_items.find((o) => o.variant_id === HA)!.stock_config_id = CFG.HA_20NB
    const posted = await confirm({ [HA]: 10 }, 'qr-2')
    expect(posted.status).toBe(200)
    expect(await resolveConsumerScanStatus(db, unpacked)).toBe('received_warehouse')
  })

  it('the Receive screen shows the same destination the RPC will use', async () => {
    const s = await summary()
    const byVariant = (v: string) => s.items.find((i: any) => i.variant_id === v)
    expect(byVariant(CO)).toMatchObject({ destination_source: 'canonical', destination_error: null })
    expect(byVariant(CO).destination_stock_config.id).toBe(CFG.CO_20NB)
    expect(byVariant(CV)).toMatchObject({ destination_source: 'order_item' })
    expect(byVariant(CV).destination_stock_config.id).toBe(CFG.CV_20NB)
  })
})
