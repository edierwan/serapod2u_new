// ============================================================================
// Stock Count "Manage Drafts" discard eligibility (pure, UI-agnostic)
// ----------------------------------------------------------------------------
// One source of truth for which saved Stock Count sessions may be discarded and
// why a session is protected. Mirrors the guarantees enforced by the
// discard_stock_count_drafts RPC (draft-only, never posted history) so the UI
// never offers a discard the backend will refuse and never shows a fake success.
//
// Opening Balance protection boundary = explicit OTP request for final posting.
// A counting freeze, 112/112 progress, D2H/H2M policy saves, Transactions
// preview, and opening Review & Post without OTP are NOT "posting started".
// ============================================================================

export type StockCountSessionStatus = 'draft' | 'posted' | 'archived'

export type StockCountCountType =
  | 'full_count'
  | 'cycle_count'
  | 'spot_check'
  | 'initial_configuration_classification'
  | 'opening_balance_cutoff'

export type OpeningBalanceCutoffStatus =
  | 'counting'
  | 'posted'
  | 'cancelled'
  | null
  | undefined

/** Authoritative Count Type History lifecycle labels. */
export type StockCountHistoryLifecycle =
  | 'draft_removable'
  | 'verification_started'
  | 'posted'
  | 'cancelled'

export interface DraftEligibilityInput {
  status: StockCountSessionStatus
  count_type?: StockCountCountType
  /**
   * True only when final-posting OTP has been requested or consumed
   * (verification request pending_delivery / active / posted).
   * Must NOT be derived from count progress or a counting freeze alone.
   */
  postingStarted: boolean
  cutoff_status?: OpeningBalanceCutoffStatus
}

export interface HistoryLifecyclePresentation {
  lifecycle: StockCountHistoryLifecycle
  badge: string
  detail: string
  deletable: boolean
}

// "Saved counts and legacy history" surfaces official Initial Classification
// history alongside live drafts. Only POSTED sessions are official audit
// history — `archived` sessions are already-discarded drafts and must never
// resurface here, otherwise a successful discard appears to "come back" after a
// reload. Deliberately excludes 'archived'.
export const LEGACY_HISTORY_STATUSES: StockCountSessionStatus[] = ['posted']

export function isCancelledOpeningBalanceCutoff(
  input: Pick<DraftEligibilityInput, 'count_type' | 'cutoff_status'>,
): boolean {
  return (input.count_type || '') === 'opening_balance_cutoff'
    && input.cutoff_status === 'cancelled'
}

/**
 * Resolve the authoritative history lifecycle.
 * Count progress (e.g. 112/112) is intentionally ignored.
 */
export function resolveStockCountHistoryLifecycle(
  input: DraftEligibilityInput,
): StockCountHistoryLifecycle {
  if (isCancelledOpeningBalanceCutoff(input)) return 'cancelled'
  if (input.status === 'posted' || input.cutoff_status === 'posted') return 'posted'
  if (input.status === 'draft' && input.postingStarted) return 'verification_started'
  return 'draft_removable'
}

export function stockCountHistoryLifecyclePresentation(
  input: DraftEligibilityInput,
): HistoryLifecyclePresentation {
  const lifecycle = resolveStockCountHistoryLifecycle(input)
  switch (lifecycle) {
    case 'verification_started':
      return {
        lifecycle,
        badge: 'Verification Started — Protected',
        detail: 'OTP has been requested. Cancel and archive this exercise to restart.',
        deletable: false,
      }
    case 'posted':
      return {
        lifecycle,
        badge: 'Posted — Official History',
        detail: input.count_type === 'opening_balance_cutoff'
          ? 'Opening Balance has been posted.'
          : 'Official posted count — audit history cannot be discarded.',
        deletable: false,
      }
    case 'cancelled':
      return {
        lifecycle,
        badge: 'Cancelled — Read-only History',
        detail: 'The exercise was cancelled and archived.',
        deletable: false,
      }
    case 'draft_removable':
    default:
      return {
        lifecycle,
        badge: 'Draft — Removable',
        detail: 'Final verification has not started.',
        deletable: input.status === 'draft',
      }
  }
}

// A session may be discarded only while it is a live draft that has not entered
// OTP verification, and is not cancelled Opening Balance history.
export function isDraftDeletable(input: DraftEligibilityInput): boolean {
  if (input.status !== 'draft') return false
  if (isCancelledOpeningBalanceCutoff(input)) return false
  if (input.postingStarted) return false
  if (input.cutoff_status === 'posted') return false
  return true
}

// Human-readable reason a session cannot be discarded, or null when it can.
export function draftProtectionReason(input: DraftEligibilityInput): string | null {
  if (isDraftDeletable(input)) return null
  const presentation = stockCountHistoryLifecyclePresentation(input)
  if (presentation.lifecycle === 'draft_removable') {
    if (input.status === 'archived') return 'Already discarded.'
    return 'This session is no longer a draft — cannot be discarded.'
  }
  return presentation.detail
}

// Split a requested selection into what will actually be removed vs. what is
// protected, so a bulk discard can never target a protected session and the
// confirmation can report exact counts.
export function partitionDiscardSelection<T extends DraftEligibilityInput & { id: string }>(
  sessions: T[],
  selectedIds: Iterable<string>,
): { removable: T[]; protected: T[] } {
  const selected = new Set(selectedIds)
  const removable: T[] = []
  const protectedSessions: T[] = []
  for (const session of sessions) {
    if (!selected.has(session.id)) continue
    if (isDraftDeletable(session)) removable.push(session)
    else protectedSessions.push(session)
  }
  return { removable, protected: protectedSessions }
}
