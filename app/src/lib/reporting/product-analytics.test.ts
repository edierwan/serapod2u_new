import { describe, expect, it } from 'vitest'
import {
  ELIGIBLE_ORDER_STATUSES,
  buildProductAnalyticsReport,
  buildReportingMonthOptions,
  categoryFilenameSegment,
  classifyAction,
  classifyDemand,
  classifyStock,
  currentReportingMonthKey,
  emptyAggregate,
  growthPercent,
  productIdentityLabel,
  productReportFilename,
  resolveProductReportPeriod,
  stockCoverDays,
  type ProductAnalyticsAggregate,
  type VariantAggregate,
} from './product-analytics'
import { aggregateProductOrders, type OrderItemRecord } from './product-analytics-source'

/** 7 September 2026, 10:00 Malaysia time — the scenario date in the spec. */
const NOW = new Date('2026-09-07T10:00:00+08:00')

const VAPE = 'cat-vape'
const PET = 'cat-pet'

function variant(partial: Partial<VariantAggregate> & { variantId: string }): VariantAggregate {
  return {
    productId: 'p1',
    categoryId: VAPE,
    categoryName: 'Vape',
    productName: 'Cellera Hero',
    variantName: 'Deluxe Cellera Cartridge [ Banana Vanilla ]',
    productCode: 'BV',
    isActive: true,
    currentUnits: 0,
    currentValue: 0,
    previousUnits: 0,
    previousValue: 0,
    stockOnHand: 0,
    stockAvailable: 0,
    reorderPoint: 0,
    safetyStock: 0,
    stockValue: 0,
    lastOrderedAt: null,
    ...partial,
  }
}

function aggregate(
  month: string,
  variants: VariantAggregate[],
  overrides: Partial<ProductAnalyticsAggregate> = {},
): ProductAnalyticsAggregate {
  const current = variants.reduce(
    (acc, v) => ({
      units: acc.units + v.currentUnits,
      orderValue: acc.orderValue + v.currentValue,
      skus: acc.skus + (v.currentUnits > 0 ? 1 : 0),
      orders: 0,
    }),
    { units: 0, orderValue: 0, skus: 0, orders: 0 },
  )
  const previous = variants.reduce(
    (acc, v) => ({
      units: acc.units + v.previousUnits,
      orderValue: acc.orderValue + v.previousValue,
      skus: acc.skus + (v.previousUnits > 0 ? 1 : 0),
      orders: 0,
    }),
    { units: 0, orderValue: 0, skus: 0, orders: 0 },
  )
  const period = resolveProductReportPeriod(month, NOW)
  return {
    month,
    categoryId: overrides.categoryId ?? 'all',
    categoryName: overrides.categoryName ?? 'All Categories',
    current,
    previous,
    activeSkus: variants.filter((v) => v.isActive).length,
    dailyTrend: Array.from({ length: period.dayCount }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      units: 0,
      orderValue: 0,
    })),
    variants,
    inventory: {
      totalValue: variants.reduce((sum, v) => sum + v.stockValue, 0),
      totalOnHand: variants.reduce((sum, v) => sum + v.stockOnHand, 0),
      variantCount: variants.filter((v) => v.stockOnHand > 0).length,
      asOf: '2026-09-07T02:00:00.000Z',
      ...overrides.inventory,
    },
    categories: overrides.categories ?? [],
    ...overrides,
  }
}

describe('reporting month default', () => {
  it('defaults to the current calendar month in Asia/Kuala_Lumpur', () => {
    expect(currentReportingMonthKey(NOW)).toBe('2026-09')
  })

  it('resolves the Malaysia month for an instant that is still the previous day in UTC', () => {
    // 00:30 on 1 September in Malaysia is 16:30 on 31 August UTC.
    expect(currentReportingMonthKey(new Date('2026-09-01T00:30:00+08:00'))).toBe('2026-09')
  })

  it('always offers the current month and never a future one', () => {
    const options = buildReportingMonthOptions(['2026-07', '2026-08', '2027-01'], '2026-09')
    expect(options.map((option) => option.value)).toEqual(['2026-09', '2026-08', '2026-07'])
  })
})

describe('current month = month to date', () => {
  const period = resolveProductReportPeriod('2026-09', NOW)

  it('reports 01 Sep through today, not the whole month', () => {
    expect(period.isCurrentMonth).toBe(true)
    expect(period.dayCount).toBe(7)
    expect(period.startDate).toBe('2026-09-01')
    expect(period.endDate).toBe('2026-09-07')
    expect(period.rangeLabel).toBe('01 Sep 2026 – 07 Sep 2026')
  })

  it('uses half-open Malaysia boundaries so a 00:30 MYT order lands in the right day', () => {
    expect(period.startUtc).toBe('2026-08-31T16:00:00.000Z')
    // Exclusive upper bound is 00:00 MYT on 8 September.
    expect(period.endUtc).toBe('2026-09-07T16:00:00.000Z')
  })

  it('compares against the same elapsed days of the previous month', () => {
    expect(period.comparisonMonth).toBe('2026-08')
    expect(period.comparisonDayCount).toBe(7)
    expect(period.comparisonRangeLabel).toBe('01 Aug 2026 – 07 Aug 2026')
    expect(period.comparisonClamped).toBe(false)
  })

  it('clamps to the previous month’s final day when that month is shorter', () => {
    // 31 March MTD cannot compare against 31 February; it clamps to 28 Feb.
    const march = resolveProductReportPeriod('2026-03', new Date('2026-03-31T10:00:00+08:00'))
    expect(march.dayCount).toBe(31)
    expect(march.comparisonDayCount).toBe(28)
    expect(march.comparisonEndDate).toBe('2026-02-28')
    expect(march.comparisonClamped).toBe(true)
  })
})

describe('historical month comparison', () => {
  it('compares a completed month against the complete previous month', () => {
    const august = resolveProductReportPeriod('2026-08', NOW)
    expect(august.isCurrentMonth).toBe(false)
    expect(august.dayCount).toBe(31)
    expect(august.rangeLabel).toBe('01 Aug 2026 – 31 Aug 2026')
    expect(august.comparisonRangeLabel).toBe('01 Jul 2026 – 31 Jul 2026')
    expect(august.comparisonDayCount).toBe(31)
  })

  it('compares February against the WHOLE of January, not its first 28 days', () => {
    const february = resolveProductReportPeriod('2026-02', NOW)
    expect(february.dayCount).toBe(28)
    expect(february.comparisonDayCount).toBe(31)
    expect(february.comparisonRangeLabel).toBe('01 Jan 2026 – 31 Jan 2026')
  })

  it('rolls over the year boundary from January to the previous December', () => {
    const january = resolveProductReportPeriod('2026-01', NOW)
    expect(january.comparisonMonth).toBe('2025-12')
    expect(january.comparisonLabel).toBe('December 2025')
    expect(january.rangeLabel).toBe('01 Jan 2026 – 31 Jan 2026')
    expect(january.comparisonRangeLabel).toBe('01 Dec 2025 – 31 Dec 2025')
  })
})

