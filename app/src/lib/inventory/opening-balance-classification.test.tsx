import { describe, expect, it } from 'vitest'
import {
  distributorClassification,
  distributorDecisionEligibility,
  evaluateOpeningBalancePostGuard,
  isManufacturerIncomingEligible,
  isOpeningBalanceDecisionStale,
  manufacturerDecisionOptions,
  manufacturerRemainingIncoming,
  summarizeOpeningBalance,
  type OpeningBalancePreview,
} from './opening-balance-classification'

// ---------------------------------------------------------------------------
// 1. Eligible H2M remaining incoming quantities
// ---------------------------------------------------------------------------
describe('H2M remaining incoming', () => {
  it('computes ordered minus received, never negative', () => {
    expect(manufacturerRemainingIncoming(100, 40)).toBe(60)
    expect(manufacturerRemainingIncoming(100, 100)).toBe(0)
    expect(manufacturerRemainingIncoming(100, 130)).toBe(0)
  })

  it('treats a partially received approved order as eligible incoming', () => {
    expect(isManufacturerIncomingEligible({ status: 'approved', orderedQty: 100, receivedQty: 40 })).toBe(true)
    expect(isManufacturerIncomingEligible({ status: 'closed', orderedQty: 10, receivedQty: 0 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Fully received / cancelled H2M orders excluded
// ---------------------------------------------------------------------------
describe('H2M exclusions', () => {
  it('excludes fully received lines', () => {
    expect(isManufacturerIncomingEligible({ status: 'approved', orderedQty: 50, receivedQty: 50 })).toBe(false)
  })
  it('excludes cancelled and non-approved/closed statuses', () => {
    expect(isManufacturerIncomingEligible({ status: 'cancelled', orderedQty: 50, receivedQty: 0 })).toBe(false)
    expect(isManufacturerIncomingEligible({ status: 'draft', orderedQty: 50, receivedQty: 0 })).toBe(false)
    expect(isManufacturerIncomingEligible({ status: 'submitted', orderedQty: 50, receivedQty: 0 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. H2M inclusion does not immediately increase Opening Balance stock
// ---------------------------------------------------------------------------
describe('H2M inclusion is separate from physical opening stock', () => {
  it('keeps physical opening stock equal to counted quantity even when incoming is selected', () => {
    const preview: OpeningBalancePreview = {
      inventory: [
        { stock_config_id: 'c1', physical_quantity: 30 },
        { stock_config_id: 'c2', physical_quantity: 12 },
      ],
      manufacturer_incoming: [
        { order_number: 'PO-1', status: 'approved', remaining_incoming_quantity: 100, stock_config_id: 'c1', decision: 'carry_forward_incoming' },
      ],
    }
    const summary = summarizeOpeningBalance(preview)
    expect(summary.physicalOpeningStock.totalQuantity).toBe(42)
    // Incoming is tracked in its own bucket, never added to the physical baseline.
    expect(summary.manufacturerIncomingAfterCutoff.totalQuantity).toBe(100)
    expect(summary.manufacturerIncomingAfterCutoff.orderCount).toBe(1)
  })

  it('offers carry-forward-incoming only when a configuration is present', () => {
    expect(manufacturerDecisionOptions({ stockConfigId: 'cfg' }).canCarryForwardIncoming).toBe(true)
    const blocked = manufacturerDecisionOptions({ stockConfigId: null })
    expect(blocked.canCarryForwardIncoming).toBe(false)
    expect(blocked.canHistoryOnly).toBe(true)
    expect(blocked.carryForwardBlockedReason).toMatch(/missing/i)
  })
})

// ---------------------------------------------------------------------------
// 4. D2H status-to-decision eligibility
// ---------------------------------------------------------------------------
describe('D2H status eligibility', () => {
  it('makes only submitted actionable with Carry Into New Inventory / Keep as Historical', () => {
    const submitted = distributorDecisionEligibility('submitted')
    expect(submitted.actionable).toBe(true)
    expect(submitted.availableActions).toEqual(['carry_forward', 'do_not_carry_forward'])
    expect(submitted.availableActions).not.toContain('cancel_release')
    expect(submitted.cancellable).toBe(true)
  })

  it('classifies non-submitted statuses without offering actions', () => {
    expect(distributorDecisionEligibility('draft').actionable).toBe(false)
    expect(distributorDecisionEligibility('approved').defaultClassification).toBe('Complete Before Cut-off')
    expect(distributorDecisionEligibility('warehouse_packed').defaultClassification).toBe('Complete Before Cut-off')
    expect(distributorDecisionEligibility('shipped_distributor').defaultClassification).toBe('Stock in Transit')
    expect(distributorDecisionEligibility('closed').defaultClassification).toBe('History Only')
    expect(distributorDecisionEligibility('cancelled').defaultClassification).toBe('History Only')
    for (const status of ['draft', 'approved', 'shipped_distributor', 'closed', 'cancelled'] as const) {
      expect(distributorDecisionEligibility(status).availableActions).toEqual([])
      expect(distributorDecisionEligibility(status).cancellable).toBe(false)
    }
  })

  it('reflects the recorded decision in the classification', () => {
    expect(distributorClassification('submitted', 'carry_forward')).toBe('Carry Forward')
    expect(distributorClassification('submitted', 'cancel_release')).toBe('Cancel & Release')
    expect(distributorClassification('submitted', 'do_not_carry_forward')).toBe('Do Not Carry Forward')
    expect(distributorClassification('submitted', null)).toBe('Blocked')
  })
})

// ---------------------------------------------------------------------------
// Phase 2 gap — explicit "Do Not Carry Forward / Exclude" for submitted D2H
// ---------------------------------------------------------------------------
describe('D2H explicit Do Not Carry Forward', () => {
  // (gap-1) Submitted D2H exposes all three explicit decisions.
  it('exposes carry_forward and do_not_carry_forward for Option B review', () => {
    expect(distributorDecisionEligibility('submitted').availableActions).toEqual([
      'carry_forward', 'do_not_carry_forward',
    ])
    expect(distributorDecisionEligibility('submitted').availableActions).not.toContain('cancel_release')
  })

  // (gap-2 / gap-3) A saved explicit exclude reloads as a resolved decision and
  // lands in the Excluded summary bucket — never in Blocked, never in physical.
  it('counts an explicit exclude in the Excluded bucket, resolved not blocked', () => {
    const preview: OpeningBalancePreview = {
      inventory: [{ stock_config_id: 'c1', physical_quantity: 100 }],
      distributor_orders: [
        { order_number: 'SO-EXCL', status: 'submitted', quantity: 8, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      ],
    }
    const summary = summarizeOpeningBalance(preview)
    expect(summary.excludedDoNotCarryForward.orderCount).toBe(1)
    expect(summary.excludedDoNotCarryForward.references).toContain('SO-EXCL')
    // (gap-5) does not reserve/deduct: carry-forward + physical are unchanged.
    expect(summary.distributorCarryForward.totalQuantity).toBe(0)
    expect(summary.distributorCancelRelease.totalQuantity).toBe(0)
    expect(summary.physicalOpeningStock.totalQuantity).toBe(100)
    // (gap-7) resolved: not present in the blocked bucket.
    expect(summary.blocked.references).not.toContain('SO-EXCL')
    expect(summary.blocked.orderCount).toBe(0)
  })

  // (gap-8) An undecided submitted order still blocks posting.
  it('still blocks an undecided submitted order', () => {
    const preview: OpeningBalancePreview = {
      distributor_orders: [
        { order_number: 'SO-UNDECIDED', status: 'submitted', quantity: 4, decision: null, classification: 'Blocked' },
        { order_number: 'SO-EXCL', status: 'submitted', quantity: 8, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      ],
    }
    const summary = summarizeOpeningBalance(preview)
    expect(summary.blocked.references).toEqual(['SO-UNDECIDED'])
    expect(summary.excludedDoNotCarryForward.references).toEqual(['SO-EXCL'])
  })

  // (gap-9) A changed status/quantity after saving makes the decision stale.
  it('marks the decision stale when the bound snapshot changes', () => {
    expect(isOpeningBalanceDecisionStale('snap-with-exclude', 'snap-after-status-change')).toBe(true)
    expect(isOpeningBalanceDecisionStale('snap-with-exclude', 'snap-with-exclude')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. Cancel & Release is performed once only  (idempotency / single-action)
// 8. Do Not Carry Forward does not reserve stock
// ---------------------------------------------------------------------------
describe('D2H decision buckets', () => {
  const preview: OpeningBalancePreview = {
    inventory: [{ stock_config_id: 'c1', physical_quantity: 100 }],
    distributor_orders: [
      { order_number: 'SO-CF', status: 'submitted', quantity: 5, decision: 'carry_forward', classification: 'Carry Forward' },
      { order_number: 'SO-CR', status: 'submitted', quantity: 7, decision: 'cancel_release', classification: 'Cancel & Release' },
      { order_number: 'SO-HIST', status: 'closed', quantity: 3, classification: 'History Only' },
    ],
  }

  it('counts a cancel & release order exactly once', () => {
    const summary = summarizeOpeningBalance(preview)
    expect(summary.distributorCancelRelease.orderCount).toBe(1)
    expect(summary.distributorCancelRelease.totalQuantity).toBe(7)
    expect(summary.distributorCancelRelease.references).toEqual(['SO-CR'])
  })

  it('keeps excluded / history orders out of carry-forward and physical stock', () => {
    const summary = summarizeOpeningBalance(preview)
    expect(summary.excludedDoNotCarryForward.orderCount).toBe(1)
    expect(summary.excludedDoNotCarryForward.references).toContain('SO-HIST')
    // Excluded order does not add to carry-forward reservation or physical baseline.
    expect(summary.distributorCarryForward.totalQuantity).toBe(5)
    expect(summary.physicalOpeningStock.totalQuantity).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// 9. Stock-in-transit orders remain protected
// ---------------------------------------------------------------------------
describe('Stock in transit protection', () => {
  it('classifies shipped_distributor as Stock in Transit and never as actionable', () => {
    expect(distributorClassification('shipped_distributor', null)).toBe('Stock in Transit')
    expect(distributorDecisionEligibility('shipped_distributor').availableActions).toEqual([])
  })

  it('reports stock-in-transit in its own bucket', () => {
    const preview: OpeningBalancePreview = {
      distributor_orders: [{ order_number: 'SO-TRANSIT', status: 'shipped_distributor', quantity: 9, classification: 'Stock in Transit' }],
      warehouse_activity: [{ movement_type: 'stock_transfer', reference_no: 'TR-1', classification: 'Stock in Transit' }],
    }
    const summary = summarizeOpeningBalance(preview)
    expect(summary.stockInTransit.orderCount).toBe(2)
    expect(summary.stockInTransit.references).toEqual(expect.arrayContaining(['SO-TRANSIT', 'TR-1']))
  })
})

// ---------------------------------------------------------------------------
// 10. Saved draft decisions reload correctly (snapshot equality)
// 11. Changed order status/quantity blocks stale posting
// ---------------------------------------------------------------------------
describe('Snapshot staleness', () => {
  it('treats an unchanged snapshot as fresh', () => {
    expect(isOpeningBalanceDecisionStale('hash-abc', 'hash-abc')).toBe(false)
  })
  it('treats a changed snapshot (status/quantity/config changed) as stale', () => {
    expect(isOpeningBalanceDecisionStale('hash-abc', 'hash-xyz')).toBe(true)
  })
  it('treats a missing snapshot as stale (fail safe)', () => {
    expect(isOpeningBalanceDecisionStale(null, 'hash')).toBe(true)
    expect(isOpeningBalanceDecisionStale('hash', undefined)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 12. Posting is atomic and idempotent  (client guard mirrors server preconditions)
// 13. Posted decision snapshot is immutable  (already-posted blocks re-post)
// ---------------------------------------------------------------------------
describe('Opening Balance post guard', () => {
  const base = { readiness: 'Ready' as const, isHqAdmin: true, freezeActive: true, alreadyPosted: false, stale: false }

  it('allows posting only when every precondition holds', () => {
    expect(evaluateOpeningBalancePostGuard(base).canPost).toBe(true)
  })

  it('blocks when not ready, not admin, not frozen, stale, or already posted', () => {
    expect(evaluateOpeningBalancePostGuard({ ...base, readiness: 'Blocked' }).canPost).toBe(false)
    expect(evaluateOpeningBalancePostGuard({ ...base, isHqAdmin: false }).canPost).toBe(false)
    expect(evaluateOpeningBalancePostGuard({ ...base, freezeActive: false }).canPost).toBe(false)
    expect(evaluateOpeningBalancePostGuard({ ...base, stale: true }).canPost).toBe(false)
    const posted = evaluateOpeningBalancePostGuard({ ...base, alreadyPosted: true })
    expect(posted.canPost).toBe(false)
    expect(posted.reasons.join(' ')).toMatch(/already been posted/i)
  })

  it('blocks a stale decision set even when readiness looks Ready', () => {
    const guard = evaluateOpeningBalancePostGuard({ ...base, stale: true })
    expect(guard.reasons.some(r => /refresh/i.test(r))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 14. QR tables are not affected  (summary derives only from inventory/orders)
// ---------------------------------------------------------------------------
describe('QR-data protection', () => {
  it('produces a summary without referencing any QR field', () => {
    const preview: OpeningBalancePreview = {
      inventory: [{ stock_config_id: 'c1', physical_quantity: 5 }],
      distributor_orders: [],
      manufacturer_incoming: [],
      warehouse_activity: [],
    }
    const summary = summarizeOpeningBalance(preview)
    const serialized = JSON.stringify(summary).toLowerCase()
    expect(serialized).not.toContain('qr')
  })
})

// ---------------------------------------------------------------------------
// 15. Blocked / unresolved decisions surface in the blocked bucket
// ---------------------------------------------------------------------------
describe('Blocked bucket', () => {
  it('collects undecided submitted orders and server blocker messages', () => {
    const preview: OpeningBalancePreview = {
      readiness: 'Blocked',
      distributor_orders: [{ order_number: 'SO-UNDECIDED', status: 'submitted', quantity: 4, decision: null, classification: 'Blocked' }],
      blockers: ['Physical count is missing for Durian (20ml · New Box).'],
    }
    const summary = summarizeOpeningBalance(preview)
    expect(summary.blocked.references).toEqual(['SO-UNDECIDED'])
    expect(summary.blocked.messages).toHaveLength(1)
    expect(summary.blocked.orderCount).toBe(1)
  })
})
