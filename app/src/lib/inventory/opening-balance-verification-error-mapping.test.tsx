import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  mapStockCountDatabaseError,
  requiresFreshStockCountVerification,
  stockCountVerificationError,
} from './stock-count-verification-errors'

/**
 * SC-MSB3UFDM-1FSK reached the operator as "We couldn't post the Stock Count due
 * to an unexpected error." The server had actually raised a precise P0001
 * ('inventory_cutoff_distributor_decision_stale'), but NO inventory_cutoff_*
 * code was in the mapping table, so every Opening Balance rejection collapsed
 * into `unexpected_error` and the operator had nothing to act on.
 */

const REFERENCE = 'SC-MSB3UFDM-1FSK'

describe('Opening Balance posting errors map to actionable messages', () => {
  it('maps the SC-MSB3UFDM-1FSK failure to a specific, actionable code', () => {
    const mapped = mapStockCountDatabaseError(
      'inventory_cutoff_distributor_decision_stale',
      'post',
      'P0001',
      REFERENCE,
    )
    expect(mapped.code).toBe('opening_balance_distributor_decision_stale')
    expect(mapped.code).not.toBe('unexpected_error')
    expect(mapped.message).toMatch(/Reopen Step 2 \(Distributor Orders\)/)
    expect(mapped.message).toMatch(/No inventory was changed/)
    expect(mapped.reference).toBe(REFERENCE)
    expect(mapped.recoverable).toBe(true)
  })

  it.each<[string, string]>([
    ['inventory_cutoff_distributor_decision_stale', 'opening_balance_distributor_decision_stale'],
    ['inventory_cutoff_distributor_not_eligible', 'opening_balance_distributor_decision_stale'],
    ['inventory_cutoff_manufacturer_decision_stale', 'opening_balance_manufacturer_decision_stale'],
    ['inventory_cutoff_manufacturer_not_eligible', 'opening_balance_manufacturer_decision_stale'],
    ['inventory_cutoff_mixed_order_decisions', 'opening_balance_mixed_decisions'],
    ['inventory_cutoff_mixed_manufacturer_order_decisions', 'opening_balance_mixed_decisions'],
    ['inventory_cutoff_transactions_policy_required', 'opening_balance_policy_required'],
    ['inventory_cutoff_d2h_policy_required', 'opening_balance_policy_required'],
    ['inventory_cutoff_h2m_policy_required', 'opening_balance_policy_required'],
    ['inventory_cutoff_transactions_policy_scope_changed', 'opening_balance_policy_scope_changed'],
    ['inventory_cutoff_h2m_policy_stale_incoming', 'opening_balance_policy_scope_changed'],
    ['inventory_cutoff_stale_preflight_data', 'opening_balance_policy_scope_changed'],
    ['inventory_cutoff_allocation_owner_unresolved', 'opening_balance_allocation_owner_unresolved'],
    ['inventory_cutoff_product_category_scope_mismatch', 'opening_balance_category_scope_mismatch'],
    ['inventory_cutoff_20ml_new_box_missing', 'opening_balance_config_missing'],
    ['inventory_cutoff_not_ready: []', 'opening_balance_not_ready'],
    ['inventory_cutoff_not_active', 'opening_balance_freeze_inactive'],
  ])('maps %s without falling back to unexpected_error', (raw, expected) => {
    const mapped = mapStockCountDatabaseError(raw, 'post', 'P0001', REFERENCE)
    expect(mapped.code).toBe(expected)
    expect(mapped.message).toMatch(/No inventory was changed/)
    expect(mapped.reference).toBe(REFERENCE)
  })

  it('names the offending order when a carry-forward runs short of stock', () => {
    const mapped = mapStockCountDatabaseError(
      'inventory_cutoff_carried_allocation_shortage: order SO26000085, config cfg-1, quantity 500',
      'post',
      'P0001',
      REFERENCE,
    )
    expect(mapped.code).toBe('opening_balance_allocation_shortage')
    expect(mapped.message).toContain('order SO26000085, config cfg-1, quantity 500')
    expect(mapped.reference).toBe(REFERENCE)
  })

  it('retains the correlation reference on every mapped code, not just unexpected_error', () => {
    for (const raw of ['stock_count_already_posted', 'verification_code_expired', 'inventory_cutoff_not_ready']) {
      expect(mapStockCountDatabaseError(raw, 'post', 'P0001', REFERENCE).reference).toBe(REFERENCE)
    }
    expect(mapStockCountDatabaseError('something nobody mapped', 'post', 'P0001', REFERENCE).reference).toBe(REFERENCE)
    expect(stockCountVerificationError('posting_timeout', { stage: 'post', reference: REFERENCE }).reference).toBe(REFERENCE)
  })

  it('keeps transient SQLSTATE handling ahead of message matching (same code stays valid)', () => {
    expect(mapStockCountDatabaseError('canceling statement due to statement timeout', 'post', '57014').code)
      .toBe('posting_timeout')
    expect(mapStockCountDatabaseError('lock timeout', 'post', '55P03').code).toBe('posting_conflict')
    expect(mapStockCountDatabaseError('deadlock', 'post', '40P01').code).toBe('posting_conflict')
    // Both explicitly tell the operator the existing code is still usable.
    expect(mapStockCountDatabaseError('x', 'post', '57014').message).toMatch(/verification code is still valid/)
  })

  it('an unmapped message still degrades to a referenced unexpected_error', () => {
    const mapped = mapStockCountDatabaseError('brand new failure mode', 'post', 'P0001', REFERENCE)
    expect(mapped.code).toBe('unexpected_error')
    expect(mapped.message).toContain(REFERENCE)
  })
})

