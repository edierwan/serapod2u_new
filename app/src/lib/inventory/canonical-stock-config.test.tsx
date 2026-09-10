import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isCanonicalCandidate,
  isLegacyConfigCode,
  resolveCanonicalStockConfig,
  shouldShowConfigurationColumn,
  LEGACY_CONFIG_CODES,
} from './canonical-stock-config'

const cfg = (overrides: Partial<Parameters<typeof isCanonicalCandidate>[0]> = {}) => ({
  id: 'cfg-20nb',
  config_code: '20NB',
  config_label: '20ml · New Box',
  status: 'active',
  default_for_ord: true,
  requires_repacking_before_sale: false,
  ...overrides,
})

const CELLERA = cfg()
const CELLERA_50NB = cfg({ id: 'cfg-50nb', config_code: '50NB', config_label: '50ml · New Box', default_for_ord: false })
const CELLERA_50OB = cfg({ id: 'cfg-50ob', config_code: '50OB', config_label: '50ml · Old Box', status: 'phase_out', default_for_ord: false, requires_repacking_before_sale: true })
const CELLERA_LEGACY = cfg({ id: 'cfg-unc', config_code: 'UNCLASSIFIED', config_label: 'Unclassified (pending stock take)', status: 'phase_out', default_for_ord: false })
const DEVICE_STD = cfg({ id: 'cfg-std', config_code: 'STD', config_label: 'Standard' })

describe('legacy configuration codes', () => {
  it('names exactly the codes retired by LEGACY-CONFIG-CUTOVER-2026', () => {
    expect([...LEGACY_CONFIG_CODES].sort()).toEqual(['50NB', '50OB', 'UNCLASSIFIED'])
  })

  it('never treats a canonical operational configuration as legacy', () => {
    expect(isLegacyConfigCode('20NB')).toBe(false)
    expect(isLegacyConfigCode('STD')).toBe(false)
    expect(isLegacyConfigCode('50NB')).toBe(true)
    expect(isLegacyConfigCode('50OB')).toBe(true)
    expect(isLegacyConfigCode('unclassified')).toBe(true)
    expect(isLegacyConfigCode('SOME-LEGACY-CODE')).toBe(true)
    expect(isLegacyConfigCode(null)).toBe(false)
  })
})

describe('canonical operational configuration resolver', () => {
  it('resolves a Cellera cartridge variant to 20NB', () => {
    const result = resolveCanonicalStockConfig(
      [CELLERA, CELLERA_50NB, CELLERA_50OB, CELLERA_LEGACY],
      'Banana Vanilla',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.configCode).toBe('20NB')
      expect(result.stockConfigId).toBe('cfg-20nb')
    }
  })

  it('resolves a non-vape variant to STD, not to 20NB', () => {
    const result = resolveCanonicalStockConfig([DEVICE_STD], 'Cosmos Black')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.configCode).toBe('STD')
  })

  it('fails loudly when no canonical configuration exists', () => {
    const result = resolveCanonicalStockConfig([CELLERA_50NB, CELLERA_LEGACY], 'Grape')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('none')
      expect(result.error).toMatch(/No canonical operational stock configuration for Grape/)
    }
  })

  it('fails loudly when more than one canonical configuration exists', () => {
    const result = resolveCanonicalStockConfig(
      [CELLERA, cfg({ id: 'cfg-other', config_code: 'STD', config_label: 'Standard' })],
      'Mango',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.error).toMatch(/Ambiguous/)
      expect(result.error).toMatch(/20NB, STD/)
    }
  })

  it('never falls back to the legacy Unclassified sink', () => {
    // The is_variant_default sink resolves to UNCLASSIFIED for every Cellera
    // variant. That fallback is what produced 303,598 legacy units, so a
    // variant whose only configuration is UNCLASSIFIED must resolve to nothing.
    const result = resolveCanonicalStockConfig([CELLERA_LEGACY], 'Keladi')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('cfg-unc')
  })

  it('rejects inactive, non-default and repack-required configurations', () => {
    expect(isCanonicalCandidate(cfg({ status: 'inactive' }))).toBe(false)
    expect(isCanonicalCandidate(cfg({ status: 'phase_out' }))).toBe(false)
    expect(isCanonicalCandidate(cfg({ default_for_ord: false }))).toBe(false)
    expect(isCanonicalCandidate(cfg({ requires_repacking_before_sale: true }))).toBe(false)
    expect(isCanonicalCandidate(CELLERA)).toBe(true)
  })
})

