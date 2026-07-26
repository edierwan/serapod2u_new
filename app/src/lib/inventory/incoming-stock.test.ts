import { describe, expect, it } from 'vitest'
import {
  aggregateIncoming,
  aggregateTransferIncoming,
  buildIncomingMap,
  clampIncoming,
  computeLineIncoming,
  computeTransferLineIncoming,
  getIncomingBreakdown,
  getReplenishmentDecision,
  incomingKey,
  type IncomingOrderLine,
  type IncomingStockRow,
  type IncomingTransferLine,
} from './incoming-stock'

const COMPANY_A = 'company-a'
const COMPANY_B = 'company-b'
const WH_1 = 'warehouse-1'
const WH_2 = 'warehouse-2'
const VARIANT_X = 'variant-x'
const VARIANT_Y = 'variant-y'

function line(overrides: Partial<IncomingOrderLine> = {}): IncomingOrderLine {
  return {
    company_id: COMPANY_A,
    destination_warehouse_org_id: WH_1,
    variant_id: VARIANT_X,
    order_type: 'H2M',
    status: 'approved',
    ordered_qty: 100,
    received_qty: 0,
    full_receipt_posted: false,
    legacy_qr_completed: false,
    ...overrides,
  }
}

describe('computeLineIncoming — inclusion rules', () => {
  it('counts an approved H2M order in full', () => {
    expect(computeLineIncoming(line())).toBe(100)
  })

  it('counts a closed (fully paid) but not fully received order', () => {
    expect(computeLineIncoming(line({ status: 'closed', received_qty: 40 }))).toBe(60)
  })

  it('excludes draft orders', () => {
    expect(computeLineIncoming(line({ status: 'draft' }))).toBe(0)
  })

  it('excludes submitted orders', () => {
    expect(computeLineIncoming(line({ status: 'submitted' }))).toBe(0)
  })

  it('excludes cancelled orders', () => {
    expect(computeLineIncoming(line({ status: 'cancelled' }))).toBe(0)
  })

  it('excludes D2H and S2D orders', () => {
    expect(computeLineIncoming(line({ order_type: 'D2H' }))).toBe(0)
    expect(computeLineIncoming(line({ order_type: 'S2D' }))).toBe(0)
  })
})

describe('computeLineIncoming — receiving progress', () => {
  it('partial receipt reduces incoming', () => {
    expect(computeLineIncoming(line({ ordered_qty: 100, received_qty: 30 }))).toBe(70)
  })

  it('full receipt brings incoming to zero', () => {
    expect(computeLineIncoming(line({ ordered_qty: 100, received_qty: 100 }))).toBe(0)
  })

  it('over-receipt (warranty buffer / extra) clamps to zero, never negative', () => {
    expect(computeLineIncoming(line({ ordered_qty: 100, received_qty: 130 }))).toBe(0)
    expect(clampIncoming(100, 130)).toBe(0)
  })

  it('"Receive All" full receipt header zeroes incoming even without receipt items', () => {
    expect(
      computeLineIncoming(line({ ordered_qty: 100, received_qty: 0, full_receipt_posted: true }))
    ).toBe(0)
  })

  it('legacy QR-only completed receive is excluded (no phantom incoming)', () => {
    expect(
      computeLineIncoming(line({ ordered_qty: 100, received_qty: 0, legacy_qr_completed: true }))
    ).toBe(0)
  })

  it('legacy order with NO receipt items and NO completed QR batch still counts (genuinely pending)', () => {
    expect(
      computeLineIncoming(line({ ordered_qty: 100, received_qty: 0, legacy_qr_completed: false }))
    ).toBe(100)
  })
})