describe('safe arithmetic', () => {
  it('never reports Infinity when the comparison baseline is zero', () => {
    expect(growthPercent(400, 0)).toBeNull()
    expect(growthPercent(0, 0)).toBeNull()
    expect(growthPercent(120, 100)).toBe(20)
    expect(growthPercent(0, 120)).toBe(-100)
  })

  it('treats a zero baseline as new demand rather than growth', () => {
    expect(classifyDemand(400, 0)).toBe('new')
    expect(classifyDemand(0, 0)).toBe('none')
    expect(classifyDemand(0, 120)).toBe('none')
  })

  it('reports stock cover only where there is demand to consume it', () => {
    expect(stockCoverDays(700, 70, 7)).toBe(70)
    expect(stockCoverDays(700, 0, 7)).toBeNull()
    expect(stockCoverDays(0, 70, 7)).toBeNull()
  })
})

describe('monthly summary', () => {
  const report = buildProductAnalyticsReport(
    aggregate('2026-09', [
      variant({ variantId: 'v1', currentUnits: 300, currentValue: 6000, previousUnits: 200, previousValue: 4200 }),
      variant({ variantId: 'v2', currentUnits: 100, currentValue: 1000, previousUnits: 100, previousValue: 1100 }),
      variant({ variantId: 'v3', productCode: 'GP' }),
    ]),
    NOW,
  )

  it('reports units, order value, SKUs ordered and average value per unit', () => {
    expect(report.summary.unitsOrdered).toBe(400)
    expect(report.summary.orderValue).toBe(7000)
    expect(report.summary.skusOrdered).toBe(2)
    expect(report.summary.avgValuePerUnit).toBe(17.5)
  })

  it('separates SKUs ordered from active SKUs in master data', () => {
    expect(report.summary.skusOrdered).toBe(2)
    expect(report.summary.activeSkus).toBe(3)
  })

  it('averages per elapsed day, not per calendar month day', () => {
    expect(report.period.dayCount).toBe(7)
    expect(report.summary.avgUnitsPerDay).toBe(Math.round(400 / 7))
  })

  it('compares each KPI against the comparison window', () => {
    expect(report.comparison.unitsOrdered.previous).toBe(300)
    expect(report.comparison.unitsOrdered.changePct).toBe(33.3)
    expect(report.comparison.skusOrdered.current - report.comparison.skusOrdered.previous).toBe(0)
    expect(report.comparison.avgValuePerUnit.previous).toBe(17.67)
    expect(report.comparison.avgValuePerUnit.changePct).toBe(-1)
  })

  it('documents the eligible order statuses and the report date field it used', () => {
    expect(report.meta.eligibleStatuses).toEqual(['approved', 'closed', 'submitted'])
    expect([...ELIGIBLE_ORDER_STATUSES]).toEqual(report.meta.eligibleStatuses)
    expect(report.meta.dateField).toBe('orders.created_at')
  })
})

describe('empty month', () => {
  const report = buildProductAnalyticsReport(emptyAggregate('2026-09', resolveProductReportPeriod('2026-09', NOW)), NOW)

  it('reports emptiness without NaN, Infinity or a misleading percentage', () => {
    expect(report.isEmpty).toBe(true)
    expect(report.summary.unitsOrdered).toBe(0)
    expect(report.summary.avgValuePerUnit).toBeNull()
    expect(report.comparison.unitsOrdered.changePct).toBeNull()
    expect(report.comparison.avgValuePerUnit.changePct).toBeNull()
    expect(Number.isFinite(report.summary.avgUnitsPerDay)).toBe(true)
  })

  it('still emits one daily row per elapsed day', () => {
    expect(report.dailyTrend).toHaveLength(7)
    expect(report.dailyTrend.every((row) => row.units === 0)).toBe(true)
  })
})

describe('daily trend', () => {
  it('stops at today for the running month and never emits future days', () => {
    const report = buildProductAnalyticsReport(aggregate('2026-09', [variant({ variantId: 'v1' })]), NOW)
    expect(report.dailyTrend).toHaveLength(7)
    expect(report.dailyTrend.at(-1)?.date).toBe('2026-09-07')
    expect(report.dailyTrend.some((row) => row.date > '2026-09-07')).toBe(false)
  })

  it('covers the complete month for a historical selection', () => {
    const report = buildProductAnalyticsReport(aggregate('2026-08', [variant({ variantId: 'v1' })]), NOW)
    expect(report.dailyTrend).toHaveLength(31)
    expect(report.dailyTrend.at(-1)?.date).toBe('2026-08-31')
  })

  it('carries no twelve-month series anywhere in the report', () => {
    const report = buildProductAnalyticsReport(aggregate('2026-09', [variant({ variantId: 'v1' })]), NOW)
    expect(report).not.toHaveProperty('twelveMonthTrend')
    expect(report.dailyTrend.length).toBeLessThanOrEqual(31)
  })
})

describe('product ranking and contribution', () => {
  const report = buildProductAnalyticsReport(
    aggregate('2026-09', [
      variant({ variantId: 'v1', productCode: 'BV', currentUnits: 820, currentValue: 13284, previousUnits: 678 }),
      variant({ variantId: 'v2', productCode: 'CO', currentUnits: 730, currentValue: 9000, previousUnits: 676 }),
      variant({ variantId: 'v3', productCode: 'AC', currentUnits: 10, currentValue: 4000, previousUnits: 8 }),
    ]),
    NOW,
  )

  it('ranks by units and by order value independently', () => {
    expect(report.topProducts.byUnits.map((row) => row.variantId)).toEqual(['v1', 'v2', 'v3'])
    expect(report.topProducts.byOrderValue.map((row) => row.variantId)).toEqual(['v1', 'v2', 'v3'])
    expect(report.topProducts.byUnits[0].rank).toBe(1)
  })

  it('labels rows with the agreed product identity, not the raw master-data name', () => {
    expect(report.topProducts.byUnits[0].label).toBe('Cellera Hero / Banana Vanilla – BV')
  })

  it('shares sum to the period total', () => {
    const total = report.topProducts.byUnits.reduce((sum, row) => sum + (row.unitsSharePct ?? 0), 0)
    expect(Math.round(total)).toBe(100)
  })

  it('splits contribution into top 5, next 5 and the remainder of the period', () => {
    const bands = report.productContribution.bands
    expect(bands.map((band) => band.label)).toEqual(['Top 5 SKUs', 'Next 5 SKUs', 'Remaining SKUs'])
    expect(bands[0].orderValue).toBe(26284)
    expect(bands[0].sharePct).toBe(100)
    expect(report.productContribution.totalOrderValue).toBe(26284)
  })
})

