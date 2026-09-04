import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const transferView = readFileSync(
  path.resolve(__dirname, '../../components/inventory/StockTransferView.tsx'),
  'utf8',
)
const transferLifecycle = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260718_stock_config_12_transfer_dispatch_lifecycle.sql'),
  'utf8',
)
const runbook = readFileSync(
  path.resolve(__dirname, '../../../../docs/runbooks/hq-direct-inventory-cutover.md'),
  'utf8',
)

describe('HQ → Warehouse transfer readiness', () => {
  it('allows HQ and warehouse organizations in the transfer UI', () => {
    expect(transferView).toContain(".in('org_type_code', ['HQ', 'WH'])")
    expect(transferView).toContain("rpc('save_stock_transfer_draft'")
    expect(transferView).toContain("rpc('dispatch_stock_transfer'")
    expect(transferView).toContain("rpc('receive_stock_transfer'")
  })

  it('keeps dispatch/receive idempotent and audited in the transfer lifecycle', () => {
    expect(transferLifecycle).toContain('post exact-configuration transfer_out once')
    expect(transferLifecycle).toContain('post transfer_in exactly once')
    expect(transferLifecycle).toContain('ready_to_dispatch')
  })

  it('drops the Stock SKU column and shows the Add Stock variant identity', () => {
    expect(transferView).not.toContain('<TableHead>Stock SKU</TableHead>')
    expect(transferView).not.toContain('{row.stockSku}')
    expect(transferView).toContain('variantIdentityLabel(row.variantName, row.variantProductCode)')
    expect(transferView).toContain('variantAlternativeLabel(row.alternativeName)')
    expect(transferView).toContain('product_code,\n            alternative_name,')
    // stock_config_id stays the transfer identity; only the display changed.
    expect(transferView).toContain('stock_config_id')
    expect(transferView).toContain('<TableHead>Configuration</TableHead>')
  })

  it('documents the later cutover without transferring production stock now', () => {
    expect(runbook).toContain('Do **not** run against staging/production inventory until explicitly approved')
    expect(runbook).toContain('Total Serapod-controlled inventory before')
    expect(runbook).toContain('Create audited HQ → Serapod HQ Warehouse transfer')
  })
})
