import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface OrderData {
  order_no: string
  order_type: string
  status: string
  created_at: string
  approved_by?: string
  approved_at?: string
  payment_terms?: string
  estimated_eta?: string
  ship_to_location?: string
  ship_to_manager?: string
  approver?: {
    full_name: string
    role_name: string
    signature_url: string | null
  }
  approval_hash?: string
  approver_signature_image?: string | null
  buyer_org: {
    org_name: string
    address?: string
    contact_phone?: string
    contact_email?: string
  }
  seller_org: {
    org_name: string
    address?: string
    contact_phone?: string
    contact_email?: string
  }
  order_items: Array<{
    product?: { product_name: string; product_code: string }
    variant?: { variant_name: string }
    qty: number
    qty_cases?: number
    units_per_case?: number
    unit_price: number
    line_total: number
  }>
}

interface DocumentData {
  doc_no: string
  doc_type: string
  status: string
  created_at: string
  acknowledged_at?: string
  acknowledged_by?: string
  payment_terms?: string
  estimated_eta?: string
  acknowledger?: {
    full_name: string
    role_name: string
    signature_url: string | null
  }
  acknowledgement_hash?: string
  acknowledger_signature_image?: string | null
}

interface SignatureData {
  signer_name: string
  signer_role: string
  signed_at: string
  integrity_hash?: string
  signature_hash?: string
  signature_image_url: string | null
  signature_image_data?: string | null
}

export class PDFGenerator {
  private doc: jsPDF
  private signatures: SignatureData[]
  private pageWidth: number = 210 // A4 width in mm
  private margin: number = 15

  constructor(signatures: SignatureData[] = []) {
    this.doc = new jsPDF()
    this.signatures = signatures
  }

