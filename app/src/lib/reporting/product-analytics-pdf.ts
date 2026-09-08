/**
 * Serapod Product Performance Report — branded A4 landscape PDF.
 *
 * Built entirely from the `ProductAnalyticsReport` DTO that renders the web
 * report, so the two can never disagree: there is no second KPI calculation
 * anywhere in this file, only formatting. Every section of the report is
 * exported regardless of which sub-tab the user happens to be looking at.
 *
 * Generated with jsPDF + jspdf-autotable (existing project dependencies),
 * following the layout conventions of `lib/returns/report-pdf.ts`.
 */

import {
  formatReportDate,
  productReportFilename,
  type ActionKey,
  type ProductAnalyticsReport,
  type ProductRow,
} from './product-analytics'

const INK: [number, number, number] = [26, 26, 26]
const MUTED: [number, number, number] = [120, 120, 120]
const ORANGE: [number, number, number] = [232, 93, 4]
const BAND: [number, number, number] = [243, 238, 230]
const BAND_BORDER: [number, number, number] = [226, 219, 205]
const BOX_BORDER: [number, number, number] = [222, 222, 222]
const BOX_FILL: [number, number, number] = [249, 250, 251]
const STRIPE: [number, number, number] = [248, 248, 248]
const POSITIVE: [number, number, number] = [22, 128, 61]
const NEGATIVE: [number, number, number] = [185, 28, 28]

export interface ProductAnalyticsPdf {
  blob: Blob
  filename: string
  size: number
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-MY')
}

function formatRM(value: number): string {
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** `null` growth means the comparison window had no baseline — never "0%". */
function formatGrowth(value: number | null): string {
  if (value === null) return 'new'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  })
}

function formatDay(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatReportDate(
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
    }).format(date),
  )
}

const ACTION_LABEL: Record<ActionKey, string> = {
  replenish: 'REPLENISH',
  maintain: 'MAINTAIN',
  promote: 'PROMOTE / REDUCE STOCK',
  review: 'REVIEW',
}

const STOCK_LABEL: Record<string, string> = {
  low: 'Low', healthy: 'Healthy', excess: 'Excess', dead: 'Dead', none: 'No stock',
}

