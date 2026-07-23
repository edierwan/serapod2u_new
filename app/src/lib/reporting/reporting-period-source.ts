import {
  reportingPeriodFromKey,
  reportingPeriodKeyFromTimestamp,
  type ReportingPeriod,
} from './reporting-period'

interface PeriodRow {
  period_key: string
  transaction_count: number | string
}

interface ScanTimestampRow {
  scanned_at: string | null
}

const FALLBACK_PAGE_SIZE = 1000

export function isMissingReportingPeriodsRpc(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || (message.includes('reporting_shop_scan_periods') && message.includes('schema cache'))
}

function periodsFromRpcRows(rows: PeriodRow[]): ReportingPeriod[] {
  return rows
    .map((row) => reportingPeriodFromKey(row.period_key, Number(row.transaction_count) || 0))
    .filter((period): period is ReportingPeriod => Boolean(period))
}

/**
 * Read transaction-backed periods through the optimized database RPC. During
 * rolling deployment, fall back to an RLS-protected timestamp-only query when
 * application code reaches a database whose migration/schema cache is behind.
 */
export async function fetchAccessibleReportingPeriods(supabase: any): Promise<ReportingPeriod[]> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('reporting_shop_scan_periods')
  if (!rpcError) return periodsFromRpcRows((rpcData || []) as PeriodRow[])
  if (!isMissingReportingPeriodsRpc(rpcError)) throw rpcError

  const counts = new Map<string, number>()
  for (let from = 0; ; from += FALLBACK_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('consumer_qr_scans')
      .select('scanned_at')
      .eq('is_manual_adjustment', false)
      .not('shop_id', 'is', null)
      .not('scanned_at', 'is', null)
      .order('scanned_at', { ascending: false })
      .range(from, from + FALLBACK_PAGE_SIZE - 1)

    if (error) throw error
    const rows = (data || []) as ScanTimestampRow[]
    for (const row of rows) {
      if (!row.scanned_at) continue
      const key = reportingPeriodKeyFromTimestamp(row.scanned_at)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    if (rows.length < FALLBACK_PAGE_SIZE) break
  }

  return [...counts.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, count]) => reportingPeriodFromKey(key, count)!)
}