describe('strategy insights', () => {
  const report = buildProductAnalyticsReport(
    aggregate('2026-09', [
      variant({ variantId: 'rise', currentUnits: 300, previousUnits: 100, currentValue: 3000 }),
      variant({ variantId: 'new', currentUnits: 120, previousUnits: 0, currentValue: 1200 }),
      variant({ variantId: 'fall', currentUnits: 25, previousUnits: 180, currentValue: 250, stockOnHand: 840, stockValue: 8400 }),
      variant({ variantId: 'dead', currentUnits: 0, previousUnits: 0, stockOnHand: 1450, stockValue: 14500 }),
    ]),
    NOW,
  )

  const insight = (key: string) => report.strategyInsights.find((row) => row.key === key)!

  it('counts rising stars including brand-new demand, never as Infinity%', () => {
    const rising = insight('rising')
    expect(rising.rows.map((row) => row.variantId).sort()).toEqual(['new', 'rise'])
    expect(rising.rows.find((row) => row.variantId === 'new')?.growthPct).toBeNull()
    expect(rising.rows.find((row) => row.variantId === 'new')?.demandTrend).toBe('new')
  })

  it('flags at-risk SKUs only against a real prior baseline', () => {
    expect(insight('at_risk').rows.map((row) => row.variantId)).toEqual(['fall'])
  })

  it('proposes promotion where weak demand meets standing stock', () => {
    expect(insight('promo').rows.map((row) => row.variantId).sort()).toEqual(['dead', 'fall'])
  })

  it('reports a count that matches the list each card opens', () => {
    for (const card of report.strategyInsights) {
      expect(card.count).toBe(card.rows.length)
    }
  })
})

describe('current inventory snapshot', () => {
  const report = buildProductAnalyticsReport(
    aggregate('2026-03', [
      variant({ variantId: 'low', currentUnits: 100, previousUnits: 90, stockOnHand: 20, stockAvailable: 5, reorderPoint: 50, stockValue: 200 }),
      variant({ variantId: 'healthy', currentUnits: 100, previousUnits: 95, stockOnHand: 200, stockAvailable: 200, reorderPoint: 50, stockValue: 3000 }),
      variant({ variantId: 'excess', currentUnits: 5, previousUnits: 5, stockOnHand: 5000, stockAvailable: 5000, reorderPoint: 10, stockValue: 50000 }),
      variant({ variantId: 'dead', currentUnits: 0, previousUnits: 0, stockOnHand: 900, stockAvailable: 900, stockValue: 9000 }),
    ]),
    NOW,
  )

  it('reports a CURRENT snapshot whose as-of date is independent of the selected month', () => {
    // March 2026 is selected, but the stock position is still today's.
    expect(report.period.month).toBe('2026-03')
    expect(report.inventorySnapshot.asOf).toBe('2026-09-07T02:00:00.000Z')
    expect(report.inventorySnapshot.totalValue).toBe(62200)
  })

  it('names each stock-health category after the rule that produced it', () => {
    const byKey = Object.fromEntries(report.inventorySnapshot.categories.map((c) => [c.key, c]))
    expect(byKey.low.skus).toBe(1)
    expect(byKey.healthy.skus).toBe(1)
    expect(byKey.excess.skus).toBe(1)
    expect(byKey.dead.skus).toBe(1)
    expect(byKey.low.label).toBe('Low Stock / Replenish')
    expect(byKey.excess.label).toBe('Excess Stock')
  })

  it('carries no inventory turnover ratio', () => {
    expect(report.summary).not.toHaveProperty('turnoverRatio')
    expect(report.inventorySnapshot).not.toHaveProperty('turnoverRatio')
  })
})

describe('management action plan', () => {
  const report = buildProductAnalyticsReport(
    aggregate('2026-09', [
      variant({ variantId: 'replenish', currentUnits: 820, previousUnits: 678, stockOnHand: 180, stockAvailable: 100, reorderPoint: 200, stockValue: 1800 }),
      variant({ variantId: 'promote', currentUnits: 0, previousUnits: 120, stockOnHand: 1450, stockAvailable: 1450, stockValue: 14500 }),
      variant({ variantId: 'review', currentUnits: 25, previousUnits: 180, stockOnHand: 40, stockAvailable: 40, reorderPoint: 10, stockValue: 400 }),
      variant({ variantId: 'maintain', currentUnits: 730, previousUnits: 676, stockOnHand: 920, stockAvailable: 920, reorderPoint: 100, stockValue: 9200 }),
      variant({ variantId: 'idle', currentUnits: 0, previousUnits: 0, stockOnHand: 0 }),
    ]),
    NOW,
  )

  it('gives each SKU exactly one action', () => {
    const byId = Object.fromEntries(report.managementActions.rows.map((row) => [row.variantId, row.action]))
    expect(byId.replenish).toBe('replenish')
    expect(byId.promote).toBe('promote')
    expect(byId.review).toBe('review')
    expect(byId.maintain).toBe('maintain')
  })

  it('leaves a SKU with no demand and no stock out of the plan rather than padding it', () => {
    expect(report.managementActions.rows.some((row) => row.variantId === 'idle')).toBe(false)
  })

  it('summary counts equal the action-list classifications', () => {
    for (const card of report.managementActions.summary) {
      const listed = report.managementActions.rows.filter((row) => row.action === card.key).length
      expect(card.count).toBe(listed)
    }
    const total = report.managementActions.summary.reduce((sum, card) => sum + card.count, 0)
    expect(total).toBe(report.managementActions.rows.length)
  })

  it('prioritises replenishment and dead stock above routine maintenance', () => {
    expect(report.managementActions.rows[0].actionPriority).toBe('HIGH')
    expect(report.managementActions.rows.at(-1)?.actionPriority).toBe('NORMAL')
  })

  it('classifies actions from transparent demand and stock rules', () => {
    expect(classifyDemand(820, 678)).toBe('growing')
    expect(classifyStock(180, 100, 200, 0, 1.5, 820, 678)).toBe('low')
    expect(classifyAction({
      demandTrend: 'growing', stockStatus: 'low', currentUnits: 820, previousUnits: 678, growthPct: 21,
    }).action).toBe('replenish')
  })
})

