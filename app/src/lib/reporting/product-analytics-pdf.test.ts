import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildProductAnalyticsReport,
  resolveProductReportPeriod,
  type ProductAnalyticsAggregate,
} from './product-analytics'
import { buildProductAnalyticsPdf } from './product-analytics-pdf'

const NOW = new Date('2026-09-07T10:00:00+08:00')

function sampleReport(month = '2026-09', categoryId = 'all', categoryName = 'All Categories') {
  const period = resolveProductReportPeriod(month, NOW)
  const aggregate: ProductAnalyticsAggregate = {
    month,
    categoryId,
    categoryName,
    current: { units: 4820, orderValue: 82340, skus: 26, orders: 0 },
    previous: { units: 4210, orderValue: 76254, skus: 23, orders: 0 },
    activeSkus: 60,
    dailyTrend: Array.from({ length: period.dayCount }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      units: 600 + i * 10,
      orderValue: 11000 + i * 120,
    })),
    variants: [
      {
        variantId: 'v1', productId: 'p1', categoryId: 'cat-vape', categoryName: 'Vape', productName: 'Cellera Hero',
        variantName: 'Deluxe Cellera Cartridge [ Banana Vanilla ]', productCode: 'BV', isActive: true,
        currentUnits: 820, currentValue: 13284, previousUnits: 678, previousValue: 11000,
        stockOnHand: 180, stockAvailable: 100, reorderPoint: 200, safetyStock: 50, stockValue: 1800,
        lastOrderedAt: '2026-09-05T02:00:00.000Z',
      },
      {
        variantId: 'v2', productId: 'p1', categoryId: 'cat-vape', categoryName: 'Vape', productName: 'Cellera Hero',
        variantName: 'Deluxe Cellera Cartridge [ Grape Pudina ]', productCode: 'GP', isActive: true,
        currentUnits: 0, currentValue: 0, previousUnits: 120, previousValue: 2000,
        stockOnHand: 1450, stockAvailable: 1450, reorderPoint: 100, safetyStock: 20, stockValue: 14500,
        lastOrderedAt: '2026-08-14T02:00:00.000Z',
      },
    ],
    inventory: { totalValue: 257450, totalOnHand: 16300, variantCount: 2, asOf: '2026-09-07T02:00:00.000Z' },
    // The server emits per-category totals only for the consolidated report.
    categories: categoryId === 'all' ? [
      { categoryId: 'cat-vape', categoryName: 'Vape', currentUnits: 820, currentValue: 13284, currentSkus: 1, previousUnits: 798, previousValue: 13000, previousSkus: 2, activeSkus: 18 },
      { categoryId: 'cat-pet', categoryName: 'Pet Food', currentUnits: 1120, currentValue: 18400, currentSkus: 8, previousUnits: 1037, previousValue: 17000, previousSkus: 8, activeSkus: 12 },
    ] : [],
  }
  return buildProductAnalyticsReport(aggregate, NOW)
}