/** Build the complete management report PDF as a Blob. */
export async function buildProductAnalyticsPdf(
  report: ProductAnalyticsReport,
  options: { generatedAt?: string | null; generatedBy?: string | null } = {},
): Promise<ProductAnalyticsPdf> {
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableModule.default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 12
  const contentWidth = pageWidth - margin * 2
  const FOOTER_RESERVE = 14
  const CONTINUE_TOP = 22
  const contentBottom = pageHeight - FOOTER_RESERVE

  const { period, summary, comparison, category } = report
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  let y = 14

  const ensureSpace = (needed: number) => {
    if (y + needed > contentBottom) {
      doc.addPage()
      y = CONTINUE_TOP
    }
  }

  const newPage = () => {
    doc.addPage()
    y = CONTINUE_TOP
  }

  const sectionBand = (title: string, note?: string) => {
    ensureSpace(24)
    doc.setDrawColor(...BAND_BORDER)
    doc.setFillColor(...BAND)
    doc.rect(margin, y, contentWidth, 8, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(title, margin + 3, y + 5.5)
    if (note) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(note, pageWidth - margin - 3, y + 5.5, { align: 'right' })
    }
    y += 11
  }

  const tableDefaults = {
    theme: 'grid' as const,
    headStyles: { fillColor: INK, textColor: 255 as any, fontStyle: 'bold' as const, fontSize: 7.5, cellPadding: 1.8 },
    styles: { fontSize: 7.5, cellPadding: 1.8, textColor: INK, lineColor: [225, 225, 225] as any, lineWidth: 0.1 },
    alternateRowStyles: { fillColor: STRIPE as any },
    margin: { left: margin, right: margin, top: CONTINUE_TOP, bottom: FOOTER_RESERVE },
    tableWidth: contentWidth,
  }

  const runTable = (options: any) => {
    autoTable(doc, { ...tableDefaults, startY: y, ...options })
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 7
  }

  const emptyNote = (text: string) => {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(text, margin + 1, y + 2)
    y += 9
  }

  /** KPI cards laid across the page width. */
  const kpiRow = (cards: { label: string; value: string; note: string; delta?: number | null }[]) => {
    const gap = 4
    const cardW = (contentWidth - gap * (cards.length - 1)) / cards.length
    const cardH = 22
    ensureSpace(cardH + 4)
    cards.forEach((card, index) => {
      const x = margin + index * (cardW + gap)
      doc.setDrawColor(...BOX_BORDER)
      doc.setFillColor(...BOX_FILL)
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(card.label.toUpperCase(), x + 3, y + 5.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...INK)
      doc.text(card.value, x + 3, y + 13)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.8)
      if (card.delta === undefined || card.delta === null) {
        doc.setTextColor(...MUTED)
      } else {
        doc.setTextColor(...(card.delta >= 0 ? POSITIVE : NEGATIVE))
      }
      doc.text(card.note, x + 3, y + 18.5, { maxWidth: cardW - 6 })
    })
    y += cardH + 6
  }

  // ══ PAGE 1 — EXECUTIVE SUMMARY ═════════════════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...INK)
  doc.text('SERAPOD PRODUCT PERFORMANCE REPORT', margin, y + 4)
  doc.setFontSize(10)
  doc.setTextColor(...ORANGE)
  doc.text(
    category.isAll ? period.label : `${category.name} · ${period.label}`,
    pageWidth - margin, y + 4, { align: 'right' },
  )
  y += 9
  doc.setDrawColor(...BAND_BORDER)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5

  const infoPairs: Array<[string, string]> = [
    ['REPORTING MONTH', period.label],
    ['PRODUCT CATEGORY', category.name],
    ['REPORT PERIOD', period.rangeLabel + (period.isCurrentMonth ? ' (month to date)' : '')],
    ['COMPARISON PERIOD', period.comparisonRangeLabel],
    ['GENERATED', formatDateTime(generatedAt)],
    ['GENERATED BY', options.generatedBy || '—'],
    ['REPORTING TIMEZONE', period.timeZone],
    ['ELIGIBLE ORDER STATUSES', report.meta.eligibleStatuses.join(', ')],
    ['REPORT DATE FIELD', report.meta.dateField],
  ]
  const infoRowH = 6
  const rowsPerCol = Math.ceil(infoPairs.length / 2)
  const infoH = infoRowH * rowsPerCol + 7
  doc.setDrawColor(...BOX_BORDER)
  doc.setFillColor(...BOX_FILL)
  doc.roundedRect(margin, y, contentWidth, infoH, 2, 2, 'FD')
  const colGap = contentWidth / 2
  infoPairs.forEach(([label, value], index) => {
    const col = Math.floor(index / rowsPerCol)
    const row = index % rowsPerCol
    const lx = margin + 4 + col * colGap
    const ly = y + 7 + row * infoRowH
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.setTextColor(...MUTED)
    doc.text(label, lx, ly)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(value, colGap - 46)[0], lx + 44, ly)
  })
  y += infoH + 6

  sectionBand('MONTHLY SUMMARY', period.rangeLabel)
  kpiRow([
    {
      label: 'Units Ordered',
      value: formatCount(summary.unitsOrdered),
      note: `${formatGrowth(comparison.unitsOrdered.changePct)} vs comparison  ·  avg ${formatCount(summary.avgUnitsPerDay)}/day`,
      delta: comparison.unitsOrdered.changePct,
    },
    {
      label: 'Order Value',
      value: formatRM(summary.orderValue),
      note: `${formatGrowth(comparison.orderValue.changePct)} vs comparison  ·  avg ${formatRM(summary.avgValuePerDay)}/day`,
      delta: comparison.orderValue.changePct,
    },
    {
      label: 'SKUs Ordered',
      value: formatCount(summary.skusOrdered),
      note: `${comparison.skusOrdered.current - comparison.skusOrdered.previous >= 0 ? '+' : ''}`
        + `${comparison.skusOrdered.current - comparison.skusOrdered.previous} vs comparison  ·  of ${formatCount(summary.activeSkus)} active SKUs`,
      delta: comparison.skusOrdered.current - comparison.skusOrdered.previous,
    },
    {
      label: 'Avg Value / Unit',
      value: summary.avgValuePerUnit === null ? '—' : formatRM(summary.avgValuePerUnit),
      note: comparison.avgValuePerUnit.previous === null
        ? 'no comparison baseline'
        : `${formatGrowth(comparison.avgValuePerUnit.changePct)}  ·  comparison ${formatRM(comparison.avgValuePerUnit.previous)}`,
      delta: comparison.avgValuePerUnit.changePct,
    },
  ])

  sectionBand('PRODUCT STRATEGY INSIGHTS', `${period.rangeLabel} vs ${period.comparisonRangeLabel}`)
  kpiRow(report.strategyInsights.map((card) => ({
    label: card.title,
    value: formatCount(card.count),
    note: card.description,
  })))

  sectionBand('THIS PERIOD VS PREVIOUS PERIOD', `${period.rangeLabel} vs ${period.comparisonRangeLabel}`)
  runTable({
    head: [['Metric', 'Current', 'Previous', 'Change']],
    body: [
      ['Units Ordered', formatCount(summary.unitsOrdered), formatCount(comparison.unitsOrdered.previous), formatGrowth(comparison.unitsOrdered.changePct)],
      ['Order Value', formatRM(summary.orderValue), formatRM(comparison.orderValue.previous), formatGrowth(comparison.orderValue.changePct)],
      ['SKUs Ordered', formatCount(summary.skusOrdered), formatCount(comparison.skusOrdered.previous),
        `${comparison.skusOrdered.current - comparison.skusOrdered.previous >= 0 ? '+' : ''}${comparison.skusOrdered.current - comparison.skusOrdered.previous}`],
      ['Avg Value / Unit',
        summary.avgValuePerUnit === null ? '—' : formatRM(summary.avgValuePerUnit),
        comparison.avgValuePerUnit.previous === null ? '—' : formatRM(comparison.avgValuePerUnit.previous),
        formatGrowth(comparison.avgValuePerUnit.changePct)],
    ],
    columnStyles: {
      0: { cellWidth: contentWidth * 0.34, fontStyle: 'bold' },
      1: { cellWidth: contentWidth * 0.22, halign: 'right' },
      2: { cellWidth: contentWidth * 0.22, halign: 'right' },
      3: { cellWidth: contentWidth * 0.22, halign: 'right' },
    },
  })

  // Category Performance is a comparison BETWEEN categories, so it belongs only
  // on the consolidated report; a drill-down PDF omits it entirely.
  if (report.categoryPerformance && report.categoryPerformance.length > 0) {
    sectionBand('CATEGORY PERFORMANCE', `${period.rangeLabel} vs ${period.comparisonRangeLabel}`)
    runTable({
      head: [['Category', 'Units Ordered', 'Order Value', 'SKUs Ordered', 'Share', 'vs Previous']],
      body: report.categoryPerformance.map((row) => [
        row.categoryName,
        formatCount(row.unitsOrdered),
        formatRM(row.orderValue),
        `${formatCount(row.skusOrdered)} of ${formatCount(row.activeSkus)}`,
        row.valueSharePct === null ? '—' : `${row.valueSharePct.toFixed(1)}%`,
        formatGrowth(row.changePct),
      ]),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.28, fontStyle: 'bold' },
        1: { cellWidth: contentWidth * 0.15, halign: 'right' },
        2: { cellWidth: contentWidth * 0.18, halign: 'right' },
        3: { cellWidth: contentWidth * 0.16, halign: 'right' },
        4: { cellWidth: contentWidth * 0.11, halign: 'right' },
        5: { cellWidth: contentWidth * 0.12, halign: 'right' },
      },
    })
  }

  // ══ PAGE 2 — PERFORMANCE ═══════════════════════════════════════════════
  newPage()
  sectionBand('DAILY PRODUCT DEMAND TREND', period.rangeLabel)
  if (report.dailyTrend.length === 0) {
    emptyNote('No days in the selected report period.')
  } else {
    // A drawn bar/line chart, not a screenshot: units as bars, order value as a
    // line, both read from the same daily rows the web chart uses.
    const chartH = 44
    ensureSpace(chartH + 10)
    const maxUnits = Math.max(...report.dailyTrend.map((row) => row.units), 1)
    const maxValue = Math.max(...report.dailyTrend.map((row) => row.orderValue), 1)
    const chartW = contentWidth
    const barSlot = chartW / report.dailyTrend.length
    const barW = Math.max(Math.min(barSlot * 0.55, 8), 1)
    const baseY = y + chartH

    doc.setDrawColor(...BOX_BORDER)
    doc.line(margin, baseY, margin + chartW, baseY)

    report.dailyTrend.forEach((row, index) => {
      const cx = margin + index * barSlot + barSlot / 2
      const h = (row.units / maxUnits) * (chartH - 4)
      doc.setFillColor(...ORANGE)
      doc.rect(cx - barW / 2, baseY - h, barW, h, 'F')
      if (index === 0 || index === report.dailyTrend.length - 1 || index % Math.ceil(report.dailyTrend.length / 10) === 0) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.5)
        doc.setTextColor(...MUTED)
        doc.text(row.label, cx, baseY + 3.5, { align: 'center' })
      }
    })

    doc.setDrawColor(...INK)
    doc.setLineWidth(0.4)
    report.dailyTrend.forEach((row, index) => {
      if (index === 0) return
      const prev = report.dailyTrend[index - 1]
      const x1 = margin + (index - 1) * barSlot + barSlot / 2
      const x2 = margin + index * barSlot + barSlot / 2
      const y1 = baseY - (prev.orderValue / maxValue) * (chartH - 4)
      const y2 = baseY - (row.orderValue / maxValue) * (chartH - 4)
      doc.line(x1, y1, x2, y2)
    })
    doc.setLineWidth(0.2)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text(
      `Bars: units ordered (peak ${formatCount(maxUnits)})   ·   Line: order value (peak ${formatRM(maxValue)})`,
      margin, y - 2,
    )
    y = baseY + 9
  }

  sectionBand('TOP PRODUCTS / VARIANTS', 'Ranked by units ordered in the report period')
  if (report.topProducts.byUnits.length === 0) {
    emptyNote('No products were ordered in the selected report period.')
  } else {
    runTable({
      head: [['#', 'Product / Variant', 'Units', 'Order Value', 'Share', 'vs Previous']],
      body: report.topProducts.byUnits.map((row) => [
        String(row.rank),
        row.label,
        formatCount(row.currentUnits),
        formatRM(row.currentValue),
        row.unitsSharePct === null ? '—' : `${row.unitsSharePct.toFixed(1)}%`,
        formatGrowth(row.growthPct),
      ]),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.05, halign: 'center' },
        1: { cellWidth: contentWidth * 0.39 },
        2: { cellWidth: contentWidth * 0.12, halign: 'right' },
        3: { cellWidth: contentWidth * 0.18, halign: 'right' },
        4: { cellWidth: contentWidth * 0.11, halign: 'right' },
        5: { cellWidth: contentWidth * 0.15, halign: 'right' },
      },
    })
  }

  sectionBand('PRODUCT CONTRIBUTION', `Concentration of ${formatRM(report.productContribution.totalOrderValue)} order value`)
  runTable({
    head: [['Band', 'SKUs', 'Order Value', 'Share of Period']],
    body: report.productContribution.bands.map((band) => [
      band.label,
      formatCount(band.skus),
      formatRM(band.orderValue),
      band.sharePct === null ? '—' : `${band.sharePct.toFixed(1)}%`,
    ]),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.34, fontStyle: 'bold' },
      1: { cellWidth: contentWidth * 0.16, halign: 'right' },
      2: { cellWidth: contentWidth * 0.25, halign: 'right' },
      3: { cellWidth: contentWidth * 0.25, halign: 'right' },
    },
  })

  // ══ PAGE 3 — INVENTORY & ACTIONS ═══════════════════════════════════════
  newPage()
  sectionBand('PRODUCTS REQUIRING ATTENTION', `${period.rangeLabel} vs ${period.comparisonRangeLabel}`)
  if (report.attentionProducts.length === 0) {
    emptyNote('No products required attention in the selected report period.')
  } else {
    runTable({
      head: [['#', 'Product / Variant', 'Current', 'Previous', 'Change', 'Current Stock', 'Last Order', 'Status']],
      body: report.attentionProducts.map((row, index) => [
        String(index + 1),
        row.label,
        formatCount(row.currentUnits),
        formatCount(row.previousUnits),
        formatGrowth(row.growthPct),
        formatCount(row.currentStock),
        formatDay(row.lastOrderedAt),
        row.status,
      ]),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.04, halign: 'center' },
        1: { cellWidth: contentWidth * 0.29 },
        2: { cellWidth: contentWidth * 0.09, halign: 'right' },
        3: { cellWidth: contentWidth * 0.09, halign: 'right' },
        4: { cellWidth: contentWidth * 0.09, halign: 'right' },
        5: { cellWidth: contentWidth * 0.12, halign: 'right' },
        6: { cellWidth: contentWidth * 0.14 },
        7: { cellWidth: contentWidth * 0.14 },
      },
    })
  }

  sectionBand(
    'CURRENT INVENTORY SNAPSHOT',
    `Stock as at ${formatDateTime(report.inventorySnapshot.asOf ?? generatedAt)} — independent of the selected reporting month`,
  )
  kpiRow([
    {
      label: 'Total Inventory Value',
      value: formatRM(report.inventorySnapshot.totalValue),
      note: `${formatCount(report.inventorySnapshot.totalOnHand)} units across ${formatCount(report.inventorySnapshot.variantCount)} stocked SKUs`,
    },
    ...report.inventorySnapshot.categories.slice(0, 3).map((category) => ({
      label: category.label,
      value: formatCount(category.skus),
      note: `${formatCount(category.units)} units · ${formatRM(category.value)}`,
    })),
  ])
  runTable({
    head: [['Stock Health', 'SKUs', 'Units', 'Stock Value', 'Rule']],
    body: report.inventorySnapshot.categories.map((category) => [
      category.label,
      formatCount(category.skus),
      formatCount(category.units),
      formatRM(category.value),
      category.description,
    ]),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.2, fontStyle: 'bold' },
      1: { cellWidth: contentWidth * 0.09, halign: 'right' },
      2: { cellWidth: contentWidth * 0.11, halign: 'right' },
      3: { cellWidth: contentWidth * 0.16, halign: 'right' },
      4: { cellWidth: contentWidth * 0.44 },
    },
  })

  sectionBand(
    'MANAGEMENT ACTION PLAN',
    report.managementActions.summary.map((card) => `${card.label}: ${card.count}`).join('   ·   '),
  )
  if (report.managementActions.rows.length === 0) {
    emptyNote('No management actions were raised for the selected report period.')
  } else {
    const actionBody = (row: ProductRow) => [
      row.actionPriority,
      row.label,
      formatCount(row.currentUnits),
      formatCount(row.previousUnits),
      formatGrowth(row.growthPct),
      formatCount(row.currentStock),
      STOCK_LABEL[row.stockStatus] ?? row.stockStatus,
      ACTION_LABEL[row.action as ActionKey],
    ]
    runTable({
      head: [['Priority', 'Product / Variant', 'Current', 'Previous', 'Demand Change', 'Current Stock', 'Stock Status', 'Recommended Action']],
      body: report.managementActions.rows.map(actionBody),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.08, fontStyle: 'bold' },
        1: { cellWidth: contentWidth * 0.26 },
        2: { cellWidth: contentWidth * 0.08, halign: 'right' },
        3: { cellWidth: contentWidth * 0.08, halign: 'right' },
        4: { cellWidth: contentWidth * 0.12, halign: 'right' },
        5: { cellWidth: contentWidth * 0.11, halign: 'right' },
        6: { cellWidth: contentWidth * 0.1 },
        7: { cellWidth: contentWidth * 0.17 },
      },
    })
  }

  // ── Page chrome ────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page)
    if (page > 1) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      doc.text('SERAPOD PRODUCT PERFORMANCE REPORT', margin, 12)
      doc.setTextColor(...ORANGE)
      doc.text(
        `${category.isAll ? '' : `${category.name} · `}${period.label} · ${period.rangeLabel}`,
        pageWidth - margin, 12, { align: 'right' },
      )
      doc.setDrawColor(...BOX_BORDER)
      doc.line(margin, 15, pageWidth - margin, 15)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text('Generated from Serapod2U', margin, pageHeight - 5)
    doc.text(`Generated: ${formatDateTime(generatedAt)} (MYT)`, pageWidth / 2, pageHeight - 5, { align: 'center' })
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: 'right' })
  }

  const blob = doc.output('blob')
  return { blob, filename: productReportFilename(period, category), size: blob.size }
}
