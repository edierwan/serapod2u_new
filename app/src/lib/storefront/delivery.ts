/** Courier name stored on orders that our own team delivers (no courier, no tracking number). */
export const OWN_DELIVERY_LABEL = 'Serapod delivery team'

export function isOwnDelivery(courierName: string | null | undefined) {
  return String(courierName || '').trim() === OWN_DELIVERY_LABEL
}

/** The order really left us: our own team took it, or a courier shipment / tracking number exists. */
export function hasShipmentDetails(order: {
  shipping_tracking_no?: string | null
  easyparcel_order_no?: string | null
  shipping_courier_name?: string | null
}) {
  return Boolean(
    String(order.shipping_tracking_no || '').trim()
    || String(order.easyparcel_order_no || '').trim()
    || isOwnDelivery(order.shipping_courier_name),
  )
}
