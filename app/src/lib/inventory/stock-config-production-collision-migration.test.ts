import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(
  new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
  'utf8',
)

const groundwork = migration('20260717_stock_config_01_groundwork.sql')
const phase8 = migration('20260717_stock_config_08_initial_classification.sql')
const forwardFix = migration('20260719_stock_config_19_collision_safe_stock_sku_generator.sql')
const preflight = readFileSync(
  new URL('../../../../supabase/diagnostics/20260719_stock_config_production_preflight.sql', import.meta.url),
  'utf8',
)

const laterMigrations = [
  '20260717_stock_config_02_core_ledger.sql',
  '20260717_stock_config_03_ord_repack.sql',
  '20260717_stock_config_04_stock_count.sql',
  '20260717_stock_config_05_so_fulfilment.sql',
  '20260717_stock_config_06_views_reports.sql',
  '20260717_stock_config_07_reference_type_fix.sql',
  '20260717_stock_config_08_initial_classification.sql',
  '20260718_stock_config_09_full_count_classification_guard.sql',
  '20260718_stock_config_10_repack_to_20nb.sql',
  '20260718_stock_config_11_transfer_workflow.sql',
  '20260718_stock_config_12_transfer_dispatch_lifecycle.sql',
  '20260718_stock_config_13_manual_stock_addition.sql',
  '20260719_stock_config_14_classification_post_grant.sql',
  '20260719_stock_config_15_posting_statement_timeout.sql',
  '20260719_stock_config_16_classification_allocation_legacy_guards.sql',
  '20260719_stock_config_17_discard_stock_count_drafts.sql',
  '20260719_stock_config_18_classification_allow_physical_variance.sql',
].map(migration).join('\n')

const generatedSku = (productCode: string, configCode: string, variantId: string) =>
  `${productCode}-${configCode}-${variantId.replaceAll('-', '')}`.toUpperCase()

