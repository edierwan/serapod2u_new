import { queueNotificationEvent } from '@/lib/notifications/supplyChainEventQueue'
import {
  DAILY_REPORT_EVENT,
  DAILY_REPORT_SCHEDULE,
  DAILY_SUMMARY_EVENT,
  TO_SHIP_STATUS,
  buildDailyReport,
  mytDayBounds,
  mytDayKey,
  mytHour,
  type DailyReportSlot,
  type ReportOrderLine,
} from './tiktok-daily-report'

const LINE_COLUMNS = 'shop_id, order_id, package_id, seller_sku, product_name, variation, quantity, order_substatus, created_time'
const PAGE = 1000

export interface DailyReportRunResult {
  slot: DailyReportSlot | null
  skipped?: string
  companies: { company_id: string; parcels: number; items: number; queued: Record<string, string> }[]
}

async function loadLines(db: any, shopIds: string[], slot: DailyReportSlot, now: Date): Promise<ReportOrderLine[]> {
  const rows: ReportOrderLine[] = []
  const { start, end } = mytDayBounds(now)
  for (let from = 0; ; from += PAGE) {
    let query = db.from('marketplace_order_lines').select(LINE_COLUMNS).in('shop_id', shopIds)
    query = slot === 'packing'
      ? query.eq('order_status', TO_SHIP_STATUS)
      : query.gte('shipped_time', start).lt('shipped_time', end)
    const { data, error } = await query.order('created_time', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

async function loadSetting(db: any, orgId: string, eventCode: string) {
  const { data } = await db.from('notification_settings').select('enabled').eq('org_id', orgId).eq('event_code', eventCode).maybeSingle()
  return data as { enabled?: boolean } | null
}

async function alreadyQueued(db: any, orgId: string, eventCode: string, reportKey: string): Promise<boolean> {
  const { data } = await db
    .from('notifications_outbox')
    .select('id')
    .eq('org_id', orgId)
    .eq('event_code', eventCode)
    .contains('payload_json', { report_key: reportKey })
    .limit(1)
  return Boolean(data && data.length)
}

/**
 * Queues the report for every company with active TikTok shops. Each event is
 * sent only when it is switched on in Notification Types; channels and
 * recipients come from there too. One report per company, day and hour.
 */
export async function runTikTokDailyReport(
  db: any,
  options: { now?: Date; slot?: DailyReportSlot; force?: boolean } = {},
): Promise<DailyReportRunResult> {
  const now = options.now || new Date()
  const hour = mytHour(now)
  const slot = options.slot || DAILY_REPORT_SCHEDULE[hour] || null
  if (!slot) return { slot: null, skipped: 'not_scheduled', companies: [] }

  const { data: shops, error } = await db
    .from('marketplace_shops')
    .select('id, company_id, shop_name')
    .eq('is_active', true)
    .order('shop_name', { ascending: true })
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { slot, skipped: 'not_migrated', companies: [] }
    throw error
  }
  if (!shops?.length) return { slot, skipped: 'no_shops', companies: [] }

  const { data: connections } = await db.from('marketplace_shop_connections').select('shop_id, last_sync_at')
  const lastSyncByShop = new Map<string, string | null>((connections || []).map((c: any) => [c.shop_id, c.last_sync_at]))

  const byCompany = new Map<string, any[]>()
  for (const shop of shops) byCompany.set(shop.company_id, [...(byCompany.get(shop.company_id) || []), shop])

  const result: DailyReportRunResult = { slot, companies: [] }
  for (const [companyId, companyShops] of byCompany) {
    const queued: Record<string, string> = {}
    const enabled = []
    for (const eventCode of [DAILY_REPORT_EVENT, DAILY_SUMMARY_EVENT]) {
      const setting = await loadSetting(db, companyId, eventCode)
      if (!setting?.enabled) queued[eventCode] = 'off'
      else enabled.push(eventCode)
    }
    if (!enabled.length) {
      result.companies.push({ company_id: companyId, parcels: 0, items: 0, queued })
      continue
    }

    const lines = await loadLines(db, companyShops.map((s) => s.id), slot, now)
    const syncTimes = companyShops.map((s) => lastSyncByShop.get(s.id)).filter(Boolean) as string[]
    const lastSyncAt = syncTimes.length ? syncTimes.sort()[0] : null
    const report = buildDailyReport({
      slot,
      now,
      shops: companyShops.map((s) => ({ id: s.id, name: s.shop_name })),
      lines,
      lastSyncAt,
    })
    const reportKey = `${mytDayKey(now)}:${slot}:${hour}${options.force ? `:manual-${now.getTime()}` : ''}`
    const payload = {
      report_key: reportKey,
      report_slot: slot,
      email_subject: report.subject,
      report_text: report.text,
      summary_text: report.summary,
      total_parcels: String(report.parcels),
      total_items: String(report.items),
    }

    for (const eventCode of enabled) {
      if (await alreadyQueued(db, companyId, eventCode, reportKey)) {
        queued[eventCode] = 'already_sent'
        continue
      }
      const outcome = await queueNotificationEvent(db, { orgId: companyId, eventCode, payload })
      queued[eventCode] = outcome.queuedCount ? 'queued' : outcome.skippedReason || 'not_queued'
      if (outcome.errors?.length) console.warn(`[tiktok-daily-report] ${eventCode}: ${outcome.errors.join('; ')}`)
    }
    result.companies.push({ company_id: companyId, parcels: report.parcels, items: report.items, queued })
  }
  return result
}
