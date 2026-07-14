/**
 * Return Product Management Report — branded A4 PDF.
 *
 * Built entirely from the dashboard summary payload (the same JSON that renders
 * the on-screen report), so Preview, Download and the Email attachment are all
 * the exact same document. Generated with jsPDF + jspdf-autotable (existing
 * project dependencies) and the approved Serapod header/footer banner assets.
 */
import { RETURN_STATUS_LABELS, RETURN_SOURCE_LABELS } from './constants'
import {
    reportFilename, deltaText, formatRM, formatCount,
    type ReturnReportSummary, type ReportCaseRow, type KpiDelta,
} from './reporting'
import { loadImageDataUrl, type LoadedImage } from './pdf'

const ASSET_BASE = '/images/serapod-return-pdf-assets'

// Palette (matches the Product Return Note PDF).
const INK: [number, number, number] = [26, 26, 26]
const MUTED: [number, number, number] = [120, 120, 120]
const ORANGE: [number, number, number] = [219, 109, 44]
const BAND: [number, number, number] = [243, 238, 230]
const BAND_BORDER: [number, number, number] = [226, 219, 205]
const BOX_BORDER: [number, number, number] = [222, 222, 222]
const BOX_FILL: [number, number, number] = [249, 250, 251]
const STRIPE: [number, number, number] = [248, 248, 248]
const POSITIVE: [number, number, number] = [22, 128, 61]
const NEGATIVE: [number, number, number] = [185, 28, 28]
const BAR: [number, number, number] = [59, 130, 246]

