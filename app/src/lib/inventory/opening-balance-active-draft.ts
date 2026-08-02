// ============================================================================
// Opening Balance — active draft vs cancelled cutoff resolution
// ----------------------------------------------------------------------------
// Pure helpers for Continue Existing Draft / History navigation. Cancelled
// freeze sessions must never be treated as the resumable active draft.
// ============================================================================

export type OpeningBalanceCutoffStatus =
  | 'counting'
  | 'posted'
  | 'cancelled'
  | null
  | undefined

export interface OpeningBalanceDraftCandidate {
  id: string
  status: string
  count_type?: string | null
  warehouse_organization_id?: string | null
  product_category_id?: string | null
  reference_name?: string | null
  created_at?: string | null
  updated_at?: string | null
  counted_count?: number | null
  scope_count?: number | null
  /** Authoritative cutoff status for this session, when one exists. */
  cutoff_status?: OpeningBalanceCutoffStatus
}

/** True when a session may be opened as the live Opening Balance draft. */
export function isResumableOpeningBalanceDraft(
  draft: Pick<OpeningBalanceDraftCandidate, 'status' | 'count_type' | 'cutoff_status'>,
): boolean {
  if (draft.status !== 'draft') return false
  if ((draft.count_type || '') !== 'opening_balance_cutoff') return false
  const cutoff = draft.cutoff_status || null
  // Cancelled and posted cutoffs are never resumable active drafts.
  if (cutoff === 'cancelled' || cutoff === 'posted') return false
  return true
}

/** Cancelled freeze history — read-only audit only. */
export function isCancelledOpeningBalanceHistory(
  draft: Pick<OpeningBalanceDraftCandidate, 'count_type' | 'cutoff_status' | 'status'>,
): boolean {
  if ((draft.count_type || '') !== 'opening_balance_cutoff') return false
  return draft.cutoff_status === 'cancelled'
}

/**
 * Resolve the single active Opening Balance draft for a warehouse+category.
 * Prefers counting freeze, then draft with no cutoff yet. Never returns a
 * cancelled or posted cutoff session.
 */
export function resolveActiveOpeningBalanceDraft<T extends OpeningBalanceDraftCandidate>(
  drafts: T[],
  warehouseOrganizationId: string,
  productCategoryId: string,
  currentSessionId?: string | null,
): T | undefined {
  const warehouse = (warehouseOrganizationId || '').trim()
  const category = (productCategoryId || '').trim()
  if (!warehouse || !category) return undefined

  const candidates = drafts
    .filter(draft =>
      isResumableOpeningBalanceDraft(draft)
      && draft.warehouse_organization_id === warehouse
      && draft.product_category_id === category
      && draft.id !== currentSessionId,
    )
    .sort((a, b) => {
      const aCounting = a.cutoff_status === 'counting' ? 0 : 1
      const bCounting = b.cutoff_status === 'counting' ? 0 : 1
      if (aCounting !== bCounting) return aCounting - bCounting
      return String(b.updated_at || b.created_at || '').localeCompare(
        String(a.updated_at || a.created_at || ''),
      )
    })

  return candidates[0]
}

export function formatOpeningBalanceDraftProgress(draft: OpeningBalanceDraftCandidate): string {
  const counted = Math.max(0, Number(draft.counted_count || 0))
  const total = Math.max(0, Number(draft.scope_count || 0))
  return `${counted}/${total}`
}

export function formatOpeningBalanceDraftCreatedAt(iso?: string | null): string {
  if (!iso) return 'Unknown time'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString()
}

/** CTA when viewing a cancelled cutoff page. */
export function cancelledOpeningBalanceNextAction(hasActiveDraft: boolean): {
  label: string
  kind: 'return_active' | 'create_new'
} {
  return hasActiveDraft
    ? { label: 'Return to Active Draft', kind: 'return_active' }
    : { label: 'Create New Opening Balance', kind: 'create_new' }
}
