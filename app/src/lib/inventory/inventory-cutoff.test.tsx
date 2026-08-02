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
  it('enables execution for a frozen HQ-admin cut-off with zero blockers (Ready or Review Required)', () => {
    expect(canExecuteInventoryCutoff(report(), true)).toBe(true)
    // 'Review Required' = zero blockers, only advisory review_items → still postable
    // (matches the backend gate, which rejects only on 'Blocked').
    expect(canExecuteInventoryCutoff(report({ readiness: 'Review Required' }), true)).toBe(true)
    // Real blockers still stop posting.
    expect(canExecuteInventoryCutoff(report({ readiness: 'Blocked' }), true)).toBe(false)
    // Freeze / status / role guards unchanged.
    expect(canExecuteInventoryCutoff(report({ freeze_active: false }), true)).toBe(false)
    expect(canExecuteInventoryCutoff(report({ status: 'posted' }), true)).toBe(false)
    expect(canExecuteInventoryCutoff(report(), false)).toBe(false)
  })

  it('exports traceable distributor, manufacturer and QR-protection fields', () => {
    const csv = inventoryCutoffReportCsv(report())
    expect(csv).toContain('Protected — No Impact')
    expect(csv).toContain('ORD-DH-1')
    expect(csv).toContain('ORD-HM-1')
    expect(csv).toContain('50ml New Box')
  })

  it('appends the seven-bucket Opening Balance summary without dropping existing sections', () => {
    const csv = inventoryCutoffReportCsv(report())
    // New summary section is present…
    expect(csv).toContain('Opening Balance Summary')
    expect(csv).toContain('1. Physical Opening Stock')
    expect(csv).toContain('2. H2M Incoming After Cut-off')
    expect(csv).toContain('7. Blocked / Unresolved')
    // …and the pre-existing sections still are.
    expect(csv).toContain('Distributor Orders')
    expect(csv).toContain('Manufacturer Incoming')
    // Physical = counted physical_quantity (10); H2M incoming reported separately (15).
    expect(csv).toContain('"1. Physical Opening Stock","1","10"')
    expect(csv).toContain('"2. H2M Incoming After Cut-off","1","15"')
  })

  it('reports an explicit Do Not Carry Forward order in the CSV and Excluded bucket', () => {
    const csv = inventoryCutoffReportCsv(report({
      distributor_orders: [
        { order_number: 'SO-EXCL', status: 'submitted', customer: 'D1', warehouse: 'WH', variant: 'Mint', quantity: 6, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      ],
    }))
    // Decision + classification appear in the distributor rows…
    expect(csv).toContain('do_not_carry_forward')
    expect(csv).toContain('Do Not Carry Forward')
    // …and it is counted in summary bucket 5 (one order), not carried/cancelled.
    expect(csv).toContain('"5. Excluded / Do Not Carry Forward","1","6"')
    expect(csv).toContain('"3. D2H Carry Forward","0","0"')
    expect(csv).toContain('"4. D2H Cancel & Release","0","0"')
  })
})
