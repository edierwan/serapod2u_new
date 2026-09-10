import { describe, expect, it } from 'vitest'
import {
  buildConsumerAnalyticsReport,
  buildReportingMonthOptions,
  currentReportingMonthKey,
  daysInMonthKey,
  emptyAggregate,
  isValidMonthKey,
  monthWindowUtc,
  previousMonthKey,
  monthKeyRange,
  safeShare,
  shiftMonthKey,
} from './consumer-analytics'
import { aggregateConsumerScans, type ScanRecord } from './consumer-analytics-source'

/** Build an eligible scan at a wall-clock time in Asia/Kuala_Lumpur. */
function scan(mytLocal: string, consumerId: string | null = null, extra: Partial<ScanRecord> = {}): ScanRecord {
  return {
    consumer_id: consumerId,
    scanned_at: new Date(`${mytLocal}+08:00`).toISOString(),
    is_manual_adjustment: false,
    ...extra,
  }
}

describe('reporting month arithmetic', () => {
  it('accepts only YYYY-MM keys', () => {
    expect(isValidMonthKey('2026-09')).toBe(true)
    expect(isValidMonthKey('2026-13')).toBe(false)
    expect(isValidMonthKey('2026-9')).toBe(false)
    expect(isValidMonthKey(null)).toBe(false)
  })

  it('uses the immediately preceding calendar month, not the previous 30 days', () => {
    expect(previousMonthKey('2026-09')).toBe('2026-08')
    expect(previousMonthKey('2026-08')).toBe('2026-07')
  })

  it('crosses the year boundary in both directions', () => {
    expect(previousMonthKey('2026-01')).toBe('2025-12')
    expect(shiftMonthKey('2025-12', 1)).toBe('2026-01')
    expect(shiftMonthKey('2026-01', -2)).toBe('2025-11')
    expect(shiftMonthKey('2026-01', -13)).toBe('2024-12')
  })

  it('ends the 12-month trend at the selected month', () => {
    const range = monthKeyRange('2026-06', 12)
    expect(range).toHaveLength(12)
    expect(range[0]).toBe('2025-07')
    expect(range[11]).toBe('2026-06')
  })

  it('reports days per month including leap February', () => {
    expect(daysInMonthKey('2026-09')).toBe(30)
    expect(daysInMonthKey('2026-02')).toBe(28)
    expect(daysInMonthKey('2028-02')).toBe(29)
  })

  it('builds half-open month windows on Malaysia boundaries', () => {
    const september = monthWindowUtc('2026-09')
    // 1 Sep 2026 00:00 MYT is 31 Aug 2026 16:00 UTC.
    expect(september.startUtc).toBe('2026-08-31T16:00:00.000Z')
    expect(september.endUtc).toBe('2026-09-30T16:00:00.000Z')
    // The end of one month is exactly the start of the next — no gap, no overlap.
    expect(monthWindowUtc('2026-10').startUtc).toBe(september.endUtc)
  })

  it('offers the current Malaysia month even with no recorded activity', () => {
    const options = buildReportingMonthOptions(['2026-07', '2026-08'], '2026-09')
    expect(options.map((o) => o.value)).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(options[0].label).toBe('September 2026')
  })

  it('never generates months beyond the current one', () => {
    const options = buildReportingMonthOptions(['2026-10', '2027-01', '2026-08'], '2026-09')
    expect(options.map((o) => o.value)).toEqual(['2026-09', '2026-08'])
  })

  it('derives the default month in Malaysia time', () => {
    // 1 Sep 2026 03:00 MYT is still 31 Aug in UTC — the report must say September.
    expect(currentReportingMonthKey(new Date('2026-08-31T19:00:00Z'))).toBe('2026-09')
  })
})

describe('safe arithmetic', () => {
  it('returns null instead of NaN or Infinity when there is no denominator', () => {
    expect(safeShare(5, 0)).toBeNull()
    expect(safeShare(0, 0)).toBeNull()
    expect(safeShare(3, 10)).toBe(30)
  })
})