const functionDefinition = (sql: string, signature: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`)
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end + 3)
}

describe('Migration 01 duplicate Product Code production safety', () => {
  it('generates different stable SKUs for several TE variants in one seed set', () => {
    const variants = [
      { id: '00000000-0000-0000-0000-000000000401', productCode: 'TE' },
      { id: '00000000-0000-0000-0000-000000000402', productCode: 'TE' },
      { id: '00000000-0000-0000-0000-000000000403', productCode: 'TE' },
    ]

    const firstPass = variants.map(({ id, productCode }) => generatedSku(productCode, 'STD', id))
    const retry = variants.map(({ id, productCode }) => generatedSku(productCode, 'STD', id))

    expect(new Set(firstPass).size).toBe(variants.length)
    expect(retry).toEqual(firstPass)
    expect(firstPass).toEqual([
      'TE-STD-00000000000000000000000000000401',
      'TE-STD-00000000000000000000000000000402',
      'TE-STD-00000000000000000000000000000403',
    ])
  })

  it('uses the variant UUID instead of a statement-snapshot free-suffix lookup', () => {
    const generator = groundwork.slice(
      groundwork.indexOf('CREATE OR REPLACE FUNCTION public.generate_stock_sku'),
      groundwork.indexOf('-- ----------------------------------------------------------------------------\n-- 3.', groundwork.indexOf('CREATE OR REPLACE FUNCTION public.generate_stock_sku')),
    )

    expect(generator).toContain("replace(p_variant_id::text, '-', '')")
    expect(generator).not.toMatch(/WHILE\s+EXISTS/i)
    expect(generator).not.toMatch(/FROM\s+public\.inventory_stock_configurations/i)
  })

  it('preserves the case-insensitive unique index and makes the bulk seed retry-safe', () => {
    expect(groundwork).toContain('ON public.inventory_stock_configurations (upper(stock_sku))')
    expect(groundwork).toContain('ON CONFLICT (variant_id, config_code) DO NOTHING')
    expect(groundwork).toContain('AND c.is_variant_default')
  })

  it('uses the same safe generator for trigger, STD to UNC, and every physical configuration', () => {
    expect(groundwork).toContain('AFTER INSERT ON public.product_variants')
    expect(groundwork).toContain("public.generate_stock_sku(NEW.id, 'STD')")

    for (const configCode of ['UNC', '20NB', '50NB', '50OB']) {
      expect(groundwork).toContain(`public.generate_stock_sku(p_variant_id, '${configCode}')`)
      expect(phase8).toContain(`public.generate_stock_sku(p_variant_id, '${configCode}')`)
    }
  })

  it('does not use stock_sku text as a relational key in Migrations 02 to 18', () => {
    expect(laterMigrations).not.toMatch(/\b\w+\.stock_sku\b\s*(?:=|LIKE\b|ILIKE\b|IN\s*\()/i)
    expect(laterMigrations).toContain("config_code = 'UNCLASSIFIED'")
    expect(laterMigrations).toContain('stock_config_id')
  })

  it('keeps the production preflight read-only and schema-safe', () => {
    expect(preflight).toContain("to_jsonb(pv) ->> 'product_code'")
    expect(preflight).toContain("to_jsonb(pv) ->> 'variant_code'")
    expect(preflight).not.toMatch(/\bpv\.name\b/i)
    expect(preflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i)
    expect(preflight).toContain('variants_that_legacy_generator_maps_to_te_std')
    expect(preflight).toContain('phase_01_application_assessment')
  })
})

describe('Migration 19 forward correction for already-migrated databases', () => {
  it('installs the exact patched generator and refreshes its dependent trigger function idempotently', () => {
    expect(functionDefinition(forwardFix, 'public.generate_stock_sku'))
      .toBe(functionDefinition(groundwork, 'public.generate_stock_sku'))
    expect(functionDefinition(forwardFix, 'public.create_default_stock_config_for_variant'))
      .toBe(functionDefinition(groundwork, 'public.create_default_stock_config_for_variant'))
    expect(forwardFix.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2)
  })

  it('can be applied over legacy TE-STD rows without rewriting existing SKUs', () => {
    const definitionBodiesRemoved = forwardFix.replace(/AS \$\$[\s\S]*?\$\$;/g, '')

    expect(definitionBodiesRemoved).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i)
    expect(forwardFix).not.toMatch(/UPDATE\s+public\.inventory_stock_configurations/i)
    expect(forwardFix).not.toMatch(/\bTE-STD\b/)
    expect(forwardFix).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i)
  })

  it('keeps new duplicate-TE variants unique for every supported generated configuration', () => {
    const variants = [
      '00000000-0000-0000-0000-000000000501',
      '00000000-0000-0000-0000-000000000502',
    ]

    for (const configCode of ['STD', 'UNC', '20NB', '50NB', '50OB']) {
      const generated = variants.map(variantId => generatedSku('TE', configCode, variantId))
      expect(new Set(generated).size).toBe(variants.length)
      expect(generated.every(sku => sku.startsWith(`TE-${configCode}-`))).toBe(true)
    }
  })

  it('cannot change inventory balances or movements', () => {
    expect(forwardFix).not.toMatch(/\bpublic\.product_inventory\b/i)
    expect(forwardFix).not.toMatch(/\bpublic\.stock_movements\b/i)
    expect(forwardFix).not.toMatch(/\brecord_stock_movement\b/i)
  })

  it('lets the production preflight distinguish legacy and collision-safe installed definitions', () => {
    expect(preflight).toContain('installed_stock_sku_generator_version')
    expect(preflight).toContain('COLLISION_SAFE_VARIANT_UUID_V2')
    expect(preflight).toContain('LEGACY_STATEMENT_SNAPSHOT_SUFFIX_V1')
    expect(preflight).toContain('installed_default_configuration_trigger_function')
  })
})
