// ============================================================================
// Opening Balance — operational transaction presentation helpers.
// ----------------------------------------------------------------------------
// Pure display formatting for the Transactions step. Does not change
// eligibility, blockers, quantities or posting rules. Keeps internal UUIDs for
// joins/audit while showing operators a business reference (or a safe dated
// fallback) instead of a raw id.
// ============================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  stock_adjustment: 'Stock Adjustment',
  stock_transfer: 'Stock Transfer',
  return: 'Return',
  transfer_out: 'Transfer Out',
  transfer_in: 'Transfer In',
  repack_out: 'Repack Out',
  repack_in: 'Repack In',
  adjustment: 'Adjustment',
  addition: 'Addition',
  repack: 'Repack',
  transfer: 'Transfer',
  receive: 'Receive',
}

export interface ActivityPresentationItem {
  item_id?: string | null
  variant_id?: string | null
  variant_name?: string | null
  alternative_name?: string | null
  stock_config_id?: string | null
  stock_configuration?: string | null
  quantity?: number | null
  warehouse?: string | null
  status?: string | null
}

export interface ActivityPresentationRow {
  movement_type?: string | null
  reference_no?: string | null
  reference_id?: string | null
  reference_type?: string | null
  occurred_at?: string | null
  status?: string | null
  quantity?: number | null
  line_count?: number | null
  variant_count?: number | null
  classification?: string | null
  required_action?: string | null
  warehouse?: string | null
  items?: ActivityPresentationItem[] | null
}

/** True when the value is a bare UUID (not a business document number). */
export function isRawUuidReference(value?: string | null): boolean {
  const trimmed = (value || '').trim()
  return Boolean(trimmed && UUID_RE.test(trimmed))
}

/** Convert machine movement names (`stock_adjustment`) into readable labels. */
export function formatWarehouseActivityType(movementType?: string | null): string {
  const key = (movementType || '').trim().toLowerCase()
  if (!key) return 'Transaction'
  if (MOVEMENT_TYPE_LABELS[key]) return MOVEMENT_TYPE_LABELS[key]
  return key
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Format an occurred-at timestamp like `19 Jul 2026, 11:05 AM`.
 * Returns null when the input is missing or invalid.
 */
export function formatActivityOccurredAt(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)

  return formatted.replace(/\b(am|pm)\b/gi, match => match.toUpperCase())
}