describe('products requiring attention', () => {
  it('anchors decline to the selected period, not to a rolling window around today', () => {
    const report = buildProductAnalyticsReport(
      aggregate('2026-08', [
        variant({ variantId: 'gone', currentUnits: 0, previousUnits: 120, stockOnHand: 1450, stockValue: 14500 }),
        variant({ variantId: 'slow', currentUnits: 25, previousUnits: 180, stockOnHand: 840, stockValue: 8400 }),
        variant({ variantId: 'fine', currentUnits: 500, previousUnits: 480, stockOnHand: 600, stockAvailable: 600, reorderPoint: 100, stockValue: 6000 }),
      ]),
      NOW,
    )
    const statuses = Object.fromEntries(report.attentionProducts.map((row) => [row.variantId, row.status]))
    expect(statuses.gone).toBe('No Orders')
    expect(statuses.slow).toBe('Declining')
    expect(statuses.fine).toBeUndefined()
    // The comparison is August vs July, chosen by the selector — not "last 3 months vs today".
    expect(report.period.comparisonMonth).toBe('2026-07')
  })
})

describe('report DTO shape and payload size', () => {
  const many = Array.from({ length: 400 }, (_, i) => variant({
    variantId: `v${i}`,
    productCode: `C${i}`,
    currentUnits: i,
    currentValue: i * 12,
    previousUnits: Math.max(i - 5, 0),
    stockOnHand: i * 3,
    stockAvailable: i * 3,
    reorderPoint: 10,
    stockValue: i * 30,
  }))
  const report = buildProductAnalyticsReport(aggregate('2026-09', many), NOW)

  it('exposes every section the management report renders', () => {
    expect(Object.keys(report).sort()).toEqual([
      'attentionProducts', 'category', 'categoryPerformance', 'comparison', 'dailyTrend',
      'inventorySnapshot', 'isEmpty', 'managementActions', 'meta', 'period',
      'productContribution', 'strategyInsights', 'summary', 'topProducts',
    ])
  })

  it('caps every list so the payload scales with report size, not database size', () => {
    expect(report.topProducts.byUnits).toHaveLength(10)
    expect(report.topProducts.byOrderValue).toHaveLength(10)
    expect(report.attentionProducts.length).toBeLessThanOrEqual(15)
    expect(report.managementActions.rows.length).toBeLessThanOrEqual(60)
    expect(report.dailyTrend.length).toBeLessThanOrEqual(31)
    expect(report.productContribution.rows.length).toBeLessThanOrEqual(100)
    for (const card of report.strategyInsights) expect(card.rows.length).toBeLessThanOrEqual(50)
  })

  it('stops growing once every list is capped — 500 SKUs cost no more than 400', () => {
    // The real guarantee is not an arbitrary byte count but that the payload
    // stops tracking catalogue size once the caps bind.
    const bigger = buildProductAnalyticsReport(
      aggregate('2026-09', Array.from({ length: 500 }, (_, i) => variant({
        variantId: `w${i}`, productCode: `D${i}`, currentUnits: i, currentValue: i * 12,
        previousUnits: Math.max(i - 5, 0), stockOnHand: i * 3, stockAvailable: i * 3,
        reorderPoint: 10, stockValue: i * 30,
      }))),
      NOW,
    )
    const at400 = JSON.stringify(report).length
    const at500 = JSON.stringify(bigger).length
    expect(Math.abs(at500 - at400)).toBeLessThan(2_000)
    expect(at500).toBeLessThan(140_000)
  })

  it('keeps the contribution drill-down the bounded part of the payload', () => {
    const contributionBytes = JSON.stringify(report.productContribution.rows).length
    // A slim projection, not a copy of every ProductRow field.
    expect(contributionBytes / report.productContribution.rows.length).toBeLessThan(600)
    expect(report.productContribution.rowsTruncated).toBe(true)
  })
})

describe('PDF filename', () => {
  it('marks the running month as MTD and a closed month by its month key', () => {
    expect(productReportFilename(resolveProductReportPeriod('2026-09', NOW)))
      .toBe('Serapod_Product_Performance_2026-09_MTD.pdf')
    expect(productReportFilename(resolveProductReportPeriod('2026-08', NOW)))
      .toBe('Serapod_Product_Performance_2026-08.pdf')
  })
})

describe('product identity labelling', () => {
  it('drops the packaging prefix and keeps the flavour plus the variant product code', () => {
    expect(productIdentityLabel('Cellera Hero', 'Deluxe Cellera Cartridge [ Banana Vanilla ]', 'BV'))
      .toBe('Cellera Hero / Banana Vanilla – BV')
  })

  it('omits the halves master data does not carry rather than printing undefined', () => {
    expect(productIdentityLabel('Cellera Hero', null, 'BV')).toBe('Cellera Hero – BV')
    expect(productIdentityLabel('Cellera Hero', 'Corn', null)).toBe('Cellera Hero / Corn')
    expect(productIdentityLabel(null, 'Corn', 'CO')).toBe('Corn – CO')
  })
})

