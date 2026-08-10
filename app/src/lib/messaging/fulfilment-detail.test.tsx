import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { formatDiscrepancyReportTelegramReply } from '@/lib/messaging/receipt-actions'

describe('messaging fulfilment detail migration', () => {
  it('adds fulfilment lines RPC and discrepancy evidence attachments', () => {
    const migration = readFileSync(
      path.resolve(
        process.cwd(),
        '../supabase/migrations/20260810220000_messaging_fulfilment_detail_discrepancy_evidence.sql',
      ),
      'utf8',
    )
    expect(migration).toContain('messaging_delivery_discrepancy_attachments')
    expect(migration).toContain('messaging_fulfilment_lines')
    expect(migration).toContain('messaging_attach_discrepancy_evidence')
    expect(migration).toContain('messaging-discrepancy-evidence')
  })
})

describe('discrepancy telegram copy', () => {
  it('prompts for optional photo evidence', () => {
    expect(formatDiscrepancyReportTelegramReply('SO1', 2)).toContain('attach evidence')
  })
})
