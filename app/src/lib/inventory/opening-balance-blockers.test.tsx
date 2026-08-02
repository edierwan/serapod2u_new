import { describe, expect, it } from 'vitest'
import {
  blockerShortName,
  classifyBlockerMessage,
  orphanAllocationBlockers,
  parseOpeningBalanceBlockers,
  resolutionActionsFor,
  transactionStepBlockers,
} from './opening-balance-blockers'

const POTATO =
  'Allocation ownership does not reconcile for Zero Edition Novella [ Potato ] (Unclassified (pending stock take)): inventory allocated 1, selected order quantity 0.'

describe('classifyBlockerMessage — allocation ownership', () => {
  it('parses the Potato allocation blocker into structured identity', () => {
    const c = classifyBlockerMessage(POTATO)
    expect(c.category).toBe('allocation_reconciliation')
    expect(c.step).toBe('transactions')
    expect(c.identity.variantName).toBe('Zero Edition Novella [ Potato ]')
    expect(c.identity.configLabel).toBe('Unclassified (pending stock take)')
    expect(c.identity.allocatedQuantity).toBe(1)
    expect(c.identity.selectedQuantity).toBe(0)
    expect(c.identity.difference).toBe(1)
    expect(c.orphan).toBe(true)
  })

  it('produces a contextual action label using the short variant name', () => {
    expect(classifyBlockerMessage(POTATO).actionLabel).toBe('Review Potato Allocation')
  })
})

describe('blockerShortName', () => {
  it('prefers the bracketed variant suffix', () => {
    expect(blockerShortName('Zero Edition Novella [ Potato ]')).toBe('Potato')
  })
  it('falls back to the whole name', () => {
    expect(blockerShortName('Widget Classic')).toBe('Widget Classic')
  })
})

describe('classifyBlockerMessage — other categories', () => {
  it('routes typed transaction resolution to the transactions step', () => {
    const c = classifyBlockerMessage('Return RET26-000007 (return_received) requires individual resolution: posted movements.')
    expect(c.category).toBe('transaction_resolution')
    expect(c.step).toBe('transactions')
    expect(c.actionLabel).toBe('Resolve Transaction Blocker')
  })
  it('routes distributor decisions to the d2h step', () => {
    expect(classifyBlockerMessage('Distributor order SO26000085 / Widget requires a carry-forward or cancel-and-release decision.').step).toBe('d2h')
  })
  it('routes manufacturer decisions to the h2m step', () => {
    expect(classifyBlockerMessage('Manufacturer order PO26-1 / Widget requires an incoming decision and valid selected configuration.').step).toBe('h2m')
  })
  it('routes missing physical count to the freeze step', () => {
    expect(classifyBlockerMessage('Physical count is missing for Widget (Standard).').step).toBe('freeze')
  })
})

describe('parseOpeningBalanceBlockers — legacy string fallback', () => {
  it('gives every blocker a stable id', () => {
    const details = parseOpeningBalanceBlockers({ blockers: [POTATO] })
    expect(details).toHaveLength(1)
    expect(details[0].id).toBeTruthy()
    // Stable across repeated parses of the same input.
    expect(parseOpeningBalanceBlockers({ blockers: [POTATO] })[0].id).toBe(details[0].id)
  })

  it('surfaces the allocation blocker as an orphan under the transactions step', () => {
    const details = parseOpeningBalanceBlockers({ blockers: [POTATO] })
    expect(transactionStepBlockers(details)).toHaveLength(1)
    expect(orphanAllocationBlockers(details)).toHaveLength(1)
    const orphan = orphanAllocationBlockers(details)[0]
    expect(orphan.identity.allocatedQuantity).toBe(1)
    expect(orphan.identity.selectedQuantity).toBe(0)
    expect(orphan.identity.difference).toBe(1)
  })

  it('keeps orphan allocations visible even without a related transaction row', () => {
    const details = parseOpeningBalanceBlockers({ blockers: [POTATO] })
    expect(details[0].orphan).toBe(true)
    // no sourceOrderId → open-source is unavailable, manual investigation stays available
    const actions = details[0].resolutionActions
    expect(actions.find(a => a.kind === 'open_source_document')?.available).toBe(false)
    expect(actions.find(a => a.kind === 'mark_manual_investigation')?.available).toBe(true)
  })
})

