import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../../../supabase/migrations/${name}`), 'utf8')

const preflight = migration('20260904110000_legacy_config_cutover_preflight.sql')
const cutover = migration('20260904120000_legacy_config_cutover_execute.sql')
const deactivate = migration('20260904130000_deactivate_legacy_cellera_configs.sql')

/** The executable half of the cutover migration, without its explanatory header. */
const cutoverBody = cutover.slice(cutover.indexOf('BEGIN;'))

const component = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, `../../${relativePath}`), 'utf8')

describe('legacy configuration scope', () => {
  it('retires exactly 50NB, 50OB and UNCLASSIFIED', () => {
    expect(preflight).toContain("SELECT ARRAY['50NB', '50OB', 'UNCLASSIFIED']::text[]")
  })

  it('never puts STD or 20NB in scope', () => {
    expect(preflight).toContain('STD is NOT legacy')
    expect(cutover).toContain("IF v_codes && ARRAY['STD', '20NB']::text[] THEN")
    expect(cutover).toContain('STD and 20NB are canonical operational configurations and cannot be retired')
  })
})

describe('cutover preflight', () => {
  it('reports every blocker class the production assessment found', () => {
    for (const code of [
      'OPEN_STOCK_TRANSFERS',
      'UNPOSTED_STOCK_ADJUSTMENTS',
      'OPEN_STOCK_COUNT_SESSIONS',
      'LIVE_LEGACY_WRITER',
      'UNBOUND_OPEN_ORDER_ITEMS',
      'UNRESOLVABLE_ACTIVE_VARIANTS',
      'ALLOCATED_LEGACY_STOCK',
    ]) {
      expect(preflight).toContain(code)
    }
  })

  it('is read-only and cancels nothing', () => {
    expect(preflight).toContain('STABLE')
    expect(preflight).toContain('Cancels nothing')
    expect(preflight).not.toMatch(/\bUPDATE public\./)
    expect(preflight).not.toMatch(/\bDELETE FROM public\./)
    expect(preflight).not.toMatch(/\bINSERT INTO public\./)
  })

  it('counts the transfer lines that carry no configuration at all', () => {
    expect(preflight).toContain('lines_without_config')
    expect(preflight).toContain("NULLIF(it->>'stock_config_id', '') IS NULL")
  })

  it('separates blocking conditions from warnings', () => {
    expect(preflight).toContain("'blocking_count'")
    expect(preflight).toContain("'warning_count'")
    expect(preflight).toContain("'ok', v_blockers = '[]'::jsonb")
  })
})

describe('cutover execution', () => {
  it('refuses to run while a blocker stands', () => {
    expect(cutover).toContain('v_preflight := public.legacy_config_cutover_preflight()')
    expect(cutover).toContain('Legacy configuration cutover refused')
    expect(cutover).toContain('this function does not cancel documents')
  })

  it('retires balances to zero without crediting any other configuration', () => {
    // A retirement is one negative movement on the LEGACY configuration.
    expect(cutover).toContain('p_quantity_change => -v_row.qty_on_hand')
    expect(cutover).toContain('p_stock_config_id => v_row.stock_config_id')
    expect(cutover).toContain('No 20NB row is touched, credited or created anywhere in this loop')
    // Nothing anywhere posts a positive quantity or resolves a canonical target.
    expect(cutoverBody).not.toContain('repack_stock_v2')
    expect(cutoverBody).not.toContain('resolve_operational_stock_config')
    // Every quantity this function posts is negative. There is no credit leg.
    const quantityArgs = cutoverBody.match(/p_quantity_change\s*=>\s*\S+/g) || []
    expect(quantityArgs).toHaveLength(1)
    expect(quantityArgs.every((arg) => /=>\s*-/.test(arg))).toBe(true)
  })

  it('states why repack_stock_v2 is deliberately not used', () => {
    expect(cutover).toContain('repack_stock_v2() is NOT used here')
    expect(cutover).toContain('50NB is a different nicotine strength and must not')
    expect(cutover).toContain('OLD 20NB + OLD 50NB + OLD UNCLASSIFIED must never be summed')
  })

  it('never updates product_inventory balances directly', () => {
    expect(cutover).toContain('Balances are never UPDATEd directly')
    expect(cutover).toContain('public.record_stock_movement(')
    expect(cutover).not.toMatch(/UPDATE public\.product_inventory/)
  })

  it('carries the required audit fields on every retirement movement', () => {
    expect(cutover).toContain("c_reference   CONSTANT text := 'LEGACY-CONFIG-CUTOVER-2026'")
    expect(cutover).toContain("p_reference_type  => 'legacy_config_cutover'")
    expect(cutover).toContain('p_reference_id    => p_request_id')
    expect(cutover).toContain('quantity_before=%s; quantity_after=0')
    expect(cutover).toContain('p_created_by      => p_performed_by')
    expect(cutover).toContain("'legacy_config_cutover'::text")
  })

  it('is idempotent on the request id and defaults to a dry run', () => {
    expect(cutover).toContain("pg_advisory_xact_lock(\n    hashtextextended('legacy-config-cutover:'")
    expect(cutover).toContain("'idempotent_replay', true")
    expect(cutover).toContain('p_dry_run      boolean DEFAULT true')
  })

  it('snapshots every configuration permanently before anything moves', () => {
    expect(cutover).toContain('CREATE TABLE IF NOT EXISTS public.legacy_config_cutover_snapshot')
    for (const column of [
      'organization_id', 'org_code', 'product_name', 'variant_id', 'variant_name',
      'stock_config_id', 'config_code', 'quantity_on_hand', 'quantity_allocated',
      'quantity_available', 'captured_by', 'captured_at', 'request_id',
    ]) {
      expect(cutover).toContain(column)
    }
    expect(cutover).toContain('Taken for EVERY configuration, not only the retired ones')
    expect(cutover).toContain('Never deleted, never rewritten')
  })

  it('refuses to retire a balance an order is holding', () => {
    expect(cutover).toContain('units are allocated to an order')
  })

  it('retires distributor balances on the same audited terms', () => {
    expect(cutover).toContain('Distributor balances are retired on the same terms')
    expect(cutover).toContain("distributor's inventory starts from legitimate future movements, orders and")
  })
})

describe('phase 4 deactivation', () => {
  it('installs a guarded function rather than changing configuration rows', () => {
    expect(deactivate).toContain('CREATE OR REPLACE FUNCTION public.deactivate_legacy_stock_configs')
    expect(deactivate).toContain('changes no configuration row')
    expect(deactivate).toContain('p_dry_run boolean DEFAULT true')
  })

  it('requires zero balances, no live writer and a clean preflight', () => {
    expect(deactivate).toContain('legacy configurations still carry stock')
    expect(deactivate).toContain('non-cutover movement(s) posted into a legacy configuration')
    expect(deactivate).toContain('blocking preflight condition(s) remain')
  })

  it('deactivates instead of deleting, and leaves the canonical codes alone', () => {
    expect(deactivate).toContain("SET status = 'inactive'")
    expect(deactivate).toContain('Configuration ROWS ARE NEVER DELETED')
    expect(deactivate).not.toMatch(/DELETE FROM public\.inventory_stock_configurations/)
    expect(deactivate).toContain('20NB remains the Cellera canonical operational configuration')
    expect(deactivate).toContain('STD  remains the non-vape canonical operational configuration')
  })
})

describe('operational UI hides configuration where there is no choice', () => {
  const addStock = component('components/inventory/AddStockView.tsx')
  const transfer = component('components/inventory/StockTransferView.tsx')
  const adjustment = component('components/inventory/StockAdjustmentView.tsx')
  const movementReport = component('components/inventory/StockMovementReportView.tsx')

  it('drives Add Stock, Stock Transfer and Stock Adjustment from the shared policy', () => {
    for (const source of [addStock, transfer, adjustment]) {
      expect(source).toContain("from '@/lib/inventory/canonical-stock-config'")
      expect(source).toContain('shouldShowConfigurationColumn')
      expect(source).toContain('showConfiguration')
    }
  })

  it('keeps submitting the exact resolved stock_config_id', () => {
    // Hiding the column is display-only: identity still travels to the server.
    expect(transfer).toContain('stock_config_id')
    expect(addStock).toContain('stockConfigId')
    expect(adjustment).toContain('stockConfigId')
  })

  it('never hides configuration on historical movement reporting', () => {
    expect(movementReport).toContain('Stock SKU / Configuration')
    expect(movementReport).not.toContain('shouldShowConfigurationColumn')
  })

  it('keeps the legacy classification sub-table showing configuration', () => {
    expect(adjustment).toContain('Legacy Source — Read Only')
    expect(adjustment).toContain('there the configuration IS the')
  })
})
