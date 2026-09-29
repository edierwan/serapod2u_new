import { isOutdoorHost } from '@/lib/hosts/outdoor-hosts'

export type OutdoorDeskProductStatus = 'live' | 'sold_out' | 'hidden_no_price'

export interface OutdoorDeskProduct {
  id: string
  name: string
  code: string
  imageUrl: string | null
  /** False when the card falls back to the bundled packshot because master data has no photo. */
  hasOwnPhoto: boolean
  price: number | null
  variantCount: number
  /** Units the online shop warehouse can still sell; null when stock cannot be read. */
  stock: number | null
  status: OutdoorDeskProductStatus
}

export interface OutdoorDeskSummary {
  toSend: number
  awaitingPayment: number
  /** Null when order requests are not installed on this database. */
  openRequests: number | null
  messagesThisWeek: number | null
  salesThisMonth: { orders: number; amount: number }
}

export interface OutdoorDeskData {
  subscribers: number
  summary: OutdoorDeskSummary
  products: OutdoorDeskProduct[]
}

export const OUTDOOR_LOW_STOCK = 5

/** Bundled packshots live here; see outdoorStaticImage. */
const OUTDOOR_PACKSHOT_PREFIX = '/outdoor/products/'

export const OUTDOOR_DESK_STATUS_LABELS: Record<OutdoorDeskProductStatus, string> = {
  live: 'Live',
  sold_out: 'Sold out',
  hidden_no_price: 'Hidden · no price',
}

export function isOutdoorPackshot(imageUrl: string | null | undefined) {
  return String(imageUrl || '').startsWith(OUTDOOR_PACKSHOT_PREFIX)
}

export function outdoorDeskProductStatus(input: { priced: boolean; stock: number | null; soldOut?: boolean }): OutdoorDeskProductStatus {
  if (!input.priced) return 'hidden_no_price'
  if (input.stock === 0 || (input.stock == null && input.soldOut)) return 'sold_out'
  return 'live'
}

export function outdoorProductPreviewHref(productId: string) {
  return `/outdoor/shop/${productId}`
}

export function outdoorProductEditHref(productId: string) {
  return `/supply-chain/products/${productId}/edit`
}

/**
 * Main-admin pages are not served on the Outdoor host (every path there is rewritten under /outdoor),
 * so from that host they must point at the main app.
 */
export function mainAppHref(
  path: string,
  location?: { hostname: string; protocol: string } | null,
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
) {
  if (!location || !isOutdoorHost(location.hostname)) return path
  const configured = String(appUrl || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(configured)) {
    try {
      if (!isOutdoorHost(new URL(configured).hostname)) return `${configured}${path}`
    } catch {
      // fall through to the host-derived origin
    }
  }
  return `${location.protocol}//${location.hostname.replace(/^(www\.)?outdoor\./i, '')}${path}`
}

/** Staff stay on the desk pages; the shop itself is open to them read-only as a preview. */
export function isOutdoorStaffPage(pathname: string) {
  return (
    pathname.startsWith('/outdoor/admin') ||
    pathname.startsWith('/outdoor/fulfilment') ||
    pathname.startsWith('/outdoor/shop') ||
    pathname.startsWith('/outdoor/unsubscribe') ||
    pathname.startsWith('/outdoor/forgot-password')
  )
}
