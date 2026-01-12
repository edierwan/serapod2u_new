/**
 * PDF Document Templates
 * 
 * This module provides different PDF template styles:
 * - detailed: Comprehensive document format with full details (Image 4 - Current)
 * - classic: Traditional Purchase Order layout (Image 2 style)
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export type DocumentTemplateType = 'detailed' | 'classic'

export interface TemplateOrderData {
  order_no: string
  order_type: string
  status: string
  created_at: string
  approved_at?: string
  payment_terms?: any
  approver?: {
    full_name: string
    role_name?: string
    signature_url?: string | null
  }
  approver_signature_image?: string | null
  buyer_org: {
    org_name: string
    address?: string | null
    address_line2?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    country_code?: string | null
    contact_name?: string | null
    contact_phone?: string | null
    contact_email?: string | null
    logo_url?: string | null
  }
  seller_org: {
    org_name: string
    address?: string | null
    address_line2?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    country_code?: string | null
    contact_name?: string | null
    contact_phone?: string | null
    contact_email?: string | null
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
  // Dynamic image data (fetched and converted to base64)
  buyer_logo_image?: string | null
  buyer_signature_image?: string | null
  creator_signature_image?: string | null  // User Level signature
}

export interface TemplateDocumentData {
  doc_no: string
  display_doc_no?: string  // New format: PO26000001
  doc_type: string
  status: string
  created_at: string
  total_amount?: number
  payment_percentage?: number
  payload?: Record<string, any>
}

export interface TemplateSignatureData {
  signer_name: string
  signer_role: string
  signed_at: string
  signature_image_data?: string | null
}







/**
 * Classic Template (Image 2 style)
 * Traditional Purchase Order layout
 */
export class ClassicTemplate {
  private doc: jsPDF
  private pageWidth: number = 210
  private margin: number = 15
  private signatures: TemplateSignatureData[]

  constructor(signatures: TemplateSignatureData[] = []) {
    this.doc = new jsPDF({ compress: true })
    this.signatures = signatures
  }