  private formatCurrency(amount: number | string): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return 'RM 0.00'
    return `RM ${numAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString)
    const day = date.getDate()
    const month = date.toLocaleDateString('en-MY', { month: 'short' })
    const year = date.getFullYear()
    return `${day} ${month} ${year}`
  }

  private format12HourTime(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleString('en-MY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  private async addCompanyLogo(yPosition: number): Promise<number> {
    const imgWidth = 40
    const imgHeight = 10
    const xPos = (this.pageWidth - imgWidth) / 2

    try {
      // When running on the server (API route), read the logo directly from disk
      if (typeof window === 'undefined') {
        const fs = await import('fs/promises')
        const path = await import('path')
        const logoPath = path.join(process.cwd(), 'docs', 'serapodlogo.png')

        try {
          const imageBuffer = await fs.readFile(logoPath)
          const base64data = `data:image/png;base64,${imageBuffer.toString('base64')}`
          this.doc.addImage(base64data, 'PNG', xPos, yPosition, imgWidth, imgHeight)
          return yPosition + imgHeight + 5
        } catch (fsError) {
          console.warn('Logo file missing or unreadable at', logoPath, fsError)
        }
      }

      // Fallback to fetching via browser if needed (e.g., client-side rendering)
      const response = await fetch('/docs/serapodlogo.png', { cache: 'no-store' })
      if (response.ok) {
        const blob = await response.blob()
        const reader = new FileReader()

        return await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            const base64data = reader.result as string
            this.doc.addImage(base64data, 'PNG', xPos, yPosition, imgWidth, imgHeight)
            resolve(yPosition + imgHeight + 5)
          }
          reader.onerror = () => reject(new Error('Failed to read logo blob'))
          reader.readAsDataURL(blob)
        })
      }

      console.warn('Logo fetch returned status', response.status)
    } catch (error) {
      console.error('Error loading logo:', error)
    }

    // Fallback to text if image fails to load
    this.doc.setFontSize(20)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('serapod', this.pageWidth / 2, yPosition, { align: 'center' })
    return yPosition + 10
  }

  private addDocumentHeader(title: string, yPosition: number): number {
    // Professional document title
    this.doc.setFontSize(16)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text(title, this.margin, yPosition)
    
    // Underline
    this.doc.setLineWidth(0.5)
    this.doc.line(this.margin, yPosition + 2, this.pageWidth - this.margin, yPosition + 2)
    
    return yPosition + 8
  }

  private addInfoTable(data: Array<{label: string, value: string}>, yPosition: number, columns: number = 2): number {
    const colWidth = (this.pageWidth - 2 * this.margin) / columns
    const rowHeight = 7
    let y = yPosition

    // Draw border
    const tableHeight = Math.ceil(data.length / columns) * rowHeight
    this.doc.setDrawColor(180, 180, 180)
    this.doc.setLineWidth(0.3)
    this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, tableHeight)

    // Draw grid lines
    for (let i = 0; i < data.length; i++) {
      const col = i % columns
      const row = Math.floor(i / columns)
      const x = this.margin + col * colWidth
      const cellY = y + row * rowHeight

      // Vertical divider
      if (col > 0) {
        this.doc.line(x, cellY, x, cellY + rowHeight)
      }
      
      // Horizontal divider
      if (row > 0 && col === 0) {
        this.doc.line(this.margin, cellY, this.pageWidth - this.margin, cellY)
      }

      // Label (bold)
      this.doc.setFontSize(9)
      this.doc.setFont('helvetica', 'bold')
      this.doc.setTextColor(0, 0, 0)
      this.doc.text(data[i].label + ':', x + 2, cellY + 5)

      // Value (normal)
      this.doc.setFont('helvetica', 'normal')
      const labelWidth = this.doc.getTextWidth(data[i].label + ': ')
      this.doc.text(data[i].value, x + 2 + labelWidth, cellY + 5)
    }

    return y + tableHeight + 5
  }

  private addPartiesSection(orderData: OrderData, yPosition: number, docType: string): number {
    let y = yPosition

    // PARTIES Section Header
    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('PARTIES', this.margin, y)
    y += 7

    // Table header
    const colWidths = [60, 60, 60]
    const startX = this.margin
    const tableWidth = this.pageWidth - 2 * this.margin
    
    // Header row
    this.doc.setFillColor(220, 220, 220)
    this.doc.rect(startX, y, tableWidth, 7, 'F')
    this.doc.setDrawColor(100, 100, 100)
    this.doc.setLineWidth(0.3)
    this.doc.rect(startX, y, tableWidth, 7)
    
    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'bold')
    
    // Column headers
    let colX = startX
    this.doc.text('BUYER (HQ)', colX + 2, y + 5)
    colX += colWidths[0]
    this.doc.line(colX, y, colX, y + 7)
    this.doc.text('SUPPLIER / MANUFACTURER', colX + 2, y + 5)
    colX += colWidths[1]
    this.doc.line(colX, y, colX, y + 7)
    this.doc.text('SHIP TO / DELIVERY LOCATION', colX + 2, y + 5)
    
    y += 7

    // Content row
    const contentHeight = 25
    this.doc.rect(startX, y, tableWidth, contentHeight)
    
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(8)
    
    // Buyer column
    colX = startX
    let textY = y + 4
    this.doc.text(orderData.buyer_org.org_name, colX + 2, textY, { maxWidth: colWidths[0] - 4 })
    if (orderData.buyer_org.address) {
      textY += 4
      this.doc.text(orderData.buyer_org.address.substring(0, 60), colX + 2, textY, { maxWidth: colWidths[0] - 4 })
    }
    if (orderData.buyer_org.contact_email) {
      textY += 4
      this.doc.text(`Email: ${orderData.buyer_org.contact_email}`, colX + 2, textY, { maxWidth: colWidths[0] - 4 })
    }
    if (orderData.buyer_org.contact_phone) {
      textY += 4
      this.doc.text(`Phone: ${orderData.buyer_org.contact_phone}`, colX + 2, textY, { maxWidth: colWidths[0] - 4 })
    }
    
    // Vertical line
    colX += colWidths[0]
    this.doc.line(colX, y, colX, y + contentHeight)
    
    // Seller column
    textY = y + 4
    this.doc.text(orderData.seller_org.org_name, colX + 2, textY, { maxWidth: colWidths[1] - 4 })
    if (orderData.seller_org.address) {
      textY += 4
      this.doc.text(orderData.seller_org.address.substring(0, 60), colX + 2, textY, { maxWidth: colWidths[1] - 4 })
    }
    if (orderData.seller_org.contact_email) {
      textY += 4
      this.doc.text(`Email: ${orderData.seller_org.contact_email}`, colX + 2, textY, { maxWidth: colWidths[1] - 4 })
    }
    if (orderData.seller_org.contact_phone) {
      textY += 4
      this.doc.text(`Phone: ${orderData.seller_org.contact_phone}`, colX + 2, textY, { maxWidth: colWidths[1] - 4 })
    }
    
    // Vertical line
    colX += colWidths[1]
    this.doc.line(colX, y, colX, y + contentHeight)
    
    // Ship to column
    textY = y + 4
    const shipToLocation = orderData.ship_to_location || 'Serapod2u Central Warehouse'
    this.doc.text(shipToLocation, colX + 2, textY, { maxWidth: colWidths[2] - 4 })
    if (orderData.ship_to_manager) {
      textY += 4
      this.doc.text(`Attn: ${orderData.ship_to_manager}`, colX + 2, textY, { maxWidth: colWidths[2] - 4 })
    }
    
    return y + contentHeight + 10
  }

  private addOrderLinesSection(orderData: OrderData, yPosition: number): number {
    let y = yPosition

    // ORDER LINES Section Header
    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('ORDER LINES', this.margin, y)
    y += 7

    // Prepare table data
    const tableData = orderData.order_items.map((item, index) => {
      // Combine product name with variant name
      let description = item.product?.product_name || 'Product'
      if (item.variant?.variant_name) {
        description += ` ${item.variant.variant_name}`
      }

      const qtyUnits = `${item.qty || 0} units`
      const qtyCases = item.qty_cases || Math.ceil((item.qty || 0) / (item.units_per_case || 100))
      
      return [
        (index + 1).toString(),
        item.product?.product_code || 'N/A',
        description,
        qtyUnits,
        qtyCases.toString(),
        this.formatCurrency(item.unit_price || 0),
        this.formatCurrency(item.line_total || 0)
      ]
    })

    autoTable(this.doc, {
      startY: y,
      head: [[
        '#',
        'Product Code',
        'Description',
        'Qty Units',
        'Qty Cases',
        'Unit (RM)',
        'Line Total (RM)'
      ]],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2,
        lineColor: [100, 100, 100],
        lineWidth: 0.3
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        halign: 'left',
        lineWidth: 0.3,
        lineColor: [100, 100, 100]
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 28 },
        2: { cellWidth: 60 },
        3: { cellWidth: 26, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 19, halign: 'right' },
        6: { cellWidth: 19, halign: 'right' }
      },
      margin: { left: this.margin, right: this.margin },
      tableWidth: this.pageWidth - 2 * this.margin
    })

    return (this.doc as any).lastAutoTable.finalY + 8
  }

  private addNotesSection(yPosition: number): number {
    let y = yPosition

    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Notes to Manufacturer:', this.margin, y)
    y += 5

    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(8)
    const notes = [
      '- Each master carton must include printed QR master + internal unit QRs.',
      '- First scan at shop will trigger reward points.',
      '- Do not mix flavors in the same carton.'
    ]
    
    notes.forEach(note => {
      this.doc.text(note, this.margin, y)
      y += 4
    })

    return y + 5
  }

  private addSummarySection(orderData: OrderData, yPosition: number): number {
    let y = yPosition

    // Calculate totals
    const subtotal = orderData.order_items.reduce((sum, item) => sum + (parseFloat(item.line_total.toString()) || 0), 0)
    const tax = subtotal * 0.00 // 0% tax as per image
    const grandTotal = subtotal + tax

    // SUMMARY Header
    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('SUMMARY', this.margin, y)
    y += 7

    // Summary table
  const summaryTableWidth = this.pageWidth - 2 * this.margin
  const labelColumnWidth = summaryTableWidth * 0.65
  const valueColumnWidth = summaryTableWidth - labelColumnWidth

    const summaryData = [
      ['Subtotal', this.formatCurrency(subtotal)],
      ['Discount / Campaign', 'RM 0.00'],
      ['Tax (0%)', this.formatCurrency(tax)]
    ]

    autoTable(this.doc, {
      startY: y,
      body: summaryData,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 2,
        lineColor: [100, 100, 100],
        lineWidth: 0.3
      },
      columnStyles: {
        0: { cellWidth: labelColumnWidth, halign: 'left', fontStyle: 'normal' },
        1: { cellWidth: valueColumnWidth, halign: 'right', fontStyle: 'normal' }
      },
      margin: { left: this.margin, right: this.margin },
      tableWidth: summaryTableWidth
    })

    const summaryTable = (this.doc as any).lastAutoTable
    y = summaryTable.finalY

    // Determine alignment using the rendered table metrics
  const tableMarginLeft = summaryTable?.settings?.margin?.left ?? this.margin
  const renderedTableWidth = summaryTable?.table?.width ?? this.pageWidth - 2 * this.margin
  const tableRight = tableMarginLeft + renderedTableWidth

    // Attempt to use the actual value column width from autoTable if available
    const valueColumn = summaryTable?.table?.columns?.find?.((col: any) => col.dataKey === 1) ??
      summaryTable?.table?.columns?.[1]
    const valueColumnRight = valueColumn ? valueColumn.x + valueColumn.width : tableRight

    // Grand Total row (label stays left, amount aligns right)
  this.doc.setFillColor(220, 220, 220)
  const spacingAfterTable = 6
  const grandTotalY = y + spacingAfterTable
  this.doc.rect(tableMarginLeft, grandTotalY, renderedTableWidth, 7, 'F')
    this.doc.setDrawColor(100, 100, 100)
  this.doc.rect(tableMarginLeft, grandTotalY, renderedTableWidth, 7)

    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('GRAND TOTAL', tableMarginLeft + 2, grandTotalY + 5)
    // Always align amount to the right edge of the table
    this.doc.text(
      this.formatCurrency(grandTotal),
      tableRight - 2,
      grandTotalY + 5,
      { align: 'right' }
    )

    return grandTotalY + 15
  }

  private async addSignaturesApprovalTrail(yPosition: number, orderData?: OrderData, documentData?: DocumentData): Promise<number> {
    let y = yPosition

    // Check if we need a new page - ensure enough space for both sections (about 120mm)
    if (y > 150) {
      this.doc.addPage()
      y = this.margin + 10
    }

    // SIGNATURES / APPROVAL TRAIL Header
    this.doc.setFontSize(11)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('SIGNATURES / APPROVAL TRAIL', this.margin, y)
    y += 7

    // Signature boxes
    for (const sig of this.signatures) {
      // Box border
      const boxHeight = 30
      this.doc.setDrawColor(100, 100, 100)
      this.doc.setLineWidth(0.3)
      this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, boxHeight)

      // Draw table-like structure
      const col1Width = 50
      const col2Width = this.pageWidth - 2 * this.margin - col1Width

      // Name row
      this.doc.line(this.margin, y + 7, this.pageWidth - this.margin, y + 7)
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Name:', this.margin + 2, y + 5)
      this.doc.setFont('helvetica', 'normal')
      this.doc.text(sig.signer_name, this.margin + col1Width + 2, y + 5)

      // Role row
      this.doc.line(this.margin, y + 14, this.pageWidth - this.margin, y + 14)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Role:', this.margin + 2, y + 12)
      this.doc.setFont('helvetica', 'normal')
      this.doc.text(sig.signer_role, this.margin + col1Width + 2, y + 12)

      // Signed At row
      this.doc.line(this.margin, y + 21, this.pageWidth - this.margin, y + 21)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Signed At:', this.margin + 2, y + 19)
      this.doc.setFont('helvetica', 'normal')
      this.doc.text(this.formatDate(sig.signed_at) + ' ' + new Date(sig.signed_at).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }), this.margin + col1Width + 2, y + 19)

      // Integrity Hash row
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Integrity Hash:', this.margin + 2, y + 27)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(7)
  const signatureHash = sig.integrity_hash || sig.signature_hash || '—'
  this.doc.text(signatureHash, this.margin + col1Width + 2, y + 27)

      // Signature Image placeholder
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Signature Image:', this.margin + 2, y + boxHeight + 5)
      
      // Signature box
      const sigBoxY = y + boxHeight + 8
      const sigBoxHeight = 20
      this.doc.rect(this.margin, sigBoxY, this.pageWidth - 2 * this.margin, sigBoxHeight)
      
      let signatureRendered = false

      const renderSignatureImage = (dataUrl: string | null) => {
        if (!dataUrl) return false
        try {
          const imgHeight = 18
          const imgWidth = 60
          const xPos = (this.pageWidth - imgWidth) / 2
          this.doc.addImage(dataUrl, 'PNG', xPos, sigBoxY + 1, imgWidth, imgHeight)
          return true
        } catch (error) {
          console.error('Error adding signature image to PDF:', error)
          return false
        }
      }

      signatureRendered = renderSignatureImage(sig.signature_image_data ?? null)

      if (!signatureRendered && sig.signature_image_url && typeof window !== 'undefined') {
        try {
          const response = await fetch(sig.signature_image_url)
          if (response.ok) {
            const blob = await response.blob()
            const reader = new FileReader()
            await new Promise<void>((resolve, reject) => {
              reader.onloadend = () => {
                try {
                  const base64data = reader.result as string
                  if (renderSignatureImage(base64data)) {
                    signatureRendered = true
                  }
                  resolve()
                } catch (error) {
                  reject(error as Error)
                }
              }
              reader.onerror = () => reject(new Error('Failed to load signature image'))
              reader.readAsDataURL(blob)
            })
          }
        } catch (clientError) {
          console.error('Error fetching signature image in browser:', clientError)
        }
      }

      if (!signatureRendered) {
        this.doc.setFont('helvetica', 'italic')
        this.doc.setFontSize(9)
        const message = sig.signature_image_url
          ? 'Signature image unavailable. Please ensure your digital signature is uploaded.'
          : '(awaiting acknowledgement)'
        this.doc.text(message, this.pageWidth / 2, sigBoxY + sigBoxHeight / 2 + 2, { align: 'center' })
      }

      y += boxHeight + sigBoxHeight + 15
    }

    // If no signatures yet, show HQ Approval and Manufacturer Acknowledgement sections
    if (this.signatures.length === 0) {
      const boxHeight = 30
      const col1Width = 50
      this.doc.setDrawColor(100, 100, 100)
      this.doc.setLineWidth(0.3)

      // HQ Approval Section
      this.doc.setFontSize(9)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('HQ Approval (Power User)', this.margin, y)
      y += 5
      
      this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, boxHeight)
      
      // Name row
      this.doc.line(this.margin, y + 7, this.pageWidth - this.margin, y + 7)
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Name:', this.margin + 2, y + 5)
      this.doc.setFont('helvetica', 'normal')
      const approverName = orderData?.approver?.full_name || ''
      this.doc.text(approverName, this.margin + col1Width + 2, y + 5)
      
      // Role row
      this.doc.line(this.margin, y + 14, this.pageWidth - this.margin, y + 14)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Role:', this.margin + 2, y + 12)
      this.doc.setFont('helvetica', 'normal')
      const approverRole = orderData?.approver?.role_name || ''
      this.doc.text(approverRole, this.margin + col1Width + 2, y + 12)
      
      // Approved At row (changed from "Signed At")
      this.doc.line(this.margin, y + 21, this.pageWidth - this.margin, y + 21)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Approved At:', this.margin + 2, y + 19)
      this.doc.setFont('helvetica', 'normal')
      const approvedAt = orderData?.approved_at ? this.format12HourTime(orderData.approved_at) : ''
      this.doc.text(approvedAt, this.margin + col1Width + 2, y + 19)
      
      // Integrity Hash row
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Integrity Hash:', this.margin + 2, y + 27)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(7)
      const integrityHash = orderData?.approval_hash || ''
      this.doc.text(integrityHash, this.margin + col1Width + 2, y + 27)
      
      y += boxHeight + 5
      
      // Signature Image
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Signature Image:', this.margin + 2, y)
      y += 3
      this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, 20)
      
      // Check if signature image exists and load it
      const approverSignatureImage = orderData?.approver_signature_image
      if (approverSignatureImage && orderData?.approved_at) {
        try {
          const imgHeight = 18
          const imgWidth = 60
          const xPos = (this.pageWidth - imgWidth) / 2
          this.doc.addImage(approverSignatureImage, 'PNG', xPos, y + 1, imgWidth, imgHeight)
        } catch (error) {
          console.error('Error adding approver signature image:', error)
          this.doc.setFont('helvetica', 'italic')
          this.doc.setFontSize(9)
          this.doc.text('[signature image here]', this.pageWidth / 2, y + 12, { align: 'center' })
        }
      } else {
        let signatureRendered = false
        const approverSignatureUrl = orderData?.approver?.signature_url
        if (approverSignatureUrl && orderData?.approved_at && typeof window !== 'undefined') {
          try {
            const response = await fetch(approverSignatureUrl)
            if (response.ok) {
              const blob = await response.blob()
              const reader = new FileReader()
              await new Promise<void>((resolve, reject) => {
                reader.onloadend = () => {
                  try {
                    const base64data = reader.result as string
                    const imgHeight = 18
                    const imgWidth = 60
                    const xPos = (this.pageWidth - imgWidth) / 2
                    this.doc.addImage(base64data, 'PNG', xPos, y + 1, imgWidth, imgHeight)
                    signatureRendered = true
                    resolve()
                  } catch (err) {
                    reject(err as Error)
                  }
                }
                reader.onerror = () => reject(new Error('Failed to load approver signature'))
                reader.readAsDataURL(blob)
              })
            }
          } catch (clientError) {
            console.error('Error loading approver signature in browser:', clientError)
          }
        }

        if (!signatureRendered) {
          this.doc.setFont('helvetica', 'italic')
          this.doc.setFontSize(9)
          this.doc.text('Upload digital signature in My Profile to display here.', this.pageWidth / 2, y + 12, { align: 'center' })
        }
      }
      
      y += 30

      // Manufacturer Acknowledgement Section
      this.doc.setFontSize(9)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Manufacturer Acknowledgement', this.margin, y)
      y += 5
      
      this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, boxHeight)
      
      // Name row
      this.doc.line(this.margin, y + 7, this.pageWidth - this.margin, y + 7)
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Name:', this.margin + 2, y + 5)
      this.doc.setFont('helvetica', 'normal')
      const mfgAckName = documentData?.acknowledger?.full_name || '—'
      this.doc.text(mfgAckName, this.margin + col1Width + 2, y + 5)
      
      // Role row
      this.doc.line(this.margin, y + 14, this.pageWidth - this.margin, y + 14)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Role:', this.margin + 2, y + 12)
      this.doc.setFont('helvetica', 'normal')
      const mfgAckRole = documentData?.acknowledger?.role_name || 'MANUFACTURER'
      this.doc.text(mfgAckRole, this.margin + col1Width + 2, y + 12)
      
      // Acknowledged At row (changed from "Signed At", 12-hour format)
      this.doc.line(this.margin, y + 21, this.pageWidth - this.margin, y + 21)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Acknowledged At:', this.margin + 2, y + 19)
      this.doc.setFont('helvetica', 'normal')
      const acknowledgedAt = documentData?.acknowledged_at ? this.format12HourTime(documentData.acknowledged_at) : '—'
      this.doc.text(acknowledgedAt, this.margin + col1Width + 2, y + 19)
      
      // Integrity Hash row
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Integrity Hash:', this.margin + 2, y + 27)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(7)
      const mfgIntegrityHash = documentData?.acknowledgement_hash || '—'
      this.doc.text(mfgIntegrityHash, this.margin + col1Width + 2, y + 27)
      
      y += boxHeight + 5
      
      // Signature Image
      this.doc.setFontSize(8)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Signature Image:', this.margin + 2, y)
      y += 3
      this.doc.rect(this.margin, y, this.pageWidth - 2 * this.margin, 20)
      
      // Check if manufacturer acknowledgement signature exists
      const mfgSignatureImage = documentData?.acknowledger_signature_image
      if (mfgSignatureImage && documentData?.acknowledged_at) {
        try {
          const imgHeight = 18
          const imgWidth = 60
          const xPos = (this.pageWidth - imgWidth) / 2
          this.doc.addImage(mfgSignatureImage, 'PNG', xPos, y + 1, imgWidth, imgHeight)
        } catch (error) {
          console.error('Error adding manufacturer signature image:', error)
          this.doc.setFont('helvetica', 'italic')
          this.doc.setFontSize(9)
          this.doc.text('(awaiting acknowledgement)', this.pageWidth / 2, y + 12, { align: 'center' })
        }
      } else {
        let signatureRendered = false
        const manufacturerSignatureUrl = documentData?.acknowledger?.signature_url
        if (manufacturerSignatureUrl && documentData?.acknowledged_at && typeof window !== 'undefined') {
          try {
            const response = await fetch(manufacturerSignatureUrl)
            if (response.ok) {
              const blob = await response.blob()
              const reader = new FileReader()
              await new Promise<void>((resolve, reject) => {
                reader.onloadend = () => {
                  try {
                    const base64data = reader.result as string
                    const imgHeight = 18
                    const imgWidth = 60
                    const xPos = (this.pageWidth - imgWidth) / 2
                    this.doc.addImage(base64data, 'PNG', xPos, y + 1, imgWidth, imgHeight)
                    signatureRendered = true
                    resolve()
                  } catch (err) {
                    reject(err as Error)
                  }
                }
                reader.onerror = () => reject(new Error('Failed to load manufacturer signature'))
                reader.readAsDataURL(blob)
              })
            }
          } catch (clientError) {
            console.error('Error loading manufacturer signature in browser:', clientError)
          }
        }

        if (!signatureRendered) {
          const message = documentData?.acknowledged_at
            ? 'Signature missing. Please upload your digital signature in My Profile.'
            : 'Awaiting acknowledgement. Upload digital signature in My Profile before acknowledging.'
          this.doc.setFont('helvetica', 'italic')
          this.doc.setFontSize(9)
          this.doc.text(message, this.pageWidth / 2, y + 12, { align: 'center' })
        }
      }
      
      y += 25
    }

    return y
  }

  async generateOrderPDF(orderData: OrderData): Promise<Blob> {
    let y = 15
    
    // Company Logo
    y = await this.addCompanyLogo(y)
    y += 5

    // Document Title
    y = this.addDocumentHeader('PURCHASE ORDER (PO)', y)
    y += 3

    // PO Information Table
    const poInfo = [
      { label: 'PO Number', value: orderData.order_no },
      { label: 'PO Date', value: this.formatDate(orderData.created_at) },
      { label: 'Status', value: orderData.status.toUpperCase() },
      { label: 'Estimated ETA', value: orderData.estimated_eta || 'TBD' },
      { label: 'Payment Terms', value: orderData.payment_terms || 'Net 30 Days' },
      { label: '', value: '' }
    ]
    y = this.addInfoTable(poInfo, y, 2)

    // Parties Section
    y = this.addPartiesSection(orderData, y, 'PO')

    // Order Lines Section
    y = this.addOrderLinesSection(orderData, y)

    // Notes Section
    y = this.addNotesSection(y)

    // Summary Section
    y = this.addSummarySection(orderData, y)

    // Signatures / Approval Trail
    y = await this.addSignaturesApprovalTrail(y, orderData)

    return this.doc.output('blob')
  }

  async generatePurchaseOrderPDF(orderData: OrderData, documentData: DocumentData): Promise<Blob> {
    let y = 15
    
    // Company Logo
    y = await this.addCompanyLogo(y)
    y += 5

    // Document Title
    y = this.addDocumentHeader('PURCHASE ORDER (PO)', y)
    y += 3

    // PO Information Table
    const poInfo = [
      { label: 'PO Number', value: documentData.doc_no },
      { label: 'PO Date', value: this.formatDate(documentData.created_at) },
      { label: 'Status', value: documentData.status.toUpperCase() },
      { label: 'Estimated ETA', value: documentData.estimated_eta || '30 Oct 2025' },
      { label: 'Payment Terms', value: documentData.payment_terms || '50% upfront, 50% upon delivery' },
      { label: '', value: '' }
    ]
    y = this.addInfoTable(poInfo, y, 2)

    // Parties Section
    y = this.addPartiesSection(orderData, y, 'PO')

    // Order Lines Section
    y = this.addOrderLinesSection(orderData, y)

    // Notes Section
    y = this.addNotesSection(y)

    // Summary Section
    y = this.addSummarySection(orderData, y)

    // Signatures / Approval Trail
    y = await this.addSignaturesApprovalTrail(y, orderData, documentData)

    return this.doc.output('blob')
  }

  async generateInvoicePDF(orderData: OrderData, documentData: DocumentData): Promise<Blob> {
    let y = 15
    
    // Company Logo
    y = await this.addCompanyLogo(y)
    y += 5

    // Document Title
    y = this.addDocumentHeader('INVOICE', y)
    y += 3

    // Invoice Information Table
    const invoiceInfo = [
      { label: 'Invoice Number', value: documentData.doc_no },
      { label: 'Invoice Date', value: this.formatDate(documentData.created_at) },
      { label: 'Status', value: documentData.status.toUpperCase() },
      { label: 'Payment Terms', value: documentData.payment_terms || 'Net 30 Days' },
      { label: 'Acknowledged', value: documentData.acknowledged_at ? this.formatDate(documentData.acknowledged_at) : 'Pending' },
      { label: '', value: '' }
    ]
    y = this.addInfoTable(invoiceInfo, y, 2)

    // Parties Section
    y = this.addPartiesSection(orderData, y, 'INVOICE')

    // Order Lines Section
    y = this.addOrderLinesSection(orderData, y)

    // Summary Section
    y = this.addSummarySection(orderData, y)

    // Signatures / Approval Trail
    y = await this.addSignaturesApprovalTrail(y, orderData, documentData)

    return this.doc.output('blob')
  }

  async generateReceiptPDF(orderData: OrderData, documentData: DocumentData): Promise<Blob> {
    let y = 15
    
    // Company Logo
    y = await this.addCompanyLogo(y)
    y += 5

    // Document Title
    y = this.addDocumentHeader('RECEIPT', y)
    y += 3

    // Receipt Information Table
    const receiptInfo = [
      { label: 'Receipt Number', value: documentData.doc_no },
      { label: 'Receipt Date', value: this.formatDate(documentData.created_at) },
      { label: 'Status', value: documentData.status.toUpperCase() },
      { label: 'Payment Method', value: 'Bank Transfer' }
    ]
    y = this.addInfoTable(receiptInfo, y, 2)

    // Parties Section
    y = this.addPartiesSection(orderData, y, 'RECEIPT')

    // Order Lines Section
    y = this.addOrderLinesSection(orderData, y)

    // Summary Section
    y = this.addSummarySection(orderData, y)

    // Signatures / Approval Trail
    y = await this.addSignaturesApprovalTrail(y, orderData, documentData)

    return this.doc.output('blob')
  }
}
