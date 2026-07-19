import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const eligibilityRoute = readFileSync(
  new URL('../../app/api/inventory/stock-configurations/eligibility/route.ts', import.meta.url),
  'utf8',
)
const variantRoute = readFileSync(
  new URL('../../app/api/inventory/stock-configurations/variant/[variantId]/route.ts', import.meta.url),
  'utf8',
)
const adminGuard = readFileSync(new URL('../server/stock-config-admin.ts', import.meta.url), 'utf8')

describe('stock configuration administration contracts', () => {
  it('requires an authenticated HQ level 1 or 10 administrator', () => {
    expect(adminGuard).toContain("orgType === 'HQ'")
    expect(adminGuard).toContain('roleLevel === 1 || roleLevel === 10')
    expect(adminGuard).toContain("status: 403")
  })

  it('uses the database enablement RPC and never classifies balances in application code', () => {
    expect(variantRoute).toContain("rpc('enable_variant_stock_configurations'")
    expect(variantRoute).toContain('p_variant_id: variantId')
    expect(variantRoute).not.toMatch(/from\('product_inventory'\)\s*\.update/)
    expect(variantRoute).not.toMatch(/from\('stock_movements'\)\s*\.insert/)
  })

  it('prevents eligibility removal while submitted 50ml order demand exists', () => {
    expect(eligibilityRoute).toContain(".eq('volume_ml', 50).eq('packaging', 'new_box')")
    expect(eligibilityRoute).toContain(".eq('orders.status', 'submitted')")
    expect(eligibilityRoute).toContain("status: 409")
    expect(eligibilityRoute).toContain("from('distributor_stock_config_eligibility')")
  })
})