describe('parseOpeningBalanceBlockers — structured contract wins', () => {
  const structured = {
    blocker_details: [
      {
        id: 'alloc-abc',
        code: 'allocation_reconciliation',
        category: 'allocation_reconciliation',
        step: 'transactions',
        reason: POTATO,
        action_label: 'Review Potato Allocation',
        product_variant_id: '11111111-1111-1111-1111-111111111111',
        variant_name: 'Zero Edition Novella [ Potato ]',
        stock_config_id: '22222222-2222-2222-2222-222222222222',
        config_label: 'Unclassified (pending stock take)',
        allocated_quantity: 1,
        selected_quantity: 0,
        difference: 1,
        source_order_id: '33333333-3333-3333-3333-333333333333',
        source_order_number: 'SO26000099',
        allocation_status: 'allocated',
        before_cutoff: true,
        orphan: false,
        resolution_actions: [
          { kind: 'select_related_order', label: 'Select Correct Related Order', mutating: true, available: true },
          { kind: 'open_source_document', label: 'Open Source Document', mutating: false, available: true },
        ],
      },
    ],
    // legacy list is present but must be ignored in favour of the structured set
    blockers: ['stale string that should not be used'],
  }

  it('prefers blocker_details over the legacy string list', () => {
    const details = parseOpeningBalanceBlockers(structured)
    expect(details).toHaveLength(1)
    expect(details[0].id).toBe('alloc-abc')
    expect(details[0].reason).toBe(POTATO)
  })

  it('exposes stable ids (variant + config), source order and allocation status', () => {
    const d = parseOpeningBalanceBlockers(structured)[0]
    expect(d.identity.variantId).toBe('11111111-1111-1111-1111-111111111111')
    expect(d.identity.stockConfigId).toBe('22222222-2222-2222-2222-222222222222')
    expect(d.identity.sourceOrderId).toBe('33333333-3333-3333-3333-333333333333')
    expect(d.identity.sourceOrderNumber).toBe('SO26000099')
    expect(d.identity.allocationStatus).toBe('allocated')
    expect(d.identity.beforeCutoff).toBe(true)
  })

  it('honours server-validated resolution actions', () => {
    const d = parseOpeningBalanceBlockers(structured)[0]
    const select = d.resolutionActions.find(a => a.kind === 'select_related_order')
    expect(select?.available).toBe(true)
    const open = d.resolutionActions.find(a => a.kind === 'open_source_document')
    expect(open?.available).toBe(true)
  })
})

describe('resolutionActionsFor — safety gating', () => {
  it('never auto-enables select/carry-forward (they need a genuine submitted owner)', () => {
    const actions = resolutionActionsFor('allocation_reconciliation', { allocatedQuantity: 1, selectedQuantity: 0 })
    const select = actions.find(a => a.kind === 'select_related_order')
    const carry = actions.find(a => a.kind === 'carry_forward_related')
    expect(select?.available).toBe(false)
    expect(select?.hint).toBeTruthy()
    expect(carry?.available).toBe(false)
    expect(carry?.hint).toBeTruthy()
  })

  it('enables exclude_and_release for a resolvable orphan residual (no selected/carried owner)', () => {
    // The SECURITY DEFINER RPC is the authoritative guard (refuses an active
    // owner), so offering the button for an orphan does not weaken safety.
    const orphan = resolutionActionsFor('allocation_reconciliation', {
      allocatedQuantity: 1, selectedQuantity: 0, variantId: 'v1', stockConfigId: 'c1',
    })
    expect(orphan.find(a => a.kind === 'exclude_and_release')?.available).toBe(true)
  })

  it('keeps exclude_and_release disabled for an orphan whose identity is not resolvable', () => {
    // Legacy string blockers carry no variant/config id, so the RPC cannot run.
    const orphan = resolutionActionsFor('allocation_reconciliation', { allocatedQuantity: 1, selectedQuantity: 0 })
    const exclude = orphan.find(a => a.kind === 'exclude_and_release')
    expect(exclude?.available).toBe(false)
    expect(exclude?.hint).toBeTruthy()
  })

  it('keeps exclude_and_release disabled for a non-orphan mismatch (selected > 0)', () => {
    const nonOrphan = resolutionActionsFor('allocation_reconciliation', {
      allocatedQuantity: 3, selectedQuantity: 2, variantId: 'v1', stockConfigId: 'c1',
    })
    const exclude = nonOrphan.find(a => a.kind === 'exclude_and_release')
    expect(exclude?.available).toBe(false)
    expect(exclude?.hint).toBeTruthy()
  })

  it('returns no actions for non-allocation blockers without server input', () => {
    expect(resolutionActionsFor('transaction_resolution', {})).toEqual([])
  })
})
