/**
 * Messaging order deep links for Telegram / WhatsApp notifications.
 * Auth still enforced by the dashboard; link only opens the order view.
 */
export function getMessagingAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || 'https://stg.serapod2u.com'
  ).replace(/\/$/, '')
}

export function buildMessagingOrderDeepLink(orderId: string): string {
  return `${getMessagingAppBaseUrl()}/dashboard?view=view-order&order_id=${encodeURIComponent(orderId)}`
}
