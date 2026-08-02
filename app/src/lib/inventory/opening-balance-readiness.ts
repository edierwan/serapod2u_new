// ===========================================================================
// Opening Balance — single authoritative readiness derivation
// ---------------------------------------------------------------------------
// The Review & Post page previously showed three DIFFERENT readiness signals
// that could disagree:
//   1. the step badge          → workspace.remainingByStep.review (client count)
//   2. the "Unresolved" card   → summary.blocked (server blockers[] + blocked
//                                 distributor lines)
//   3. the OTP button          → report.readiness (server authoritative)
// A response-contract mismatch (e.g. transactions_historical_summary.blocked_count
// = 0 while blockers[] = 1) let the badge read "All resolved" while the card read
// "1 blocker(s)" and OTP stayed disabled.
//
// This module derives ONE readiness result from the server-authoritative
// `report.readiness`, and produces a blocker list that can never contradict it.
// The readiness badge, blocker count, blocker details, OTP button state and the
// final-posting validation all consume this single result.
// ===========================================================================

import type { OpeningBalanceStepId } from './opening-balance-workspace'
import {
  parseOpeningBalanceBlockers,
  type OpeningBalanceBlockerDetail,
  type OpeningBalanceBlockerIdentity,
  type OpeningBalanceResolutionAction,
} from './opening-balance-blockers'

export type OpeningBalanceReadinessLevel = 'ready' | 'action-required' | 'blocked'

export interface OpeningBalanceBlocker {
  /** Stable identity used for navigation + highlight (never product text alone). */
  id: string
  /** Short blocker type, e.g. "D2H Policy Not Saved". */
  type: string
  /** Wizard step where the blocker is resolved. */
  step: OpeningBalanceStepId
  /** Document/reference (order number, RET/ST reference), when applicable. */
  reference?: string
  /** Exact, human-readable reason. */
  reason: string
  /** Contextual resolution route, e.g. "Review Potato Allocation". */
  actionLabel: string
  /** Structured, non-textual identity when the blocker resolves to a record. */
  identity?: OpeningBalanceBlockerIdentity
  /** Valid, server-gated resolution actions (presentation only). */
  resolutionActions?: OpeningBalanceResolutionAction[]
}

export interface OpeningBalanceReadiness {
  /** Server-authoritative: true only when the preview reports "Ready". */
  ready: boolean
  level: OpeningBalanceReadinessLevel
  /** 'Ready to Post' | 'Review Required' | 'Action Required' | 'Blocked'. */
  statusLabel: string
  /** Genuine blockers only. Zero for Ready and for advisory-only Review Required. */
  blockerCount: number
  blockers: OpeningBalanceBlocker[]
}

export interface DeriveReadinessInput {
  /** Server readiness from inventory_cutoff_preview — the only source of truth. */
  serverReadiness: 'Ready' | 'Review Required' | 'Blocked' | undefined | null
  /** Server-provided genuine blocker messages (top-level blockers[]). */
  serverBlockers?: string[]
  /**
   * Structured blocker contract (preview.blocker_details[]) when the server
   * provides it. Supersedes `serverBlockers` — same authoritative collection
   * Step 4 consumes, so the two steps can never contradict.
   */
  serverBlockerDetails?: unknown
  /** Distributor order numbers whose lines are classified "Blocked". */
  blockedDistributorRefs?: string[]
  d2hRequired: boolean
  d2hPolicyResolved: boolean
  /** Undecided submitted D2H lines under Option B. */
  d2hUndecidedLines: number
  h2mRequired: boolean
  h2mPolicyResolved: boolean
  /** Undecided eligible H2M lines under Option B. */
  h2mUndecidedLines: number
  transactionsRequired: boolean
  transactionsPolicyResolved: boolean
}

const READY: OpeningBalanceReadiness = {
  ready: true,
  level: 'ready',
  statusLabel: 'Ready to Post',
  blockerCount: 0,
  blockers: [],
}

/**
 * Derive the single authoritative readiness view.
 *
 * Rules (from the Opening Balance posting spec):
 *  - `report.readiness` is authoritative. When it is "Ready" the exercise is
 *    ready to post and there are ZERO blockers — never both "Ready" and a
 *    positive blocker count.
 *  - When it is not "Ready" there is always at least one blocker; if no specific
 *    blocker can be attributed client-side (a stale/contract mismatch), a
 *    "refresh readiness" blocker is surfaced so the badge and count still agree.
 *  - Historical-excluded eligible transactions are NEVER treated as blockers —
 *    only genuine unresolved items (unsaved required policies, undecided lines,
 *    config-blocked carry-forward, and server-reported resolution blockers).
 */
