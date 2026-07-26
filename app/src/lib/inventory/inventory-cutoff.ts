export type CutoffReadiness = 'Ready' | 'Review Required' | 'Blocked'
export type CutoffDecision = 'carry_forward' | 'cancel_release' | 'carry_forward_incoming' | 'history_only'

export interface CutoffReport {
  cutoff_id: string
  status: 'counting' | 'posted' | 'cancelled'
  proposed_cutoff_at: string
  warehouse_organization_id: string
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
}

export function canExecuteInventoryCutoff(report: CutoffReport | null, isHqAdmin: boolean): boolean {
  return Boolean(isHqAdmin && report?.status === 'counting' && report.readiness === 'Ready' && report.freeze_active)
}

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

export function inventoryCutoffReportCsv(report: CutoffReport): string {
  const lines: string[] = [
    ['Inventory Opening Balance Cut-off Report'],
    ['Proposed cut-off', report.proposed_cutoff_at],
    ['Warehouse', report.warehouse_organization_id],
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
  ].map(row => row.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}