  private formatCurrency(amount: number | string): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return 'RM 0.00'
    return `RM ${numAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  private formatDateLong(dateString: string): string {
    if (!dateString) return ''
    const date = new Date(dateString)
    const day = date.getDate()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[date.getMonth()]
    const year = date.getFullYear()
    return `${day} ${month} ${year}`
  }

  async generate(orderData: TemplateOrderData, documentData: TemplateDocumentData, docTitle: string): Promise<Blob> {
    let y = 20

    // 1. Header Section - 2 Column Grid
    // Left Column (65%): Logo + Company Info (Side-by-side, vertically centered)
    // Right Column (35%): Document Title + Meta Details

    // --- Right Column Content (Title + Meta) ---
    const headerRightX = this.pageWidth - this.margin

    this.doc.setTextColor(0, 0, 0)
    this.doc.setFontSize(14)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(docTitle.toUpperCase(), headerRightX, y + 5, { align: 'right' })

    let detailsY = y + 15
    this.doc.setFontSize(9)

    const details = [
      { label: 'PO#:', value: documentData.display_doc_no || documentData.doc_no },
      { label: 'Date:', value: this.formatDate(documentData.created_at) },
      { label: 'By:', value: 'User Level' },
      { label: 'Ledger:', value: 'Stock Purchased / Inventory' }
    ]

    details.forEach(detail => {
      this.doc.setFont('helvetica', 'normal')
      this.doc.setTextColor(128, 128, 128) // Gray label
      this.doc.text(detail.label, headerRightX - 50, detailsY, { align: 'left' })

      this.doc.setTextColor(0, 0, 0) // Black value
      this.doc.text(detail.value, headerRightX, detailsY, { align: 'right' })
      detailsY += 5
    })

    // --- Left Column Content (Logo + Info) ---
    const orgName = orderData.buyer_org.org_name.toUpperCase()
    const buyerAddress = [
      orderData.buyer_org.address,
      orderData.buyer_org.address_line2,
      [orderData.buyer_org.city, orderData.buyer_org.postal_code].filter(Boolean).join(', '),
      orderData.buyer_org.state,
      orderData.buyer_org.contact_email
    ].filter(Boolean)

    // Calculate Text Block Height
    const nameHeight = 4
    const addrLineHeight = 3.5
    const textBlockHeight = nameHeight + (buyerAddress.length * addrLineHeight)

    // Logo Dimensions & Positioning
    const logoMaxHeight = 22 // ~64px (100% bigger)
    let logoW = 22
    let logoH = 22
    const logoX = this.margin
    let logoY = y + 2 // Default top align if no image

    if (orderData.buyer_logo_image) {
      try {
        const props = this.doc.getImageProperties(orderData.buyer_logo_image)
        const ratio = props.width / props.height
        logoH = Math.min(logoMaxHeight, props.height * 0.264583) // Convert px to mm if needed, but max is 22mm
        logoH = logoMaxHeight
        logoW = logoH * ratio

        // Center vertically relative to text block
        // Ensure we don't go above y
        logoY = y + Math.max(0, (textBlockHeight - logoH) / 2)

        this.doc.addImage(orderData.buyer_logo_image, 'PNG', logoX, logoY, logoW, logoH)
      } catch (e) {
        console.error('Error adding buyer logo:', e)
        this.doc.setDrawColor(200, 200, 200)
        this.doc.rect(logoX, logoY, logoH, logoH)
      }
    } else {
      this.doc.setFontSize(6)
      this.doc.setTextColor(150, 150, 150)
      this.doc.text('LOGO', logoX, logoY + 5)
    }

    // Render Text Block (Offset by Logo Width + Gap)
    const textX = logoX + logoW + 5 // 5mm gap
    let currentTextY = y + 3.5 // Align text top roughly with logo top

    // Org Name
    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text(orgName, textX, currentTextY)
    currentTextY += nameHeight

    // Address
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'normal')
    this.doc.setTextColor(100, 100, 100)

    buyerAddress.forEach(line => {
      if (line) {
        this.doc.text(line, textX, currentTextY)
        currentTextY += addrLineHeight
      }
    })

    y = Math.max(currentTextY, detailsY) + 5

    // 2. Supplier & Status Section
    // Draw line above Supplier
    this.doc.setDrawColor(230, 230, 230)
    this.doc.setLineWidth(0.1)
    this.doc.line(this.margin, y, this.pageWidth - this.margin, y)

    y += 5
    const supplierY = y

    // Supplier (Left) - Only show supplier name and address
    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('Supplier:', this.margin, supplierY)

    this.doc.setFontSize(9)
    this.doc.text(orderData.seller_org.org_name.toUpperCase(), this.margin, supplierY + 6)

    this.doc.setFont('helvetica', 'normal')
    this.doc.setTextColor(100, 100, 100)
    let suppAddrY = supplierY + 11

    // Helper to clean and validate address line
    const cleanAddressLine = (line: string | null | undefined): string | null => {
      if (!line || typeof line !== 'string') return null
      const trimmed = line.trim()
      if (trimmed.length === 0) return null
      // Filter out UUID patterns (8-4-4-4-12 hex format)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null
      // Filter out long hex strings
      if (/^[0-9a-f]{16,}$/i.test(trimmed)) return null
      return trimmed
    }

    // Build address lines - split any newlines in address fields
    const addressLines: string[] = []

    // Process main address field (may contain newlines)
    const mainAddress = cleanAddressLine(orderData.seller_org.address)
    if (mainAddress) {
      // Split by newlines and add each line separately
      mainAddress.split(/[\n\r]+/).forEach(line => {
        const cleaned = cleanAddressLine(line)
        if (cleaned) addressLines.push(cleaned)
      })
    }

    // Process address_line2
    const address2 = cleanAddressLine(orderData.seller_org.address_line2)
    if (address2) {
      address2.split(/[\n\r]+/).forEach(line => {
        const cleaned = cleanAddressLine(line)
        if (cleaned) addressLines.push(cleaned)
      })
    }

    // Add city/postal code if available
    const cityPostal = [orderData.seller_org.city, orderData.seller_org.postal_code].filter(Boolean).join(', ')
    if (cityPostal) {
      const cleaned = cleanAddressLine(cityPostal)
      if (cleaned) addressLines.push(cleaned)
    }

    // Render address lines with proper line height
    addressLines.forEach(line => {
      this.doc.text(line, this.margin, suppAddrY)
      suppAddrY += 4
    })

    // Status Box (Right)
    // Box dimensions
    const boxWidth = 40
    const boxHeight = 15
    const boxX = this.pageWidth - this.margin - boxWidth
    const boxY = supplierY

    this.doc.setDrawColor(230, 230, 230)
    this.doc.setLineWidth(0.5)
    this.doc.rect(boxX, boxY, boxWidth, boxHeight)

    this.doc.setFontSize(7)
    this.doc.setTextColor(128, 128, 128)
    this.doc.text('STATUS', boxX + (boxWidth / 2), boxY + 5, { align: 'center' })

    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(34, 197, 94) // Green color
    this.doc.text(orderData.status.toUpperCase(), boxX + (boxWidth / 2), boxY + 11, { align: 'center' })

    y = Math.max(suppAddrY, boxY + boxHeight) + 5

    // 3. Items Table
    // Simple table with no borders, just lines
    const headers = ['No', 'Description', 'Unit', 'Price', 'Amount']

    const tableData = orderData.order_items.map((item, index) => {
      const qty = item.qty || 0
      const unitPrice = item.unit_price || 0
      const total = item.line_total || (qty * unitPrice)

      // Format description to match Order print/save view
      // Extract product base name (e.g., "Cellera Hero")
      const productName = (item.product?.product_name || 'Product').replace(/\[.*?\]\s*$/, '').trim()
      // Extract variant details (e.g., "Deluxe Cellera Cartridge [ Strawberry Cheesecake ]")
      const variantName = item.variant?.variant_name || ''

      let description = productName
      if (variantName) {
        // If variant contains brackets, extract the parts
        const bracketMatch = variantName.match(/^(.*?)\s*\[(.*)\]\s*$/)
        if (bracketMatch) {
          // Format: ProductName VariantType [ VariantFlavor ]
          description = `${productName} ${bracketMatch[1].trim()} [ ${bracketMatch[2].trim()} ]`
        } else {
          // Fallback: Just show product name and variant
          description = `${productName} ${variantName}`
        }
      }

      return [
        (index + 1).toString(),
        description,
        qty.toString(),
        unitPrice.toFixed(2),
        `RM ${total.toFixed(2)}`
      ]
    })

    autoTable(this.doc, {
      startY: y,
      head: [headers],
      body: tableData,
      theme: 'plain', // Minimal theme
      styles: {
        fontSize: 9,
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
        minCellHeight: 8,
        valign: 'middle',
        textColor: [0, 0, 0],
        font: 'helvetica',
        overflow: 'ellipsize',
        cellWidth: 'wrap'
      },
      headStyles: {
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        halign: 'left',
        fontSize: 11,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },   // No column - centered
        1: { cellWidth: 'auto', halign: 'left', fontStyle: 'normal' }, // Description - left aligned, not bold
        2: { cellWidth: 18, halign: 'center' },   // Unit - center aligned (header & data)
        3: { cellWidth: 22, halign: 'right' },    // Price - right aligned (header & data)
        4: { cellWidth: 28, halign: 'right' }     // Amount - right aligned (header & data)
      },
      margin: { left: this.margin, right: this.margin },
      didParseCell: (data) => {
        // Make headers for columns 2,3,4 center/right aligned to match data
        if (data.section === 'head') {
          if (data.column.index === 2) {
            data.cell.styles.halign = 'center'
          } else if (data.column.index >= 3) {
            data.cell.styles.halign = 'right'
          }
        }
      },
      didDrawCell: (data) => {
        // Draw horizontal line after each body row
        if (data.section === 'body') {
          this.doc.setDrawColor(230, 230, 230)
          this.doc.setLineWidth(0.1)
          const lineY = data.cell.y + data.cell.height
          this.doc.line(
            this.margin,
            lineY,
            this.pageWidth - this.margin,
            lineY
          )
        }
      },
      didDrawPage: (data) => {
        // Header line
        this.doc.setDrawColor(230, 230, 230)
        this.doc.setLineWidth(0.1)
        this.doc.line(this.margin, data.settings.startY + 7, this.pageWidth - this.margin, data.settings.startY + 7)
      }
    })

    y = (this.doc as any).lastAutoTable.finalY + 5

    // 4. Footer / Totals
    const totalAmount = orderData.order_items.reduce((sum, item) => sum + (item.line_total || 0), 0)

    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)

    const totalX = this.pageWidth - this.margin - 30
    this.doc.text('Total', totalX - 20, y, { align: 'right' })
    this.doc.text(this.formatCurrency(totalAmount), this.pageWidth - this.margin, y, { align: 'right' })

    y += 30

    // 5. Signatures / Footer
    const footerY = y

    // Issued by (Left) - Organization stamp/signature
    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text('Issued by:', this.margin, footerY)

    // Organization Stamp - Use dynamic signature image if available (reduced 50% - half size)
    const stampX = this.margin + 14
    const stampY = footerY + 14
    const stampSize = 16  // Reduced to half size (50% smaller)

    if (orderData.buyer_signature_image) {
      try {
        this.doc.addImage(orderData.buyer_signature_image, 'PNG', stampX - stampSize / 2, stampY - stampSize / 2, stampSize, stampSize)
      } catch (e) {
        console.error('Error adding organization stamp:', e)
        // Fallback to simulated stamp
        this.drawDefaultStamp(stampX, stampY, orderData.buyer_org.org_name, stampSize / 2)
      }
    } else {
      // Fallback: simulated stamp (half size)
      this.drawDefaultStamp(stampX, stampY, orderData.buyer_org.org_name, stampSize / 2)
    }

    // Created by (Center) - Always show "User Level" as per requirement
    const centerX = this.pageWidth / 2
    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'normal')
    this.doc.setTextColor(100, 100, 100)
    this.doc.text('Created by: User Level', centerX, footerY, { align: 'center' })

    // Creator Signature - Use CREATOR signature (User Level), NOT approver signature
    if (orderData.creator_signature_image) {
      try {
        this.doc.addImage(orderData.creator_signature_image, 'PNG', centerX - 15, footerY + 2, 30, 12)
      } catch (e) {
        console.error('Error adding creator signature:', e)
        // Draw placeholder squiggle
        this.doc.setDrawColor(0, 0, 0)
        this.doc.setLineWidth(0.5)
        this.doc.lines([[2, -1], [2, 1], [2, -1], [2, 1]], centerX - 4, footerY + 10)
      }
    } else {
      // Draw placeholder squiggle
      this.doc.setDrawColor(0, 0, 0)
      this.doc.setLineWidth(0.5)
      this.doc.lines([[2, -1], [2, 1], [2, -1], [2, 1]], centerX - 4, footerY + 10)
    }

    // Signature Line
    this.doc.setDrawColor(200, 200, 200)
    this.doc.line(centerX - 15, footerY + 15, centerX + 15, footerY + 15)

    // Date
    this.doc.setFontSize(8)
    this.doc.setTextColor(100, 100, 100)
    this.doc.text(this.formatDateLong(documentData.created_at), centerX, footerY + 22, { align: 'center' })

    // Approved by (Right) - Use dynamic approver role
    const footerRightX = this.pageWidth - this.margin - 25
    this.doc.setFontSize(9)
    const approverRole = orderData.approver?.role_name || 'Manager Level'
    this.doc.text(`Approved by: ${approverRole}`, footerRightX, footerY, { align: 'center' })

    // Approver Signature - Use approver signature if available  
    if (orderData.approver_signature_image) {
      try {
        this.doc.addImage(orderData.approver_signature_image, 'PNG', footerRightX - 15, footerY + 2, 30, 12)
      } catch (e) {
        console.error('Error adding approver signature:', e)
        // Draw placeholder squiggle
        this.doc.setDrawColor(0, 0, 0)
        this.doc.setLineWidth(0.5)
        this.doc.lines([[2, -1], [2, 1], [2, -1], [2, 1]], footerRightX - 4, footerY + 10)
      }
    } else {
      // Draw placeholder squiggle
      this.doc.setDrawColor(0, 0, 0)
      this.doc.setLineWidth(0.5)
      this.doc.lines([[2, -1], [2, 1], [2, -1], [2, 1]], footerRightX - 4, footerY + 10)
    }

    // Signature Line
    this.doc.line(footerRightX - 15, footerY + 15, footerRightX + 15, footerY + 15)

    // Date
    const approvedDate = orderData.approved_at || documentData.created_at
    this.doc.text(this.formatDateLong(approvedDate), footerRightX, footerY + 22, { align: 'center' })

    // Bottom text
    const bottomY = footerY + 40
    this.doc.setFontSize(7)
    this.doc.setTextColor(180, 180, 180)
    this.doc.text('This is a computer generated document.', this.margin, bottomY)

    return this.doc.output('blob')
  }

  private drawDefaultStamp(centerX: number, centerY: number, orgName: string, radius: number = 14): void {
    // Draw circular stamp with configurable size
    this.doc.setDrawColor(100, 100, 100)
    this.doc.setLineWidth(0.5)
    this.doc.circle(centerX, centerY, radius)
    this.doc.circle(centerX, centerY, radius - 2)

    // Parse org name for stamp text - scale font based on radius
    const nameParts = orgName.toUpperCase().split(' ')
    const fontSize = Math.max(3, Math.min(5, radius / 3))
    this.doc.setFontSize(fontSize)
    this.doc.setTextColor(100, 100, 100)

    const lineSpacing = radius / 3
    if (nameParts.length >= 3) {
      this.doc.text(nameParts[0], centerX, centerY - lineSpacing, { align: 'center' })
      this.doc.text(nameParts[1], centerX, centerY, { align: 'center' })
      this.doc.text(nameParts.slice(2).join(' '), centerX, centerY + lineSpacing, { align: 'center' })
    } else if (nameParts.length === 2) {
      this.doc.text(nameParts[0], centerX, centerY - lineSpacing / 2, { align: 'center' })
      this.doc.text(nameParts[1], centerX, centerY + lineSpacing / 2, { align: 'center' })
    } else {
      this.doc.text(orgName.toUpperCase(), centerX, centerY, { align: 'center' })
    }
  }
}


/**
 * Get the appropriate template class based on template type
 */
export function getTemplateGenerator(
  templateType: DocumentTemplateType,
  signatures: TemplateSignatureData[] = []
): ClassicTemplate | null {
  switch (templateType) {
    case 'classic':
      return new ClassicTemplate(signatures)
    case 'detailed':
      // Return null to use the existing PDFGenerator
      return null
    default:
      return null
  }
}

/**
 * Get document title based on document type
 */
export function getDocumentTitle(docType: string): string {
  const typeMap: Record<string, string> = {
    'PO': 'Purchase Order',
    'SO': 'Sales Order',
    'DO': 'Delivery Order',
    'INVOICE': 'Invoice',
    'RECEIPT': 'Receipt',
    'PAYMENT': 'Payment Advice',
    'PAYMENT_REQUEST': 'Balance Payment Request'
  }
  return typeMap[docType?.toUpperCase()] || docType || 'Document'
}
