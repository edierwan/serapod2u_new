import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)

const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')
const variantsTab = repoFile('app/src/components/products/tabs/VariantsTab.tsx')
const productDetails = repoFile('app/src/components/products/ViewProductDetails.tsx')
const reconciliation = repoFile('supabase/migrations/20260730_archive_variant_stock_config_reconciliation.sql')
const atomicArchive = repoFile('supabase/migrations/20260731_archive_product_variant_atomic.sql')

describe('Phase 1 archived variant stock-count behavior', () => {
  it('new scopes query only active configurations, variants and products', () => {
    const newCatalogQuery = stockCountView.slice(
      stockCountView.indexOf('const loadCountRows = async'),
      stockCountView.indexOf('// Full / Partial / Spot counts'),
    )
    expect(newCatalogQuery).toContain(".neq('status', 'inactive')")
    expect(newCatalogQuery).toContain(".eq('product_variants.is_active', true)")
    expect(newCatalogQuery).toContain(".eq('product_variants.products.is_active', true)")
  })

  it('reopens the immutable scope without active filters and labels historical rows', () => {
    const historicalScopeLoad = stockCountView.slice(
      stockCountView.indexOf('const loadDraft = async'),
      stockCountView.indexOf('const resetSession ='),
    )
    expect(historicalScopeLoad).toContain(".in('id', missingScopeIds)")
    expect(historicalScopeLoad).not.toContain(".eq('product_variants.is_active', true)")
    expect(historicalScopeLoad).not.toContain(".eq('product_variants.products.is_active', true)")
    expect(stockCountView).toContain('Archived variant · historical')
    expect(stockCountView).toContain('Historical configuration')
  })

  it('routes both Master Data actions through the same verified archive RPC flow', () => {
    expect(variantsTab).toContain('archiveProductVariantAndRefresh')
    expect(productDetails).toContain('archiveProductVariantAndRefresh')
    expect(variantsTab).not.toMatch(/from\('product_variants'\)\.delete/)
    expect(productDetails).not.toMatch(/from\('product_variants'\)[\s\S]{0,80}\.delete/)
  })

  it('atomically archives the referenced variant and only its operational configurations', () => {
    expect(atomicArchive).toMatch(
      /UPDATE public\.product_variants[\s\S]*SET is_active = false[\s\S]*WHERE id = p_variant_id/,
    )
    expect(atomicArchive).toMatch(
      /UPDATE public\.inventory_stock_configurations[\s\S]*SET status = 'inactive'[\s\S]*WHERE variant_id = p_variant_id[\s\S]*status IN \('active', 'phase_out'\)/,
    )
    expect(atomicArchive).toContain('FOR UPDATE')
    expect(atomicArchive).toContain("RAISE EXCEPTION 'variant_archive_incomplete'")
    expect(atomicArchive).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('never mutates existing draft snapshots or posted history during archive', () => {
    expect(atomicArchive).not.toMatch(/UPDATE public\.stock_count_session_(items|scope)/i)
    expect(atomicArchive).not.toMatch(/UPDATE public\.stock_count_sessions/i)
    expect(atomicArchive).not.toMatch(/UPDATE public\.stock_movements/i)
    expect(atomicArchive).not.toMatch(/UPDATE public\.product_inventory/i)
    expect(atomicArchive).not.toMatch(/UPDATE public\.products/i)
  })

  it('reconciliation is generic, idempotent and preserves all history', () => {
    expect(reconciliation).toContain('pv.is_active = false')
    expect(reconciliation).toContain("isc.status IN ('active', 'phase_out')")
    expect(reconciliation).toContain("SET status = 'inactive'")
    expect(reconciliation).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(reconciliation).not.toMatch(/stock_count_session_items\s+SET/i)
    expect(reconciliation).not.toMatch(/stock_movements\s+SET/i)
    expect(reconciliation).not.toMatch(/variant_name\s*=/i)
  })
})
