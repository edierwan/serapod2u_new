import { RETURN_STATUS_LABELS } from './constants'
import type { ReturnCase } from './types'

/**
 * Generate the Return form PDF from a return case, entirely client-side using
 * jsPDF + jspdf-autotable (already project dependencies). A QR/barcode of the
 * return number is embedded when the `qrcode` utility is available; otherwise
 * the layout simply omits it (space is kept ready).
 */
export async function generateReturnPdf(
    rc: ReturnCase,
    opts: { instructionText?: string | null; preview?: boolean } = {},
): Promise<void> {
    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ])
    const autoTable = autoTableModule.default
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()

    // ── Header ────────────────────────────────────────────────────────────
    doc.setFontSize(18)
    doc.setTextColor(20)
    doc.text('Product Return Form', 14, 18)

    doc.setFontSize(11)
    doc.setTextColor(90)
    doc.text(`Return No: ${rc.return_no}`, 14, 26)
    doc.text(`Status: ${RETURN_STATUS_LABELS[rc.status] || rc.status}`, 14, 32)
    doc.text(`Created: ${formatDate(rc.created_at)}`, 14, 38)
    if (rc.created_by_name) doc.text(`Created By: ${rc.created_by_name}`, 14, 44)

    // ── QR (optional) ─────────────────────────────────────────────────────
    try {
        const QR = (await import('qrcode')).default as any
        const dataUrl: string = await QR.toDataURL(rc.return_no, { margin: 1, width: 120 })
        doc.addImage(dataUrl, 'PNG', pageWidth - 46, 12, 32, 32)
    } catch {
        // QR utility unavailable — keep layout, skip QR.
    }

    // ── Shop / Warehouse block ────────────────────────────────────────────
    const shop = rc.shop
    const wh = rc.warehouse
    autoTable(doc, {
        startY: 50,
        head: [['Return From (Shop)', 'Return To (Warehouse)']],
        body: [[
            [
                shop?.org_name || '—',
                shop?.org_code ? `Code: ${shop.org_code}` : '',
                rc.contact_person ? `Contact: ${rc.contact_person}` : (shop?.contact_name ? `Contact: ${shop.contact_name}` : ''),
                rc.contact_phone ? `Phone: ${rc.contact_phone}` : (shop?.contact_phone ? `Phone: ${shop.contact_phone}` : ''),
                [shop?.address, shop?.city, shop?.postal_code].filter(Boolean).join(', '),
            ].filter(Boolean).join('\n'),
            [
                wh?.org_name || '—',
                wh?.org_code ? `Code: ${wh.org_code}` : '',
                wh?.contact_name ? `Contact: ${wh.contact_name}` : '',
                wh?.contact_phone ? `Phone: ${wh.contact_phone}` : '',
                [wh?.address, wh?.city, wh?.postal_code].filter(Boolean).join(', '),
            ].filter(Boolean).join('\n'),
        ]],
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 9, cellPadding: 3, valign: 'top' },
        columnStyles: { 0: { cellWidth: (pageWidth - 28) / 2 }, 1: { cellWidth: (pageWidth - 28) / 2 } },
    })

    // ── Items ─────────────────────────────────────────────────────────────
    const items = rc.items || []
    let totalQty = 0
    let totalValue = 0
    const body = items.map((it, i) => {
        const qty = Number(it.quantity || 0)
        const cost = Number(it.unit_cost || 0)
        totalQty += qty
        totalValue += qty * cost
        return [
            String(i + 1),
            it.product_name || '—',
            [it.variant_name, it.sku].filter(Boolean).join(' / ') || '—',
            String(qty),
            cost.toFixed(2),
            it.reason || '—',
            it.condition || '—',
        ]
    })

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 6,
        head: [['No', 'Product', 'Variant / SKU', 'Qty', 'Unit Cost (RM)', 'Reason', 'Condition']],
        body: body.length > 0 ? body : [['—', 'No items', '—', '—', '—', '—', '—']],
        foot: [['', 'Total', '', String(totalQty), totalValue.toFixed(2), '', '']],
        headStyles: { fillColor: [37, 99, 235] },
        footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 2.5 },
    })

    let y = (doc as any).lastAutoTable.finalY + 8

    // ── Notes ─────────────────────────────────────────────────────────────
    if (rc.notes) {
        doc.setFontSize(11)
        doc.setTextColor(20)
        doc.text('Additional Notes', 14, y)
        y += 5
        doc.setFontSize(9)
        doc.setTextColor(80)
        const lines = doc.splitTextToSize(rc.notes, pageWidth - 28)
        doc.text(lines, 14, y)
        y += lines.length * 4 + 6
    }

    // ── Instruction text ──────────────────────────────────────────────────
    if (opts.instructionText) {
        doc.setDrawColor(200)
        doc.line(14, y, pageWidth - 14, y)
        y += 5
        doc.setFontSize(8)
        doc.setTextColor(120)
        const lines = doc.splitTextToSize(opts.instructionText, pageWidth - 28)
        doc.text(lines, 14, y)
    }

    if (opts.preview) {
        const url = doc.output('bloburl')
        window.open(url as unknown as string, '_blank')
    } else {
        doc.save(`${rc.return_no}.pdf`)
    }
}

function formatDate(value?: string | null): string {
    if (!value) return '—'
    try {
        return new Date(value).toLocaleString('en-MY', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
    } catch {
        return value
    }
}