describe('server-side aggregation (fallback parity with the RPC)', () => {
  function line(createdAtMyt: string, variantId: string, qty: number, value: number, status = 'approved'): OrderItemRecord {
    return {
      variant_id: variantId,
      product_id: 'p1',
      qty,
      line_total: value,
      orders: { created_at: new Date(`${createdAtMyt}+08:00`).toISOString(), status },
    }
  }

  const catalogue = [
    { id: 'v1', product_id: 'p1', variant_name: 'Deluxe Cellera Cartridge [ Banana Vanilla ]', product_code: 'BV', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'v2', product_id: 'p1', variant_name: 'Deluxe Cellera Cartridge [ Corn ]', product_code: 'CO', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
  ]
  const inventory = [
    { variant_id: 'v1', quantity_on_hand: 180, quantity_available: 100, reorder_point: 200, safety_stock: 50, total_value: 1800, updated_at: '2026-09-07T02:00:00.000Z' },
  ]

  it('buckets orders into the report window and its comparison window by Malaysia date', () => {
    const result = aggregateProductOrders(
      [
        line('2026-09-03T09:00:00', 'v1', 100, 1700),
        line('2026-09-07T23:30:00', 'v1', 50, 850),
        line('2026-08-03T09:00:00', 'v1', 80, 1360),
        // Outside both windows: 20 August is past the 01–07 August comparison.
        line('2026-08-20T09:00:00', 'v1', 999, 9999),
      ],
      catalogue, inventory, '2026-09', NOW,
    )
    expect(result.current.units).toBe(150)
    expect(result.previous.units).toBe(80)
    expect(result.current.skus).toBe(1)
  })

  it('keeps a 00:30 Malaysia order in the Malaysia day, not the UTC one', () => {
    const result = aggregateProductOrders([line('2026-09-01T00:30:00', 'v1', 10, 170)], catalogue, [], '2026-09', NOW)
    expect(result.dailyTrend[0]).toEqual({ date: '2026-09-01', units: 10, orderValue: 170 })
    expect(result.current.units).toBe(10)
  })

  it('counts only eligible order statuses', () => {
    const result = aggregateProductOrders(
      [line('2026-09-03T09:00:00', 'v1', 100, 1700, 'draft'), line('2026-09-03T09:00:00', 'v2', 40, 500, 'closed')],
      catalogue, [], '2026-09', NOW,
    )
    expect(result.current.units).toBe(40)
    expect(result.current.skus).toBe(1)
  })

  it('emits one daily row per elapsed day and no future days', () => {
    const result = aggregateProductOrders([line('2026-09-03T09:00:00', 'v1', 100, 1700)], catalogue, [], '2026-09', NOW)
    expect(result.dailyTrend).toHaveLength(7)
    expect(result.dailyTrend.at(-1)?.date).toBe('2026-09-07')
  })

  it('folds multi-location inventory into one stock position per variant', () => {
    const result = aggregateProductOrders([], catalogue, [
      { variant_id: 'v1', quantity_on_hand: 100, quantity_available: 80, reorder_point: 50, safety_stock: 10, total_value: 1000 },
      { variant_id: 'v1', quantity_on_hand: 40, quantity_available: 40, reorder_point: 70, safety_stock: 20, total_value: 400 },
    ], '2026-09', NOW)
    const v1 = result.variants.find((row) => row.variantId === 'v1')!
    expect(v1.stockOnHand).toBe(140)
    expect(v1.stockAvailable).toBe(120)
    // The highest configured level is the one the network must not fall below.
    expect(v1.reorderPoint).toBe(70)
    expect(v1.stockValue).toBe(1400)
  })

  it('feeds a report whose KPIs match the rows it aggregated', () => {
    const result = aggregateProductOrders(
      [line('2026-09-03T09:00:00', 'v1', 100, 1700), line('2026-09-04T09:00:00', 'v2', 100, 1300)],
      catalogue, inventory, '2026-09', NOW,
    )
    const report = buildProductAnalyticsReport(result, NOW)
    expect(report.summary.unitsOrdered).toBe(200)
    expect(report.summary.orderValue).toBe(3000)
    expect(report.summary.skusOrdered).toBe(2)
    expect(report.summary.activeSkus).toBe(2)
    expect(report.summary.avgValuePerUnit).toBe(15)
  })
})

// ── Category filtering ─────────────────────────────────────────────────────

describe('category scoping', () => {
  const catalogue = [
    { id: 'vape1', product_id: 'pv', variant_name: 'Deluxe Cellera Cartridge [ Banana Vanilla ]', product_code: 'BV', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'vape2', product_id: 'pv', variant_name: 'Deluxe Cellera Cartridge [ Corn ]', product_code: 'CO', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'pet1', product_id: 'pp', variant_name: 'Chicken Bites', product_code: 'CB', is_active: true, productName: 'Pet Treats', categoryId: PET, categoryName: 'Pet Food' },
    // Legacy row whose product (and therefore category) cannot be resolved.
    { id: 'orphan', product_id: null, variant_name: 'Legacy Item', product_code: 'LG', is_active: true, productName: null, categoryId: null, categoryName: null },
  ]

  const inventory = [
    { variant_id: 'vape1', quantity_on_hand: 180, quantity_available: 100, reorder_point: 200, safety_stock: 50, total_value: 1800, updated_at: '2026-09-07T02:00:00.000Z' },
    { variant_id: 'pet1', quantity_on_hand: 900, quantity_available: 900, reorder_point: 50, safety_stock: 10, total_value: 9000, updated_at: '2026-09-06T02:00:00.000Z' },
    { variant_id: 'orphan', quantity_on_hand: 40, quantity_available: 40, reorder_point: 5, safety_stock: 0, total_value: 400, updated_at: '2026-09-05T02:00:00.000Z' },
  ]

  function line(createdAtMyt: string, variantId: string, qty: number, value: number): OrderItemRecord {
    return {
      variant_id: variantId, product_id: 'p1', qty, line_total: value,
      orders: { created_at: new Date(`${createdAtMyt}+08:00`).toISOString(), status: 'approved' },
    }
  }

  // 100 Vape + 40 Pet Food units this period; 50 Vape + 10 Pet Food last period.
  const items = [
    line('2026-09-03T09:00:00', 'vape1', 60, 1200),
    line('2026-09-04T09:00:00', 'vape2', 40, 800),
    line('2026-09-04T09:00:00', 'pet1', 40, 1000),
    line('2026-09-05T09:00:00', 'orphan', 5, 75),
    line('2026-08-03T09:00:00', 'vape1', 50, 900),
    line('2026-08-04T09:00:00', 'pet1', 10, 250),
  ]

  const build = (categoryId: string) =>
    buildProductAnalyticsReport(
      aggregateProductOrders(items, catalogue, inventory, '2026-09', NOW, undefined, categoryId),
      NOW,
    )

  it('defaults to All Categories and consolidates every category', () => {
    const report = build('all')
    expect(report.category.id).toBe('all')
    expect(report.category.isAll).toBe(true)
    expect(report.category.name).toBe('All Categories')
    expect(report.summary.unitsOrdered).toBe(145) // 100 Vape + 40 Pet + 5 orphan
  })

  it('recalculates every KPI inside the selected category', () => {
    const vape = build(VAPE)
    expect(vape.category.name).toBe('Vape')
    expect(vape.summary.unitsOrdered).toBe(100)
    expect(vape.summary.orderValue).toBe(2000)
    expect(vape.summary.skusOrdered).toBe(2)
    expect(vape.summary.avgValuePerUnit).toBe(20)

    const pet = build(PET)
    expect(pet.summary.unitsOrdered).toBe(40)
    expect(pet.summary.orderValue).toBe(1000)
    expect(pet.summary.skusOrdered).toBe(1)
  })

  it('scopes the active-SKU denominator to the category', () => {
    expect(build(VAPE).summary.activeSkus).toBe(2)
    expect(build(PET).summary.activeSkus).toBe(1)
    expect(build('all').summary.activeSkus).toBe(4)
  })

  it('keeps the comparison window inside the SAME category', () => {
    // Vape must compare against Vape, never against all categories.
    const vape = build(VAPE)
    expect(vape.comparison.unitsOrdered.previous).toBe(50)
    expect(vape.comparison.unitsOrdered.changePct).toBe(100)

    const pet = build(PET)
    expect(pet.comparison.unitsOrdered.previous).toBe(10)
    expect(pet.comparison.orderValue.previous).toBe(250)
  })

  it('keeps the comparison in scope for a historical month and across the year boundary', () => {
    const august = buildProductAnalyticsReport(
      aggregateProductOrders(items, catalogue, inventory, '2026-08', NOW, undefined, VAPE), NOW,
    )
    expect(august.category.name).toBe('Vape')
    expect(august.period.comparisonMonth).toBe('2026-07')

    const january = buildProductAnalyticsReport(
      aggregateProductOrders([], catalogue, inventory, '2026-01', NOW, undefined, PET), NOW,
    )
    expect(january.category.name).toBe('Pet Food')
    expect(january.period.comparisonMonth).toBe('2025-12')
    expect(january.period.comparisonRangeLabel).toBe('01 Dec 2025 – 31 Dec 2025')
  })

  it('ranks only products inside the category', () => {
    const vape = build(VAPE)
    expect(vape.topProducts.byUnits.map((row) => row.variantId)).toEqual(['vape1', 'vape2'])
    expect(vape.topProducts.byUnits.some((row) => row.variantId === 'pet1')).toBe(false)
  })

  it('uses the category total as the contribution denominator', () => {
    const vape = build(VAPE)
    // 1200 of the 2000 Vape order value, NOT of the consolidated 3075.
    expect(vape.productContribution.totalOrderValue).toBe(2000)
    expect(vape.topProducts.byUnits[0].valueSharePct).toBe(60)
  })

  it('scopes the daily trend to the category', () => {
    const vape = build(VAPE)
    const total = vape.dailyTrend.reduce((sum, row) => sum + row.units, 0)
    expect(total).toBe(100)
    // 4 Sep carries only the Vape line, not the Pet Food one ordered the same day.
    expect(vape.dailyTrend.find((row) => row.date === '2026-09-04')?.units).toBe(40)
  })

  it('scopes the current inventory snapshot without making it historical', () => {
    const vape = build(VAPE)
    expect(vape.inventorySnapshot.totalValue).toBe(1800)
    expect(vape.inventorySnapshot.variantCount).toBe(1)
    // Still a CURRENT snapshot: its as-of is unrelated to the reporting month.
    expect(vape.inventorySnapshot.asOf).toBe('2026-09-07T02:00:00.000Z')

    expect(build(PET).inventorySnapshot.totalValue).toBe(9000)
    expect(build('all').inventorySnapshot.totalValue).toBe(11200)
  })

  it('scopes the management action plan and its summary counts', () => {
    const vape = build(VAPE)
    expect(vape.managementActions.rows.every((row) => ['vape1', 'vape2'].includes(row.variantId))).toBe(true)
    for (const card of vape.managementActions.summary) {
      expect(card.count).toBe(vape.managementActions.rows.filter((row) => row.action === card.key).length)
    }
  })

  it('scopes products requiring attention and the strategy insights', () => {
    const pet = build(PET)
    expect(pet.attentionProducts.every((row) => row.variantId === 'pet1')).toBe(true)
    for (const card of pet.strategyInsights) {
      expect(card.rows.every((row) => row.variantId === 'pet1')).toBe(true)
    }
  })

  it('counts an uncategorised legacy variant under All Categories but never inside a category', () => {
    const all = build('all')
    expect(all.managementActions.rows.some((row) => row.variantId === 'orphan')
      || all.topProducts.byUnits.some((row) => row.variantId === 'orphan')).toBe(true)

    // It is never silently assigned to a category.
    for (const categoryId of [VAPE, PET]) {
      const report = build(categoryId)
      expect(report.topProducts.byUnits.some((row) => row.variantId === 'orphan')).toBe(false)
      expect(report.managementActions.rows.some((row) => row.variantId === 'orphan')).toBe(false)
    }
  })
})

describe('Category Performance', () => {
  const catalogue = [
    { id: 'vape1', product_id: 'pv', variant_name: 'Corn', product_code: 'CO', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'pet1', product_id: 'pp', variant_name: 'Chicken Bites', product_code: 'CB', is_active: true, productName: 'Pet Treats', categoryId: PET, categoryName: 'Pet Food' },
  ]
  const items: OrderItemRecord[] = [
    { variant_id: 'vape1', product_id: 'pv', qty: 2200, line_total: 30800, orders: { created_at: new Date('2026-09-03T09:00:00+08:00').toISOString(), status: 'approved' } },
    { variant_id: 'pet1', product_id: 'pp', qty: 1120, line_total: 18400, orders: { created_at: new Date('2026-09-03T09:00:00+08:00').toISOString(), status: 'approved' } },
    { variant_id: 'vape1', product_id: 'pv', qty: 1930, line_total: 27000, orders: { created_at: new Date('2026-08-03T09:00:00+08:00').toISOString(), status: 'approved' } },
  ]
  const build = (categoryId: string) =>
    buildProductAnalyticsReport(aggregateProductOrders(items, catalogue, [], '2026-09', NOW, undefined, categoryId), NOW)

  it('is present on the consolidated report with per-category totals and growth', () => {
    const rows = build('all').categoryPerformance!
    expect(rows).not.toBeNull()
    const byName = Object.fromEntries(rows.map((row) => [row.categoryName, row]))
    expect(byName.Vape.unitsOrdered).toBe(2200)
    expect(byName.Vape.orderValue).toBe(30800)
    expect(byName.Vape.skusOrdered).toBe(1)
    expect(byName.Vape.changePct).toBe(14)
    // Pet Food has no prior baseline — never Infinity, never a false +0%.
    expect(byName['Pet Food'].changePct).toBeNull()
  })

  it('orders categories by order value and shares sum to the consolidated total', () => {
    const rows = build('all').categoryPerformance!
    expect(rows.map((row) => row.categoryName)).toEqual(['Vape', 'Pet Food'])
    expect(Math.round(rows.reduce((sum, row) => sum + (row.valueSharePct ?? 0), 0))).toBe(100)
  })

  it('is omitted entirely inside a category drill-down', () => {
    expect(build(VAPE).categoryPerformance).toBeNull()
    expect(build(PET).categoryPerformance).toBeNull()
  })
})

describe('empty category month', () => {
  it('reports the category as empty without NaN, Infinity or a false decline', () => {
    const catalogue = [
      { id: 'pet1', product_id: 'pp', variant_name: 'Chicken Bites', product_code: 'CB', is_active: true, productName: 'Pet Treats', categoryId: PET, categoryName: 'Pet Food' },
    ]
    const inventory = [
      { variant_id: 'pet1', quantity_on_hand: 900, quantity_available: 900, reorder_point: 50, safety_stock: 10, total_value: 9000, updated_at: '2026-09-07T02:00:00.000Z' },
    ]
    const report = buildProductAnalyticsReport(
      aggregateProductOrders([], catalogue, inventory, '2026-03', NOW, undefined, PET), NOW,
    )
    expect(report.isEmpty).toBe(true)
    expect(report.category.name).toBe('Pet Food')
    expect(report.summary.unitsOrdered).toBe(0)
    expect(report.summary.avgValuePerUnit).toBeNull()
    expect(report.comparison.unitsOrdered.changePct).toBeNull()
    // The current stock snapshot survives an empty reporting month.
    expect(report.inventorySnapshot.totalValue).toBe(9000)
  })
})

describe('category-scoped PDF filename', () => {
  it('adds a filename-safe category segment, and none for All Categories', () => {
    const mtd = resolveProductReportPeriod('2026-09', NOW)
    const closed = resolveProductReportPeriod('2026-08', NOW)
    const all = { id: 'all', name: 'All Categories', isAll: true }
    expect(productReportFilename(mtd, all)).toBe('Serapod_Product_Performance_2026-09_MTD.pdf')
    expect(productReportFilename(mtd, { id: VAPE, name: 'Vape', isAll: false }))
      .toBe('Serapod_Product_Performance_Vape_2026-09_MTD.pdf')
    expect(productReportFilename(closed, { id: PET, name: 'Pet Food', isAll: false }))
      .toBe('Serapod_Product_Performance_Pet_Food_2026-08.pdf')
  })

  it('never lets a category name produce a path separator', () => {
    expect(categoryFilenameSegment('Vape / Pods (2026)')).toBe('Vape_Pods_2026')
    expect(categoryFilenameSegment('  Pet  Food  ')).toBe('Pet_Food')
  })
})

// ── Product Contribution drill-down ────────────────────────────────────────

describe('contribution drill-down bands', () => {
  /** 12 ordered SKUs so all three bands are populated. */
  const twelve = Array.from({ length: 12 }, (_, i) => variant({
    variantId: `c${i}`,
    productCode: `C${i}`,
    // Descending value so rank is deterministic: c0 is #1.
    currentUnits: (12 - i) * 100,
    currentValue: (12 - i) * 1000,
    previousUnits: (12 - i) * 90,
    previousValue: (12 - i) * 950,
    stockOnHand: 500,
    stockAvailable: 500,
    reorderPoint: 100,
    stockValue: 5000,
  }))
  const report = buildProductAnalyticsReport(aggregate('2026-09', twelve), NOW)
  const rowsIn = (band: string) => report.productContribution.rows.filter((row) => row.band === band)

  it('assigns ranks 1-5 to Top 5', () => {
    const top = rowsIn('top5')
    expect(top).toHaveLength(5)
    expect(top.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5])
    expect(top[0].variantId).toBe('c0')
  })

  it('assigns ranks 6-10 to Next 5', () => {
    const next = rowsIn('next5')
    expect(next).toHaveLength(5)
    expect(next.map((row) => row.rank)).toEqual([6, 7, 8, 9, 10])
    expect(next[0].variantId).toBe('c5')
  })

  it('assigns rank 11 onward to Remaining', () => {
    const remaining = rowsIn('remaining')
    expect(remaining).toHaveLength(2)
    expect(remaining.map((row) => row.rank)).toEqual([11, 12])
  })

  it('band row counts match the summary band counts exactly', () => {
    for (const band of report.productContribution.bands) {
      expect(rowsIn(band.key)).toHaveLength(band.skus)
    }
  })

  it('band rank ranges are published for the drill-down caption', () => {
    const byKey = Object.fromEntries(report.productContribution.bands.map((b) => [b.key, b]))
    expect([byKey.top5.rankFrom, byKey.top5.rankTo]).toEqual([1, 5])
    expect([byKey.next5.rankFrom, byKey.next5.rankTo]).toEqual([6, 10])
    expect([byKey.remaining.rankFrom, byKey.remaining.rankTo]).toEqual([11, null])
  })

  it('handles fewer than 10 SKUs without fabricating placeholder rows', () => {
    const three = buildProductAnalyticsReport(
      aggregate('2026-09', Array.from({ length: 3 }, (_, i) => variant({
        variantId: `s${i}`, currentUnits: (3 - i) * 10, currentValue: (3 - i) * 100, previousUnits: 5,
      }))),
      NOW,
    )
    const bands = Object.fromEntries(three.productContribution.bands.map((b) => [b.key, b]))
    expect(bands.top5.skus).toBe(3)
    expect(bands.next5.skus).toBe(0)
    expect(bands.remaining.skus).toBe(0)
    expect(three.productContribution.rows).toHaveLength(3)
    expect(three.productContribution.rows.every((row) => row.band === 'top5')).toBe(true)
  })

  it('reports empty bands for a month with no orders rather than inventing rows', () => {
    const empty = buildProductAnalyticsReport(emptyAggregate('2026-09', resolveProductReportPeriod('2026-09', NOW)), NOW)
    expect(empty.productContribution.rows).toHaveLength(0)
    for (const band of empty.productContribution.bands) {
      expect(band.skus).toBe(0)
      expect(band.sharePct).toBeNull()
    }
  })

  it('leaves the existing band totals and shares untouched', () => {
    // The drill-down must not have changed the numbers the section already showed.
    const bands = report.productContribution.bands
    const top5Total = report.productContribution.rows
      .filter((row) => row.band === 'top5')
      .reduce((sum, row) => sum + row.currentValue, 0)
    expect(bands[0].orderValue).toBe(top5Total)
    expect(bands.reduce((sum, band) => sum + band.orderValue, 0))
      .toBeCloseTo(report.productContribution.totalOrderValue, 2)
    expect(Math.round(bands.reduce((sum, band) => sum + (band.sharePct ?? 0), 0))).toBe(100)
  })

  it('ranks by order value, so band membership follows contribution', () => {
    const values = report.productContribution.rows.map((row) => row.currentValue)
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })
})

