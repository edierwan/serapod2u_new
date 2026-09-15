/** Organization types whose users may trigger QR batch processing from the dashboard. */
export const PROCESSING_ORG_TYPES: readonly string[] = ['HQ', 'MFG']

export type OrderOwnership = {
  seller_org_id: string | null
  buyer_org_id: string | null
  company_id: string | null
}

/** Whether a user of `orgType`/`orgId` may process a batch for this order. */
export function canProcessBatchForOrder(orgType: string, orgId: string, order: OrderOwnership | null): boolean {
  if (!order || !orgId) return false
  // The manufacturer the order was placed with (what QRBatchesView lists).
  if (order.seller_org_id === orgId) return true
  // The HQ that owns the order.
  if (orgType === 'HQ') return order.company_id === orgId || order.buyer_org_id === orgId
  return false
}
