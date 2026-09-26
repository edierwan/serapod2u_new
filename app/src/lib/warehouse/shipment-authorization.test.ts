import { describe, expect, it } from 'vitest'

import { authorizeWarehouseShipment } from './shipment-authorization'

const shipment = { warehouse_org_id: 'warehouse-1', company_id: 'hq-1' }

describe('warehouse shipment authorization', () => {
  it('allows an active level-40 ordinary user in the shipment warehouse', () => {
    expect(authorizeWarehouseShipment({
      id: 'user-1', organization_id: 'warehouse-1', is_active: true,
      role_level: 40, organization_type: 'WH',
    }, shipment)).toEqual({ allowed: true })
  })

  it('allows an active HQ actor in the shipment company', () => {
    expect(authorizeWarehouseShipment({
      id: 'user-1', organization_id: 'hq-1', is_active: true,
      role_level: 10, organization_type: 'HQ',
    }, shipment)).toEqual({ allowed: true })
  })

  it('allows an active level-40 ordinary HQ user in the shipment company', () => {
    expect(authorizeWarehouseShipment({
      id: 'user-1', organization_id: 'hq-1', is_active: true,
      role_level: 40, organization_type: 'HQ',
    }, shipment)).toEqual({ allowed: true })
  })

  it('denies another warehouse', () => {
    expect(authorizeWarehouseShipment({
      id: 'user-1', organization_id: 'warehouse-2', is_active: true,
      role_level: 30, organization_type: 'WH',
    }, shipment)).toMatchObject({ allowed: false, reason: 'Shipment belongs to another warehouse' })
  })

  it('denies cross-company HQ, inactive, guest-level and distributor actors', () => {
    const actors = [
      { id: 'hq', organization_id: 'hq-2', is_active: true, role_level: 10, organization_type: 'HQ' },
      { id: 'inactive', organization_id: 'warehouse-1', is_active: false, role_level: 30, organization_type: 'WH' },
      { id: 'guest', organization_id: 'warehouse-1', is_active: true, role_level: 50, organization_type: 'WH' },
      { id: 'dist', organization_id: 'warehouse-1', is_active: true, role_level: 30, organization_type: 'DIST' },
      { id: 'shop', organization_id: 'warehouse-1', is_active: true, role_level: 40, organization_type: 'SHOP' },
      { id: 'mfg', organization_id: 'warehouse-1', is_active: true, role_level: 30, organization_type: 'MFG' },
    ]

    for (const actor of actors) {
      expect(authorizeWarehouseShipment(actor, shipment).allowed).toBe(false)
    }
  })
})
