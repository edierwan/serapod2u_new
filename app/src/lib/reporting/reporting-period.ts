export const REPORTING_TIME_ZONE = 'Asia/Kuala_Lumpur'

export interface ReportingPeriod {
  key: string
  label: string
  startUtc: string
  endUtc: string
  startDate: string
  endDate: string
  transactionCount: number
}

const PERIOD_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

export function reportingPeriodFromKey(key: string, transactionCount = 0): ReportingPeriod | null {
  const match = PERIOD_KEY.exec(key)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const label = new Intl.DateTimeFormat('en-MY', {
    month: 'long',
    year: 'numeric',
    timeZone: REPORTING_TIME_ZONE,
  }).format(new Date(`${key}-15T12:00:00+08:00`))

  return {
    key,
    label,
    startUtc: new Date(`${key}-01T00:00:00+08:00`).toISOString(),
    endUtc: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`).toISOString(),
    startDate: `${key}-01`,
    endDate: `${key}-${String(lastDay).padStart(2, '0')}`,
    transactionCount,
  }
}

export function currentReportingPeriodKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: REPORTING_TIME_ZONE,
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export function reportingPeriodKeyFromTimestamp(timestamp: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: REPORTING_TIME_ZONE,
  }).formatToParts(typeof timestamp === 'string' ? new Date(timestamp) : timestamp)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export function resolveDefaultReportingPeriod(periods: ReportingPeriod[], now = new Date()): string | null {
  if (periods.length === 0) return null
  const currentKey = currentReportingPeriodKey(now)
  return periods.find((period) => period.key === currentKey)?.key || periods[0].key
}

export function reportingPeriodRangeLabel(period: ReportingPeriod): string {
  const formatter = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: REPORTING_TIME_ZONE,
  })
  return `${formatter.format(new Date(period.startUtc))} – ${formatter.format(new Date(new Date(period.endUtc).getTime() - 1))}`
}

export function reportingPeriodFilenameLabel(period: ReportingPeriod): string {
  return period.label.replace(/\s+/g, '_')
}

export function previousReportingPeriod(period: ReportingPeriod): ReportingPeriod {
  const [year, month] = period.key.split('-').map(Number)
  const previousYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  return reportingPeriodFromKey(`${previousYear}-${String(previousMonth).padStart(2, '0')}`)!
}

export function reportingPeriodDateWindow(period: ReportingPeriod) {
  const previous = previousReportingPeriod(period)
  return {
    start: new Date(period.startUtc),
    end: new Date(period.endUtc),
    prevStart: new Date(previous.startUtc),
    prevEnd: new Date(previous.endUtc),
  }
}
