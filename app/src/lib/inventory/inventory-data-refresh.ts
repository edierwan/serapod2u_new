/**
 * One authoritative invalidation signal for committed inventory writes.
 *
 * Views that read `product_inventory` / `stock_movements` (View Inventory, the
 * inventory summary cards, Movement Reports & History) are mounted independently
 * of whatever posted the change, so a confirmed commit elsewhere in the app has
 * no way to reach them. This is a single broadcast fired exactly once AFTER the
 * database transaction is confirmed committed — not polling, and never fired
 * optimistically before the server response.
 */

export const INVENTORY_DATA_REFRESH_EVENT = 'serapod:inventory-data-refresh'

export type InventoryDataRefreshReason =
    | 'opening_balance_posted'
    | 'stock_count_posted'
    | 'stock_adjustment_posted'

export interface InventoryDataRefreshDetail {
    reason: InventoryDataRefreshReason
    /** Warehouse organization whose inventory changed, when known. */
    warehouseOrganizationId?: string | null
    /** Correlates the refresh with the posted session/cut-off. */
    referenceId?: string | null
}

/** Fire once, after the authoritative commit is confirmed. */
export function broadcastInventoryDataRefresh(detail: InventoryDataRefreshDetail): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<InventoryDataRefreshDetail>(
        INVENTORY_DATA_REFRESH_EVENT,
        { detail },
    ))
}

/**
 * Subscribe to committed-inventory invalidations. Returns the unsubscribe
 * function so callers can wire it straight into a `useEffect` cleanup.
 */
export function subscribeToInventoryDataRefresh(
    handler: (detail: InventoryDataRefreshDetail) => void,
): () => void {
    if (typeof window === 'undefined') return () => {}
    const listener = (event: Event) => {
        const detail = (event as CustomEvent<InventoryDataRefreshDetail>).detail
        handler(detail ?? { reason: 'stock_count_posted' })
    }
    window.addEventListener(INVENTORY_DATA_REFRESH_EVENT, listener)
    return () => window.removeEventListener(INVENTORY_DATA_REFRESH_EVENT, listener)
}
