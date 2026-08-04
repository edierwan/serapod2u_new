// ===========================================================================
// Opening Balance — Step 4 → Step 5 workflow guard
// ---------------------------------------------------------------------------
// "Continue to Review & Post" previously stayed enabled on the Transactions
// step (Step 4) even while an authoritative blocker remained — e.g. an
// allocation-reconciliation blocker with difference = 1 and one decision still
// pending. The footer only gated the D2H and H2M steps, so Step 4 advanced
// unconditionally.
//
// This module derives the Step 4 continue gate and the authoritative
// "may Review & Post be entered as a POSTABLE state" guard from the single
// server-authoritative readiness result (`deriveOpeningBalanceReadiness`) plus
// the structured remaining-decision counts. It NEVER parses English blocker
// text: it keys off structured `readiness.blockers[].step` / `blockerCount` and
// `remainingByStep`.
// ===========================================================================

import { deriveOpeningBalanceReadiness, type OpeningBalanceReadiness } from './opening-balance-readiness'
import type { OpeningBalanceStepId } from './opening-balance-workspace'
import {
  deriveWorkspaceState,
  groupDistributorOrders,
  groupManufacturerOrders,
  type OpeningBalanceWorkspaceState,
} from './opening-balance-workspace'

export interface OpeningBalanceContinueGate {
  canContinue: boolean
  /** Authoritative unresolved count = transaction-step blockers + pending decisions. */
  unresolvedCount: number
  /** Exact, human-readable reason, or null when the user may continue. */
  message: string | null
  /** Stable id of the first unresolved transaction blocker, for a jump/highlight. */
  firstUnresolvedKey: string | null
}

const READY_GATE: OpeningBalanceContinueGate = {
  canContinue: true,
  unresolvedCount: 0,
  message: null,
  firstUnresolvedKey: null,
}

/**
 * Gate for advancing OUT of the Transactions step (Step 4 → Review & Post).
 * Blocks while any authoritative blocker resolves on the Transactions step
 * (allocation reconciliation / individual resolution) OR a transaction decision
 * is still pending. Both inputs are structured — no blocker text is parsed.
 */
export function transactionsContinueGate(
  readiness: OpeningBalanceReadiness | null,
  remainingTransactionsDecisions: number,
): OpeningBalanceContinueGate {
  const txBlockers = (readiness?.blockers ?? []).filter(b => b.step === 'transactions')
  const pendingDecisions = Math.max(0, Math.trunc(remainingTransactionsDecisions || 0))
  const unresolvedCount = txBlockers.length + pendingDecisions
  if (unresolvedCount === 0) return READY_GATE
  return {
    canContinue: false,
    unresolvedCount,
    message: `Resolve ${unresolvedCount} transaction blocker${unresolvedCount === 1 ? '' : 's'} before continuing to Review & Post.`,
    firstUnresolvedKey: txBlockers[0]?.id ?? null,
  }
}

/**
 * The SINGLE authoritative Transactions-step continue gate. Orphan allocation
 * blockers are counted BOTH as transaction-step blockers in `readiness.blockers`
 * and folded into `remainingByStep.transactions`; subtract them so they are not
 * double-counted. This one result feeds the Transactions summary, the footer
 * message, the Continue disabled state AND the Continue onClick — never two
 * divergent calculations.
 */
export function transactionsGateFor(
  readiness: OpeningBalanceReadiness | null,
  workspace: Pick<OpeningBalanceWorkspaceState, 'remainingByStep' | 'allocationBlockers'> | null,
): OpeningBalanceContinueGate {
  const remaining = Math.max(
    0,
    (workspace?.remainingByStep.transactions ?? 0) - (workspace?.allocationBlockers.length ?? 0),
  )
  return transactionsContinueGate(readiness, remaining)
}

/**
 * Derive `{ readiness, workspace }` from a raw preview report in ONE place, so a
 * freshly-refetched preview yields the exact same authoritative state the render
 * memos use. The Continue onClick calls this on the just-fetched report — no
 * stale ref/closure, no second gate calculation.
 */