describe('OTP reuse gate', () => {
  it('demands a fresh code only when the request itself is spent', () => {
    for (const code of ['code_already_used', 'expired_code', 'snapshot_changed', 'already_posted']) {
      expect(requiresFreshStockCountVerification(code)).toBe(true)
    }
  })

  it('leaves the code usable after a rolled-back post (the whole post is one transaction)', () => {
    for (const code of [
      'opening_balance_distributor_decision_stale',
      'opening_balance_manufacturer_decision_stale',
      'opening_balance_allocation_owner_unresolved',
      'opening_balance_not_ready',
      'posting_timeout',
      'posting_conflict',
      'unexpected_error',
      'invalid_code',
      null,
      undefined,
    ]) {
      expect(requiresFreshStockCountVerification(code)).toBe(false)
    }
  })
})

describe('posting routes wire the reference and the mapper together', () => {
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  const verifyRoute = read('../../app/api/inventory/stock-count/verification/verify/route.ts')
  const requestRoute = read('../../app/api/inventory/stock-count/verification/request/route.ts')

  it('the verify route passes the reference into the mapper and returns it', () => {
    expect(verifyRoute).toContain("mapStockCountDatabaseError(error?.message || '', 'post', error?.code, reference)")
    // No longer discards a specific mapping in favour of unexpected_error.
    expect(verifyRoute).not.toContain("mapped.code === 'unexpected_error'")
    expect(verifyRoute).toContain('reference: friendly.reference')
    expect(verifyRoute).toContain('guidance: friendly.guidance')
  })

  it('the verify route records the raw server error against the reference for correlation', () => {
    expect(verifyRoute).toContain('db_message')
    expect(verifyRoute).toContain('error_code: friendly.code')
    expect(verifyRoute).toContain('sql_state: error?.code ?? null')
  })

  it('the request route keeps the same contract', () => {
    expect(requestRoute).toContain("mapStockCountDatabaseError(error?.message || '', 'request', error?.code, reference)")
    expect(requestRoute).toContain("jsonError({ ...mapped, stage: 'request', reference })")
  })

  it('success is returned only when the RPC neither threw nor carried an error_code', () => {
    expect(verifyRoute).toContain('if (error) throw error')
    expect(verifyRoute).toContain('if (data?.error_code) throw new Error(data.error_code)')
  })
})
