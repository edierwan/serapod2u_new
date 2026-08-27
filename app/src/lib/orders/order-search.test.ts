import { describe, expect, it } from 'vitest'

import {
  getOrderDisplayOrgName,
  orderMatchesSearch,
  orderSearchFields,
  type SearchableOrder,
} from './order-search'

const VIEWER_ORG = 'org-hq'

const skdOrder: SearchableOrder = {
  order_no: 'ORD-2026-000142',
  display_doc_no: 'ORD26000142',
  notes: null,
  order_type: 'D2H',
  seller_org_id: 'org-hq',
  buyer_org: { org_name: 'SKD Distribution', org_code: 'SKD01', org_type_code: 'DIST' },
  seller_org: { org_name: 'Serapod HQ', org_code: 'HQ01', org_type_code: 'HQ' },
}

describe('orders search', () => {
  it('matches the organization name shown in the Name column', () => {
    expect(getOrderDisplayOrgName(skdOrder, VIEWER_ORG)).toBe('SKD Distribution')
    expect(orderMatchesSearch(skdOrder, 'skd', VIEWER_ORG)).toBe(true)
  })

  it('is case-insensitive and trims the query', () => {
    expect(orderMatchesSearch(skdOrder, '  SKD  ', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, 'sKd DiStRiBuTiOn', VIEWER_ORG)).toBe(true)
  })

  it('still matches the display and legacy order numbers', () => {
    expect(orderMatchesSearch(skdOrder, 'ORD26000142', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, 'ord-2026-000142', VIEWER_ORG)).toBe(true)
  })

  it('matches buyer and seller organization names and codes', () => {
    expect(orderMatchesSearch(skdOrder, 'serapod hq', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, 'SKD01', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, 'HQ01', VIEWER_ORG)).toBe(true)
  })

  it('still matches notes', () => {
    const order: SearchableOrder = { ...skdOrder, notes: 'urgent restock' }
    expect(orderMatchesSearch(order, 'restock', VIEWER_ORG)).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(orderMatchesSearch(skdOrder, 'zzz-nothing', VIEWER_ORG)).toBe(false)
  })

  it('treats an empty query as "everything matches"', () => {
    expect(orderMatchesSearch(skdOrder, '', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, '   ', VIEWER_ORG)).toBe(true)
    expect(orderMatchesSearch(skdOrder, null, VIEWER_ORG)).toBe(true)
  })

  it('never throws on null fields', () => {
    const sparse: SearchableOrder = {
      order_no: null,
      display_doc_no: null,
      notes: null,
      order_type: 'H2M',
      buyer_org: null,
      seller_org: null,
    }
    expect(() => orderMatchesSearch(sparse, 'anything', VIEWER_ORG)).not.toThrow()
    expect(orderMatchesSearch(sparse, 'anything', VIEWER_ORG)).toBe(false)
    expect(orderSearchFields(sparse, VIEWER_ORG)).toEqual(['N/A'])
  })

  it('keeps the per-order-type Name column rules', () => {
    const h2m: SearchableOrder = {
      order_type: 'H2M',
      buyer_org: { org_name: 'Serapod HQ', org_type_code: 'HQ' },
      seller_org: { org_name: 'Acme Manufacturing', org_type_code: 'MFG' },
    }
    expect(getOrderDisplayOrgName(h2m, VIEWER_ORG)).toBe('Acme Manufacturing')

    const s2d: SearchableOrder = {
      order_type: 'S2D',
      seller_org_id: 'org-dist',
      buyer_org: { org_name: 'Kedai Runcit Ali', org_type_code: 'SHOP' },
      seller_org: { org_name: 'SKD Distribution', org_type_code: 'DIST' },
    }
    // Distributor's own view shows the shop…
    expect(getOrderDisplayOrgName(s2d, 'org-dist')).toBe('Kedai Runcit Ali')
    // …the shop's view shows the distributor.
    expect(getOrderDisplayOrgName(s2d, 'org-shop')).toBe('SKD Distribution')
    expect(orderMatchesSearch(s2d, 'skd', 'org-shop')).toBe(true)
  })

  it('falls back to the seller for legacy D2H rows built the other way up', () => {
    const legacy: SearchableOrder = {
      order_type: 'D2H',
      buyer_org: { org_name: 'Serapod HQ', org_type_code: 'HQ' },
      seller_org: { org_name: 'SKD Distribution', org_type_code: 'DIST' },
    }
    expect(getOrderDisplayOrgName(legacy, VIEWER_ORG)).toBe('SKD Distribution')
    expect(orderMatchesSearch(legacy, 'skd', VIEWER_ORG)).toBe(true)
  })
})
