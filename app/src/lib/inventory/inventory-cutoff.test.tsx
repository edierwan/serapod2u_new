import { describe, expect, it } from 'vitest'
import { canExecuteInventoryCutoff, inventoryCutoffReportCsv, type CutoffReport } from './inventory-cutoff'

const report = (overrides: Partial<CutoffReport> = {}): CutoffReport => ({
  cutoff_id: 'cutoff-1',
  status: 'counting',
  proposed_cutoff_at: '2026-07-26T10:00:00Z',
  warehouse_organization_id: 'warehouse-1',
  company_id: 'company-1',
  readiness: 'Ready',
  freeze_active: true,
  qr_status: 'Protected — No Impact',
  notice: 'Preview only — no inventory, order, allocation, or QR data will be changed.',
  inventory: [{ variant_name: 'Mint', stock_configuration: '20ml New Box', system_quantity: 5, physical_quantity: 10, variance: 5, allocated_quantity: 2 }],
  distributor_orders: [{ order_number: 'ORD-DH-1', status: 'submitted', customer: 'D1', warehouse: 'WH', variant: 'Mint', quantity: 2, decision: 'carry_forward', classification: 'Carry Forward' }],
  manufacturer_incoming: [{ order_number: 'ORD-HM-1', status: 'approved', manufacturer: 'M1', variant: 'Mint', ordered_quantity: 20, received_quantity: 5, remaining_incoming_quantity: 15, stock_configuration: '50ml New Box', decision: 'carry_forward_incoming' }],
  warehouse_activity: [],
  stock_count_drafts: [],
  blockers: [],
  review_items: [],
  ...overrides,
})

describe('Inventory Opening Balance Cut-off UI contract', () => {
  it('enables execution only for a frozen Ready report and HQ Admin', () => {
    expect(canExecuteInventoryCutoff(report(), true)).toBe(true)
    expect(canExecuteInventoryCutoff(report({ readiness: 'Blocked' }), true)).toBe(false)
    expect(canExecuteInventoryCutoff(report({ freeze_active: false }), true)).toBe(false)
    expect(canExecuteInventoryCutoff(report(), false)).toBe(false)
  })

  it('exports traceable distributor, manufacturer and QR-protection fields', () => {
    const csv = inventoryCutoffReportCsv(report())
    expect(csv).toContain('Protected — No Impact')
    expect(csv).toContain('ORD-DH-1')
    expect(csv).toContain('ORD-HM-1')
    expect(csv).toContain('50ml New Box')
  })
})
