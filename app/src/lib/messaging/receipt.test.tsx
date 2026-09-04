import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  formatDiscrepancyReportTelegramReply,
  formatPendingReceiptsTelegramReply,
  formatReceiptAckTelegramReply,
} from '@/lib/messaging/receipt-actions'

describe('messaging receipt migration', () => {
  it('adds receipt ack, discrepancy, and invoice-after-receipt RPCs', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810180000_messaging_receipt_invoice.sql'),
      'utf8',
    )
    expect(migration).toContain('messaging_acknowledge_receipt')
    expect(migration).toContain('messaging_report_discrepancy')
    expect(migration).toContain('messaging_resolve_discrepancy_invoice')
    expect(migration).toContain('messaging_create_invoice_for_order')
    expect(migration).toContain('pending_receipt')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.orders_approve')
  })
})

describe('receipt telegram copy', () => {
  it('shows invoice total only after receipt', () => {
    const text = formatReceiptAckTelegramReply({
      orderNo: 'SO26000107',
      invoiceNo: 'INV-SO26000107',
      invoiceTotal: 640,
    })
    expect(text).toContain('RM 640.00')
    expect(text).toContain('Invoice')
  })

  it('lists pending receipts and discrepancy confirmation', () => {
    expect(formatPendingReceiptsTelegramReply([])).toContain('No orders')
    expect(formatDiscrepancyReportTelegramReply('SO1')).toContain('HQ will review')
  })
})
