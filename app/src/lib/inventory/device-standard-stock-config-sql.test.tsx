import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationsRoot = new URL('../../../../supabase/migrations/', import.meta.url)
const read = (name: string) => fs.readFileSync(new URL(name, migrationsRoot), 'utf8')

const deploymentRoot = new URL('../../../../supabase/deployment/20260813_device_standard_stock_config/', import.meta.url)
const readDeployment = (name: string) => fs.readFileSync(new URL(name, deploymentRoot), 'utf8')
const release = readDeployment('D_APPLY_release_phantom_stockcount_refs.sql')
const prodPurge = readDeployment('B2_APPLY_purge_device_concentration_configs.sql')

const repair = read('20260813120000_device_standard_stock_config_repair.sql')
const purge = read('20260813120100_device_remove_concentration_stock_configs.sql')
const groundwork = read('20260717_stock_config_01_groundwork.sql')
const groupProfile = read('20260727_stock_count_group_config_profile.sql')

/** Executable SQL only — `--` documentation is deliberately allowed to name the incident. */
const stripComments = (sql: string) => sql.replace(/^\s*--.*$/gm, '')

/** The in-place repair block, excluding the redefined Cartridge-only function. */
const repairBlock = stripComments(
  repair.slice(0, repair.indexOf('CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core')),
)
const coreFunction = repair.slice(
  repair.indexOf('CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core'),
)

/** Every FK column that can point at a stock configuration, per pg_constraint. */
const REFERENCING_TABLES = [
  'product_inventory',
  'stock_movements',
  'order_items',
  'warehouse_receipt_items',
  'stock_adjustment_items',
  'stock_count_session_items',
  'stock_count_session_scope',
  'stock_count_classification_allocation_resolutions',
  'inventory_cutoff_decisions',
  'inventory_cutoff_allocation_requests',
] as const

describe('Device Standard stock configuration repair (20260813120000)', () => {
  it('resolves Device structurally — vape product in a standard-profile group, never by name', () => {
    expect(repairBlock).toContain('p.is_vape IS TRUE')
    expect(repairBlock).toContain("COALESCE(g.stock_config_profile, 'standard') = 'standard'")
    // Product / variant names may appear in the documentation header, never in
    // the executable statements.
    expect(repairBlock).not.toMatch(/S\.Line|S\.Box|Oliver/)
    expect(stripComments(purge)).not.toMatch(/S\.Line|S\.Box|Oliver/)
  })

  it('refuses to run when the Device target set is empty', () => {
    expect(repair).toContain('Refusing to run a repair that targets nothing')
  })

  it('repairs the SAME generic row in place — no INSERT and no DELETE of configurations', () => {
    expect(repairBlock).toContain('UPDATE public.inventory_stock_configurations c')
    expect(repairBlock).not.toContain('DELETE FROM public.inventory_stock_configurations')
    expect(repairBlock).not.toContain('INSERT INTO public.inventory_stock_configurations (')
  })

  it('collapses both damaged production states into one in-place UPDATE', () => {
    // STATE 1 (UNCLASSIFIED + phase_out) and STATE 2 (STD + inactive) are both
    // matched by "generic row that is not already a correct STD row".
    expect(repairBlock).toContain('c.volume_ml IS NULL AND c.packaging IS NULL')
    expect(repairBlock).toContain("c.config_code NOT IN ('STD', 'UNCLASSIFIED')")
  })

  it('writes the complete STD invariant, not status alone', () => {
    for (const assignment of [
      "config_code                    = 'STD'",
      "config_label                   = 'Standard'",
      "status                         = 'active'",
      'allow_so                       = true',
      'allow_ord                      = true',
      'default_for_ord                = true',
      'is_variant_default             = true',
      'requires_repacking_before_sale = false',
      'sort_order                     = 0',
    ]) {
      expect(repair).toContain(assignment)
    }
  })

  it('matches the invariant that create_default_stock_config_for_variant() seeds', () => {
    // The repaired row must be indistinguishable from a freshly created one.
    expect(groundwork).toContain("'STD', 'Standard'")
    expect(groundwork).toContain('true, true, true, true, \'active\', 0')
  })

  it('serialises against concurrent stock operations', () => {
    expect(repair).toContain('LOCK TABLE public.inventory_stock_configurations IN SHARE ROW EXCLUSIVE MODE')
  })

  it('backs up every row it changes into a timestamped audit table', () => {
    expect(repair).toContain('public._backup_device_stock_config_20260813')
    expect(repair).toContain("'repair_generic_to_std'")
    expect(repair).toContain('INCLUDING DEFAULTS')
  })

  it('aborts on every ambiguous state instead of guessing', () => {
    expect(repair).toContain('BLOCKED_DUPLICATE_GENERIC_CONFIG')
    expect(repair).toContain('BLOCKED_DUPLICATE_STD')
    expect(repair).toContain('UNEXPECTED_STATE')
    expect(repair).toContain('has no generic config')
    expect(repair).toContain('still holds default_for_ord')
    expect(repair).toContain('is_variant_default is held by config')
  })

  it('proves inventory quantities and allocations are unchanged before COMMIT', () => {
    expect(repair).toContain('sum(quantity_on_hand)')
    expect(repair).toContain('sum(quantity_allocated)')
    expect(repair).toContain('POST_CHECK_FAILED: inventory changed')
  })

  it('proves no Cartridge (concentration) configuration was modified', () => {
    expect(repair).toContain("COALESCE(g.stock_config_profile, 'standard') = 'concentration'")
    expect(repair).toContain('POST_CHECK_FAILED: a Cartridge (concentration) configuration was modified')
  })

  it('leaves stock_sku alone — it is snapshotted elsewhere and not part of the invariant', () => {
    // The repair never rewrites the business identifier; only the Cartridge-only
    // function (unchanged behaviour) still regenerates it.
    expect(repairBlock).not.toMatch(/stock_sku\s*=/)
    expect(coreFunction).toMatch(/stock_sku\s*=\s*public\.generate_stock_sku/)
  })
})