describe('contribution drill-down row data', () => {
  const rows = () => buildProductAnalyticsReport(
    aggregate('2026-09', [
      variant({ variantId: 'grow', currentUnits: 700, currentValue: 9800, previousUnits: 625, previousValue: 8000, stockOnHand: 400, stockAvailable: 400, reorderPoint: 100, stockValue: 4000 }),
      variant({ variantId: 'fresh', currentUnits: 600, currentValue: 8400, previousUnits: 0, previousValue: 0, stockOnHand: 300, stockAvailable: 300, reorderPoint: 100, stockValue: 3000 }),
      variant({ variantId: 'flat', currentUnits: 300, currentValue: 4200, previousUnits: 300, previousValue: 4200, stockOnHand: 250, stockAvailable: 250, reorderPoint: 100, stockValue: 2500 }),
    ]),
    NOW,
  ).productContribution.rows

  it('uses the canonical business-friendly product label', () => {
    expect(rows()[0].label).toBe('Cellera Hero / Banana Vanilla – BV')
    expect(rows()[0].label).not.toContain('Deluxe Cellera Cartridge')
  })

  it('divides share by the selected scope’s order value', () => {
    const all = rows()
    // 9800 of 22400 total.
    expect(all[0].valueSharePct).toBe(43.8)
    expect(Math.round(all.reduce((sum, row) => sum + (row.valueSharePct ?? 0), 0))).toBe(100)
  })

  it('reports a zero comparison baseline as new activity, never Infinity', () => {
    const fresh = rows().find((row) => row.variantId === 'fresh')!
    expect(fresh.growthPct).toBeNull()
    expect(fresh.demandTrend).toBe('new')
    expect(Number.isFinite(fresh.currentUnits)).toBe(true)
  })

  it('carries the comparison figures and a flat trend where demand did not move', () => {
    const flat = rows().find((row) => row.variantId === 'flat')!
    expect(flat.previousUnits).toBe(300)
    expect(flat.previousValue).toBe(4200)
    expect(flat.growthPct).toBe(0)
    expect(flat.demandTrend).toBe('stable')
  })

  it('carries the current stock position for the SKU detail', () => {
    const grow = rows().find((row) => row.variantId === 'grow')!
    expect(grow.currentStock).toBe(400)
    expect(grow.availableStock).toBe(400)
    expect(grow.reorderPoint).toBe(100)
    expect(grow.stockStatus).toBeTruthy()
  })

  it('reuses the existing management action classification, not a second system', () => {
    for (const row of rows()) {
      const full = buildProductAnalyticsReport(
        aggregate('2026-09', [variant({
          variantId: row.variantId, currentUnits: row.currentUnits, currentValue: row.currentValue,
          previousUnits: row.previousUnits, previousValue: row.previousValue,
          stockOnHand: row.currentStock, stockAvailable: row.availableStock,
          reorderPoint: row.reorderPoint, stockValue: 1000,
        })]),
        NOW,
      )
      const actionRow = full.managementActions.rows.find((r) => r.variantId === row.variantId)
      expect(row.action).toBe(actionRow?.action ?? null)
    }
  })
})