describe('aggregateConsumerScans', () => {
  it('keeps scans inside the selected Malaysia month and excludes the neighbours', () => {
    const rows = [
      scan('2026-08-31T23:59:59'), // August in MYT
      scan('2026-09-01T00:00:00'),
      scan('2026-09-30T23:59:59'),
      scan('2026-10-01T00:00:00'), // October in MYT
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.current.totalScans).toBe(2)
    expect(aggregate.previous.totalScans).toBe(1)
    expect(aggregate.dailyTrend).toHaveLength(30)
    expect(aggregate.dailyTrend[0]).toEqual({ date: '2026-09-01', scans: 1, consumers: 0 })
    expect(aggregate.dailyTrend[29]).toEqual({ date: '2026-09-30', scans: 1, consumers: 0 })
  })

  it('excludes manual adjustments from every metric', () => {
    const rows = [
      scan('2026-09-05T10:00:00', 'c1'),
      { ...scan('2026-09-05T11:00:00', 'c2'), is_manual_adjustment: true },
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.current.totalScans).toBe(1)
    expect(aggregate.current.identifiedConsumers).toBe(1)
  })

  it('never lets anonymous scans inflate identified-consumer counts', () => {
    const rows = [
      scan('2026-09-05T10:00:00', null),
      scan('2026-09-06T10:00:00', null),
      scan('2026-09-07T10:00:00', 'c1'),
      scan('2026-09-08T10:00:00', 'c1'),
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.current.totalScans).toBe(4)
    expect(aggregate.current.identifiedScans).toBe(2)
    expect(aggregate.current.identifiedConsumers).toBe(1)
  })

  it('classifies a consumer as returning from history before the month', () => {
    const rows = [
      scan('2026-05-02T10:00:00', 'returning-one'),
      scan('2026-09-05T10:00:00', 'returning-one'),
      scan('2026-09-06T10:00:00', 'brand-new'),
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.current.identifiedConsumers).toBe(2)
    expect(aggregate.returningCurrent).toBe(1)
  })

  it('treats identity known from outside the loaded window as returning', () => {
    const rows = [scan('2026-09-05T10:00:00', 'long-lapsed')]
    const aggregate = aggregateConsumerScans(rows, '2026-09', {
      priorConsumerIds: new Set(['long-lapsed']),
    })
    expect(aggregate.returningCurrent).toBe(1)
  })

  it('buckets the heatmap on Malaysia day-of-week and hour', () => {
    // 6 Sep 2026 is a Sunday in Malaysia; 01:30 MYT is still Saturday in UTC.
    const aggregate = aggregateConsumerScans([scan('2026-09-06T01:30:00')], '2026-09')
    expect(aggregate.activityHeatmap).toEqual([{ dayOfWeek: 0, hour: 1, scans: 1 }])
  })

  it('aggregates products through the embedded QR relationship', () => {
    const rows = [
      scan('2026-09-05T10:00:00', 'c1', { qr_codes: { product_id: 'p1', variant_id: 'v1' } }),
      scan('2026-09-06T10:00:00', 'c2', { qr_codes: { product_id: 'p1', variant_id: 'v1' } }),
      scan('2026-09-07T10:00:00', 'c3', { qr_codes: { product_id: 'p1', variant_id: 'v2' } }),
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.topProducts).toEqual([
      { productId: 'p1', variantId: 'v1', productName: null, variantName: null, scans: 2 },
      { productId: 'p1', variantId: 'v2', productName: null, variantName: null, scans: 1 },
    ])
  })

  it('builds a six-month cohort ending at the selected month', () => {
    const rows = [
      scan('2026-08-05T10:00:00', 'c1'),
      scan('2026-08-06T10:00:00', 'c2'),
      scan('2026-09-05T10:00:00', 'c1'),
    ]
    const aggregate = aggregateConsumerScans(rows, '2026-09')
    expect(aggregate.cohort.map((row) => row.month)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ])
    const august = aggregate.cohort.find((row) => row.month === '2026-08')!
    expect(august).toEqual({ month: '2026-08', consumers: 2, retained: 1 })
  })
})