export function deriveOpeningBalanceReadiness(input: DeriveReadinessInput): OpeningBalanceReadiness {
  // Server-authoritative "Ready" short-circuits: no client count may contradict it.
  if (input.serverReadiness === 'Ready') return READY

  const blockers: OpeningBalanceBlocker[] = []

  // --- Required-policy / undecided-line blockers ---------------------------
  if (input.d2hRequired && !input.d2hPolicyResolved) {
    blockers.push({
      id: 'policy:d2h',
      type: 'D2H Policy Not Saved',
      step: 'd2h',
      reason: 'Choose Start Fresh or Review Orders and save the D2H policy before posting.',
      actionLabel: 'Go to D2H Policy',
    })
  } else if (input.d2hUndecidedLines > 0) {
    blockers.push({
      id: 'decisions:d2h',
      type: 'D2H Decisions Pending',
      step: 'd2h',
      reason: `${input.d2hUndecidedLines} distributor line(s) still need a carry-forward decision.`,
      actionLabel: 'Go to D2H Policy',
    })
  }

  if (input.h2mRequired && !input.h2mPolicyResolved) {
    blockers.push({
      id: 'policy:h2m',
      type: 'H2M Policy Not Saved',
      step: 'h2m',
      reason: 'Choose Start Fresh or Review Orders and save the H2M policy before posting.',
      actionLabel: 'Go to H2M Policy',
    })
  } else if (input.h2mUndecidedLines > 0) {
    blockers.push({
      id: 'decisions:h2m',
      type: 'H2M Decisions Pending',
      step: 'h2m',
      reason: `${input.h2mUndecidedLines} manufacturer line(s) still need an incoming decision.`,
      actionLabel: 'Go to H2M Policy',
    })
  }

  if (input.transactionsRequired && !input.transactionsPolicyResolved) {
    blockers.push({
      id: 'policy:transactions',
      type: 'Transactions Policy Not Saved',
      step: 'transactions',
      reason: 'Choose a Transactions policy (Start Fresh, Carry Forward, or Review) and save it before posting.',
      actionLabel: 'Go to Transactions',
    })
  }

  // --- Config-blocked D2H carry-forward ------------------------------------
  for (const reference of input.blockedDistributorRefs ?? []) {
    blockers.push({
      id: `d2h-cf-blocked:${reference}`,
      type: 'D2H Carry Forward Blocked',
      step: 'd2h',
      reference,
      reason: 'Carry Forward is blocked for this order. Open the D2H step to resolve the configuration or keep it as historical.',
      actionLabel: 'Review Item',
    })
  }

  // --- Genuine server-reported resolution blockers -------------------------
  // Consume the SAME authoritative blocker collection Step 4 renders: structured
  // `blocker_details[]` when present, else the classified `blockers[]` strings.
  // Each blocker carries a stable identity and a contextual action label, so an
  // allocation-ownership mismatch navigates to "Review <Item> Allocation" — not a
  // generic "Go to Transactions" that lands on a page with nothing to fix.
  const details: OpeningBalanceBlockerDetail[] = parseOpeningBalanceBlockers({
    blocker_details: input.serverBlockerDetails,
    blockers: input.serverBlockers,
  })
  for (const detail of details) {
    blockers.push({
      id: detail.id,
      type: detail.category === 'allocation_reconciliation'
        ? 'Allocation Reconciliation'
        : 'Requires Individual Resolution',
      step: detail.step,
      reference: detail.identity.sourceOrderNumber ?? detail.identity.sourceDocumentRef,
      reason: detail.reason,
      actionLabel: detail.actionLabel,
      identity: detail.identity,
      resolutionActions: detail.resolutionActions,
    })
  }

  // Server contract (inventory_cutoff_preview): readiness is 'Blocked' when there
  // are blockers, 'Review Required' when there are ZERO blockers but non-blocking
  // review advisories exist (stock-in-transit, historical-excluded transactions),
  // else 'Ready'. 'Review Required' therefore means the exercise has NO blockers
  // and MUST be allowed to advance to Review & Post — the advisories are reviewed
  // there. OTP request / final post accept Ready OR Review Required (Blocked only).
  if (blockers.length === 0 && input.serverReadiness === 'Review Required') {
    return {
      ready: false,
      level: 'action-required',
      statusLabel: 'Review Required',
      blockerCount: 0,
      blockers: [],
    }
  }

  // The server says 'Blocked' (or an unknown non-Ready value) yet nothing was
  // attributable client-side — a stale preview or a response-contract mismatch.
  // Surface a single refresh blocker so the badge, count and OTP button agree.
  if (blockers.length === 0) {
    blockers.push({
      id: 'readiness:not-confirmed',
      type: 'Readiness Not Confirmed',
      step: 'review',
      reason: 'Server readiness is not "Ready". Refresh the preview to load the latest blockers, then re-check.',
      actionLabel: 'Refresh Readiness',
    })
  }

  const level: OpeningBalanceReadinessLevel =
    input.serverReadiness === 'Blocked' ? 'blocked' : 'action-required'

  return {
    ready: false,
    level,
    statusLabel: level === 'blocked' ? 'Blocked' : 'Action Required',
    blockerCount: blockers.length,
    blockers,
  }
}