describe('Recurrence guard in _enable_variant_stock_configurations_core', () => {
  it('rejects any non-concentration group before mutating the Standard row', () => {
    const body = repair.slice(repair.indexOf('CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core'))
    const guardAt = body.indexOf("COALESCE(v_group_profile, 'standard') <> 'concentration'")
    const convertAt = body.indexOf("config_code   = 'UNCLASSIFIED'")
    expect(guardAt).toBeGreaterThan(-1)
    expect(convertAt).toBeGreaterThan(-1)
    // The guard must raise strictly BEFORE the STD -> UNCLASSIFIED conversion.
    expect(guardAt).toBeLessThan(convertAt)
  })

  it('raises a clear, typed database exception', () => {
    expect(repair).toContain('Concentration stock configurations (20NB/50NB/50OB) cannot be enabled for variant')
    expect(repair).toContain("USING ERRCODE = 'check_violation'")
    expect(repair).toContain('HINT =')
  })

  it('guards both supported profiles — transition and new_standard both create 20NB', () => {
    const body = repair.slice(repair.indexOf('CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core'))
    const guardAt = body.indexOf("COALESCE(v_group_profile, 'standard') <> 'concentration'")
    const profileBranchAt = body.indexOf("IF p_profile = 'transition' THEN")
    expect(guardAt).toBeLessThan(profileBranchAt)
  })

  it('keeps existing Cartridge behaviour byte-for-byte', () => {
    expect(repair).toContain("(p_variant_id, '20NB', '20ml · New Box'")
    expect(repair).toContain("20, 'new_box', false, true,  true,  true,  false, 'active',    1)")
    expect(repair).toContain("50, 'new_box', false, false, true,  false, false, 'active',    2)")
    expect(repair).toContain("50, 'old_box', false, false, false, false, true,  'phase_out', 3)")
  })

  it('complements — does not replace — the 20260727 row-level eligibility trigger', () => {
    expect(groupProfile).toContain('assert_stock_config_group_eligibility')
    expect(repair).not.toContain('DROP TRIGGER')
  })
})

