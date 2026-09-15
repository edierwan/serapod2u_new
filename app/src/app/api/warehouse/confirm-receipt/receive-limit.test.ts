import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, type FakeSupabase } from '@/lib/warehouse/test-utils/fake-supabase'
import { fakePostWarehouseReceipt } from '@/lib/warehouse/test-utils/fake-warehouse-receipt-rpc'

/**
 * Server-side receive limit — a request that bypasses the Receive screen
 * validation is still rejected. Shaped like staging ORD26000093: Corn 100
 * ordered, manufacturer warranty 1% (buffer 1), 70 already received.
 */

let db: FakeSupabase

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

const ORDER = '8fb0fee3-7646-4367-a99a-5d6a0d2f5cc5'
const BATCH = 'dcd523c8-aa09-46fd-bd6f-99e03d3b4360'
const CORN = '3d13c8ac-25f1-4859-996e-0d59575e717d'
const GRAPE = 'variant-grape'

beforeEach(() => {
  db = createFakeSupabase(
    {
      organizations: [
        { id: 'hq', org_type_code: 'HQ' },
        { id: 'mfg', org_type_code: 'MFG', warranty_bonus: 1 },
      ],
      orders: [{ id: ORDER, order_no: 'ORD-HM-0926-25', display_doc_no: 'ORD26000093', buyer_org_id: 'hq', seller_org_id: 'mfg' }],
      order_items: [
        { order_id: ORDER, variant_id: CORN, qty: 100, stock_config_id: null, product_variants: { variant_name: 'Deluxe Cellera Cartridge [ Corn ]', product_code: 'CO' } },
        { order_id: ORDER, variant_id: GRAPE, qty: 50, stock_config_id: null, product_variants: { variant_name: 'Grape', product_code: 'GR' } },
      ],
      inventory_stock_configurations: [
        { id: 'corn-20nb', variant_id: CORN, config_code: '20NB', status: 'active', allow_ord: true, default_for_ord: true },
        { id: 'grape-20nb', variant_id: GRAPE, config_code: '20NB', status: 'active', allow_ord: true, default_for_ord: true },
      ],
      qr_batches: [{ id: BATCH, company_id: 'co', order_id: ORDER, receiving_status: 'completed', receiving_mode: 'partial', orders: { buyer_org_id: 'hq', seller_org_id: 'mfg', order_no: 'ORD-HM-0926-25' } }],
      warehouse_receipts: [{ id: 'r1', order_id: ORDER, receipt_no: 'WR-ORD-HM-0926-25-01', idempotency_key: 'first', total_received: 70 }],
      warehouse_receipt_items: [{ receipt_id: 'r1', order_id: ORDER, variant_id: CORN, received_now: 70, stock_config_id: 'corn-20nb' }],
      stock_movements: [],
    },
    { post_warehouse_receipt: (a) => fakePostWarehouseReceipt(() => db)(a) },
  )
})

async function post(items: Record<string, number>, key: string) {
  const { POST } = await import('./route')
  const res = await POST(new NextRequest('http://localhost/api/warehouse/confirm-receipt', {
    method: 'POST',
    body: JSON.stringify({ order_id: ORDER, batch_id: BATCH, receipt_type: 'partial', idempotency_key: key, items: Object.entries(items).map(([variant_id, received_now]) => ({ variant_id, received_now })) }),
  }))
  return { status: res.status, body: await res.json() }
}

const cornReceived = () => db.tables.warehouse_receipt_items.filter((r) => r.variant_id === CORN).reduce((s, r) => s + r.received_now, 0)

describe('confirm-receipt enforces ordered + remaining buffer server-side', () => {
  it.each([32, 40, 1000])('rejects Receive Now %i (maximum 31) without posting or calling the RPC', async (qty) => {
    const res = await post({ [CORN]: qty }, `over-${qty}`)
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ code: 'warehouse_receipt_exceeds_allowed_quantity', stage: 'validation' })
    expect(res.body.error).toContain('Maximum receivable now is 31 cases (30 ordered balance + 1 remaining buffer).')
    expect(db.rpcCalls).toHaveLength(0)
    expect(cornReceived()).toBe(70)
    expect(db.tables.stock_movements).toHaveLength(0)
  })

  it('accepts 31 (cumulative 101, extra 1)', async () => {
    const res = await post({ [CORN]: 31 }, 'ok-31')
    expect(res.status).toBe(200)
    expect(res.body.receipt.items[0]).toMatchObject({ cumulative_received: 101, extra_received: 1 })
    expect((await post({ [CORN]: 1 }, 'after-full')).body.code).toBe('warehouse_receipt_order_already_fully_received')
  })

  it('accepts 30 (cumulative 100, extra 0)', async () => {
    const res = await post({ [CORN]: 30 }, 'ok-30')
    expect(res.body.receipt.items[0]).toMatchObject({ cumulative_received: 100, extra_received: 0 })
  })

  it('one invalid line blocks the whole receipt', async () => {
    const res = await post({ [GRAPE]: 50, [CORN]: 32 }, 'mixed')
    expect(res.status).toBe(422)
    expect(res.body.lines).toHaveLength(1)
    expect(db.tables.warehouse_receipt_items).toHaveLength(1)
  })

  it('the RPC itself rejects an over-limit request that skips the API pre-check', async () => {
    const rpc = fakePostWarehouseReceipt(() => db)
    const result = rpc({ p_order_id: ORDER, p_batch_id: BATCH, p_items: [{ variant_id: CORN, received_now: 32 }], p_idempotency_key: 'direct' })
    expect(result.error?.message).toBe(`warehouse_receipt_exceeds_allowed_quantity: variant ${CORN} (maximum receivable now 31)`)
  })

  it('an idempotent retry of an already posted receipt still replays instead of failing the limit', async () => {
    await post({ [CORN]: 31 }, 'retry-key')
    const replay = await post({ [CORN]: 31 }, 'retry-key')
    expect(replay.status).toBe(200)
    expect(replay.body.receipt.idempotent_replay).toBe(true)
    expect(cornReceived()).toBe(101)
  })
})
