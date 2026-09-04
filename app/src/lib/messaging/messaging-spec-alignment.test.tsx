import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  formatTelegramCheckReply,
  formatTelegramConfirmReply,
  type TelegramConfirmResult,
  type TelegramPasteCheckResult,
} from '@/lib/telegram/order-actions'
import { formatMessagingStatusTelegram } from '@/lib/messaging/telegram-notify'

describe('messaging spec alignment migration', () => {
  it('confirms with reserve + warehouse inbox and does not require HQ approve gate', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810210000_messaging_spec_confirm_reserve.sql'),
      'utf8',
    )
    expect(migration).toContain('PERFORM public.allocate_inventory_for_order(v_order.id)')
    expect(migration).toContain("SET status = 'approved'")
    expect(migration).toContain('messaging_warehouse_inbox')
    expect(migration).toContain('message_notifications')
    expect(migration).toContain('messaging_channel_settings')
    expect(migration).toContain('messaging_release_allocation_delta')
    expect(migration).toContain('-- §10: final stock validation + reserve (no physical deduct)')
    expect(migration).toContain('ORDER_CONFIRMED')
  })

  it('ready-to-ship keeps reservation from confirm (no re-allocate unless legacy)', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810210000_messaging_spec_confirm_reserve.sql'),
      'utf8',
    )
    expect(migration).toContain('Reservation held from confirm')
    expect(migration).not.toMatch(/IF v_inbox\.status <> 'ready_to_ship'[\s\S]*allocate_inventory_for_order[\s\S]*always/)
  })
})

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

describe('Telegram distributor-facing copy (spec §7–§12)', () => {
  it('hides price on check and describes confirm reserve', () => {
    const text = formatTelegramCheckReply(checkBase)
    expect(text).toContain('Order summary')
    expect(text).toContain('reserved when you confirm')
    expect(text).not.toContain('RM ')
    expect(text).not.toContain('HQ will review')
  })

  it('confirms order and claims reservation + warehouse notify', () => {
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
    expect(text).toContain('warehouse has been notified')
    expect(text).toContain('Stock has been reserved')
    expect(text).not.toContain('HQ will review')
    expect(text).not.toContain('RM ')
  })
})

describe('messaging telegram status copy', () => {
  it('ready-to-ship does not re-state reservation at wrong stage', () => {
    const text = formatMessagingStatusTelegram({ orderNo: 'SO1', stage: 'ready_to_ship' })
    expect(text).toContain('ready for shipment')
    expect(text).not.toContain('Stock has been reserved')
  })
})
