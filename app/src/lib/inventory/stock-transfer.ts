/**
 * Stock Transfer workflow helpers and lifecycle documentation.
 *
 * Lifecycle (UI label → DB status):
 *   Draft              → draft
 *   Pending Approval   → pending_approval
 *   Ready to Dispatch  → ready_to_dispatch
 *   In Transit         → in_transit
 *   Received           → received
 * Terminal: cancelled, rejected. Legacy rows may still use pending.
 *
 * Exact stock timing:
 *   draft              — editable; no reservation; no ledger movement
 *   pending_approval   — source quantity_allocated reserved; on_hand unchanged
 *   ready_to_dispatch  — reservation remains; Transfer Note available; no transfer_out
 *   in_transit         — reservation consumed; transfer_out posted once at source
 *   received           — transfer_in posted once at destination
 *
 * Cancel / reject:
 *   draft              — cancel only (no stock)
 *   pending_approval   — cancel/reject/recall releases reservation once
 *   ready_to_dispatch  — authorized cancel releases reservation once
 *   in_transit         — normal cancel prohibited (controlled return/reversal only)
 *   received           — terminal; no cancel through this flow
 *
 * Authorization (server + UI):
 *   Approve / Reject  — public.is_hq_admin() (get_my_role_level() <= 10)
 *   Dispatch          — source warehouse can_access_org(from) or is_hq_admin()
 *   Receive           — destination warehouse can_access_org(to) or is_hq_admin()
 *   Requester cannot silently self-approve unless they independently satisfy is_hq_admin()
 */

export type StockTransferDbStatus =
  | 'draft'
  | 'pending'
  | 'pending_approval'
  | 'ready_to_dispatch'
  | 'in_transit'
  | 'received'
  | 'cancelled'
  | 'rejected'

export type StockTransferStage =
  | 'draft'
  | 'pending_approval'
  | 'ready_to_dispatch'
  | 'in_transit'
  | 'received'

export const STOCK_TRANSFER_STAGES: Array<{
  id: StockTransferStage
  label: string
  dbStatus: StockTransferDbStatus
}> = [
  { id: 'draft', label: 'Draft', dbStatus: 'draft' },
  { id: 'pending_approval', label: 'Pending Approval', dbStatus: 'pending_approval' },
  { id: 'ready_to_dispatch', label: 'Ready to Dispatch', dbStatus: 'ready_to_dispatch' },
  { id: 'in_transit', label: 'In Transit', dbStatus: 'in_transit' },
  { id: 'received', label: 'Received', dbStatus: 'received' },
]

export const STOCK_TRANSFER_NOTES_MAX = 300

/** Canonical HQ authority label — mirrors public.is_hq_admin(). */
export const STOCK_TRANSFER_HQ_APPROVER_LABEL =
  'HQ Admin / Super Admin (is_hq_admin · role_level 1–10)'

export interface StockTransferLineInput {
  variant_id: string
  stock_config_id: string
  quantity: number
  cost?: number | null
  variant_name?: string
  product_name?: string
  product_code?: string
  stock_sku?: string
  config_label?: string
  volume_ml?: number | null
  packaging?: string | null
}

export interface SourceInventoryRow {
  inventoryKey: string
  variantId: string
  stockConfigId: string
  productId: string
  productCode: string
  productName: string
  variantName: string
  flavour: string
  productLine: string
  configLabel: string
  stockSku: string
  volumeMl: number | null
  packaging: string | null
  configCode: string
  available: number
  unitCost: number | null
  imageUrl?: string | null
}

export function extractFlavour(variantName: string): string {
  const match = variantName.match(/\[([^\]]*)\]/)
  const flavour = match?.[1]?.trim()
  return flavour ? `[${flavour}]` : variantName
}

/**
 * Map DB status → five UI stages.
 * Historical Phase-11 rows stored Ready-to-Dispatch work as `in_transit`
 * (stock already deducted). They render as In Transit without destructive rewrite.
 */
export function mapDbStatusToStage(status: string | null | undefined): StockTransferStage | null {
  switch (status) {
    case 'draft':
    case 'pending':
      return 'draft'
    case 'pending_approval':
      return 'pending_approval'
    case 'ready_to_dispatch':
      return 'ready_to_dispatch'
    case 'in_transit':
      return 'in_transit'
    case 'received':
      return 'received'
    default:
      return null
  }
}

export function transferStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
    case 'pending':
      return 'Draft'
    case 'pending_approval':
      return 'Pending Approval'
    case 'ready_to_dispatch':
      return 'Ready to Dispatch'
    case 'in_transit':
      return 'In Transit'
    case 'received':
      return 'Received'
    case 'cancelled':
      return 'Cancelled'
    case 'rejected':
      return 'Rejected'
    default:
      return status || 'Unknown'
  }
}

