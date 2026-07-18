import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { extractFlavour, transferStatusLabel } from './stock-transfer'

export interface TransferNoteParty {
  orgCode: string
  orgName: string
}

export interface TransferNoteLine {
  productName: string
  variantName: string
  configLabel: string
  stockSku: string
  quantity: number
}

export interface TransferNoteInput {
  transferNo: string
  status: string
  from: TransferNoteParty
  to: TransferNoteParty
  requiredDate?: string | null
  notes?: string | null
  requestedBy?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  shippedAt?: string | null
  receivedBy?: string | null
  receivedAt?: string | null
  createdAt?: string | null
  lines: TransferNoteLine[]
}

function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function buildTransferNotePdf(input: TransferNoteInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  let y = 48

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Transfer Note', margin, y)
  y += 22

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`Transfer Reference: ${input.transferNo}`, margin, y)
  y += 16
  doc.text(`Status: ${transferStatusLabel(input.status)}`, margin, y)
  y += 16
  doc.text(`From: ${input.from.orgName} (${input.from.orgCode})`, margin, y)
  y += 16
  doc.text(`To: ${input.to.orgName} (${input.to.orgCode})`, margin, y)
  y += 16
  doc.text(`Required Date: ${input.requiredDate || '—'}`, margin, y)
  y += 16
  doc.text(`Requested: ${fmtDate(input.createdAt)} by ${input.requestedBy || '—'}`, margin, y)
  y += 16
  doc.text(`Approved: ${fmtDate(input.approvedAt)} by ${input.approvedBy || '—'}`, margin, y)
  y += 16
  doc.text(`Dispatch: ${fmtDate(input.shippedAt)}`, margin, y)
  y += 16
  doc.text(`Received: ${fmtDate(input.receivedAt)} by ${input.receivedBy || '—'}`, margin, y)
  y += 20

  if (input.notes) {
    doc.text(`Notes: ${input.notes}`, margin, y, { maxWidth: 515 })
    y += 28
  }

  autoTable(doc, {
    startY: y,
    head: [['Product / Flavour', 'Configuration', 'Stock SKU', 'Qty']],
    body: input.lines.map((line) => [
      `${line.productName} / ${extractFlavour(line.variantName)}`,
      line.configLabel,
      line.stockSku,
      String(line.quantity),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [30, 64, 175] },
    margin: { left: margin, right: margin },
  })

  const finalY = ((doc as any).lastAutoTable?.finalY || y) + 36
  doc.setFont('helvetica', 'bold')
  doc.text('Acknowledgement', margin, finalY)
  doc.setFont('helvetica', 'normal')
  doc.text('Source warehouse signature: ______________________    Date: ________', margin, finalY + 24)
  doc.text('Destination warehouse signature: _________________    Date: ________', margin, finalY + 48)

  return doc
}

export function downloadTransferNotePdf(input: TransferNoteInput, filename?: string) {
  const doc = buildTransferNotePdf(input)
  doc.save(filename || `${input.transferNo}-transfer-note.pdf`)
}

export function transferNoteLinesFromItems(items: unknown): TransferNoteLine[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => ({
    productName: String(item?.product_name || 'Product'),
    variantName: String(item?.variant_name || ''),
    configLabel: String(item?.config_label || item?.stock_sku || 'Configuration'),
    stockSku: String(item?.stock_sku || '—'),
    quantity: Number(item?.quantity || 0),
  }))
}