function formatDateTime(value?: string | null): string {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDate(value?: string | null): string {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface ReturnReportPdfInput {
    summary: ReturnReportSummary
    cases: ReportCaseRow[]
    generatedBy: string | null
}

export interface ReturnReportPdf {
    blob: Blob
    filename: string
    /** Attachment size in bytes. */
    size: number
}

/** Build the management report PDF and return it as a Blob (single source for preview / download / email). */
export async function buildReturnReportPdf(input: ReturnReportPdfInput): Promise<ReturnReportPdf> {
    const { summary, cases, generatedBy } = input
    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ])
    const autoTable = autoTableModule.default
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 12
    const contentWidth = pageWidth - margin * 2

    let header: LoadedImage | null = null
    let footer: LoadedImage | null = null
    try { header = await loadImageDataUrl(`${ASSET_BASE}/serapod-return-header.png`) } catch { /* optional */ }
    try { footer = await loadImageDataUrl(`${ASSET_BASE}/Footer.png`, true) } catch { /* optional */ }

    const headerImgH = header ? contentWidth * (header.h / header.w) : 0
    const footerImgH = footer ? contentWidth * (footer.h / footer.w) : 0
    const CONTINUE_TOP = 20
    const PAGENUM_BAND = 8
    const FOOTER_RESERVE = (footerImgH || 12) + PAGENUM_BAND + 4
    const footerTopY = pageHeight - PAGENUM_BAND - (footerImgH || 12)
    const contentBottom = pageHeight - FOOTER_RESERVE

    const ensureSpace = (needed: number) => {
        if (y + needed > contentBottom) {
            doc.addPage()
            y = CONTINUE_TOP
        }
    }

    const sectionBand = (title: string, note?: string) => {
        ensureSpace(8 + 18)
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
        y += 10
    }

    const emptyNote = (text: string) => {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(...MUTED)
        doc.text(text, margin + 1, y + 2)
        y += 8
    }

    const tableDefaults = {
        theme: 'grid' as const,
        headStyles: { fillColor: INK, textColor: 255 as any, fontStyle: 'bold' as const, fontSize: 8, cellPadding: 2 },
        styles: { fontSize: 8, cellPadding: 2, textColor: INK, lineColor: [225, 225, 225] as any, lineWidth: 0.1 },
        alternateRowStyles: { fillColor: STRIPE as any },
        margin: { left: margin, right: margin, top: CONTINUE_TOP, bottom: FOOTER_RESERVE },
        tableWidth: contentWidth,
    }

    const runTable = (options: any) => {
        autoTable(doc, { ...tableDefaults, startY: y, ...options })
        y = ((doc as any).lastAutoTable?.finalY ?? y) + 6
    }

    // ── Page 1: banner + title ──────────────────────────────────────────────
    let y = 10
    if (header && headerImgH > 0) {
        try { doc.addImage(header.url, 'PNG', margin, y, contentWidth, headerImgH) } catch { /* skip */ }
        y += headerImgH + 6
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...INK)
    doc.text('RETURN PRODUCT MANAGEMENT REPORT', margin, y + 4)
    doc.setFontSize(10)
    doc.setTextColor(...ORANGE)
    doc.text(`Period: ${summary.periodLabel}`, pageWidth - margin, y + 4, { align: 'right' })
    y += 9
    doc.setDrawColor(...BAND_BORDER)
    doc.line(margin, y, pageWidth - margin, y)
    y += 5

    // ── Report information box ──────────────────────────────────────────────
    const f = summary.filters
    const infoPairs: Array<[string, string]> = [
        ['REPORT MODE', summary.period.mode === 'monthly' ? 'Monthly' : 'Quarterly'],
        ['REPORT PERIOD', summary.periodLabel],
        ['COMPARED WITH', summary.comparisonLabel],
        ['GENERATED', formatDateTime(summary.generatedAt)],
        ['GENERATED BY', generatedBy || '—'],
        ['SOURCE TYPE', f.sourceType ? RETURN_SOURCE_LABELS[f.sourceType] : 'All Types'],
        ['RETURN FROM', f.sourceName || 'All Sources'],
        ['WAREHOUSE', f.warehouseName || 'All Warehouses'],
        ['REASON', f.reasonLabel || 'All Reasons'],
        ['STATUS', f.statusLabel || 'All Status'],
    ]
    const infoRowH = 6.5
    const rowsPerCol = Math.ceil(infoPairs.length / 2)
    const infoH = infoRowH * rowsPerCol + 8
    doc.setDrawColor(...BOX_BORDER)
    doc.setFillColor(...BOX_FILL)
    doc.roundedRect(margin, y, contentWidth, infoH, 2, 2, 'FD')
    const colGap = contentWidth / 2
    infoPairs.forEach(([label, value], i) => {
        const col = Math.floor(i / rowsPerCol)
        const row = i % rowsPerCol
        const lx = margin + 4 + col * colGap
        const ly = y + 8 + row * infoRowH
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(...MUTED)
        doc.text(label, lx, ly)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK)
        const lines = doc.splitTextToSize(value, colGap - 34)
        doc.text(lines[0], lx + 28, ly)
    })
    y += infoH + 6

    // ── KPI summary cards ───────────────────────────────────────────────────
    const kpiCards: Array<{ label: string; value: string; delta: KpiDelta; negativeIsBad: boolean | null }> = [
        { label: 'TOTAL RETURNS', value: formatCount(summary.kpis.totalReturns), delta: summary.deltas.totalReturns, negativeIsBad: null },
        { label: 'TOTAL QUANTITY', value: `${formatCount(summary.kpis.totalQty)} pcs`, delta: summary.deltas.totalQty, negativeIsBad: null },
        { label: 'TOTAL VALUE', value: formatRM(summary.kpis.totalValue), delta: summary.deltas.totalValue, negativeIsBad: null },
        { label: 'AVG RETURN VALUE', value: formatRM(summary.kpis.avgValue), delta: summary.deltas.avgValue, negativeIsBad: null },
        { label: 'OVERDUE RETURNS', value: formatCount(summary.kpis.overdue), delta: summary.deltas.overdue, negativeIsBad: false },
        { label: 'COMPLETION RATE', value: `${summary.kpis.completionRate.toFixed(1)}%`, delta: summary.deltas.completionRate, negativeIsBad: true },
    ]
    const cardGap = 4
    const cardW = (contentWidth - cardGap * 2) / 3
    const cardH = 21
    ensureSpace(cardH * 2 + cardGap + 4)
    kpiCards.forEach((card, i) => {
        const cx = margin + (i % 3) * (cardW + cardGap)
        const cy = y + Math.floor(i / 3) * (cardH + cardGap)
        doc.setDrawColor(...BOX_BORDER)
        doc.setFillColor(...BOX_FILL)
        doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        doc.setTextColor(...MUTED)
        doc.text(card.label, cx + 4, cy + 5.5)
        doc.setFontSize(13)
        doc.setTextColor(...INK)
        doc.text(card.value, cx + 4, cy + 12.5)
        // Comparison line: overdue up = bad (red), completion down = bad; the
        // rest are informational (neutral ink).
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        let color: [number, number, number] = MUTED
        if (card.delta.direction !== 'flat' && card.negativeIsBad !== null) {
            const isGood = card.negativeIsBad ? card.delta.direction === 'up' : card.delta.direction === 'down'
            color = isGood ? POSITIVE : NEGATIVE
        }
        doc.setTextColor(...color)
        doc.text(deltaText(card.delta, summary.comparisonLabel), cx + 4, cy + 17.5)
    })
    y += cardH * 2 + cardGap + 8

    const noData = summary.kpis.totalReturns === 0

    // ── Return trend ────────────────────────────────────────────────────────
    sectionBand('RETURN TREND', summary.period.mode === 'monthly' ? `Monthly, ${summary.period.year}` : 'Last 8 quarters')
    const trendMax = Math.max(...summary.trend.map((t) => t.qty), 1)
    const chartH = 34
    ensureSpace(chartH + 12)
    // Simple deterministic bar chart drawn with rects (no screenshotting).
    const slotW = contentWidth / summary.trend.length
    const barW = Math.min(10, slotW * 0.55)
    doc.setDrawColor(...BOX_BORDER)
    doc.line(margin, y + chartH, margin + contentWidth, y + chartH)
    summary.trend.forEach((t, i) => {
        const bx = margin + i * slotW + (slotW - barW) / 2
        const bh = trendMax > 0 ? (t.qty / trendMax) * (chartH - 6) : 0
        if (bh > 0) {
            doc.setFillColor(...BAR)
            doc.rect(bx, y + chartH - bh, barW, bh, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.8)
        doc.setTextColor(...MUTED)
        doc.text(t.label, bx + barW / 2, y + chartH + 3.5, { align: 'center' })
        if (t.qty > 0) {
            doc.setTextColor(...INK)
            doc.text(formatCount(t.qty), bx + barW / 2, y + chartH - bh - 1.2, { align: 'center' })
        }
    })
    y += chartH + 8
    runTable({
        head: [['Period', 'Return Cases', 'Quantity (pcs)', 'Value']],
        body: summary.trend.map((t) => [t.label, formatCount(t.cases), formatCount(t.qty), formatRM(t.value)]),
        columnStyles: {
            0: { cellWidth: contentWidth * 0.31 },
            1: { cellWidth: contentWidth * 0.23, halign: 'right' },
            2: { cellWidth: contentWidth * 0.23, halign: 'right' },
            3: { cellWidth: contentWidth * 0.23, halign: 'right' },
        },
    })

    // ── Returns by reason ───────────────────────────────────────────────────
    sectionBand('RETURNS BY REASON')
    if (summary.byReason.length === 0) {
        emptyNote('No data available for this period.')
    } else {
        runTable({
            head: [['Reason', 'Cases', 'Quantity (pcs)', 'Value', '% of Value']],
            body: summary.byReason.map((r) => [r.label, formatCount(r.cases), formatCount(r.qty), formatRM(r.value), `${r.pct.toFixed(1)}%`]),
            columnStyles: {
                0: { cellWidth: contentWidth * 0.34 },
                1: { cellWidth: contentWidth * 0.13, halign: 'right' },
                2: { cellWidth: contentWidth * 0.18, halign: 'right' },
                3: { cellWidth: contentWidth * 0.20, halign: 'right' },
                4: { cellWidth: contentWidth * 0.15, halign: 'right' },
            },
        })
    }

    // ── Top return sources ──────────────────────────────────────────────────
    sectionBand('TOP RETURN SOURCES', 'Top 10 by return cases')
    if (summary.bySource.length === 0) {
        emptyNote('No data available for this period.')
    } else {
        runTable({
            head: [['Return From', 'Source Type', 'Cases', 'Quantity (pcs)', 'Value', '% of Cases']],
            body: summary.bySource.slice(0, 10).map((s) => [
                s.code ? `${s.name} (${s.code})` : s.name,
                RETURN_SOURCE_LABELS[s.sourceType],
                formatCount(s.cases), formatCount(s.qty), formatRM(s.value), `${s.pct.toFixed(1)}%`,
            ]),
            columnStyles: {
                0: { cellWidth: contentWidth * 0.32 },
                1: { cellWidth: contentWidth * 0.14 },
                2: { cellWidth: contentWidth * 0.10, halign: 'right' },
                3: { cellWidth: contentWidth * 0.15, halign: 'right' },
                4: { cellWidth: contentWidth * 0.17, halign: 'right' },
                5: { cellWidth: contentWidth * 0.12, halign: 'right' },
            },
        })
    }

    // ── Warehouse summary ───────────────────────────────────────────────────
    sectionBand('RETURNS BY WAREHOUSE')
    if (summary.byWarehouse.length === 0) {
        emptyNote('No data available for this period.')
    } else {
        runTable({
            head: [['Warehouse', 'Cases', 'Quantity (pcs)', 'Value', '% of Value']],
            body: summary.byWarehouse.map((w) => [w.name, formatCount(w.cases), formatCount(w.qty), formatRM(w.value), `${w.pct.toFixed(1)}%`]),
            foot: [[
                'Total',
                formatCount(summary.kpis.totalReturns),
                formatCount(summary.kpis.totalQty),
                formatRM(summary.kpis.totalValue),
                '',
            ]],
            footStyles: { fillColor: [255, 255, 255] as any, textColor: INK as any, fontStyle: 'bold' as const, fontSize: 8 },
            columnStyles: {
                0: { cellWidth: contentWidth * 0.34 },
                1: { cellWidth: contentWidth * 0.13, halign: 'right' },
                2: { cellWidth: contentWidth * 0.18, halign: 'right' },
                3: { cellWidth: contentWidth * 0.20, halign: 'right' },
                4: { cellWidth: contentWidth * 0.15, halign: 'right' },
            },
        })
    }

    // ── Product summary ─────────────────────────────────────────────────────
    sectionBand('RETURNS BY PRODUCT', 'Top 10 by returned quantity')
    if (summary.byProduct.length === 0) {
        emptyNote('No data available for this period.')
    } else {
        runTable({
            head: [['Product / Variant', 'Quantity (pcs)', 'Value', 'Main Reason']],
            body: summary.byProduct.slice(0, 10).map((p) => [p.name, formatCount(p.qty), formatRM(p.value), p.topReason || '—']),
            columnStyles: {
                0: { cellWidth: contentWidth * 0.46 },
                1: { cellWidth: contentWidth * 0.16, halign: 'right' },
                2: { cellWidth: contentWidth * 0.18, halign: 'right' },
                3: { cellWidth: contentWidth * 0.20 },
            },
        })
    }

    // ── Key insights ────────────────────────────────────────────────────────
    sectionBand('KEY INSIGHTS')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    for (const insight of summary.insights) {
        const lines = doc.splitTextToSize(`•  ${insight}`, contentWidth - 4)
        ensureSpace(lines.length * 4.4 + 2)
        doc.text(lines, margin + 1, y + 2)
        y += lines.length * 4.4 + 1.5
    }
    y += 4

    // ── Detailed returns ────────────────────────────────────────────────────
    sectionBand('DETAILED RETURNS', `${cases.length} return case(s)`)
    if (noData || cases.length === 0) {
        emptyNote(`No Return Product activity was recorded for ${summary.periodLabel}.`)
    } else {
        runTable({
            head: [['Return No', 'Type', 'Return From', 'Warehouse', 'Status', 'Qty', 'Value', 'Created', 'Days', 'Overdue']],
            body: cases.map((r) => [
                r.return_no,
                RETURN_SOURCE_LABELS[r.return_source_type],
                r.source_name || '—',
                r.warehouse_name || '—',
                RETURN_STATUS_LABELS[r.status] || r.status,
                formatCount(r.total_qty),
                formatRM(r.total_value),
                formatDate(r.created_at),
                String(r.days_open),
                r.is_overdue ? 'Yes' : '—',
            ]),
            showHead: 'everyPage',
            styles: { ...tableDefaults.styles, fontSize: 7 },
            headStyles: { ...tableDefaults.headStyles, fontSize: 7 },
            columnStyles: {
                0: { cellWidth: contentWidth * 0.13 },
                1: { cellWidth: contentWidth * 0.07 },
                2: { cellWidth: contentWidth * 0.17 },
                3: { cellWidth: contentWidth * 0.16 },
                4: { cellWidth: contentWidth * 0.12 },
                5: { cellWidth: contentWidth * 0.06, halign: 'right' },
                6: { cellWidth: contentWidth * 0.11, halign: 'right' },
                7: { cellWidth: contentWidth * 0.09 },
                8: { cellWidth: contentWidth * 0.04, halign: 'right' },
                9: { cellWidth: contentWidth * 0.05 },
            },
        })
    }

    // ── Page chrome ─────────────────────────────────────────────────────────
    const totalPages = doc.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        if (p > 1) {
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9)
            doc.setTextColor(...INK)
            doc.text('RETURN PRODUCT MANAGEMENT REPORT', margin, 12)
            doc.setTextColor(...ORANGE)
            doc.text(summary.periodLabel, pageWidth - margin, 12, { align: 'right' })
            doc.setDrawColor(...BOX_BORDER)
            doc.line(margin, 15, pageWidth - margin, 15)
        }
        if (footer && footerImgH > 0) {
            try { doc.addImage(footer.url, 'PNG', margin, footerTopY, contentWidth, footerImgH) } catch { /* skip */ }
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...MUTED)
        doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 3, { align: 'right' })
    }

    const blob = doc.output('blob')
    return {
        blob,
        filename: reportFilename(summary.period, 'pdf'),
        size: blob.size,
    }
}