export function transferStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
    case 'pending':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'pending_approval':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'ready_to_dispatch':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200'
    case 'in_transit':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'received':
      return 'bg-violet-100 text-violet-800 border-violet-200'
    case 'cancelled':
    case 'rejected':
      return 'bg-slate-100 text-slate-700 border-slate-200'
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200'
  }
}

export function transferStockImpactMessage(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
    case 'pending':
      return 'Stock is not reserved.'
    case 'pending_approval':
      return 'Quantity reserved; On Hand unchanged.'
    case 'ready_to_dispatch':
      return 'Approved and reserved; awaiting dispatch.'
    case 'in_transit':
      return 'Source stock deducted; awaiting receipt.'
    case 'received':
      return 'Destination stock received; transfer complete.'
    case 'cancelled':
      return 'Transfer cancelled; no open reservation.'
    case 'rejected':
      return 'Transfer rejected; reservation released.'
    default:
      return 'Stock impact depends on transfer status.'
  }
}

/** Client-side mirror of public.is_hq_admin() / get_my_role_level() <= 10. */
export function isHqInventoryAdmin(roleLevel: number | null | undefined): boolean {
  if (roleLevel == null || Number.isNaN(Number(roleLevel))) return false
  return Number(roleLevel) <= 10
}

export function canApproveStockTransfer(options: {
  status: string | null | undefined
  isHqAdmin: boolean
}): boolean {
  return options.isHqAdmin && options.status === 'pending_approval'
}

export function canRejectStockTransfer(options: {
  status: string | null | undefined
  isHqAdmin: boolean
}): boolean {
  return options.isHqAdmin && options.status === 'pending_approval'
}

export function canDispatchStockTransfer(options: {
  status: string | null | undefined
  isHqAdmin: boolean
  userOrgId?: string | null
  fromOrgId?: string | null
}): boolean {
  if (options.status !== 'ready_to_dispatch') return false
  if (options.isHqAdmin) return true
  return Boolean(options.userOrgId && options.fromOrgId && options.userOrgId === options.fromOrgId)
}

export function canReceiveStockTransfer(options: {
  status: string | null | undefined
  isHqAdmin: boolean
  userOrgId?: string | null
  toOrgId?: string | null
}): boolean {
  if (options.status !== 'in_transit') return false
  if (options.isHqAdmin) return true
  return Boolean(options.userOrgId && options.toOrgId && options.userOrgId === options.toOrgId)
}

export function canCancelStockTransfer(options: {
  status: string | null | undefined
}): boolean {
  return ['draft', 'pending', 'pending_approval', 'ready_to_dispatch'].includes(options.status || '')
}

export function canPrintTransferNote(options: {
  status: string | null | undefined
  hasTransferId: boolean
}): boolean {
  if (!options.hasTransferId) return false
  return [
    'ready_to_dispatch',
    'in_transit',
    'received',
    // Historical Phase-11 rows used in_transit as the post-approval state.
  ].includes(options.status || '')
}

export function configBadgeClass(volumeMl: number | null, packaging: string | null): string {
  if (volumeMl === 20 && packaging === 'new_box') return 'bg-blue-100 text-blue-800 border-blue-200'
  if (volumeMl === 50 && packaging === 'new_box') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (volumeMl === 50 && packaging === 'old_box') return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

export function isTransferableConfiguration(row: {
  stockConfigId: string | null | undefined
  configCode?: string | null
  status?: string | null
}): boolean {
  if (!row.stockConfigId) return false
  const code = (row.configCode || '').toUpperCase()
  if (!code || code === 'UNCLASSIFIED' || code.includes('LEGACY')) return false
  if (row.status && row.status !== 'active') return false
  return true
}

export function parseTransferQuantity(raw: string | number | null | undefined): {
  ok: true
  value: number
} | {
  ok: false
  error: string
} {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'Quantity is required' }
  }
  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: 'Transfer quantities must be positive whole numbers' }
  }
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: 'Transfer quantities must be positive whole numbers' }
  }
  return { ok: true, value }
}

export function validateTransferQuantity(
  raw: string | number | null | undefined,
  available: number,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseTransferQuantity(raw)
  if (!parsed.ok) return parsed
  if (parsed.value > available) {
    return { ok: false, error: 'Transfer quantity cannot exceed available stock' }
  }
  return parsed
}

export function afterTransferQty(available: number, transferQty: number): number {
  return available - transferQty
}

