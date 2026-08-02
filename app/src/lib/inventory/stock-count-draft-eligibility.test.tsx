import { describe, expect, it } from 'vitest'
import {
  LEGACY_HISTORY_STATUSES,
  isDraftDeletable,
  draftProtectionReason,
  partitionDiscardSelection,
  resolveStockCountHistoryLifecycle,
  stockCountHistoryLifecyclePresentation,
} from './stock-count-draft-eligibility'

describe('Stock Count draft discard eligibility', () => {
  it('legacy history only surfaces posted (official) sessions, never archived', () => {
    expect(LEGACY_HISTORY_STATUSES).toEqual(['posted'])
    expect(LEGACY_HISTORY_STATUSES).not.toContain('archived')
    expect(LEGACY_HISTORY_STATUSES).not.toContain('draft')
  })

  it('1. a new draft is removable', () => {
    const draft = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: null,
    }
    expect(isDraftDeletable(draft)).toBe(true)
    expect(resolveStockCountHistoryLifecycle(draft)).toBe('draft_removable')
    expect(stockCountHistoryLifecyclePresentation(draft).badge).toBe('Draft — Removable')
    expect(stockCountHistoryLifecyclePresentation(draft).detail).toMatch(/final verification has not started/i)
  })

  it('2. 112/112 completion remains removable (progress never means posting started)', () => {
    // Progress is intentionally absent from eligibility inputs.
    const draft = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'counting' as const,
    }
    expect(isDraftDeletable(draft)).toBe(true)
    expect(resolveStockCountHistoryLifecycle(draft)).toBe('draft_removable')
  })

  it('3–6. D2H/H2M/transactions/review without OTP remain removable under a counting freeze', () => {
    const draft = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'counting' as const,
    }
    expect(isDraftDeletable(draft)).toBe(true)
    expect(draftProtectionReason(draft)).toBeNull()
  })

  it('7. refresh/reopen preserves removable status when OTP was never requested', () => {
    const before = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'counting' as const,
    }
    const afterReopen = { ...before }
    expect(isDraftDeletable(before)).toBe(true)
    expect(isDraftDeletable(afterReopen)).toBe(true)
    expect(resolveStockCountHistoryLifecycle(afterReopen)).toBe('draft_removable')
  })

  it('13–14. OTP request protects the exercise and rejects hard discard', () => {
    const protectedDraft = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: true,
      cutoff_status: 'counting' as const,
    }
    expect(isDraftDeletable(protectedDraft)).toBe(false)
    expect(resolveStockCountHistoryLifecycle(protectedDraft)).toBe('verification_started')
    expect(draftProtectionReason(protectedDraft)).toMatch(/OTP has been requested/i)
    expect(stockCountHistoryLifecyclePresentation(protectedDraft).badge).toBe(
      'Verification Started — Protected',
    )
  })

  it('16. posted exercise cannot be discarded', () => {
    const posted = {
      status: 'posted' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'posted' as const,
    }
    expect(isDraftDeletable(posted)).toBe(false)
    expect(resolveStockCountHistoryLifecycle(posted)).toBe('posted')
    expect(draftProtectionReason(posted)).toMatch(/Opening Balance has been posted/i)
  })

  it('17. cancelled exercise remains read-only and is not labelled posting started', () => {
    const cancelled = {
      status: 'archived' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'cancelled' as const,
    }
    expect(isDraftDeletable(cancelled)).toBe(false)
    expect(resolveStockCountHistoryLifecycle(cancelled)).toBe('cancelled')
    expect(draftProtectionReason(cancelled)).toMatch(/cancelled and archived/i)
    expect(draftProtectionReason(cancelled)).not.toMatch(/posting has started/i)
  })

  it('20. history lifecycle derives from authoritative state, not count progress', () => {
    const completeButPreOtp = {
      status: 'draft' as const,
      count_type: 'opening_balance_cutoff' as const,
      postingStarted: false,
      cutoff_status: 'counting' as const,
    }
    expect(resolveStockCountHistoryLifecycle(completeButPreOtp)).toBe('draft_removable')
    expect(resolveStockCountHistoryLifecycle({
      ...completeButPreOtp,
      postingStarted: true,
    })).toBe('verification_started')
  })

  it('a removable Legacy Initial Classification test draft can be discarded when safe', () => {
    const draft = {
      status: 'draft' as const,
      count_type: 'initial_configuration_classification' as const,
      postingStarted: false,
    }
    expect(isDraftDeletable(draft)).toBe(true)
    expect(draftProtectionReason(draft)).toBeNull()
  })

  it('archived (already discarded) sessions are not deletable again', () => {
    const archived = {
      status: 'archived' as const,
      count_type: 'full_count' as const,
      postingStarted: false,
    }
    expect(isDraftDeletable(archived)).toBe(false)
    expect(draftProtectionReason(archived)).toMatch(/already discarded/i)
  })

  it('bulk discard partitions a mixed selection into removable vs protected', () => {
    const sessions = [
      { id: 'd1', status: 'draft' as const, count_type: 'full_count' as const, postingStarted: false },
      {
        id: 'd2',
        status: 'draft' as const,
        count_type: 'opening_balance_cutoff' as const,
        postingStarted: true,
        cutoff_status: 'counting' as const,
      },
      {
        id: 'd3',
        status: 'draft' as const,
        count_type: 'opening_balance_cutoff' as const,
        postingStarted: false,
        cutoff_status: 'counting' as const,
      },
      { id: 'p1', status: 'posted' as const, count_type: 'initial_configuration_classification' as const, postingStarted: false },
      {
        id: 'c1',
        status: 'archived' as const,
        count_type: 'opening_balance_cutoff' as const,
        postingStarted: false,
        cutoff_status: 'cancelled' as const,
      },
    ]
    const { removable, protected: prot } = partitionDiscardSelection(
      sessions,
      ['d1', 'd2', 'd3', 'p1', 'c1'],
    )
    expect(removable.map(s => s.id)).toEqual(['d1', 'd3'])
    expect(prot.map(s => s.id)).toEqual(['d2', 'p1', 'c1'])
  })
})
