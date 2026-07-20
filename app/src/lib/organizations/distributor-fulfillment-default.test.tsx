import { describe, expect, it } from 'vitest'
import {
  buildSetDefaultFulfillmentConfirmMessage,
  shouldShowDistributorFulfillmentCard,
} from './distributor-fulfillment-default'

describe('Distributor Order Fulfillment card visibility', () => {
  const hq = {
    id: 'hq-1',
    org_name: 'Serapod Technology Sdn Bhd',
    org_type_code: 'HQ',
    is_active: true,
  }
  const warehouse = {
    id: 'wh-1',
    org_name: 'Serapod Warehouse Balakong',
    org_type_code: 'WH',
    parent_org_id: 'hq-1',
    is_active: true,
  }

  it('shows only for active warehouses under an HQ parent', () => {
    expect(shouldShowDistributorFulfillmentCard(warehouse, hq)).toBe(true)
  })

  it.each([
    ['HQ org', { ...warehouse, org_type_code: 'HQ', parent_org_id: null }, hq],
    ['distributor', { ...warehouse, org_type_code: 'DIST' }, hq],
    ['shop', { ...warehouse, org_type_code: 'SHOP' }, hq],
    ['manufacturer', { ...warehouse, org_type_code: 'MFG' }, hq],
    ['inactive warehouse', { ...warehouse, is_active: false }, hq],
    ['warehouse under distributor', warehouse, { ...hq, id: 'dist-1', org_type_code: 'DIST' }],
    ['missing parent', warehouse, null],
  ])('hides for %s', (_label, org, parent) => {
    expect(shouldShowDistributorFulfillmentCard(org as any, parent as any)).toBe(false)
  })
})

describe('default fulfillment confirmation copy', () => {
  it('states that only new distributor orders are affected', () => {
    expect(buildSetDefaultFulfillmentConfirmMessage('Serapod Warehouse Alma', 'Serapod Technology Sdn Bhd'))
      .toContain('New distributor orders under Serapod Technology Sdn Bhd will automatically select this warehouse')
    expect(buildSetDefaultFulfillmentConfirmMessage('Serapod Warehouse Alma', 'Serapod Technology Sdn Bhd'))
      .toContain('Existing orders will not be changed')
  })
})
