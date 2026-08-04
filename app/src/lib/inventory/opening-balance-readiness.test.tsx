import { describe, expect, it } from 'vitest'
import { deriveOpeningBalanceReadiness, type DeriveReadinessInput } from './opening-balance-readiness'

const base: DeriveReadinessInput = {
  serverReadiness: 'Ready',
  serverBlockers: [],
  blockedDistributorRefs: [],
  d2hRequired: true,
  d2hPolicyResolved: true,
  d2hUndecidedLines: 0,
  h2mRequired: true,
  h2mPolicyResolved: true,
  h2mUndecidedLines: 0,
  transactionsRequired: true,
  transactionsPolicyResolved: true,
}

describe('deriveOpeningBalanceReadiness', () => {
  it('reports Ready to Post with zero blockers when the server readiness is Ready', () => {
    const result = deriveOpeningBalanceReadiness(base)
    expect(result.ready).toBe(true)
    expect(result.statusLabel).toBe('Ready to Post')
    expect(result.blockerCount).toBe(0)
    expect(result.blockers).toEqual([])
  })

  it('treats server "Review Required" as ZERO blockers (advisories are not blockers)', () => {
    // e.g. 51 historical-excluded transactions / a stock-in-transit note. These
    // drive 'Review Required' server-side but are NOT blockers and must not
    // fabricate a phantom "readiness:not-confirmed" blocker.
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Review Required',
      serverBlockers: [],
    })
    expect(result.ready).toBe(false)
    expect(result.statusLabel).toBe('Review Required')
    expect(result.blockerCount).toBe(0)
    expect(result.blockers).toEqual([])
  })

  it('"Review Required" WITH a genuine client blocker still reports that blocker', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Review Required',
      d2hPolicyResolved: false, // unsaved required policy → a real blocker
    })
    expect(result.blockerCount).toBeGreaterThan(0)
    expect(result.blockers.some(b => b.step === 'd2h')).toBe(true)
  })

  it('still fabricates a refresh blocker when server says Blocked but nothing is attributable', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: [],
    })
    expect(result.blockerCount).toBe(1)
    expect(result.blockers[0].id).toBe('readiness:not-confirmed')
  })

  it('is idempotent across repeated derivations (no duplicated/double-counted blockers)', () => {
    const input: DeriveReadinessInput = { ...base, serverReadiness: 'Review Required', serverBlockers: [] }
    const a = deriveOpeningBalanceReadiness(input)
    const b = deriveOpeningBalanceReadiness(input)
    expect(a.blockerCount).toBe(b.blockerCount)
    expect(a.blockerCount).toBe(0)
  })

  it('ignores client-derived counts when the server says Ready (no contradiction possible)', () => {
    // Even if a client policy flag looks unsaved, server "Ready" wins → 0 blockers.
    const result = deriveOpeningBalanceReadiness({
      ...base,
      d2hPolicyResolved: false,
      serverBlockers: ['stale message'],
    })
    expect(result.ready).toBe(true)
    expect(result.blockerCount).toBe(0)
  })

  it('never shows Ready to Post when there is a positive blocker count', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: ['Return RET26-000007 requires individual resolution.'],
    })
    expect(result.ready).toBe(false)
    expect(result.statusLabel).not.toBe('Ready to Post')
    expect(result.blockerCount).toBeGreaterThan(0)
  })

  it('surfaces an unsaved D2H policy as a blocker with a resolution route', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      d2hPolicyResolved: false,
    })
    const blocker = result.blockers.find(b => b.step === 'd2h')
    expect(blocker).toBeTruthy()
    expect(blocker?.type).toBe('D2H Policy Not Saved')
    expect(blocker?.actionLabel).toBe('Go to D2H Policy')
    expect(blocker?.reason).toContain('D2H policy')
  })

  it('surfaces undecided D2H lines only when the policy is saved', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Review Required',
      d2hPolicyResolved: true,
      d2hUndecidedLines: 3,
    })
    const blocker = result.blockers.find(b => b.type === 'D2H Decisions Pending')
    expect(blocker?.reason).toContain('3 distributor line(s)')
  })

  it('surfaces genuine server resolution blockers with the exact reason and a contextual Transactions route', () => {
    const message = 'Return RET26-000007 requires individual resolution: resolve it in the Return workflow.'
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: [message],
    })
    const blocker = result.blockers.find(b => b.type === 'Requires Individual Resolution')
    expect(blocker?.reason).toBe(message)
    expect(blocker?.step).toBe('transactions')
    expect(blocker?.id).toBeTruthy()
    // Contextual, not the generic "Go to Transactions" that landed nowhere.
    expect(blocker?.actionLabel).toBe('Resolve Transaction Blocker')
  })

  it('routes an allocation-ownership mismatch to a contextual, identity-bearing blocker', () => {
    const message =
      'Allocation ownership does not reconcile for Zero Edition Novella [ Potato ] (Unclassified (pending stock take)): inventory allocated 1, selected order quantity 0.'
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: [message],
    })
    const blocker = result.blockers.find(b => b.type === 'Allocation Reconciliation')
    expect(blocker).toBeTruthy()
    expect(blocker?.step).toBe('transactions')
    expect(blocker?.actionLabel).toBe('Review Potato Allocation')
    expect(blocker?.id).toBeTruthy()
    expect(blocker?.identity?.allocatedQuantity).toBe(1)
    expect(blocker?.identity?.selectedQuantity).toBe(0)
    expect(blocker?.identity?.difference).toBe(1)
  })

  it('prefers the structured blocker_details contract over legacy strings', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: ['stale legacy string'],
      serverBlockerDetails: [
        {
          id: 'alloc-xyz',
          category: 'allocation_reconciliation',
          step: 'transactions',
          reason: 'Allocation ownership does not reconcile for Widget (Standard): inventory allocated 2, selected order quantity 0.',
          action_label: 'Review Widget Allocation',
          allocated_quantity: 2,
          selected_quantity: 0,
          difference: 2,
        },
      ],
    })
    expect(result.blockerCount).toBe(1)
    expect(result.blockers[0].id).toBe('alloc-xyz')
    expect(result.blockers[0].actionLabel).toBe('Review Widget Allocation')
  })

  it('surfaces config-blocked D2H orders by reference with a Review Item route', () => {
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      blockedDistributorRefs: ['SO26000085'],
    })
    const blocker = result.blockers.find(b => b.type === 'D2H Carry Forward Blocked')
    expect(blocker?.reference).toBe('SO26000085')
    expect(blocker?.actionLabel).toBe('Review Item')
  })

  it('never treats historical-excluded eligible transactions as blockers', () => {
    // Server Ready, all policies saved, no serverBlockers → excluded/eligible
    // transactions contribute nothing.
    const result = deriveOpeningBalanceReadiness({ ...base, serverReadiness: 'Ready' })
    expect(result.blockers).toEqual([])
  })

  it('always yields at least one blocker when not Ready, even on a contract mismatch', () => {
    // The reported bug: readiness Blocked but no attributable client blocker
    // (blockers[] empty, policies saved). The badge/count must still agree.
    const result = deriveOpeningBalanceReadiness({
      ...base,
      serverReadiness: 'Blocked',
      serverBlockers: [],
    })
    expect(result.ready).toBe(false)
    expect(result.blockerCount).toBe(1)
    expect(result.blockers[0].type).toBe('Readiness Not Confirmed')
    expect(result.blockers[0].actionLabel).toBe('Refresh Readiness')
  })

  it('marks the level Blocked vs Action Required from the server readiness', () => {
    expect(deriveOpeningBalanceReadiness({ ...base, serverReadiness: 'Blocked' }).level).toBe('blocked')
    expect(deriveOpeningBalanceReadiness({ ...base, serverReadiness: 'Review Required' }).level).toBe('action-required')
  })
})
