import { describe, expect, it } from 'vitest'
import {
  MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE,
  filterEligibleHqFulfillmentWarehouses,
  insufficientStockAtWarehouseMessage,
  resolveDefaultFulfillmentWarehouseId,
  resolveSellerHqId,
} from './hq-fulfillment-warehouses'

const hqId = 'hq-1'

const rows = [
  { id: 'wh-balakong', org_name: 'Serapod Warehouse Balakong', org_code: 'WH001', org_type_code: 'WH', parent_org_id: hqId, is_active: true },
  { id: 'wh-alma', org_name: 'Serapod Warehouse Alma', org_code: 'WH002', org_type_code: 'WH', parent_org_id: hqId, is_active: true },
  { id: 'wh-hq', org_name: 'Serapod HQ Warehouse', org_code: 'WH003', org_type_code: 'WH', parent_org_id: hqId, is_active: true },
  { id: 'wh-inactive', org_name: 'Inactive Warehouse', org_code: 'WH099', org_type_code: 'WH', parent_org_id: hqId, is_active: false },
  { id: 'wh-dist', org_name: 'Distributor Warehouse', org_code: 'WH-D', org_type_code: 'WH', parent_org_id: 'dist-1', is_active: true },
  { id: 'hq-1', org_name: 'Serapod Technology Sdn Bhd', org_code: 'SERA-HQ', org_type_code: 'HQ', parent_org_id: null, is_active: true },
  { id: 'dist-1', org_name: 'Distributor A', org_code: 'DIST1', org_type_code: 'DIST', parent_org_id: hqId, is_active: true },
]

describe('HQ fulfillment warehouse eligibility', () => {
  it('keeps only active WH children of the seller HQ', () => {
    const eligible = filterEligibleHqFulfillmentWarehouses(rows as any, hqId)
    expect(eligible.map((row) => row.id).sort()).toEqual(['wh-alma', 'wh-balakong', 'wh-hq'].sort())
  })

  it('excludes HQ, distributors, inactive warehouses, and foreign warehouses', () => {
    const eligibleIds = new Set(filterEligibleHqFulfillmentWarehouses(rows as any, hqId).map((row) => row.id))
    expect(eligibleIds.has('hq-1')).toBe(false)
    expect(eligibleIds.has('dist-1')).toBe(false)
    expect(eligibleIds.has('wh-inactive')).toBe(false)
    expect(eligibleIds.has('wh-dist')).toBe(false)
  })
})

describe('default fulfillment warehouse resolution', () => {
  it('uses the configured Balakong default when it remains eligible', () => {
    const eligible = filterEligibleHqFulfillmentWarehouses(rows as any, hqId)
    expect(resolveDefaultFulfillmentWarehouseId('wh-balakong', eligible)).toEqual({
      warehouseId: 'wh-balakong',
      defaultMissingOrInvalid: false,
    })
  })

  it('does not silently fall back when the default is missing or invalid', () => {
    const eligible = filterEligibleHqFulfillmentWarehouses(rows as any, hqId)
    expect(resolveDefaultFulfillmentWarehouseId(null, eligible)).toEqual({
      warehouseId: null,
      defaultMissingOrInvalid: true,
    })
    expect(resolveDefaultFulfillmentWarehouseId('wh-inactive', eligible)).toEqual({
      warehouseId: null,
      defaultMissingOrInvalid: true,
    })
    expect(MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE).toContain('No default fulfillment warehouse')
  })
})

describe('seller HQ resolution and insufficient-stock copy', () => {
  it('resolves HQ from HQ or warehouse sellers', () => {
    expect(resolveSellerHqId({ id: 'hq-1', org_type_code: 'HQ', parent_org_id: null })).toBe('hq-1')
    expect(resolveSellerHqId({ id: 'wh-1', org_type_code: 'WH', parent_org_id: 'hq-1' })).toBe('hq-1')
    expect(resolveSellerHqId({ id: 'dist-1', org_type_code: 'DIST', parent_org_id: 'hq-1' })).toBeNull()
  })

  it('names the warehouse in the insufficient stock message', () => {
    expect(insufficientStockAtWarehouseMessage('Serapod Warehouse Alma')).toBe(
      'Insufficient available stock at Serapod Warehouse Alma. Select another fulfillment warehouse or adjust the order quantity.',
    )
  })
})