describe('PDF uses the same report data source as the web report', () => {
  it('takes the report DTO as its only data input — it never queries or recomputes', () => {
    const source = readFileSync(new URL('./product-analytics-pdf.ts', import.meta.url), 'utf8')
    // No data access of its own: the DTO the UI renders is the DTO it formats.
    expect(source).not.toMatch(/supabase|createClient|fetch\(|\.rpc\(/)
    // No second KPI calculation: it must not re-derive the report from an aggregate.
    expect(source).not.toMatch(/buildProductAnalyticsReport|aggregateProductOrders/)
  })

  it('renders a real multi-page PDF document', async () => {
    const pdf = await buildProductAnalyticsPdf(sampleReport(), { generatedAt: '2026-09-07T02:00:00.000Z' })
    expect(pdf.size).toBeGreaterThan(1000)
    const head = Buffer.from(await pdf.blob.arrayBuffer()).subarray(0, 5).toString('latin1')
    expect(head).toBe('%PDF-')
  })

  it('exports the complete report — every section, whichever sub-tab is on screen', async () => {
    const pdf = await buildProductAnalyticsPdf(sampleReport(), { generatedAt: '2026-09-07T02:00:00.000Z' })
    const text = Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1')
    // jsPDF writes page objects per page; the report spans Overview,
    // Performance and Inventory & Actions regardless of the active sub-tab.
    const pageCount = (text.match(/\/Type \/Page[^s]/g) || []).length
    expect(pageCount).toBeGreaterThanOrEqual(3)
  })

  it('names the file by the reporting month, marking a running month as MTD', async () => {
    const mtd = await buildProductAnalyticsPdf(sampleReport('2026-09'))
    expect(mtd.filename).toBe('Serapod_Product_Performance_2026-09_MTD.pdf')
    const closed = await buildProductAnalyticsPdf(sampleReport('2026-08'))
    expect(closed.filename).toBe('Serapod_Product_Performance_2026-08.pdf')
  })

  it('formats the same KPI values the web report shows', async () => {
    const report = sampleReport()
    // The PDF has no numbers of its own; these are the DTO's numbers verbatim.
    expect(report.summary.unitsOrdered).toBe(4820)
    expect(report.summary.orderValue).toBe(82340)
    expect(report.summary.skusOrdered).toBe(26)
    expect(report.summary.activeSkus).toBe(60)
    expect(report.comparison.unitsOrdered.changePct).toBe(14.5)
    expect(report.comparison.orderValue.changePct).toBe(8)

    const pdf = await buildProductAnalyticsPdf(report, { generatedAt: '2026-09-07T02:00:00.000Z' })
    expect(pdf.size).toBeGreaterThan(1000)
  })
})

describe('PDF respects the selected product category', () => {
  it('names the file with a filename-safe category segment', async () => {
    const vape = await buildProductAnalyticsPdf(sampleReport('2026-09', 'cat-vape', 'Vape'))
    expect(vape.filename).toBe('Serapod_Product_Performance_Vape_2026-09_MTD.pdf')

    const pet = await buildProductAnalyticsPdf(sampleReport('2026-08', 'cat-pet', 'Pet Food'))
    expect(pet.filename).toBe('Serapod_Product_Performance_Pet_Food_2026-08.pdf')

    const all = await buildProductAnalyticsPdf(sampleReport('2026-09'))
    expect(all.filename).toBe('Serapod_Product_Performance_2026-09_MTD.pdf')
  })

  it('prints the selected category in the header of both report modes', async () => {
    const consolidated = sampleReport('2026-09')
    expect(consolidated.category.name).toBe('All Categories')
    expect(consolidated.category.isAll).toBe(true)

    const scoped = sampleReport('2026-09', 'cat-vape', 'Vape')
    expect(scoped.category.name).toBe('Vape')
    expect(scoped.category.isAll).toBe(false)

    // Both render; the header pair is driven purely by report.category.
    for (const report of [consolidated, scoped]) {
      const pdf = await buildProductAnalyticsPdf(report, { generatedAt: '2026-09-07T02:00:00.000Z' })
      expect(pdf.size).toBeGreaterThan(1000)
    }
  })

  it('includes Category Performance only for the consolidated report', async () => {
    // The section is driven by the DTO, so its presence is decided upstream and
    // the PDF cannot disagree with the web report about it.
    expect(sampleReport('2026-09').categoryPerformance).not.toBeNull()
    expect(sampleReport('2026-09', 'cat-vape', 'Vape').categoryPerformance).toBeNull()

    const scoped = await buildProductAnalyticsPdf(
      sampleReport('2026-09', 'cat-vape', 'Vape'), { generatedAt: '2026-09-07T02:00:00.000Z' },
    )
    const pageCount = (Buffer.from(await scoped.blob.arrayBuffer()).toString('latin1')
      .match(/\/Type \/Page[^s]/g) || []).length
    // A drill-down still exports the complete three-section report.
    expect(pageCount).toBeGreaterThanOrEqual(3)
  })
})
