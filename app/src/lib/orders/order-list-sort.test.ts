import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  calculateOrderBalance,
  calculateOrderTotal,
  sortOrders,
  type SortableOrder,
} from './order-list-sort'

const VIEWER_ORG = 'org-hq'

type Fixture = SortableOrder & { id: string }

const orderA: Fixture = {
  id: 'a',
  order_no: 'ORD-2026-000003',
  display_doc_no: 'ORD26000003',
  order_type: 'D2H',
  status: 'submitted',
  created_at: '2026-03-01T00:00:00.000Z',
  seller_org_id: 'org-hq',
  buyer_org: { org_name: 'SKD Distribution', org_code: 'SKD01', org_type_code: 'DIST' },
  seller_org: { org_name: 'Serapod HQ', org_code: 'HQ01', org_type_code: 'HQ' },
  created_by_user: { full_name: 'Zara Ahmad', email: 'zara@example.com' },
  order_items: [{ line_total: 100.25 }, { line_total: 50.5 }],
}

const orderB: Fixture = {
  id: 'b',
  order_no: 'ORD-2026-000001',
  display_doc_no: 'ORD26000001',
  order_type: 'D2H',
  status: 'approved',
  created_at: '2026-01-01T00:00:00.000Z',
  seller_org_id: 'org-hq',
  buyer_org: { org_name: 'Apex Trading', org_code: 'APX01', org_type_code: 'DIST' },
  seller_org: { org_name: 'Serapod HQ', org_code: 'HQ01', org_type_code: 'HQ' },
  created_by_user: { full_name: 'Ali Baba', email: 'ali@example.com' },
  order_items: [{ line_total: 900 }],
}

const orderC: Fixture = {
  id: 'c',
  order_no: 'ORD-2026-000002',
  display_doc_no: 'ORD26000002',
  order_type: 'H2M',
  status: 'draft',
  created_at: '2026-02-01T00:00:00.000Z',
  seller_org_id: 'org-mfg',
  buyer_org: { org_name: 'Serapod HQ', org_code: 'HQ01', org_type_code: 'HQ' },
  seller_org: { org_name: 'Meridian Manufacturing', org_code: 'MER01', org_type_code: 'MFG' },
  created_by_user: { full_name: null, email: 'mfg@example.com' },
  order_items: [],
}

const orders: Fixture[] = [orderA, orderB, orderC]

const ids = (rows: Fixture[]) => rows.map((row) => row.id)

describe('order total arithmetic', () => {
  it('sums line totals exactly as the table renders them', () => {
    expect(calculateOrderTotal(orderA)).toBe(150.75)
    expect(calculateOrderTotal(orderB)).toBe(900)
    expect(calculateOrderTotal(orderC)).toBe(0)
  })

  it('keeps the || 0 fallbacks for missing items and missing line totals', () => {
    expect(calculateOrderTotal({ order_items: null })).toBe(0)
    expect(calculateOrderTotal({})).toBe(0)
    expect(calculateOrderTotal({ order_items: [{ line_total: null }, { line_total: 25 }] })).toBe(25)
  })

  it('treats an approved order as settled and anything else as its total', () => {
    expect(calculateOrderBalance(orderB)).toBe(0)
    expect(calculateOrderBalance(orderA)).toBe(150.75)
    expect(calculateOrderBalance(orderC)).toBe(0)
  })
})

describe('orders table sorting', () => {
  it('sorts by Date', () => {
    expect(ids(sortOrders(orders, 'created_at', 'asc', VIEWER_ORG))).toEqual(['b', 'c', 'a'])
    expect(ids(sortOrders(orders, 'created_at', 'desc', VIEWER_ORG))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by Order number', () => {
    expect(ids(sortOrders(orders, 'order_no', 'asc', VIEWER_ORG))).toEqual(['b', 'c', 'a'])
    expect(ids(sortOrders(orders, 'order_no', 'desc', VIEWER_ORG))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by Name using the organization shown in the table', () => {
    // Apex Trading < Meridian Manufacturing < SKD Distribution
    expect(ids(sortOrders(orders, 'seller', 'asc', VIEWER_ORG))).toEqual(['b', 'c', 'a'])
    expect(ids(sortOrders(orders, 'seller', 'desc', VIEWER_ORG))).toEqual(['a', 'c', 'b'])
  })

  // Regression: these two used to reach `calculateOrderTotal` before its
  // component-scope `const` declaration and throw a ReferenceError.
  it('sorts by Total in both directions without throwing', () => {
    expect(() => sortOrders(orders, 'total', 'asc', VIEWER_ORG)).not.toThrow()
    expect(ids(sortOrders(orders, 'total', 'asc', VIEWER_ORG))).toEqual(['c', 'a', 'b'])
    expect(ids(sortOrders(orders, 'total', 'desc', VIEWER_ORG))).toEqual(['b', 'a', 'c'])
  })

  it('sorts by Balance in both directions without throwing', () => {
    expect(() => sortOrders(orders, 'balance', 'asc', VIEWER_ORG)).not.toThrow()
    // approved order b counts as 0, alongside the empty order c
    expect(ids(sortOrders(orders, 'balance', 'asc', VIEWER_ORG))).toEqual(['b', 'c', 'a'])
    expect(ids(sortOrders(orders, 'balance', 'desc', VIEWER_ORG))).toEqual(['a', 'b', 'c'])
  })

  it('sorts by Status and Created By', () => {
    expect(ids(sortOrders(orders, 'status', 'asc', VIEWER_ORG))).toEqual(['b', 'c', 'a'])
    // orderC has no full_name, so it falls back to its email; the comparator
    // uses raw `<` / `>`, so uppercase names sort ahead of the lowercase email.
    expect(ids(sortOrders(orders, 'created_by', 'asc', VIEWER_ORG))).toEqual(['b', 'a', 'c'])
  })

  it('leaves an unknown column untouched and never mutates the input', () => {
    const input = [...orders]
    expect(ids(sortOrders(input, 'nope', 'asc', VIEWER_ORG))).toEqual(['a', 'b', 'c'])
    expect(ids(input)).toEqual(['a', 'b', 'c'])
  })
})

describe('OrdersView wiring', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../components/orders/OrdersView.tsx'),
    'utf8',
  )

  it('uses the hoisted comparator instead of a component-scope helper', () => {
    expect(source).toContain("from '@/lib/orders/order-list-sort'")
    expect(source).toContain('const sortedOrders = sortOrders(filteredOrders, sortColumn, sortDirection')
    // A component-scope `const calculateOrderTotal` would re-introduce the TDZ.
    expect(source).not.toContain('const calculateOrderTotal =')
  })
})
