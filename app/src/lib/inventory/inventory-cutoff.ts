import { summarizeOpeningBalance, type OpeningBalancePreview } from './opening-balance-classification'

export type CutoffReadiness = 'Ready' | 'Review Required' | 'Blocked'
export type CutoffDecision = 'carry_forward' | 'cancel_release' | 'do_not_carry_forward' | 'carry_forward_incoming' | 'history_only'

export interface CutoffReport {
  cutoff_id: string
  status: 'counting' | 'posted' | 'cancelled'
  proposed_cutoff_at: string
  /** Authoritative boundary: proposed_cutoff_at before post, posted_at after. */
  cutoff_boundary_at?: string
  warehouse_organization_id: string
  product_category_id?: string
  product_category_name?: string
  company_id: string
  readiness: CutoffReadiness
  freeze_active: boolean
  qr_status: 'Protected — No Impact'
  notice: 'Preview only — no inventory, order, allocation, or QR data will be changed.'
  inventory: any[]
  distributor_orders: any[]
  manufacturer_incoming: any[]
  warehouse_activity: any[]
  stock_count_drafts: any[]
  blockers: string[]
  review_items: string[]
  /** Saved D2H policy snapshot for this cutoff, when present. */
  d2h_policy?: {
    policy: 'exclude_all' | 'review_select'
    boundary_at: string
    eligible_order_count: number
    eligible_item_count: number
    eligible_quantity: number
    selected_order_count: number
    selected_item_count: number
    selected_quantity: number
    excluded_order_count: number
    excluded_item_count: number
    excluded_quantity: number
    eligible_order_ids: string[]
    selected_order_ids: string[]
    excluded_order_ids: string[]
    decided_by?: string
    decided_at?: string
    orders_cancelled?: false
    historical_movements_reversed?: false
    qr_impact?: 'none'
  } | null
  d2h_historical_summary?: {
    order_count: number
    item_count: number
    ordered_quantity: number
    orders_cancelled?: false
    historical_stock_returned?: false
    notice?: string | null
  } | null
  /** Saved H2M policy snapshot for this cutoff, when present. */
  h2m_policy?: {
    policy: 'exclude_all' | 'review_select'
    boundary_at: string
    eligible_order_count: number
    eligible_item_count: number
    eligible_quantity: number
    eligible_ordered_quantity?: number
    eligible_received_before_boundary?: number
    eligible_outstanding_quantity?: number
    selected_order_count: number
    selected_item_count: number
    selected_quantity: number
    selected_outstanding_quantity?: number
    excluded_order_count: number
    excluded_item_count: number
    excluded_quantity: number
    excluded_outstanding_quantity?: number
    eligible_order_ids: string[]
    selected_order_ids: string[]
    excluded_order_ids: string[]
    decided_by?: string
    decided_at?: string
    orders_cancelled?: false
    inventory_added?: false
    qr_impact?: 'none'
  } | null
  h2m_historical_summary?: {
    order_count: number
    item_count: number
    ordered_quantity: number
    received_before_boundary?: number
    outstanding_quantity?: number
    orders_cancelled?: false
    inventory_added?: false
    notice?: string | null
  } | null
}

export function canExecuteInventoryCutoff(report: CutoffReport | null, isHqAdmin: boolean): boolean {
  // Posting is blocked ONLY by real blockers ('Blocked'). Advisory review_items
  // ('Review Required' — stock-in-transit, historical-excluded transactions) do
  // NOT block posting. This mirrors the backend gate in
  // bind_inventory_cutoff_verification_snapshot / verify_and_post_...scoped_legacy
  // (20260801240000), which rejects only when readiness = 'Blocked'.
  return Boolean(
    isHqAdmin
    && report?.status === 'counting'
    && report.freeze_active
    && (report.readiness === 'Ready' || report.readiness === 'Review Required'),
  )
}

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

export function inventoryCutoffReportCsv(report: CutoffReport): string {
  const lines: string[] = [
    ['Inventory Opening Balance & Initial Classification Report'],
    ['Proposed cut-off', report.proposed_cutoff_at],
    ['Warehouse', report.warehouse_organization_id],
    ['Product Category', report.product_category_name || report.product_category_id],
    ['Organization', report.company_id],
    ['Readiness', report.readiness],
    ['QR status', report.qr_status],
    [],
    ['Inventory'],
    ['Variant', 'Configuration', 'System Quantity', 'Physical Quantity', 'Variance', 'Allocated Quantity'],
    ...report.inventory.map(row => [
      row.variant_name, row.stock_configuration, row.system_quantity,
      row.physical_quantity, row.variance, row.allocated_quantity,
    ]),
    [],
    ['Distributor Orders'],
    ['Order', 'Status', 'Customer', 'Warehouse', 'Variant', 'Quantity', 'Decision', 'Classification'],
    ...report.distributor_orders.map(row => [
      row.order_number, row.status, row.customer, row.warehouse, row.variant,
      row.quantity, row.decision, row.classification,
    ]),
    [],
    ['Manufacturer Incoming'],
    ['Order', 'Status', 'Manufacturer', 'Variant', 'Ordered', 'Received', 'Remaining', 'Configuration', 'Decision'],
    ...report.manufacturer_incoming.map(row => [
      row.order_number, row.status, row.manufacturer, row.variant, row.ordered_quantity,
      row.received_quantity, row.remaining_incoming_quantity, row.stock_configuration, row.decision,
    ]),
    ...openingBalanceSummaryCsvRows(report),
  ].map(row => row.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

/**
 * The seven pre-posting summary buckets, appended to the CSV without altering
 * the existing sections above. Keeps the report self-explanatory for auditors.
 */
function openingBalanceSummaryCsvRows(report: CutoffReport): unknown[][] {
  const summary = summarizeOpeningBalance(report as unknown as OpeningBalancePreview)
  return [
    [],
    ['Opening Balance Summary'],
    ['Bucket', 'Order/Row Count', 'Total Quantity'],
    ['1. Physical Opening Stock', summary.physicalOpeningStock.countedRows, summary.physicalOpeningStock.totalQuantity],
    ['2. H2M Incoming After Cut-off', summary.manufacturerIncomingAfterCutoff.orderCount, summary.manufacturerIncomingAfterCutoff.totalQuantity],
    ['3. D2H Carry Forward', summary.distributorCarryForward.orderCount, summary.distributorCarryForward.totalQuantity],
    ['4. D2H Cancel & Release', summary.distributorCancelRelease.orderCount, summary.distributorCancelRelease.totalQuantity],
    ['5. Excluded / Do Not Carry Forward', summary.excludedDoNotCarryForward.orderCount, summary.excludedDoNotCarryForward.totalQuantity],
    ['6. Stock in Transit', summary.stockInTransit.orderCount, summary.stockInTransit.totalQuantity],
    ['7. Blocked / Unresolved', summary.blocked.orderCount + summary.blocked.messages.length, ''],
  ]
}