describe('operational Configuration column policy', () => {
  it('hides the column when every variant carries one configuration', () => {
    // A mixed Cellera + device list shows two codes overall but no CHOICE.
    expect(shouldShowConfigurationColumn([
      { variantId: 'v-1', stockConfigId: 'cfg-20nb', configCode: '20NB' },
      { variantId: 'v-2', stockConfigId: 'cfg-20nb-2', configCode: '20NB' },
      { variantId: 'v-3', stockConfigId: 'cfg-std', configCode: 'STD' },
    ])).toBe(false)
  })

  it('shows the column again when one variant carries two configurations', () => {
    expect(shouldShowConfigurationColumn([
      { variantId: 'v-1', stockConfigId: 'cfg-20nb', configCode: '20NB' },
      { variantId: 'v-1', stockConfigId: 'cfg-50nb', configCode: '50NB' },
    ])).toBe(true)
  })

  it('is stable on empty and incomplete input', () => {
    expect(shouldShowConfigurationColumn([])).toBe(false)
    expect(shouldShowConfigurationColumn([{ variantId: '', stockConfigId: 'x' }])).toBe(false)
    expect(shouldShowConfigurationColumn([{ variantId: 'v-1' }])).toBe(false)
  })
})

describe('SQL resolver mirrors the TypeScript rule', () => {
  const migration = readFileSync(
    path.resolve(__dirname, '../../../../supabase/migrations/20260904100000_canonical_operational_stock_config.sql'),
    'utf8',
  )

  it('defines the canonical candidate view with the same four predicates', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.v_canonical_stock_config')
    expect(migration).toContain("WHERE c.status = 'active'")
    expect(migration).toContain('AND c.default_for_ord')
    expect(migration).toContain("AND c.config_code <> 'UNCLASSIFIED'")
    expect(migration).toContain('AND NOT COALESCE(c.requires_repacking_before_sale, false)')
  })

  it('fails closed on zero and on more than one candidate', () => {
    expect(migration).toContain('No canonical operational stock configuration for variant')
    expect(migration).toContain('Ambiguous canonical operational stock configuration for variant')
    expect(migration).toContain("USING ERRCODE = 'no_data_found'")
    expect(migration).toContain("USING ERRCODE = 'cardinality_violation'")
  })

  it('does not hard-code 20NB as the answer', () => {
    const resolver = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.resolve_operational_stock_config'),
      migration.indexOf('COMMENT ON FUNCTION public.resolve_operational_stock_config'),
    )
    expect(resolver).not.toContain("'20NB'")
    expect(resolver).not.toContain("'STD'")
  })

  it('repoints every forward write path off the legacy sink', () => {
    for (const fn of [
      'record_stock_movement',
      'trg_stock_movements_fill_cost_and_balance',
      'post_return_case_inventory',
      'adjust_inventory_quantity',
      'apply_inventory_ship_adjustment',
      'wms_deduct_and_summarize',
      'stock_movements_apply_to_inventory',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`)
    }
    // Seven repointed bodies, and not one leftover forward call to the sink.
    const repointed = migration.split('Repointed write paths')[1]
    expect(repointed.match(/public\.resolve_operational_stock_config\(/g)?.length).toBe(7)
    expect(repointed).not.toContain('resolve_default_stock_config(')
  })

  it('documents why the two reversal paths keep the legacy sink', () => {
    expect(migration).toContain('release_allocation_for_order')
    expect(migration).toContain('revert_inventory_on_movement_delete')
    expect(migration).toContain('Both look BACKWARDS at where stock already sits')
  })
})