export function deriveOpeningBalanceReviewState(
  report: Parameters<typeof deriveWorkspaceState>[0],
  cutoffStatus?: string,
): { readiness: OpeningBalanceReadiness; workspace: OpeningBalanceWorkspaceState } {
  const workspace = deriveWorkspaceState({ ...report, status: cutoffStatus })
  const d2hGroups = groupDistributorOrders((report?.distributor_orders ?? []) as Parameters<typeof groupDistributorOrders>[0])
  const h2mGroups = groupManufacturerOrders((report?.manufacturer_incoming ?? []) as Parameters<typeof groupManufacturerOrders>[0])
  const d2hPolicyResolved = Boolean(workspace.d2hPolicy?.policy)
  const h2mPolicyResolved = Boolean(workspace.h2mPolicy?.policy)
  const readiness = deriveOpeningBalanceReadiness({
    serverReadiness: (report as { readiness?: 'Ready' | 'Review Required' | 'Blocked' })?.readiness,
    serverBlockers: workspace.summary.blocked.messages,
    serverBlockerDetails: (report as { blocker_details?: unknown })?.blocker_details,
    blockedDistributorRefs: [...new Set(workspace.summary.blocked.references)],
    d2hRequired: d2hGroups.actionable.length + d2hGroups.historical.length > 0,
    d2hPolicyResolved,
    d2hUndecidedLines: d2hPolicyResolved ? workspace.d2hRemaining : 0,
    h2mRequired: h2mGroups.length > 0,
    h2mPolicyResolved,
    h2mUndecidedLines: h2mPolicyResolved ? workspace.h2mRemaining : 0,
    transactionsRequired: Boolean(
      workspace.transactionsHistoricalSummary
      && workspace.transactionsHistoricalSummary.eligibleCount > 0,
    ),
    transactionsPolicyResolved: Boolean(workspace.transactionsPolicy?.policy),
  })
  return { readiness, workspace }
}

const PRE_REVIEW_STEPS: OpeningBalanceStepId[] = ['freeze', 'd2h', 'h2m', 'transactions']

/**
 * Authoritative guard: may the Review & Post step be entered as a POSTABLE
 * state? True only when server readiness is ready, there are zero authoritative
 * blockers, and no earlier step has decisions remaining. Used to block Step 4 →
 * Step 5 advancement through alternate/stale client paths. Viewing the Review
 * dashboard read-only is separate — posting itself is additionally gated by
 * `canExecuteInventoryCutoff` and re-validated server-side.
 */
export function canEnterReviewStep(
  readiness: OpeningBalanceReadiness | null,
  remainingByStep: Record<OpeningBalanceStepId, number> | null,
): boolean {
  // Gate on the authoritative blocker count, NOT the strict `ready` flag. Server
  // 'Review Required' has zero blockers (only non-blocking advisories) and must
  // be allowed to enter Review & Post; posting stays gated on server 'Ready'.
  if (!readiness || readiness.blockerCount > 0) return false
  if (remainingByStep) {
    const pending = PRE_REVIEW_STEPS.reduce(
      (sum, s) => sum + Math.max(0, Math.trunc(remainingByStep[s] ?? 0)),
      0,
    )
    if (pending > 0) return false
  }
  return true
}

/**
 * Resolve the step a navigation request may actually land on. Any target other
 * than 'review' is always allowed (the user must be free to go back and fix a
 * blocker). Advancing INTO 'review' is only permitted when `canEnterReviewStep`
 * holds; otherwise the request is refused (returns null).
 */
export function guardedAdvanceTarget(
  target: OpeningBalanceStepId,
  readiness: OpeningBalanceReadiness | null,
  remainingByStep: Record<OpeningBalanceStepId, number> | null,
): OpeningBalanceStepId | null {
  if (target !== 'review') return target
  return canEnterReviewStep(readiness, remainingByStep) ? 'review' : null
}