describe('contribution drill-down respects the report filters', () => {
  const catalogue = [
    { id: 'vape1', product_id: 'pv', variant_name: 'Deluxe Cellera Cartridge [ Corn ]', product_code: 'CO', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'vape2', product_id: 'pv', variant_name: 'Deluxe Cellera Cartridge [ Hazelnut ]', product_code: 'HA', is_active: true, productName: 'Cellera Hero', categoryId: VAPE, categoryName: 'Vape' },
    { id: 'pet1', product_id: 'pp', variant_name: 'Chicken Bites', product_code: 'CB', is_active: true, productName: 'Pet Treats', categoryId: PET, categoryName: 'Pet Food' },
  ]
  const line = (day: string, v: string, qty: number, value: number): OrderItemRecord => ({
    variant_id: v, product_id: 'p', qty, line_total: value,
    orders: { created_at: new Date(`${day}+08:00`).toISOString(), status: 'approved' },
  })
  const items = [
    line('2026-09-03T09:00:00', 'vape1', 100, 2000),
    line('2026-09-03T09:00:00', 'vape2', 60, 1200),
    line('2026-09-03T09:00:00', 'pet1', 400, 9000),
    line('2026-08-03T09:00:00', 'vape1', 80, 1600),
    line('2026-08-03T09:00:00', 'pet1', 300, 7000),
  ]
  const build = (month: string, categoryId: string) => buildProductAnalyticsReport(
    aggregateProductOrders(items, catalogue, [], month, NOW, undefined, categoryId), NOW,
  )

  it('lists only SKUs of the selected category', () => {
    const vape = build('2026-09', VAPE)
    expect(vape.productContribution.rows.map((row) => row.variantId)).toEqual(['vape1', 'vape2'])
    expect(vape.productContribution.rows.some((row) => row.variantId === 'pet1')).toBe(false)
  })

  it('divides share by the category total, not the company total', () => {
    const vape = build('2026-09', VAPE)
    // 2000 of the 3200 Vape order value, not of the 12200 consolidated total.
    expect(vape.productContribution.totalOrderValue).toBe(3200)
    expect(vape.productContribution.rows[0].valueSharePct).toBe(62.5)
  })

  it('compares against the same category in the MTD comparison window', () => {
    const vape = build('2026-09', VAPE)
    expect(vape.period.isCurrentMonth).toBe(true)
    expect(vape.period.comparisonRangeLabel).toBe('01 Aug 2026 – 07 Aug 2026')
    const corn = vape.productContribution.rows.find((row) => row.variantId === 'vape1')!
    expect(corn.previousUnits).toBe(80)
    expect(corn.growthPct).toBe(25)
  })

  it('follows the selected month, using full-month comparison for a closed month', () => {
    const august = build('2026-08', VAPE)
    expect(august.period.isCurrentMonth).toBe(false)
    expect(august.period.comparisonRangeLabel).toBe('01 Jul 2026 – 31 Jul 2026')
    const corn = august.productContribution.rows.find((row) => row.variantId === 'vape1')!
    expect(corn.currentUnits).toBe(80)
    // July had no orders, so there is no baseline rather than a -100%.
    expect(corn.growthPct).toBeNull()
  })
})
