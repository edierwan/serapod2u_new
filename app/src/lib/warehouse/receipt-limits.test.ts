import { describe, expect, it } from 'vitest'
import { maxReceivableMessage, receiptLimitErrorCode, receiptLineLimit, validateReceiveNow, warrantyBufferAllowance } from './receipt-limits'

describe('warrantyBufferAllowance', () => {
  it('floors ordered × warranty % like numeric SQL', () => {
    expect(warrantyBufferAllowance(100, 1)).toBe(1)
    expect(warrantyBufferAllowance(100, 10)).toBe(10)
    expect(warrantyBufferAllowance(600, 0.5)).toBe(3)
    expect(warrantyBufferAllowance(50, 1)).toBe(0)
    expect(warrantyBufferAllowance(100, 29)).toBe(29) // 100 × 0.29 would floor to 28 in plain float math
    expect(warrantyBufferAllowance(1000, 1.1)).toBe(11)
  })
  it('is 0 without a warranty %', () => {
    for (const pct of [0, null, undefined, -1, NaN]) expect(warrantyBufferAllowance(100, pct as any)).toBe(0)
  })
})

describe('ORD26000093: ordered 100, buffer 1 (warranty 1%), previously received 70', () => {
  const limit = receiptLineLimit({ orderedQty: 100, previouslyReceived: 70, warrantyBonusPercent: 1 })

  it('allows a maximum of 31 now (maximum cumulative 101)', () => {
    expect(limit).toEqual({ orderedQty: 100, previouslyReceived: 70, bufferAllowance: 1, maxCumulative: 101, maxReceiveNow: 31, orderedBalance: 30, remainingBuffer: 1 })
  })

  it.each([[30, true], [31, true], [32, false], [40, false], [0, true]])('receive %i → valid %s', (qty, valid) => {
    expect(validateReceiveNow(qty, limit).valid).toBe(valid)
  })

  it('explains the maximum', () => {
    expect(validateReceiveNow(32, limit).message).toBe('Maximum receivable now is 31 cases (30 ordered balance + 1 remaining buffer).')
    expect(receiptLimitErrorCode(limit)).toBe('warehouse_receipt_exceeds_allowed_quantity')
  })
})

describe('remaining buffer after earlier extra receipts', () => {
  it('ordered 100, buffer 10, previously 105 → only 5 more', () => {
    const limit = receiptLineLimit({ orderedQty: 100, previouslyReceived: 105, warrantyBonusPercent: 10 })
    expect(limit).toMatchObject({ maxCumulative: 110, maxReceiveNow: 5, orderedBalance: 0, remainingBuffer: 5 })
    expect(validateReceiveNow(5, limit).valid).toBe(true)
    expect(validateReceiveNow(6, limit)).toEqual({ valid: false, message: 'Maximum receivable now is 5 cases (0 ordered balance + 5 remaining buffer).' })
  })

  it('buffer fully consumed → nothing more, reported as fully received', () => {
    const limit = receiptLineLimit({ orderedQty: 100, previouslyReceived: 110, warrantyBonusPercent: 10 })
    expect(limit.maxReceiveNow).toBe(0)
    expect(maxReceivableMessage(limit)).toBe('Maximum receivable now is 0 cases.')
    expect(receiptLimitErrorCode(limit)).toBe('warehouse_receipt_order_already_fully_received')
  })
})

describe('no warranty buffer', () => {
  it('maximum is the remaining ordered quantity', () => {
    const limit = receiptLineLimit({ orderedQty: 100, previouslyReceived: 70, warrantyBonusPercent: 0 })
    expect(limit).toMatchObject({ bufferAllowance: 0, maxReceiveNow: 30, remainingBuffer: 0 })
    expect(validateReceiveNow(31, limit)).toEqual({ valid: false, message: 'Maximum receivable now is 30 cases.' })
  })
})

describe('multiple lines are independent', () => {
  it('each line has its own maximum', () => {
    const a = receiptLineLimit({ orderedQty: 100, previouslyReceived: 70, warrantyBonusPercent: 1 })
    const b = receiptLineLimit({ orderedQty: 50, previouslyReceived: 0, warrantyBonusPercent: 1 })
    expect([a.maxReceiveNow, b.maxReceiveNow]).toEqual([31, 50])
  })
  it('no limit supplied → not validated (older API response)', () => {
    expect(validateReceiveNow(9999, undefined).valid).toBe(true)
  })
})