describe('buildConsumerAnalyticsReport', () => {
  const rows = [
    // August: c1 and c2 identified, plus one anonymous scan.
    scan('2026-08-04T09:00:00', 'c1'),
    scan('2026-08-05T09:00:00', 'c2'),
    scan('2026-08-06T09:00:00', null),
    // September: c1 returns, c3 is brand new, plus one anonymous scan.
    scan('2026-09-02T09:00:00', 'c1'),
    scan('2026-09-03T09:00:00', 'c1'),
    scan('2026-09-04T09:00:00', 'c3'),
    scan('2026-09-05T09:00:00', null),
  ]
  const report = buildConsumerAnalyticsReport(aggregateConsumerScans(rows, '2026-09'))

  it('labels the period and its automatic comparison month', () => {
    expect(report.period.label).toBe('September 2026')
    expect(report.period.previousMonth).toBe('2026-08')
    expect(report.period.previousMonthLabel).toBe('August 2026')
    expect(report.period.previousMonthShortLabel).toBe('Aug 2026')
    expect(report.period.timeZone).toBe('Asia/Kuala_Lumpur')
  })

  it('separates scan metrics from identified-consumer metrics', () => {
    expect(report.summary.totalScans).toBe(4)
    expect(report.summary.identifiedScans).toBe(3)
    expect(report.summary.identifiedConsumers).toBe(2)
    expect(report.summary.identityCoveragePct).toBe(75)
  })

  it('splits new and returning consumers by first identified scan', () => {
    expect(report.newVsReturning).toEqual({
      identifiedConsumers: 2,
      newConsumers: 1,
      newPct: 50,
      returningConsumers: 1,
      returningPct: 50,
    })
  })

  it('compares against the preceding calendar month', () => {
    expect(report.comparison.totalScans).toEqual({ current: 4, previous: 3, changePct: 33.3 })
    expect(report.comparison.identifiedConsumers).toEqual({ current: 2, previous: 2, changePct: 0 })
  })

  it('derives retention from the previous month cohort', () => {
    // Of August's two identified consumers, only c1 scanned again in September.
    expect(report.summary.retentionRate).toBe(50)
    expect(report.retentionCohort.at(-1)).toMatchObject({ month: '2026-09', pending: true, retentionRate: null })
  })

  it('returns a compact payload rather than raw scans', () => {
    expect(report.dailyTrend).toHaveLength(30)
    expect(report.twelveMonthTrend).toHaveLength(12)
    expect(report.twelveMonthTrend.at(-1)?.month).toBe('2026-09')
    expect(report.retentionCohort).toHaveLength(6)
    expect(JSON.stringify(report).length).toBeLessThan(20_000)
  })
})

describe('empty reporting month', () => {
  const report = buildConsumerAnalyticsReport(emptyAggregate('2026-09'))

  it('renders zeroes without NaN, Infinity or misleading growth', () => {
    expect(report.isEmpty).toBe(true)
    expect(report.summary.totalScans).toBe(0)
    expect(report.summary.avgScansPerDay).toBe(0)
    expect(report.summary.identityCoveragePct).toBeNull()
    expect(report.summary.repeatSharePct).toBeNull()
    expect(report.summary.retentionRate).toBeNull()
    expect(report.comparison.totalScans.changePct).toBeNull()
    expect(report.comparison.retentionRate.changePoints).toBeNull()
    expect(report.newVsReturning.newPct).toBeNull()
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('NaN')
    expect(serialized).not.toContain('Infinity')
  })

  it('still fills the trend scaffolding so the layout stays stable', () => {
    expect(report.dailyTrend).toHaveLength(30)
    expect(report.twelveMonthTrend).toHaveLength(12)
    expect(report.retentionCohort).toHaveLength(6)
    expect(report.topConsumers).toEqual([])
    expect(report.topProducts).toEqual([])
  })
})
