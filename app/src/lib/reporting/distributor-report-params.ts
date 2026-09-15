import {
  ALL_DISTRIBUTORS,
  ALL_STATUS,
  ORDER_STATUSES,
  currentReportingMonthKey,
  isValidMonthKey,
} from './distributor-analytics'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DistributorReportParams =
  | { ok: true; month: string; distributor: string; status: string }
  | { ok: false; error: string }

/**
 * The report scope — `?month=YYYY-MM&distributor=all|<uuid>&status=all|<order_status>` —
 * validated once for the report and every drill-down, so both always read the
 * same month, distributor and status.
 */
export function parseDistributorReportParams(searchParams: URLSearchParams, now: Date = new Date()): DistributorReportParams {
  const currentMonth = currentReportingMonthKey(now)
  const month = searchParams.get('month') ?? currentMonth
  if (!isValidMonthKey(month)) {
    return { ok: false, error: `Invalid reporting month "${month}", expected YYYY-MM` }
  }
  // A month beyond the running Malaysia month cannot have traded.
  if (month > currentMonth) {
    return { ok: false, error: `Reporting month "${month}" is in the future` }
  }

  // Stable IDs only: anything that is not the `all` sentinel must be a uuid, so
  // a distributor can never be selected by name or by free text.
  const distributor = searchParams.get('distributor')?.trim() || ALL_DISTRIBUTORS
  if (distributor !== ALL_DISTRIBUTORS && !UUID.test(distributor)) {
    return { ok: false, error: `Invalid distributor "${distributor}"` }
  }

  const status = searchParams.get('status')?.trim() || ALL_STATUS
  if (status !== ALL_STATUS && !(ORDER_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Invalid order status "${status}"` }
  }
  return { ok: true, month, distributor, status }
}