export function consolidateTransferLines(lines: StockTransferLineInput[]): StockTransferLineInput[] {
  const map = new Map<string, StockTransferLineInput>()
  for (const line of lines) {
    if (!line.variant_id || !line.stock_config_id) {
      throw new Error('Every transfer line requires variant_id and stock_config_id')
    }
    const parsed = parseTransferQuantity(line.quantity)
    if (!parsed.ok) throw new Error(parsed.error)
    const key = `${line.variant_id}:${line.stock_config_id}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { ...line, quantity: parsed.value })
    } else {
      map.set(key, {
        ...existing,
        quantity: existing.quantity + parsed.value,
        cost: line.cost ?? existing.cost,
      })
    }
  }
  return Array.from(map.values())
}

export function validateTransferRoute(fromId: string, toId: string): string | null {
  if (!fromId || !toId) return 'Please select from and to warehouses'
  if (fromId === toId) return 'Source and destination cannot be identical'
  return null
}

export function filterSourceInventoryRows(
  rows: SourceInventoryRow[],
  options: {
    search?: string
    productLine?: string
    configurationKey?: string
    availableOnly?: boolean
  },
): SourceInventoryRow[] {
  const search = (options.search || '').trim().toLowerCase()
  return rows.filter((row) => {
    if (options.availableOnly && row.available <= 0) return false
    if (options.productLine && options.productLine !== 'all' && row.productLine !== options.productLine) {
      return false
    }
    if (options.configurationKey && options.configurationKey !== 'all') {
      const key = `${row.volumeMl ?? 'std'}|${row.packaging ?? 'none'}|${row.configLabel}`
      if (key !== options.configurationKey) return false
    }
    if (!search) return true
    const haystack = [
      row.flavour,
      row.variantName,
      row.productName,
      row.productCode,
      row.stockSku,
      row.configLabel,
    ].join(' ').toLowerCase()
    return haystack.includes(search)
  })
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): {
  pageRows: T[]
  totalPages: number
  page: number
} {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
    page: safePage,
  }
}

export function summarizeDraftSelection(
  rows: SourceInventoryRow[],
  quantities: Record<string, string>,
): {
  selectedConfigs: number
  selectedFlavours: number
  totalQuantity: number
  estimatedValue: number
  errors: string[]
} {
  const errors: string[] = []
  let totalQuantity = 0
  let estimatedValue = 0
  const flavourIds = new Set<string>()
  let selectedConfigs = 0

  for (const row of rows) {
    const raw = quantities[row.inventoryKey]
    if (raw === undefined || raw === '') continue
    const validated = validateTransferQuantity(raw, row.available)
    if (!validated.ok) {
      errors.push(`${row.stockSku}: ${validated.error}`)
      continue
    }
    selectedConfigs += 1
    flavourIds.add(row.variantId)
    totalQuantity += validated.value
    estimatedValue += validated.value * (row.unitCost || 0)
  }

  return {
    selectedConfigs,
    selectedFlavours: flavourIds.size,
    totalQuantity,
    estimatedValue,
    errors,
  }
}

export function buildTransferRpcItems(
  rows: SourceInventoryRow[],
  quantities: Record<string, string>,
): StockTransferLineInput[] {
  const lines: StockTransferLineInput[] = []
  for (const row of rows) {
    const raw = quantities[row.inventoryKey]
    if (raw === undefined || raw === '') continue
    const validated = validateTransferQuantity(raw, row.available)
    if (!validated.ok) throw new Error(`${row.stockSku}: ${validated.error}`)
    if (!isTransferableConfiguration(row)) {
      throw new Error('Legacy/Unclassified stock cannot be transferred through the normal flow')
    }
    lines.push({
      variant_id: row.variantId,
      stock_config_id: row.stockConfigId,
      quantity: validated.value,
      cost: row.unitCost,
      variant_name: row.variantName,
      product_name: row.productName,
      product_code: row.productCode,
      stock_sku: row.stockSku,
      config_label: row.configLabel,
      volume_ml: row.volumeMl,
      packaging: row.packaging,
    })
  }
  return consolidateTransferLines(lines)
}

export function inventoryRowKey(variantId: string, stockConfigId: string): string {
  return `${variantId}:${stockConfigId}`
}

export function formatTransferItemsSummary(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '—'
  const labels = items.slice(0, 2).map((item: any) => {
    const flavour = extractFlavour(String(item?.variant_name || item?.product_name || 'Item'))
    const config = item?.config_label || item?.stock_sku || ''
    return config ? `${flavour} (${config})` : flavour
  })
  const extra = items.length - labels.length
  return extra > 0 ? `${labels.join(', ')} +${extra}` : labels.join(', ')
}