describe('Device concentration configuration purge (20260813120100)', () => {
  it('counts references in every table that can point at a stock configuration', () => {
    for (const table of REFERENCING_TABLES) {
      expect(purge).toContain(`public.${table} x`)
    }
  })

  it('uses the classification-resolution target column, not stock_config_id', () => {
    expect(purge).toContain('x.target_stock_config_id = c.id')
  })

  it('deletes only provably unreferenced configurations', () => {
    expect(purge).toContain('total_refs')
    expect(purge).toContain('WHERE t.total_refs > 0')
  })

  it('aborts with BLOCKED_REFERENCED_LIQUID_CONFIG and per-table counts', () => {
    expect(purge).toContain('BLOCKED_REFERENCED_LIQUID_CONFIG')
    expect(purge).toContain('Manual treatment required for')
    expect(purge).toContain('stock_count_session_items=%s')
    expect(purge).toContain('stock_count_session_scope=%s')
  })

  it('documents why reference consolidation is not provably safe', () => {
    expect(purge).toContain('stock_count_session_items is UNIQUE (session_id, stock_config_id)')
    expect(purge).toContain('stock_count_session_scope is keyed on (session_id, stock_config_id)')
  })

  it('never repoints an existing reference at another configuration', () => {
    expect(purge).not.toMatch(/UPDATE\s+public\.(stock_count_session_items|stock_count_session_scope|stock_movements|product_inventory|order_items)/)
  })

  it('targets Device variants only and never a Cartridge configuration', () => {
    expect(purge).toContain('p.is_vape IS TRUE')
    expect(purge).toContain("COALESCE(g.stock_config_profile, 'standard') = 'standard'")
    expect(purge).toContain('POST_CHECK_FAILED: Cartridge configuration count changed')
  })

  it('removes every dimensioned configuration, not just the three known codes', () => {
    expect(purge).toContain("c.config_code IN ('20NB', '50NB', '50OB')")
    expect(purge).toContain('c.volume_ml IS NOT NULL')
    expect(purge).toContain('c.packaging IS NOT NULL')
  })

  it('leaves exactly one configuration per Device variant', () => {
    expect(purge).toContain('GROUP BY c.variant_id HAVING count(*) <> 1')
    expect(purge).toContain('POST_CHECK_FAILED: a Device variant still carries a concentration configuration')
  })

  it('proves quantities are unchanged and backs up every deleted row', () => {
    expect(purge).toContain("'purge_concentration_config'")
    expect(purge).toContain('POST_CHECK_FAILED: inventory changed')
  })

  it('tells the operator how to unblock rather than leaving them stuck', () => {
    expect(purge).toContain('archived and removed, then re-run this migration')
    expect(prodPurge).toContain('archived and removed, then re-run B2')
  })

  it('is a separate transaction so a blocked purge cannot roll back the repair', () => {
    expect(repair.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(purge.trimEnd().endsWith('COMMIT;')).toBe(true)
    // Exactly one transaction per file, so an abort in the purge cannot unwind
    // the repair that restores sellability.
    expect(stripComments(purge).match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(stripComments(repair).match(/^BEGIN;$/gm)).toHaveLength(1)
  })
})

describe('Phantom stock-count reference release (D — the only script that deletes history)', () => {
  it('deletes from the two stock-count tables and nothing else', () => {
    const deletes = stripComments(release).match(/DELETE FROM public\.\w+/g) ?? []
    expect(new Set(deletes)).toEqual(new Set([
      'DELETE FROM public.stock_count_session_items',
      'DELETE FROM public.stock_count_session_scope',
    ]))
  })

  it('scopes every delete to a phantom Device configuration', () => {
    // Both DELETEs must join _phantom_cfg — never a bare session-wide delete.
    for (const stmt of stripComments(release).split('DELETE FROM public.').slice(1)) {
      expect(stmt).toContain('_phantom_cfg pc')
    }
  })

  it('resolves phantom configs structurally, same rule as B1/B2', () => {
    expect(release).toContain('p.is_vape IS TRUE')
    expect(release).toContain("COALESCE(g.stock_config_profile, 'standard') = 'standard'")
  })

  it('refuses unless every affected session is archived and never posted', () => {
    expect(release).toContain('BLOCKED_SESSION_NOT_ARCHIVED_OR_POSTED')
    expect(release).toContain("s.status <> 'archived' OR s.posted_at IS NOT NULL OR s.posted_by IS NOT NULL")
  })

  it('refuses when a session carries non-zero aggregates', () => {
    expect(release).toContain('BLOCKED_SESSION_HAS_AGGREGATES')
    for (const col of ['total_variants_counted', 'variance_items', 'net_quantity_adjustment', 'estimated_adjustment_value']) {
      expect(release).toContain(col)
    }
  })

  it('refuses when an item carries any counted data — a physical count of zero still counts', () => {
    expect(release).toContain('BLOCKED_ITEM_HAS_COUNTED_DATA')
    // IS NOT NULL, not <> 0: "counted zero" is a real count and must block.
    expect(release).toContain('i.physical_quantity IS NOT NULL')
    expect(release).toContain('i.note IS NOT NULL')
  })

  it('refuses when a downstream record depends on an affected session', () => {
    expect(release).toContain('BLOCKED_SESSION_HAS_DEPENDENTS')
    for (const t of ['inventory_opening_cutoffs', 'stock_count_verification_requests',
                     'stock_count_classification_allocation_resolutions']) {
      expect(release).toContain(t)
    }
  })

  it('self-invalidates if a future migration adds an FK or DELETE trigger', () => {
    expect(release).toContain("tgt.relname IN ('stock_count_session_items','stock_count_session_scope')")
    expect(release).toContain('This script was written when nothing did')
    expect(release).toContain('(t.tgtype & 8) <> 0')
  })

  it('backs up complete rows before deleting them', () => {
    expect(release).toContain('public._backup_phantom_scope_20260813')
    expect(release).toContain('public._backup_phantom_items_20260813')
    expect(release).toContain("'release_phantom_device_config_ref'")
  })

  it('proves non-phantom stock-count rows and all quantities survive untouched', () => {
    expect(release).toContain('POST_CHECK_FAILED: non-phantom stock-count rows were affected')
    expect(release).toContain('POST_CHECK_FAILED: inventory changed')
    expect(release).toContain('POST_CHECK_FAILED: a stock_count_sessions row was modified')
  })

  it('never touches a configuration row — that is B2 job', () => {
    expect(stripComments(release)).not.toMatch(/DELETE FROM public\.inventory_stock_configurations/)
    expect(stripComments(release)).not.toMatch(/UPDATE public\.inventory_stock_configurations/)
  })

  it('leaves every phantom config fully unreferenced so B2 can run', () => {
    for (const table of REFERENCING_TABLES) {
      expect(release).toContain(`public.${table} x`)
    }
  })
})
