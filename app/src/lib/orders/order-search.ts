/**
 * Free-text search for the Orders list.
 *
 * The Orders table shows an organization in its "Name" column, but the search
 * only ever looked at `order_no`, `display_doc_no` and `notes` — and the same
 * three columns were pushed into the Supabase query as an `.or(...)` filter, so
 * typing "skd" fetched only the handful of rows whose *document number* or
 * notes happened to contain "skd" and every "SKD Distribution" order fell out
 * of the result set before the client ever saw it.
 *
 * The whole page of orders is already loaded (see ORDER_FETCH_LIMIT), so the
 * search is done here, in one place, over the identity the user actually sees.
 */

export interface OrderSearchOrg {
  org_name?: string | null
  org_code?: string | null
  org_type_code?: string | null
}

export interface SearchableOrder {
  order_no?: string | null
  display_doc_no?: string | null
  notes?: string | null
  order_type?: string | null
  seller_org_id?: string | null
  buyer_org?: OrderSearchOrg | null
  seller_org?: OrderSearchOrg | null
}

/**
 * The organization name rendered in the Orders "Name" column.
 *
 *  - D2H (Distributor → HQ): the distributor placing the order (buyer),
 *    with a legacy fallback to the seller for old rows built the other way up.
 *  - H2M (HQ → Manufacturer): the manufacturer (seller).
 *  - S2D (Shop → Distributor): the counterparty, from the viewer's side.
 */
export function getOrderDisplayOrgName(
  order: SearchableOrder,
  viewerOrgId?: string | null,
): string {
  if (order.order_type === 'D2H') {
    const sellerIsHQorWH = order.seller_org?.org_type_code === 'HQ' || order.seller_org?.org_type_code === 'WH'
    const buyerIsDist = order.buyer_org?.org_type_code === 'DIST'

    if (buyerIsDist && order.buyer_org?.org_name) {
      return order.buyer_org.org_name
    }
    if (!sellerIsHQorWH && order.seller_org?.org_name) {
      return order.seller_org.org_name
    }
    return order.buyer_org?.org_name || order.seller_org?.org_name || 'N/A'
  }

  if (order.order_type === 'H2M') {
    return order.seller_org?.org_name || 'N/A'
  }

  if (order.order_type === 'S2D') {
    if (order.seller_org_id && order.seller_org_id === viewerOrgId) {
      return order.buyer_org?.org_name || 'N/A'
    }
    return order.seller_org?.org_name || 'N/A'
  }

  return order.seller_org?.org_name || 'N/A'
}

/** Every field the Orders free-text box searches, in display order. */
export function orderSearchFields(
  order: SearchableOrder,
  viewerOrgId?: string | null,
): string[] {
  return [
    order.display_doc_no,
    order.order_no,
    getOrderDisplayOrgName(order, viewerOrgId),
    order.buyer_org?.org_name,
    order.seller_org?.org_name,
    order.buyer_org?.org_code,
    order.seller_org?.org_code,
    order.notes,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * Case-insensitive, trimmed substring match across the searchable fields.
 * An empty query matches everything; null/undefined fields never throw.
 */
export function orderMatchesSearch(
  order: SearchableOrder,
  query: string | null | undefined,
  viewerOrgId?: string | null,
): boolean {
  const normalizedSearch = (query || '').trim().toLowerCase()
  if (!normalizedSearch) return true

  return orderSearchFields(order, viewerOrgId)
    .some((value) => value.toLowerCase().includes(normalizedSearch))
}
