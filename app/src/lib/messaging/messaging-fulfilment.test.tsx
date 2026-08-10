import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { formatMessagingStatusTelegram } from '@/lib/messaging/telegram-notify'

describe('messaging prepare/ready/ship migration', () => {
  it('adds messaging fulfilment RPCs without altering classic submit_and_allocate', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810170000_messaging_prepare_ready_ship.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.messaging_start_preparing')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.messaging_ready_to_ship')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.messaging_ship_order')
    expect(migration).toContain('PERFORM public.allocate_inventory_for_order(p_order_id)')
    expect(migration).toContain('PERFORM public.fulfill_order_inventory(p_order_id)')
    expect(migration).toContain("source_channel NOT IN ('telegram', 'whatsapp')")
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.submit_and_allocate_d2h_order')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.orders_approve')
  })
})

describe('messaging telegram status copy', () => {
  it('formats stage messages without prices', () => {
    expect(formatMessagingStatusTelegram({ orderNo: 'SO1', stage: 'preparing' })).toContain('being prepared')
    expect(formatMessagingStatusTelegram({ orderNo: 'SO1', stage: 'ready_to_ship' })).toContain('reserved')
    const shipped = formatMessagingStatusTelegram({
      orderNo: 'SO1',
      stage: 'shipped',
      deliveryMethod: 'lalamove',
      deliveryReference: 'LLM-1',
    })
    expect(shipped).toContain('shipped')
    expect(shipped).toContain('LLM-1')
    expect(shipped).not.toContain('RM')
  })
})
