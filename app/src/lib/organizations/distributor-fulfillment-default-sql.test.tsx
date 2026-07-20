import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260720_hq_warehouse_default_fulfillment_guard_04.sql'),
  'utf8',
)
const editView = readFileSync(
  path.resolve(__dirname, '../../components/organizations/EditOrganizationView.tsx'),
  'utf8',
)
const card = readFileSync(
  path.resolve(__dirname, '../../components/organizations/DistributorOrderFulfillmentCard.tsx'),
  'utf8',
)
const api = readFileSync(
  path.resolve(__dirname, '../../app/api/organizations/set-default-warehouse/route.ts'),
  'utf8',
)

describe('Distributor fulfillment default UI contract', () => {
  it('places the card on warehouse edit below Parent Organization', () => {
    expect(editView).toContain('DistributorOrderFulfillmentCard')
    expect(editView.indexOf('{/* Parent Organization')).toBeLessThan(
      editView.indexOf('<DistributorOrderFulfillmentCard'),
    )
    expect(card).toContain('Distributor Order Fulfillment')
    expect(card).toContain('Set This Warehouse as Default')
    expect(card).toContain('Current Default')
  })

  it('saves immediately through the secure API and requires HQ admin', () => {
    expect(card).toContain("/api/organizations/set-default-warehouse")
    expect(card).toContain("rpc('is_hq_admin')")
    expect(api).toContain("rpc('is_hq_admin')")
    expect(api).toContain('Only HQ Admin can update the default fulfillment warehouse.')
  })

  it('blocks deactivation of the current default until replaced', () => {
    expect(migration).toContain('Cannot deactivate the default fulfillment warehouse')
    expect(migration).toContain('is_active_hq_fulfillment_warehouse')
    expect(editView).toContain('Cannot deactivate default warehouse')
  })
})
