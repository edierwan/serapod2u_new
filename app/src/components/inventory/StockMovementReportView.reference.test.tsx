// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createFakeSupabase, type FakeSupabase } from '@/lib/warehouse/test-utils/fake-supabase'

let db: FakeSupabase
vi.mock('@/lib/hooks/useSupabaseAuth', () => ({ useSupabaseAuth: () => ({ isReady: true, supabase: db }) }))
vi.mock('@/lib/inventory/inventory-data-refresh', () => ({ subscribeToInventoryDataRefresh: () => () => {} }))

import StockMovementReportView from './StockMovementReportView'

afterEach(cleanup)

const base = { variant_id: 'v1', quantity_change: 70, quantity_before: 0, quantity_after: 70, unit_cost: 0, total_cost: 0, company_id: 'co', created_by: 'u1', variant_code: 'CO', variant_name: 'Corn', product_name: 'Cellera Hero', organization_name: 'WH', created_by_email: 'wh@example.com', stock_config_id: null }

function seed() {
  db = createFakeSupabase({
    vw_stock_movements_ordered: [
      { ...base, id: 'm1', movement_type: 'addition', reference_type: 'order', reference_id: 'ord-93', reference_no: 'ORD-HM-0926-25', created_at: '2026-09-15T06:40:56Z' },
      { ...base, id: 'm2', movement_type: 'allocation', reference_type: 'order', reference_id: 'so-63', reference_no: 'ORD-DH-0226-10', created_at: '2026-09-14T06:40:56Z' },
      { ...base, id: 'm3', movement_type: 'transfer_out', reference_type: 'transfer', reference_id: 'tr-1', reference_no: 'ST26020004', created_at: '2026-09-13T06:40:56Z' },
      { ...base, id: 'm4', movement_type: 'addition', reference_type: 'order', reference_id: 'gone', reference_no: 'ORD-HM-0726-99', created_at: '2026-09-12T06:40:56Z' },
    ],
    orders: [
      { id: 'ord-93', order_no: 'ORD-HM-0926-25', display_doc_no: 'ORD26000093' },
      { id: 'so-63', order_no: 'ORD-DH-0226-10', display_doc_no: 'SO26000063' },
    ],
    stock_movements: [], product_variants: [], organizations: [], users: [], inventory_stock_configurations: [],
  })
}

describe('Movement Reports Reference column', () => {
  it('shows the current order number for order movements and keeps other references, writing nothing', async () => {
    seed()
    render(<StockMovementReportView userProfile={{ id: 'u1' }} />)
    await screen.findAllByText('ORD26000093')
    const table = screen.getAllByRole('table')[0]
    expect(within(table).getAllByText('ORD26000093').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('SO26000063').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('ST26020004').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('ORD-HM-0726-99').length).toBeGreaterThan(0) // unresolvable → unchanged
    expect(within(table).queryByText('ORD-HM-0926-25')).toBeNull()
    expect(within(table).queryByText('ORD-DH-0226-10')).toBeNull()

    // 5. Presentation only: no stock or inventory history is written.
    expect(db.updates).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
    expect(db.tables.vw_stock_movements_ordered.map((m) => m.reference_no)).toEqual(['ORD-HM-0926-25', 'ORD-DH-0226-10', 'ST26020004', 'ORD-HM-0726-99'])
  })

  it('5. the report never mutates movements (source contract)', () => {
    const source = readFileSync(path.resolve(__dirname, 'StockMovementReportView.tsx'), 'utf-8')
    expect(source).toContain('resolveMovementReferenceNo(item, ordersMap)')
    expect(source).not.toMatch(/\.(update|insert|upsert|delete)\(/)
  })
})
