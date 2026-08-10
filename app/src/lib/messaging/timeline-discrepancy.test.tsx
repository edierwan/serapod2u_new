import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseDiscrepancyArgs, splitReportDifferenceArgs } from '@/lib/messaging/receipt-actions'
import { buildMessagingOrderDeepLink } from '@/lib/messaging/deep-links'
import { formatMessagingStatusTelegram } from '@/lib/messaging/telegram-notify'

describe('messaging timeline / discrepancy migration', () => {
  it('adds timeline and discrepancy line items without touching classic approve', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810200000_messaging_timeline_discrepancy_items.sql'),
      'utf8',
    )
    expect(migration).toContain('messaging_order_timeline_events')
    expect(migration).toContain('messaging_delivery_discrepancy_items')
    expect(migration).toContain('messaging_timeline_append')
    expect(migration).toContain('short_quantity')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.orders_approve')
  })
})

describe('discrepancy arg parser', () => {
  it('parses structured short/damaged lines and keeps free text', () => {
    const parsed = parseDiscrepancyArgs('short:100:95,damaged:50:48 boxes wet')
    expect(parsed.items).toEqual([
      { issue_type: 'short_quantity', shipped_quantity: 100, received_quantity: 95 },
      { issue_type: 'damaged_item', shipped_quantity: 50, received_quantity: 48 },
    ])
    expect(parsed.remarks).toContain('boxes')
  })

  it('does not treat structured first token as order number', () => {
    expect(splitReportDifferenceArgs('short:100:95 boxes wet')).toEqual({
      orderNoArg: null,
      remarks: 'short:100:95 boxes wet',
    })
    expect(splitReportDifferenceArgs('SO123 short:100:95 note')).toEqual({
      orderNoArg: 'SO123',
      remarks: 'short:100:95 note',
    })
  })
})

describe('messaging deep links', () => {
  it('builds dashboard order deep link', () => {
    const url = buildMessagingOrderDeepLink('abc-123')
    expect(url).toContain('/dashboard?view=view-order&order_id=abc-123')
  })

  it('keeps shipped notify copy free of prices', () => {
    const text = formatMessagingStatusTelegram({
      orderNo: 'SO1',
      stage: 'shipped',
      deliveryMethod: 'lalamove',
    })
    expect(text).toContain('/report_difference')
    expect(text).not.toContain('RM')
  })
})
