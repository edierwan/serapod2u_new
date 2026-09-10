import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * auto_create_stock_adjustment_from_movement must create an adjustment ONLY for
 * the two supported reason codes, and must skip everything else — including a
 * reason that matches no row at all, which is what it failed to do.
 *
 * The guard is pinned against the migration, and the decision itself is run as
 * a mirror of the SQL so the NULL case is exercised rather than asserted about.
 */

const migration = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260904140000_fix_auto_adjustment_unknown_reason.sql'),
  'utf8',
)
const cutover = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260904120000_legacy_config_cutover_execute.sql'),
  'utf8',
)

/** The supported set, unchanged by this fix. */
const SUPPORTED = ['quality_issue', 'return_to_supplier'] as const

/**
 * Mirrors the corrected guard:
 *
 *   IF v_reason_code IS NULL
 *      OR v_reason_code NOT IN ('quality_issue', 'return_to_supplier') THEN
 *     RETURN NEW;
 *
 * `reasonCode` is what the lookup against stock_adjustment_reasons returned:
 * null means the movement's reason text matched no row.
 */
function createsAdjustment(movement: {
  reason: string | null
  fromOrganizationId: string | null
  reasonCode: string | null
}): boolean {
  if (movement.reason === null) return false
  if (movement.reason === 'warehouse_receive') return false
  if (movement.fromOrganizationId === null) return false
  if (movement.reasonCode === null) return false
  return (SUPPORTED as readonly string[]).includes(movement.reasonCode)
}

const movement = (over: Partial<Parameters<typeof createsAdjustment>[0]> = {}) => ({
  reason: 'quality_issue',
  fromOrganizationId: 'wh-001',
  reasonCode: 'quality_issue',
  ...over,
})

describe('auto_create_stock_adjustment_from_movement', () => {
  it('1. a NULL reason creates no adjustment', () => {
    expect(createsAdjustment(movement({ reason: null, reasonCode: null }))).toBe(false)
  })

  it('2. an unknown reason creates no adjustment', () => {
    // The defect: the reason text matches no stock_adjustment_reasons row, the
    // lookup yields NULL, and `NULL NOT IN (...)` is NULL — so the old guard
    // did not fire and an adjustment was created anyway.
    expect(createsAdjustment(movement({ reason: 'Some ad-hoc correction', reasonCode: null }))).toBe(false)
    expect(createsAdjustment(movement({ reason: 'transfer_out', reasonCode: null }))).toBe(false)
  })

  it('3. quality_issue still creates an adjustment', () => {
    expect(createsAdjustment(movement({ reason: 'quality_issue', reasonCode: 'quality_issue' }))).toBe(true)
    // Also when the movement carries the reason NAME and the lookup resolves
    // it to the code, which is the other arm of the reasons query.
    expect(createsAdjustment(movement({ reason: 'Quality Issue', reasonCode: 'quality_issue' }))).toBe(true)
  })

  it('4. return_to_supplier still creates an adjustment', () => {
    expect(createsAdjustment(movement({ reason: 'return_to_supplier', reasonCode: 'return_to_supplier' }))).toBe(true)
    expect(createsAdjustment(movement({ reason: 'Return to Supplier', reasonCode: 'return_to_supplier' }))).toBe(true)
  })

  it('5. a legacy cutover retirement movement creates no adjustment', () => {
    // The cutover's reason matches no reason row, so the lookup returns NULL.
    // This is the case that generated 481 artifacts in staging and blocked the
    // cutover's own deactivation step.
    const retirementReason =
      'Legacy configuration retired to zero (UNCLASSIFIED). Not converted into 20NB; true quantity to be established by physical stock count.'
    expect(cutover).toContain('Legacy configuration retired to zero (%s)')
    expect(createsAdjustment(movement({ reason: retirementReason, reasonCode: null }))).toBe(false)
  })

  it('keeps the existing non-reason guards intact', () => {
    expect(createsAdjustment(movement({ reason: 'warehouse_receive', reasonCode: 'quality_issue' }))).toBe(false)
    expect(createsAdjustment(movement({ fromOrganizationId: null }))).toBe(false)
  })

  it('does not broaden the supported reason set', () => {
    for (const other of ['damage', 'expiry', 'stock_take', 'repack', 'legacy_config_cutover']) {
      expect(createsAdjustment(movement({ reason: other, reasonCode: other }))).toBe(false)
    }
  })
})

describe('the migration pins the corrected guard', () => {
  it('adds the IS NULL arm without touching the supported set', () => {
    expect(migration).toContain('IF v_reason_code IS NULL')
    expect(migration).toContain("OR v_reason_code NOT IN ('quality_issue', 'return_to_supplier') THEN")
    // Exactly the original two codes, nothing added.
    expect(migration.match(/'quality_issue', 'return_to_supplier'/g)?.length).toBe(2)
  })

  it('leaves the other guards and the insert bodies untouched', () => {
    expect(migration).toContain('IF NEW.reason IS NULL THEN')
    expect(migration).toContain("IF NEW.reason = 'warehouse_receive' THEN")
    expect(migration).toContain('IF NEW.from_organization_id IS NULL THEN')
    expect(migration).toContain('INSERT INTO public.stock_adjustments (')
    expect(migration).toContain('INSERT INTO public.stock_adjustment_items (')
  })

  it('records why the original comment was wrong', () => {
    expect(migration).toContain('The comment describes the intent; the code does the')
    expect(migration).toContain('`NULL NOT IN (...)` is NULL, NULL is not true')
  })
})