/** Date-only label for readable fallbacks (`19 Jul 2026`) — avoids repeating full date/time. */
export function formatActivityOccurredDate(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/**
 * User-facing reference for the Transactions table.
 *
 * Prefers an existing business document/reference number. Never promotes a raw
 * UUID (or truncated UUID) as the primary label. Falls back to
 * `{Type} · {date}` (date only — full timestamp lives in the Date/time column).
 */
export function formatWarehouseActivityReference(row: ActivityPresentationRow): string {
  const businessRef = (row.reference_no || '').trim()
  if (businessRef && !isRawUuidReference(businessRef)) return businessRef

  const label = formatWarehouseActivityType(row.movement_type)
  const when = formatActivityOccurredDate(row.occurred_at)
  return when ? `${label} · ${when}` : label
}

/**
 * Internal UUID retained for joins, API actions, audit and uniqueness.
 * Surfaced only via tooltip / technical details — never as the primary cell.
 */
export function warehouseActivityTechnicalId(row: ActivityPresentationRow): string | null {
  const explicit = (row.reference_id || '').trim()
  if (explicit) return explicit
  const ref = (row.reference_no || '').trim()
  if (isRawUuidReference(ref)) return ref
  return null
}

/** Required operator action for must-resolve operational transactions. */
export function formatActivityRequiredAction(row: ActivityPresentationRow): string {
  const explicit = (row.required_action || '').trim()
  if (explicit) return explicit
  if ((row.classification || '').trim() === 'Complete Before Cut-off') return 'Complete or Cancel'
  if ((row.classification || '').trim() === 'Stock in Transit') return 'Protected — no action'
  if ((row.classification || '').trim() === 'History Only') return 'History only'
  return (row.classification || '').trim() || 'Review'
}

/**
 * Deep-link into the original transaction workspace. UUIDs stay in the query
 * string for selection; they are never shown as the primary label.
 */
export function warehouseActivityOpenHref(row: ActivityPresentationRow): string | null {
  const type = (row.movement_type || '').trim().toLowerCase()
  const technicalId = warehouseActivityTechnicalId(row)
  const businessRef = (row.reference_no || '').trim()
  const usableRef = businessRef && !isRawUuidReference(businessRef) ? businessRef : null

  if (type === 'stock_adjustment' || type === 'adjustment') {
    if (!technicalId) return '/supply-chain/inventory/count'
    return `/supply-chain/inventory/count?adjustmentId=${encodeURIComponent(technicalId)}`
  }
  if (type === 'stock_transfer' || type === 'transfer' || type === 'transfer_out' || type === 'transfer_in') {
    if (usableRef) return `/supply-chain/inventory/transfer?transfer=${encodeURIComponent(usableRef)}`
    if (technicalId) return `/supply-chain/inventory/transfer?transferId=${encodeURIComponent(technicalId)}`
    return '/supply-chain/inventory/transfer'
  }
  if (type === 'return') {
    if (usableRef) return `/supply-chain/returns?return=${encodeURIComponent(usableRef)}`
    if (technicalId) return `/supply-chain/returns?returnId=${encodeURIComponent(technicalId)}`
    return '/supply-chain/returns'
  }
  return null
}

export function warehouseActivityOpenLabel(row: ActivityPresentationRow): string {
  const type = (row.movement_type || '').trim().toLowerCase()
  if (type === 'stock_adjustment' || type === 'adjustment') return 'Open Adjustment'
  return 'View Transaction'
}

/** Authoritative child lines when the server provided them; otherwise empty. */
export function warehouseActivityItems(row: ActivityPresentationRow): ActivityPresentationItem[] {
  return Array.isArray(row.items) ? row.items : []
}

export function warehouseActivityLineCount(row: ActivityPresentationRow): number {
  if (typeof row.line_count === 'number' && Number.isFinite(row.line_count)) {
    return Math.max(0, Math.trunc(row.line_count))
  }
  const items = warehouseActivityItems(row)
  if (items.length > 0) return items.length
  // Header-only legacy rows still count as one unresolved document item.
  return Number(row.quantity || 0) !== 0 || (row.status || '').trim() ? 1 : 0
}

export function warehouseActivityVariantCount(row: ActivityPresentationRow): number {
  if (typeof row.variant_count === 'number' && Number.isFinite(row.variant_count)) {
    return Math.max(0, Math.trunc(row.variant_count))
  }
  const items = warehouseActivityItems(row)
  if (items.length === 0) return 0
  return new Set(items.map(item => item.variant_id || item.variant_name || '').filter(Boolean)).size
}

export function warehouseActivityQuantity(row: ActivityPresentationRow): number {
  const items = warehouseActivityItems(row)
  if (items.length > 0) {
    return items.reduce((sum, item) => sum + Math.abs(Number(item.quantity || 0)), 0)
  }
  return Math.abs(Number(row.quantity || 0))
}

/** Show alternative name only when it adds information beyond the variant name. */
export function formatActivityVariantLabel(item: ActivityPresentationItem): string {
  const name = (item.variant_name || '').trim() || 'Variant unavailable'
  const alt = (item.alternative_name || '').trim()
  if (!alt || alt.toLowerCase() === name.toLowerCase()) return name
  return `${name} (${alt})`
}

export function formatActivityStockConfiguration(item: ActivityPresentationItem): string {
  const label = (item.stock_configuration || '').trim()
  return label || 'Unclassified'
}

export interface WarehouseActivityTypeSummary {
  movementType: string
  label: string
  documentCount: number
  lineItemCount: number
  totalQuantity: number
}

export interface WarehouseActivitySummary {
  /** Distinct unresolved transaction headers/documents. */
  documentCount: number
  /** Authoritative child lines (or 1 per header when detail is absent). */
  lineItemCount: number
  totalAffectedQuantity: number
  zeroImpactCount: number
  byType: WarehouseActivityTypeSummary[]
  /** Operator-facing remaining badge, e.g. "68 pending items across 12 stock adjustments". */
  remainingLabel: string
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

/**
 * Summarise unresolved operational transactions for the Transactions step.
 * Document count is authoritative for progression blocking; line count and
 * quantity come from child detail when present.
 */
export function summarizeWarehouseActivity(rows: ActivityPresentationRow[]): WarehouseActivitySummary {
  const documentCount = rows.length
  let lineItemCount = 0
  let totalAffectedQuantity = 0
  let zeroImpactCount = 0
  const byTypeMap = new Map<string, WarehouseActivityTypeSummary>()

  for (const row of rows) {
    const lines = warehouseActivityLineCount(row)
    const qty = warehouseActivityQuantity(row)
    lineItemCount += lines
    totalAffectedQuantity += qty
    if (qty === 0) zeroImpactCount += 1

    const movementType = (row.movement_type || 'transaction').trim().toLowerCase() || 'transaction'
    const existing = byTypeMap.get(movementType)
    if (existing) {
      existing.documentCount += 1
      existing.lineItemCount += lines
      existing.totalQuantity += qty
    } else {
      byTypeMap.set(movementType, {
        movementType,
        label: formatWarehouseActivityType(movementType),
        documentCount: 1,
        lineItemCount: lines,
        totalQuantity: qty,
      })
    }
  }

  const byType = [...byTypeMap.values()].sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label))
  const remainingLabel = formatTransactionsRemainingLabel({
    documentCount,
    lineItemCount,
    byType,
  })

  return {
    documentCount,
    lineItemCount,
    totalAffectedQuantity,
    zeroImpactCount,
    byType,
    remainingLabel,
  }
}

export function formatTransactionsRemainingLabel(input: {
  documentCount: number
  lineItemCount: number
  byType: WarehouseActivityTypeSummary[]
}): string {
  const { documentCount, lineItemCount, byType } = input
  if (documentCount <= 0) return 'All resolved'

  const dominant = byType.length === 1 ? byType[0] : null
  const docNoun = dominant
    ? pluralize(documentCount, dominant.label.toLowerCase(), `${dominant.label.toLowerCase()}s`)
    : pluralize(documentCount, 'transaction')

  if (lineItemCount > 0 && lineItemCount !== documentCount) {
    return `${lineItemCount} pending ${pluralize(lineItemCount, 'item')} across ${documentCount} ${docNoun}`
  }
  if (dominant?.movementType === 'stock_adjustment' || dominant?.movementType === 'adjustment') {
    return `${documentCount} pending ${pluralize(documentCount, 'adjustment')}`
  }
  return `${documentCount} pending ${docNoun}`
}
