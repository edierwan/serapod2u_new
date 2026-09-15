import { describe, expect, it } from 'vitest'
import {
  canonicalOrderNumber,
  isOrderLinkedMovement,
  orderIdsForMovements,
  resolveMovementReferenceNo,
} from './stock-movement-reference'

// Staging rows (read-only sample, 2026-09-15).
const ORD93 = { id: '8fb0fee3-7646-4367-a99a-5d6a0d2f5cc5', order_no: 'ORD-HM-0926-25', display_doc_no: 'ORD26000093' }
const D2H = { id: 'd2h-order', order_no: 'ORD-DH-0226-10', display_doc_no: 'SO26000063' }
const orders = new Map([[ORD93.id, ORD93], [D2H.id, D2H]])

describe('Movement Reports reference — canonical order number', () => {
  it('1–2. H2M warehouse receipt ORD-HM-0926-25 displays ORD26000093 via reference_id', () => {
    const movement = { movement_type: 'addition', reference_type: 'order', reference_id: ORD93.id, reference_no: 'ORD-HM-0926-25' }
    expect(resolveMovementReferenceNo(movement, orders)).toBe('ORD26000093')
  })

  it('1. warranty bonus of the same order resolves the same way', () => {
    expect(resolveMovementReferenceNo({ movement_type: 'warranty_bonus', reference_type: 'order', reference_id: ORD93.id, reference_no: 'ORD-HM-0926-25' }, orders)).toBe('ORD26000093')
  })

  it.each(['allocation', 'deallocation', 'order_fulfillment', 'transfer_in'])('3. D2H %s movement uses the canonical number', (movement_type) => {
    expect(resolveMovementReferenceNo({ movement_type, reference_type: 'order', reference_id: D2H.id, reference_no: 'ORD-DH-0226-10' }, orders)).toBe('SO26000063')
  })

  it('3. order_fulfillment keeps resolving even without an order reference_type (previous behaviour)', () => {
    expect(resolveMovementReferenceNo({ movement_type: 'order_fulfillment', reference_type: null, reference_id: D2H.id, reference_no: 'x' }, orders)).toBe('SO26000063')
  })

  it('falls back to order_no when the order has no display_doc_no', () => {
    const legacy = { id: 'o-legacy', order_no: 'ORD-HM-1125-01', display_doc_no: null }
    expect(resolveMovementReferenceNo({ reference_type: 'order', reference_id: legacy.id, reference_no: 'stale' }, new Map([[legacy.id, legacy]]))).toBe('ORD-HM-1125-01')
    expect(canonicalOrderNumber({ id: 'x', order_no: '  ', display_doc_no: ' ' })).toBeNull()
  })

  it('4. keeps the stored reference when the order cannot be resolved', () => {
    expect(resolveMovementReferenceNo({ reference_type: 'order', reference_id: 'deleted-order', reference_no: 'ORD-HM-0726-01' }, orders)).toBe('ORD-HM-0726-01')
    expect(resolveMovementReferenceNo({ reference_type: 'order', reference_id: null, reference_no: 'ORD-HM-0726-01' }, orders)).toBe('ORD-HM-0726-01')
  })

  it.each([
    ['transfer', 'ST26020004'],
    ['legacy_config_cutover', 'LEGACY-CONFIG-CUTOVER-2026'],
    ['stock_classification', 'Stock Classification 2026-07-18'],
    ['adjustment', null],
  ])('4. non-order reference %s keeps its stored value, never an ORD number', (reference_type, reference_no) => {
    // Even if the id happened to equal an order id, a non-order reference is not resolved.
    const movement = { movement_type: 'adjustment', reference_type, reference_id: ORD93.id, reference_no }
    expect(isOrderLinkedMovement(movement)).toBe(false)
    expect(resolveMovementReferenceNo(movement, orders)).toBe(reference_no)
  })

  it('collects order ids only for order-linked movements, de-duplicated', () => {
    expect(orderIdsForMovements([
      { reference_type: 'order', reference_id: ORD93.id },
      { reference_type: 'order', reference_id: ORD93.id },
      { reference_type: 'transfer', reference_id: 'transfer-1' },
      { movement_type: 'order_fulfillment', reference_id: D2H.id },
    ])).toEqual([ORD93.id, D2H.id])
  })
})