describe('aggregateIncoming — grouping and isolation', () => {
  it('aggregates multiple open orders for the same variant/warehouse', () => {
    const result = aggregateIncoming([
      line({ ordered_qty: 100, received_qty: 20 }), // 80
      line({ ordered_qty: 50 }), // 50
      line({ ordered_qty: 200, received_qty: 200 }), // 0 — fully received, dropped
    ])
    expect(result).toHaveLength(1)
    expect(result[0].incoming_qty).toBe(130)
    expect(result[0].open_order_count).toBe(2)
  })

  it('isolates by company', () => {
    const result = aggregateIncoming([
      line({ company_id: COMPANY_A, ordered_qty: 100 }),
      line({ company_id: COMPANY_B, ordered_qty: 40 }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find(r => r.company_id === COMPANY_A)?.incoming_qty).toBe(100)
    expect(result.find(r => r.company_id === COMPANY_B)?.incoming_qty).toBe(40)
  })

  it('isolates by destination warehouse', () => {
    const result = aggregateIncoming([
      line({ destination_warehouse_org_id: WH_1, ordered_qty: 100 }),
      line({ destination_warehouse_org_id: WH_2, ordered_qty: 25 }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find(r => r.destination_warehouse_org_id === WH_1)?.incoming_qty).toBe(100)
    expect(result.find(r => r.destination_warehouse_org_id === WH_2)?.incoming_qty).toBe(25)
  })

  it('isolates by variant', () => {
    const result = aggregateIncoming([
      line({ variant_id: VARIANT_X, ordered_qty: 100 }),
      line({ variant_id: VARIANT_Y, ordered_qty: 5 }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find(r => r.variant_id === VARIANT_X)?.incoming_qty).toBe(100)
    expect(result.find(r => r.variant_id === VARIANT_Y)?.incoming_qty).toBe(5)
  })

  it('drops excluded orders entirely (draft/submitted/cancelled mixed in)', () => {
    const result = aggregateIncoming([
      line({ status: 'draft' }),
      line({ status: 'submitted' }),
      line({ status: 'cancelled' }),
    ])
    expect(result).toHaveLength(0)
  })
})

describe('getReplenishmentDecision — decision matrix', () => {
  const RP = 50

  it('Available > Reorder Point → Normal', () => {
    const d = getReplenishmentDecision(80, 0, RP)
    expect(d.code).toBe('normal')
    expect(d.reorderNeeded).toBe(false)
    expect(d.lowStock).toBe(false)
  })

  it('Available ≤ RP and Incoming = 0 → Reorder Required', () => {
    const d = getReplenishmentDecision(30, 0, RP)
    expect(d.code).toBe('reorder_required')
    expect(d.reorderNeeded).toBe(true)
    expect(d.lowStock).toBe(true)
  })

  it('Available ≤ RP, Incoming > 0, Position > RP → Low Stock — Replenishment Incoming', () => {
    const d = getReplenishmentDecision(30, 100, RP)
    expect(d.code).toBe('replenishment_incoming')
    expect(d.inventoryPosition).toBe(130)
    // Duplicate reorder is prevented…
    expect(d.reorderNeeded).toBe(false)
    // …but the physical low-stock condition stays visible.
    expect(d.lowStock).toBe(true)
    expect(d.label).toContain('Low Stock')
  })

  it('Available ≤ RP and Position ≤ RP → Additional Reorder Required', () => {
    const d = getReplenishmentDecision(30, 10, RP)
    expect(d.code).toBe('additional_reorder_required')
    expect(d.inventoryPosition).toBe(40)
    expect(d.reorderNeeded).toBe(true)
    expect(d.lowStock).toBe(true)
  })

  it('decision uses Available + Incoming (inventory position), not Available alone', () => {
    // Same available, different incoming → different decisions.
    expect(getReplenishmentDecision(30, 100, RP).code).toBe('replenishment_incoming')
    expect(getReplenishmentDecision(30, 5, RP).code).toBe('additional_reorder_required')
  })

  it('boundary: Available exactly at reorder point is a low-stock state', () => {
    expect(getReplenishmentDecision(RP, 0, RP).code).toBe('reorder_required')
    expect(getReplenishmentDecision(RP, 1, RP).code).toBe('replenishment_incoming')
  })

  it('out of stock with incoming still warns instead of reporting normal', () => {
    const d = getReplenishmentDecision(0, 200, RP)
    expect(d.code).toBe('replenishment_incoming')
    expect(d.lowStock).toBe(true)
  })
})

function transferLine(overrides: Partial<IncomingTransferLine> = {}): IncomingTransferLine {
  return {
    company_id: COMPANY_A,
    source_warehouse_org_id: WH_2,
    destination_warehouse_org_id: WH_1,
    variant_id: VARIANT_X,
    status: 'in_transit',
    quantity: 50,
    destination_posted: false,
    ...overrides,
  }
}

describe('computeTransferLineIncoming — transfer rules', () => {
  it('counts a confirmed in-transit transfer at the destination warehouse', () => {
    expect(computeTransferLineIncoming(transferLine())).toBe(50)
  })

  it('excludes pending transfers that have not left the source warehouse', () => {
    expect(computeTransferLineIncoming(transferLine({ status: 'pending' }))).toBe(0)
  })

  it('received transfer becomes zero incoming', () => {
    expect(computeTransferLineIncoming(transferLine({ status: 'received' }))).toBe(0)
  })

  it('excludes cancelled transfers', () => {
    expect(computeTransferLineIncoming(transferLine({ status: 'cancelled' }))).toBe(0)
  })

  it('excludes self-transfers (source = destination)', () => {
    expect(
      computeTransferLineIncoming(
        transferLine({ source_warehouse_org_id: WH_1, destination_warehouse_org_id: WH_1 })
      )
    ).toBe(0)
  })

  it('excludes lines whose destination inventory posting already happened (no double count)', () => {
    // The current creation flow posts transfer_in at creation, so the quantity
    // is already inside destination On Hand — it must not count as incoming too.
    expect(computeTransferLineIncoming(transferLine({ destination_posted: true }))).toBe(0)
  })
})

describe('aggregateTransferIncoming — destination attribution and isolation', () => {
  it('attributes incoming to the destination warehouse, never the source', () => {
    const result = aggregateTransferIncoming([
      transferLine({ source_warehouse_org_id: WH_2, destination_warehouse_org_id: WH_1, quantity: 50 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].destination_warehouse_org_id).toBe(WH_1)
    expect(result.find(r => r.destination_warehouse_org_id === WH_2)).toBeUndefined()
  })

  it('sums duplicate transfer lines only via distinct contributions (per exploded line)', () => {
    // The SQL view groups duplicate variant entries inside one transfer before
    // this stage; two DIFFERENT transfers for the same variant do aggregate.
    const result = aggregateTransferIncoming([
      transferLine({ quantity: 50 }),
      transferLine({ quantity: 30 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].incoming_qty).toBe(80)
    expect(result[0].open_order_count).toBe(2)
  })

  it('isolates by company, destination warehouse and variant', () => {
    const result = aggregateTransferIncoming([
      transferLine({ company_id: COMPANY_A, quantity: 10 }),
      transferLine({ company_id: COMPANY_B, quantity: 20 }),
      transferLine({ destination_warehouse_org_id: WH_2, source_warehouse_org_id: WH_1, quantity: 30 }),
      transferLine({ variant_id: VARIANT_Y, quantity: 40 }),
    ])
    expect(result).toHaveLength(4)
    expect(
      result.find(
        r => r.company_id === COMPANY_A && r.destination_warehouse_org_id === WH_1 && r.variant_id === VARIANT_X
      )?.incoming_qty
    ).toBe(10)
    expect(result.find(r => r.company_id === COMPANY_B)?.incoming_qty).toBe(20)
    expect(result.find(r => r.destination_warehouse_org_id === WH_2)?.incoming_qty).toBe(30)
    expect(result.find(r => r.variant_id === VARIANT_Y)?.incoming_qty).toBe(40)
  })

  it('drops excluded transfers entirely', () => {
    const result = aggregateTransferIncoming([
      transferLine({ status: 'pending' }),
      transferLine({ status: 'received' }),
      transferLine({ status: 'cancelled' }),
      transferLine({ destination_posted: true }),
    ])
    expect(result).toHaveLength(0)
  })
})

describe('getIncomingBreakdown — Total = Manufacturer + Transfer', () => {
  const baseRow: IncomingStockRow = {
    company_id: COMPANY_A,
    destination_warehouse_org_id: WH_1,
    variant_id: VARIANT_X,
    incoming_qty: 130,
    open_order_count: 2,
    oldest_approved_at: null,
    has_warehouse_mismatch: false,
  }

  it('splits manufacturer and transfer incoming and totals them correctly', () => {
    const breakdown = getIncomingBreakdown({
      ...baseRow,
      manufacturer_incoming_qty: 100,
      transfer_incoming_qty: 30,
      in_transit_transfer_count: 1,
    })
    expect(breakdown).toEqual({ manufacturer: 100, transfer: 30, total: 130 })
    expect(breakdown.manufacturer + breakdown.transfer).toBe(breakdown.total)
  })

  it('falls back to manufacturer-only when migration 07 columns are absent', () => {
    const breakdown = getIncomingBreakdown(baseRow)
    expect(breakdown).toEqual({ manufacturer: 130, transfer: 0, total: 130 })
  })

  it('returns zeros for a missing row', () => {
    expect(getIncomingBreakdown(undefined)).toEqual({ manufacturer: 0, transfer: 0, total: 0 })
  })

  it('Inventory Position and replenishment decision use Total Incoming', () => {
    const breakdown = getIncomingBreakdown({
      ...baseRow,
      incoming_qty: 40,
      manufacturer_incoming_qty: 10,
      transfer_incoming_qty: 30,
    })
    // Available 30, reorder point 50: manufacturer alone (10) would still be
    // "additional reorder required"; with transfers the position clears it.
    const decision = getReplenishmentDecision(30, breakdown.total, 50)
    expect(decision.inventoryPosition).toBe(70)
    expect(decision.code).toBe('replenishment_incoming')
    const manufacturerOnly = getReplenishmentDecision(30, breakdown.manufacturer, 50)
    expect(manufacturerOnly.code).toBe('additional_reorder_required')
  })
})

describe('buildIncomingMap / incomingKey', () => {
  it('keys rows by warehouse + variant for UI lookup', () => {
    const map = buildIncomingMap([
      {
        company_id: COMPANY_A,
        destination_warehouse_org_id: WH_1,
        variant_id: VARIANT_X,
        incoming_qty: 70,
        open_order_count: 2,
        oldest_approved_at: '2026-07-01T00:00:00Z',
        has_warehouse_mismatch: false,
      },
    ])
    expect(map.get(incomingKey(WH_1, VARIANT_X))?.incoming_qty).toBe(70)
    expect(map.get(incomingKey(WH_2, VARIANT_X))).toBeUndefined()
    expect(map.get(incomingKey(WH_1, VARIANT_Y))).toBeUndefined()
  })
})
