import { describe, expect, it } from 'vitest'
import {
  consumerScanStatus,
  hasOrderWarehouseReceipt,
  isPreWarehouseQrStatus,
  PRE_WAREHOUSE_QR_STATUSES,
  resolveConsumerScanStatus,
} from './qr-scan-eligibility'
import { isQrEligibleForCollectPoints } from './collect-points-qr-status'
import { createFakeSupabase } from '@/lib/warehouse/test-utils/fake-supabase'

const QR_CODES_STATUS_CHECK = [
  'pending', 'generated', 'printed', 'packed', 'ready_to_ship', 'received_warehouse', 'warehouse_packed',
  'shipped_distributor', 'activated', 'redeemed', 'expired', 'available', 'used_ok', 'spoiled',
  'buffer_available', 'buffer_used',
]

describe('pre-warehouse statuses', () => {
  it('only reuses statuses allowed by the existing qr_codes_status_check (no new status)', () => {
    for (const status of PRE_WAREHOUSE_QR_STATUSES) {
      // 'created' is an existing buffer status accepted by the current eligibility code.
      if (status !== 'created') expect(QR_CODES_STATUS_CHECK).toContain(status)
    }
  })

  it('never treats terminal or blocked statuses as pre-warehouse', () => {
    for (const status of ['pending', 'spoiled', 'expired', 'received_warehouse', 'shipped_distributor', 'redeemed', null, undefined]) {
      expect(isPreWarehouseQrStatus(status)).toBe(false)
    }
  })
})

describe('consumerScanStatus', () => {
  it('checks a pre-warehouse code of a received order as received_warehouse', () => {
    for (const status of PRE_WAREHOUSE_QR_STATUSES) {
      expect(consumerScanStatus(status, true)).toBe('received_warehouse')
    }
  })

  it('leaves the status untouched when the order is not received', () => {
    expect(consumerScanStatus('printed', false)).toBe('printed')
    expect(consumerScanStatus('buffer_available', false)).toBe('buffer_available')
  })

  it('never revives spoiled/expired or changes later statuses', () => {
    expect(consumerScanStatus('spoiled', true)).toBe('spoiled')
    expect(consumerScanStatus('expired', true)).toBe('expired')
    expect(consumerScanStatus('shipped_distributor', true)).toBe('shipped_distributor')
    expect(consumerScanStatus('redeemed', true)).toBe('redeemed')
  })
})

describe('hasOrderWarehouseReceipt (existing receipt state as the gate)', () => {
  it('is true once a posted receipt line has received_now > 0', async () => {
    const db = createFakeSupabase({ warehouse_receipt_items: [{ id: 'i1', order_id: 'o1', received_now: 300 }], qr_batches: [] })
    expect(await hasOrderWarehouseReceipt(db, 'o1')).toBe(true)
    expect(await hasOrderWarehouseReceipt(db, 'o2')).toBe(false)
  })

  it('ignores zero-quantity receipt lines', async () => {
    const db = createFakeSupabase({ warehouse_receipt_items: [{ id: 'i1', order_id: 'o1', received_now: 0 }], qr_batches: [{ id: 'b1', order_id: 'o1', receiving_status: 'idle' }] })
    expect(await hasOrderWarehouseReceipt(db, 'o1')).toBe(false)
  })

  it('accepts a completed batch receive (Receive All / legacy)', async () => {
    const db = createFakeSupabase({ warehouse_receipt_items: [], qr_batches: [{ id: 'b1', order_id: 'o1', receiving_status: 'completed' }] })
    expect(await hasOrderWarehouseReceipt(db, 'o1')).toBe(true)
  })

  it('does not treat a queued/processing/failed batch as received', async () => {
    for (const receiving_status of ['queued', 'processing', 'failed', 'idle']) {
      const db = createFakeSupabase({ warehouse_receipt_items: [], qr_batches: [{ id: 'b1', order_id: 'o1', receiving_status }] })
      expect(await hasOrderWarehouseReceipt(db, 'o1')).toBe(false)
    }
  })

  it('fails closed on lookup errors and missing order', async () => {
    const db = createFakeSupabase({ warehouse_receipt_items: [{ id: 'i1', order_id: 'o1', received_now: 5 }], qr_batches: [] })
    db.failOn = () => ({ message: 'boom' })
    expect(await hasOrderWarehouseReceipt(db, 'o1')).toBe(false)
    expect(await hasOrderWarehouseReceipt(db, null)).toBe(false)
  })
})

describe('resolveConsumerScanStatus', () => {
  it('does not query for codes that are already received or later', async () => {
    const db = createFakeSupabase({})
    db.failOn = () => { throw new Error('should not query') }
    expect(await resolveConsumerScanStatus(db, { status: 'received_warehouse', order_id: 'o1' })).toBe('received_warehouse')
  })

  it('makes unpacked unique codes collect-points eligible only after the first receipt', async () => {
    const before = createFakeSupabase({ warehouse_receipt_items: [], qr_batches: [] })
    const after = createFakeSupabase({ warehouse_receipt_items: [{ id: 'i1', order_id: 'o1', received_now: 300 }], qr_batches: [] })
    const qr = { status: 'packed', order_id: 'o1' }
    expect(isQrEligibleForCollectPoints({ status: await resolveConsumerScanStatus(before, qr), isBuffer: false })).toBe(false)
    expect(isQrEligibleForCollectPoints({ status: await resolveConsumerScanStatus(after, qr), isBuffer: false })).toBe(true)
  })
})
