import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(path.resolve(__dirname, 'WarehouseReceiveView2.tsx'), 'utf-8')

/**
 * Warehouse Receive quantities are CASES. Boxes and pcs are derived from the
 * shared order packaging helper (same rules as Create Order), never a local
 * hardcoded conversion.
 */
describe('WarehouseReceiveView2 quantity terminology', () => {
  it('never labels quantities with generic "units"', () => {
    expect(source).not.toMatch(/\bunits\b/)
    expect(source).not.toContain('"Units"')
  })

  it.each([
    'Receive Now (Cases)',
    'Packaging Estimate',
    'Receiving Now',
    'Estimated Boxes:',
    'All quantities in cases',
    'suffix="cases"',
    'suffix="Cases"',
    'Consumer Scan',
  ])('renders %s', (label) => {
    expect(source).toContain(label)
  })

  it('derives boxes and pcs from the shared packaging helper', () => {
    expect(source).toContain("from '@/lib/orders/packaging'")
    expect(source).toContain('formatPackagingLine(receiveNowPackaging)')
    expect(source).toContain('it.cases_per_box')
    expect(source).toContain('it.pcs_per_case')
    // No second, hardcoded conversion system in the view.
    expect(source).not.toMatch(/\/\s*100\b/)
    expect(source).not.toMatch(/\*\s*4\b/)
  })

  it('keeps the existing receiving actions intact', () => {
    for (const s of ['Confirm Receipt', 'Fill Remaining Qty', 'Receive All (Order + Buffer)', 'Goods Received History', "receipt_type: 'partial'", "receipt_type: 'full'"]) {
      expect(source).toContain(s)
    }
  })
})
