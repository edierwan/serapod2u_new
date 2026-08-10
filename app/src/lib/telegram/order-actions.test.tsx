import { describe, expect, it } from 'vitest'
import {
  formatTelegramCheckReply,
  formatTelegramConfirmReply,
  type TelegramConfirmResult,
  type TelegramPasteCheckResult,
} from '@/lib/telegram/order-actions'
import { readFileSync } from 'fs'
import path from 'path'

const checkBase: TelegramPasteCheckResult = {
  summary: {
    bucket: 'available',
    label: 'Available',
    totalLines: 2,
    sectionHeaders: 0,
    matchedLines: 2,
    reviewLines: 0,
    outOfStockLines: 0,
    partialLines: 0,
    availableLines: 2,
  },
  distributorName: 'Distributor1',
  warehouseName: 'Serapod Warehouse Balakong',
  estimatedOrderValue: 6400,
  lineCount: 2,
  totalQuantity: 200,
}

describe('Telegram distributor-facing copy', () => {
  it('hides price on check and uses confirm wording', () => {
    const text = formatTelegramCheckReply(checkBase)
    expect(text).toContain('Order summary')
    expect(text).toContain('Total qty: 200')
    expect(text).toContain('/submit')
    expect(text).toContain('reserved when you confirm')
    expect(text).not.toContain('RM ')
    expect(text).not.toMatch(/\bprice\b/i)
  })

  it('hides price on confirm reply and claims reservation', () => {
    const result: TelegramConfirmResult = {
      orderNo: 'SO26000107',
      orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      confirmedLines: 2,
      skippedLines: 0,
      estimatedOrderValue: 6400,
      summary: checkBase.summary,
      warehouseName: 'Serapod Warehouse Balakong',
    }
    const text = formatTelegramConfirmReply(result)
    expect(text).toContain('Order confirmed')
    expect(text).toContain('SO26000107')
    expect(text).toContain('Stock has been reserved')
    expect(text).toContain('warehouse has been notified')
    expect(text).not.toContain('RM ')
    expect(text).not.toMatch(/\bprice\b/i)
  })
})

describe('legacy submit migration reference', () => {
  it('documents original submit_d2h_order migration superseded by spec alignment', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810160000_messaging_submit_without_allocate.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.submit_d2h_order')
    expect(migration).toContain('messaging_warehouse_inbox')
  })
})
