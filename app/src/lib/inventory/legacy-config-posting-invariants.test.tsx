import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two invariants the cutover depends on, each proved twice: once by pinning the
 * exact SQL that implements it, and once by running the behaviour it describes.
 *
 * The runnable half is a deliberate mirror of the SQL, not a second
 * implementation — no production code imports it. It exists so a reviewer can
 * see the 5,520 / 1,300 arithmetic actually come out right rather than trust a
 * string match. Each mirrored line is pinned by an assertion against the
 * migration directly above or below it, so the mirror cannot drift from the SQL
 * without a test failing.
 *
 * The end-to-end proof against a real ledger is
 * supabase/operations/legacy_config_cutover_rehearsal.sql, which performs these
 * same postings inside a transaction it rolls back.
 */

const migration = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../../../supabase/migrations/${name}`), 'utf8')

const canonical = migration('20260904100000_canonical_operational_stock_config.sql')
const preflight = migration('20260904110000_legacy_config_cutover_preflight.sql')
const deactivate = migration('20260904130000_deactivate_legacy_cellera_configs.sql')
const cutover = migration('20260904120000_legacy_config_cutover_execute.sql')

/** The body of one function inside a migration, without its neighbours. */
const functionBody = (sql: string, name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const end = sql.indexOf('\n-- ---- ', start)
  return sql.slice(start, end === -1 ? undefined : end)
}

// ===========================================================================
// 1. An explicit stock_config_id is never overridden
// ===========================================================================

interface Ledger {
  /** quantity_on_hand keyed by stock_config_id */
  balances: Record<string, number>
  movements: Array<{ stockConfigId: string; quantityChange: number; before: number; after: number }>
}

/**
 * Mirrors record_stock_movement + stock_movements_apply_to_inventory:
 *
 *   v_config_id := COALESCE(p_stock_config_id, resolve_operational(...))
 *   ... locks product_inventory WHERE stock_config_id = v_config_id
 *   ... v_new_qty := v_current_qty + p_quantity_change  (must be >= 0)
 *
 * `resolveCanonical` stands in for the resolver and is only ever consulted when
 * no configuration was supplied.
 */
function postMovement(
  ledger: Ledger,
  input: { stockConfigId?: string | null; quantityChange: number; resolveCanonical: () => string },
): Ledger {
  const configId = input.stockConfigId ?? input.resolveCanonical()
  const before = ledger.balances[configId]
  if (before === undefined) {
    if (input.quantityChange < 0) throw new Error('Inventory not found for outgoing movement')
    ledger.balances[configId] = 0
  }
  const current = ledger.balances[configId]
  const after = current + input.quantityChange
  if (after < 0) throw new Error(`Insufficient stock. Current: ${current}, requested change: ${input.quantityChange}`)
  ledger.balances[configId] = after
  ledger.movements.push({ stockConfigId: configId, quantityChange: input.quantityChange, before: current, after })
  return ledger
}

const openingLedger = (): Ledger => ({
  balances: { '20NB': 5520, '50NB': 1300, UNCLASSIFIED: 27 },
  movements: [],
})

/** Consulting the resolver at all would be a bug in these scenarios. */
const resolverMustNotBeCalled = () => {
  throw new Error('canonical resolver was consulted for an explicit configuration')
}

describe('an explicit stock_config_id is never overridden by the resolver', () => {
  it('pins the guard in every function that assigns a configuration', () => {
    // record_stock_movement: explicit argument first, resolver only as fallback.
    expect(functionBody(canonical, 'record_stock_movement')).toContain(
      'v_config_id := COALESCE(p_stock_config_id, public.resolve_operational_stock_config(p_variant_id));',
    )
    // BEFORE trigger: fills only when the row carries no configuration.
    const fill = functionBody(canonical, 'trg_stock_movements_fill_cost_and_balance')
    expect(fill).toContain('IF NEW.stock_config_id IS NULL THEN')
    expect(fill).toContain('NEW.stock_config_id := public.resolve_operational_stock_config(NEW.variant_id);')
    // AFTER trigger: applies to the configuration the movement already carries.
    expect(functionBody(canonical, 'stock_movements_apply_to_inventory')).toContain(
      'v_config_id := COALESCE(NEW.stock_config_id, public.resolve_operational_stock_config(NEW.variant_id));',
    )
  })

  it('validates configuration OWNERSHIP only, so a phase_out legacy code stays postable', () => {
    const record = functionBody(canonical, 'record_stock_movement')
    // The only check on the resolved configuration is that it belongs to the
    // variant. A status filter here would make the cutover impossible, because
    // 50OB and UNCLASSIFIED are phase_out.
    expect(record).toContain('WHERE c.id = v_config_id AND c.variant_id = p_variant_id')
    expect(record).toContain('Stock configuration % does not belong to variant %')
    expect(record).not.toMatch(/c\.status\s*=\s*'active'/)
    expect(canonical).toContain('It deliberately does not check status, so a phase_out 50NB or')
  })

  it('uses the chosen configuration verbatim for the movement and the balance', () => {
    const record = functionBody(canonical, 'record_stock_movement')
    expect(record).toContain('AND stock_config_id = v_config_id')
    const apply = functionBody(canonical, 'stock_movements_apply_to_inventory')
    expect(apply).toContain('AND stock_config_id = v_config_id')
  })

  it('retires 50NB 1,300 → 0 and leaves 20NB 5,520 untouched', () => {
    const ledger = postMovement(openingLedger(), {
      stockConfigId: '50NB',
      quantityChange: -1300,
      resolveCanonical: resolverMustNotBeCalled,
    })

    expect(ledger.balances).toEqual({ '20NB': 5520, '50NB': 0, UNCLASSIFIED: 27 })
    expect(ledger.movements).toEqual([
      { stockConfigId: '50NB', quantityChange: -1300, before: 1300, after: 0 },
    ])
  })

  it('retires UNCLASSIFIED 27 → 0 and leaves 20NB 5,520 untouched', () => {
    const ledger = postMovement(openingLedger(), {
      stockConfigId: 'UNCLASSIFIED',
      quantityChange: -27,
      resolveCanonical: resolverMustNotBeCalled,
    })

    expect(ledger.balances).toEqual({ '20NB': 5520, '50NB': 1300, UNCLASSIFIED: 0 })
    expect(ledger.movements[0]).toEqual({
      stockConfigId: 'UNCLASSIFIED', quantityChange: -27, before: 27, after: 0,
    })
  })

  it('leaves 20NB at exactly 5,520 after retiring both legacy balances', () => {
    // The whole point of the business decision: 5,520 + 1,300 + 27 is never
    // summed. 20NB ends the cutover at the number it started with, and the
    // physical count establishes the truth afterwards.
    let ledger = openingLedger()
    ledger = postMovement(ledger, { stockConfigId: '50NB', quantityChange: -1300, resolveCanonical: resolverMustNotBeCalled })
    ledger = postMovement(ledger, { stockConfigId: 'UNCLASSIFIED', quantityChange: -27, resolveCanonical: resolverMustNotBeCalled })

    expect(ledger.balances).toEqual({ '20NB': 5520, '50NB': 0, UNCLASSIFIED: 0 })
    expect(ledger.movements.every((m) => m.quantityChange < 0)).toBe(true)
    expect(ledger.movements.some((m) => m.stockConfigId === '20NB')).toBe(false)

    // A later physical count of 8,800 is an ordinary variance on 20NB alone.
    ledger = postMovement(ledger, { stockConfigId: '20NB', quantityChange: 8800 - 5520, resolveCanonical: resolverMustNotBeCalled })
    expect(ledger.balances['20NB']).toBe(8800)
  })

  it('still resolves canonically when NO configuration is supplied', () => {
    const ledger = postMovement(openingLedger(), {
      stockConfigId: null,
      quantityChange: 40,
      resolveCanonical: () => '20NB',
    })
    expect(ledger.balances['20NB']).toBe(5560)
    expect(ledger.balances['50NB']).toBe(1300)
  })

  it('refuses to overdraw the configuration it was given', () => {
    expect(() => postMovement(openingLedger(), {
      stockConfigId: '50NB',
      quantityChange: -1301,
      resolveCanonical: resolverMustNotBeCalled,
    })).toThrow(/Insufficient stock. Current: 1300/)
  })

  it('only posts against active inventory rows, and the preflight covers the rest', () => {
    expect(cutover).toContain('AND pi.is_active')
    expect(cutover).toContain('record_stock_movement only locates active inventory rows')
    expect(preflight).toContain('INACTIVE_LEGACY_INVENTORY_ROWS')
  })
})

// ===========================================================================
// 2. LIVE_LEGACY_WRITER is activation-relative, not window-relative
// ===========================================================================

const ACTIVATED_AT = Date.parse('2026-09-10T00:00:00Z')

/**
 * Mirrors preflight blocker 4:
 *
 *   IF v_activated_at IS NULL THEN block CANONICAL_RESOLVER_NOT_ACTIVATED
 *   ELSE block on legacy movements WHERE created_at > v_activated_at
 *                                    AND reference_type <> 'legacy_config_cutover'
 */
function liveWriterBlocker(
  activatedAt: number | null,
  movements: Array<{ createdAt: string; referenceType: string }>,
): string | null {
  if (activatedAt === null) return 'CANONICAL_RESOLVER_NOT_ACTIVATED'
  const offending = movements.filter(
    (m) => Date.parse(m.createdAt) > activatedAt && m.referenceType !== 'legacy_config_cutover',
  )
  return offending.length > 0 ? 'LIVE_LEGACY_WRITER' : null
}

describe('LIVE_LEGACY_WRITER blocks on writes after activation, not before', () => {
  it('pins the activation stamp to the same transaction as the repointed paths', () => {
    expect(canonical).toContain('CREATE TABLE IF NOT EXISTS public.canonical_stock_config_activation')
    expect(canonical).toContain('ON CONFLICT (singleton) DO NOTHING')
    expect(canonical).toContain('CREATE OR REPLACE FUNCTION public.canonical_stock_config_activated_at()')
    // One transaction: the stamp and the behaviour it describes cannot disagree.
    expect(canonical.indexOf('BEGIN;')).toBeLessThan(canonical.indexOf('canonical_stock_config_activation'))
    expect(canonical.indexOf('canonical_stock_config_activation')).toBeLessThan(canonical.lastIndexOf('COMMIT;'))
    expect(canonical).toContain('Re-applying the')
    expect(canonical).toContain('migration keeps the original stamp')
  })

  it('pins the preflight predicate to the activation instant', () => {
    expect(preflight).toContain('v_activated_at := public.canonical_stock_config_activated_at();')
    expect(preflight).toContain('AND sm.created_at > v_activated_at')
    expect(preflight).toContain("AND sm.reference_type <> 'legacy_config_cutover'")
    expect(preflight).toContain('Activation-relative, never window-relative')
    // The day window survives only for the non-blocking historical summary.
    expect(preflight).toContain('AND (v_activated_at IS NULL OR sm.created_at <= v_activated_at)')
    expect(preflight).toContain("'historical_legacy_writers'")
  })

  it('does not block on legacy movements posted BEFORE activation', () => {
    // Production's 484 return movements, 2026-07-29 → 2026-09-04.
    const historical = [
      { createdAt: '2026-07-29T00:00:00Z', referenceType: 'return' },
      { createdAt: '2026-09-03T07:35:35Z', referenceType: 'return' },
      { createdAt: '2026-09-04T08:55:28Z', referenceType: 'return' },
      { createdAt: '2026-09-09T23:59:59Z', referenceType: 'adjustment' },
    ]
    expect(liveWriterBlocker(ACTIVATED_AT, historical)).toBeNull()
  })

  it('blocks on a single legacy movement posted AFTER activation', () => {
    const withOneAfter = [
      { createdAt: '2026-09-04T08:55:28Z', referenceType: 'return' },
      { createdAt: '2026-09-10T00:00:01Z', referenceType: 'return' },
    ]
    expect(liveWriterBlocker(ACTIVATED_AT, withOneAfter)).toBe('LIVE_LEGACY_WRITER')
  })

  it('does not block on the cutover’s own retirement movements', () => {
    const afterActivation = [
      { createdAt: '2026-09-11T10:00:00Z', referenceType: 'legacy_config_cutover' },
      { createdAt: '2026-09-11T10:00:00Z', referenceType: 'legacy_config_cutover' },
    ]
    expect(liveWriterBlocker(ACTIVATED_AT, afterActivation)).toBeNull()
  })

  it('blocks outright when the resolver has not been activated in this environment', () => {
    expect(liveWriterBlocker(null, [])).toBe('CANONICAL_RESOLVER_NOT_ACTIVATED')
    expect(preflight).toContain('CANONICAL_RESOLVER_NOT_ACTIVATED')
    expect(preflight).toContain('still resolve to the legacy sink')
  })

  it('applies the same activation rule to phase 4 deactivation', () => {
    expect(deactivate).toContain('v_activated_at := public.canonical_stock_config_activated_at();')
    expect(deactivate).toContain('AND sm.created_at > v_activated_at')
    expect(deactivate).not.toContain("interval '7 days'")
    expect(deactivate).toContain('history before activation never blocks')
  })
})
