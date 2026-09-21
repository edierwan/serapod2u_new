/**
 * Order business date (`orders.order_date`) helpers.
 *
 *   order_date  DATE         business / SO date, a Malaysia calendar date
 *   created_at  TIMESTAMPTZ  actual system creation instant (audit)
 *
 * A DATE is handled as its `YYYY-MM-DD` key everywhere here. It is never passed
 * through `new Date('YYYY-MM-DD')`, which is a UTC-midnight instant and renders
 * as the previous day in any time zone west of UTC. Converting a `created_at`
 * instant to a business date always goes through Asia/Kuala_Lumpur, never the
 * UTC date (which is "yesterday" between 00:00 and 08:00 MYT).
 */

export const ORDER_DATE_TIME_ZONE = 'Asia/Kuala_Lumpur'

/** Malaysia has not observed DST since 1982, so MYT is a fixed UTC+8. */
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

export const FUTURE_ORDER_DATE_MESSAGE = 'SO Date cannot be in the future.'

export const ORDER_DATE_MIGRATION = '20260921120000_add_orders_order_date.sql'
export const D2H_ORDER_DATE_RPC_MIGRATION = '20260921120100_d2h_submit_order_date.sql'

/** A real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_KEY.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as unknown as [number, number, number, number]
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** The Malaysia calendar date an instant falls on. */
export function malaysiaDateOf(instant: string | number | Date): string | null {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + MYT_OFFSET_MS).toISOString().slice(0, 10)
}

/** Today's calendar date in Asia/Kuala_Lumpur. */
export function malaysiaToday(now: Date = new Date()): string {
  return malaysiaDateOf(now) as string
}

/** `YYYY-MM-DD` shifted by whole days, calendar-safe across month/year ends. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The instant a Malaysia business date starts (its 00:00 MYT), as ISO-8601 UTC. */
export function businessDateStartUtc(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - MYT_OFFSET_MS).toISOString()
}

/**
 * The business date of an order: `order_date` when present, otherwise the
 * Malaysia date of `created_at` — which is exactly how the migration backfills
 * legacy rows, so the fallback and the stored value can never disagree.
 */
export function orderBusinessDate(order: {
  order_date?: string | null
  created_at?: string | null
} | null | undefined): string | null {
  if (!order) return null
  const stored = typeof order.order_date === 'string' ? order.order_date.slice(0, 10) : null
  if (stored && isDateKey(stored)) return stored
  return order.created_at ? malaysiaDateOf(order.created_at) : null
}

/** `15/09/2026` — the SO date convention (`en-MY` numeric), without a Date round-trip. */
export function formatDateKey(dateKey: string | null | undefined, fallback = '—'): string {
  if (!dateKey || !isDateKey(dateKey.slice(0, 10))) return fallback
  const [y, m, d] = dateKey.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** `15/09/26` — the compact form the Orders list uses. */
export function formatDateKeyShort(dateKey: string | null | undefined, fallback = '—'): string {
  if (!dateKey || !isDateKey(dateKey.slice(0, 10))) return fallback
  const [y, m, d] = dateKey.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `15 Sep 2026` — the long form the PDFs use. */
export function formatDateKeyLong(dateKey: string | null | undefined, fallback = ''): string {
  if (!dateKey || !isDateKey(dateKey.slice(0, 10))) return fallback
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`
}

export type OrderDateValidation =
  | { ok: true; orderDate: string; isBackdated: boolean }
  | { ok: false; error: string }

/**
 * Validate a business SO date against today in Malaysia: today and any past
 * date are allowed, a future date is not. Mirrors the database rule enforced by
 * submit_and_allocate_d2h_order and the orders_order_date_guard trigger.
 */
export function validateOrderDate(value: unknown, now: Date = new Date()): OrderDateValidation {
  if (!isDateKey(value)) return { ok: false, error: 'Please select a valid SO Date.' }
  const today = malaysiaToday(now)
  if (value > today) return { ok: false, error: FUTURE_ORDER_DATE_MESSAGE }
  return { ok: true, orderDate: value, isBackdated: value < today }
}

/** PostgREST/Postgres error for a SELECT/filter on an order_date column that does not exist yet. */
export function isMissingOrderDateColumn(error: any): boolean {
  if (!error) return false
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return (error?.code === '42703' || error?.code === 'PGRST204' || /column|schema cache/i.test(message))
    && message.includes('order_date')
}

/** PostgREST error for an RPC call whose p_order_date parameter the database does not know yet. */
export function isMissingOrderDateRpcParameter(error: any): boolean {
  if (!error) return false
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return (error?.code === 'PGRST202' || /schema cache|could not find the function/i.test(message))
    && message.includes('p_order_date')
}
