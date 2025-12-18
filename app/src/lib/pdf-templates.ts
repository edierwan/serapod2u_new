/**
 * PDF Document Templates
 * 
 * This module provides different PDF template styles:
 * - minimal: Simple, clean invoice style (Image 2)
 * - tax_invoice: Professional tax invoice format (Image 3)
 * - detailed: Comprehensive document format with full details (Image 4 - Current)
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export type DocumentTemplateType = 'minimal' | 'tax_invoice' | 'detailed'

export interface TemplateOrderData {
  order_no: string
  order_type: string
  status: string
  created_at: string
  approved_at?: string
  payment_terms?: any
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
}

export interface TemplateDocumentData {
  doc_no: string
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
 * Minimal Template (Simple Invoice - Image 2 style)
 * Clean, simple invoice with minimal information
 */
export class MinimalTemplate {
  private doc: jsPDF
  private pageWidth: number = 210
  private margin: number = 20
  private signatures: TemplateSignatureData[]

  constructor(signatures: TemplateSignatureData[] = []) {
    this.doc = new jsPDF({ compress: true })
    this.signatures = signatures
  }

  private formatCurrency(amount: number | string): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '$0'
    return `$${numAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}.${month}.${year}`
  }

  async generate(orderData: TemplateOrderData, documentData: TemplateDocumentData, docTitle: string): Promise<Blob> {
    let y = 25

    // Draw header line
    this.doc.setDrawColor(0, 0, 0)
    this.doc.setLineWidth(0.5)
    this.doc.line(this.margin, y, 100, y)

    // INVOICE title
    this.doc.setFontSize(28)
    this.doc.setFont('helvetica', 'normal')
    this.doc.setTextColor(0, 0, 0)
    this.doc.text(docTitle.toUpperCase(), 105, y + 3)

    // Draw line after title
    this.doc.line(190 - this.margin, y, this.pageWidth - this.margin, y)

    y += 35

    // ISSUED TO section
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('ISSUED TO:', this.margin, y)
    
    this.doc.setFont('helvetica', 'normal')
    y += 5
    this.doc.text(orderData.buyer_org.contact_name || orderData.buyer_org.org_name, this.margin, y)
    y += 4
    this.doc.text(orderData.buyer_org.org_name, this.margin, y)
    y += 4
    
    const addressParts = [
      orderData.buyer_org.address,
      orderData.buyer_org.city
    ].filter(Boolean).join(', ')
    if (addressParts) {
      this.doc.text(addressParts, this.margin, y)
    }

    // Right side - Invoice details
    const rightX = 130
    let rightY = y - 13
    
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('INVOICE NO:', rightX, rightY)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.doc_no.replace(/[^0-9]/g, '').slice(-5) || '01234', rightX + 35, rightY)
    
    rightY += 5
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('DATE:', rightX + 12, rightY)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(this.formatDate(documentData.created_at), rightX + 35, rightY)
    
    rightY += 5
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('DUE DATE:', rightX + 1, rightY)
    this.doc.setFont('helvetica', 'normal')
    // Due date is 30 days from created_at
    const dueDate = new Date(documentData.created_at)
    dueDate.setDate(dueDate.getDate() + 30)
    this.doc.text(this.formatDate(dueDate.toISOString()), rightX + 35, rightY)

    y += 15

    // PAY TO section
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('PAY TO:', this.margin, y)
    
    this.doc.setFont('helvetica', 'normal')
    y += 5
    this.doc.text('Bank Transfer', this.margin, y)
    y += 4
    this.doc.text(`Account Name: ${orderData.seller_org.org_name}`, this.margin, y)
    y += 4
    this.doc.text('Account No.: ****-****-****', this.margin, y)

    y += 20

    // Table header
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('DESCRIPTION', this.margin, y)
    this.doc.text('UNIT PRICE', 100, y, { align: 'center' })
    this.doc.text('QTY', 130, y, { align: 'center' })
    this.doc.text('TOTAL', this.pageWidth - this.margin, y, { align: 'right' })

    y += 3
    this.doc.setLineWidth(0.3)
    this.doc.line(this.margin, y, this.pageWidth - this.margin, y)

    y += 8

    // Order items
    this.doc.setFont('helvetica', 'normal')
    let subtotal = 0
    
    orderData.order_items.forEach((item) => {
      const description = item.product?.product_name || 'Product'
      const unitPrice = item.unit_price || 0
      const qty = item.qty || 0
      const total = item.line_total || (unitPrice * qty)
      subtotal += total

      this.doc.text(description, this.margin, y)
      this.doc.text(unitPrice.toString(), 100, y, { align: 'center' })
      this.doc.text(qty.toString(), 130, y, { align: 'center' })
      this.doc.text(this.formatCurrency(total), this.pageWidth - this.margin, y, { align: 'right' })
      
      y += 8
    })

    y += 10

    // Summary
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('SUBTOTAL', this.margin, y)
    this.doc.text(this.formatCurrency(subtotal), this.pageWidth - this.margin, y, { align: 'right' })

    y += 8
    // Tax calculation (10%)
    const taxRate = 10
    const taxAmount = subtotal * (taxRate / 100)
    const total = subtotal + taxAmount

    this.doc.setFont('helvetica', 'normal')
    this.doc.text('Tax', 130, y, { align: 'right' })
    this.doc.text(`${taxRate}%`, this.pageWidth - this.margin, y, { align: 'right' })

    y += 5
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('TOTAL', 130, y, { align: 'right' })
    this.doc.text(this.formatCurrency(total), this.pageWidth - this.margin, y, { align: 'right' })

    // Signature at bottom
    if (this.signatures.length > 0) {
      y = 250
      
      // Find appropriate signature based on document type
      const sig = this.signatures[0]
      
      if (sig.signature_image_data) {
        try {
          this.doc.addImage(sig.signature_image_data, 'PNG', this.pageWidth - 70, y, 50, 20)
        } catch (e) {
          // Fallback to text signature
          this.doc.setFont('helvetica', 'italic')
          this.doc.setFontSize(14)
          this.doc.text(sig.signer_name, this.pageWidth - this.margin, y + 15, { align: 'right' })
        }
      } else {
        // Stylized text signature
        this.doc.setFont('helvetica', 'italic')
        this.doc.setFontSize(14)
        this.doc.text(sig.signer_name, this.pageWidth - this.margin, y + 15, { align: 'right' })
      }
    }

    return this.doc.output('blob')
  }
}


/**
 * Tax Invoice Template (Image 3 style)
 * Professional tax invoice format with GST/Tax breakdown
 */
export class TaxInvoiceTemplate {
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
    if (isNaN(numAmount)) return '0.00'
    return numAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  async generate(orderData: TemplateOrderData, documentData: TemplateDocumentData, docTitle: string): Promise<Blob> {
    let y = 15

    // Company Header (Seller)
    this.doc.setFontSize(14)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text(orderData.seller_org.org_name, this.margin, y)
    
    y += 5
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'normal')
    
    // Address lines
    const sellerAddress = [
      orderData.seller_org.address,
      orderData.seller_org.address_line2,
      [orderData.seller_org.city, orderData.seller_org.postal_code].filter(Boolean).join(', '),
      orderData.seller_org.state
    ].filter(Boolean)
    
    sellerAddress.forEach(line => {
      if (line) {
        this.doc.text(line, this.margin, y)
        y += 4
      }
    })
    
    // Contact info
    if (orderData.seller_org.contact_phone) {
      this.doc.text(`Phone: ${orderData.seller_org.contact_phone}`, this.margin, y)
      y += 4
    }
    if (orderData.seller_org.contact_email) {
      this.doc.text(`Email: ${orderData.seller_org.contact_email}`, this.margin, y)
      y += 4
    }

    y += 5

    // Horizontal line
    this.doc.setLineWidth(0.5)
    this.doc.line(this.margin, y, this.pageWidth - this.margin, y)

    y += 8

    // TAX INVOICE title
    this.doc.setFontSize(14)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('TAX INVOICE', this.pageWidth / 2, y, { align: 'center' })

    // Invoice details on right side
    const rightX = 130
    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text(`Tax Invoice : ${documentData.doc_no}`, rightX, y)

    y += 10

    // Bill To box
    this.doc.setDrawColor(0, 0, 0)
    this.doc.setLineWidth(0.3)
    this.doc.rect(this.margin, y, 80, 25)
    
    this.doc.setFontSize(9)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(orderData.buyer_org.org_name, this.margin + 2, y + 5)

    // Right side details box
    const detailsStartY = y
    this.doc.setFontSize(8)
    
    const details = [
      { label: 'Your Ref.', value: ':' },
      { label: 'Our D/O No', value: ':' },
      { label: 'Terms', value: `: 30 Days` },
      { label: 'Date', value: `: ${this.formatDate(documentData.created_at)}` },
      { label: 'Page', value: ': 1 of 1' }
    ]
    
    let detailY = detailsStartY
    details.forEach(detail => {
      this.doc.text(detail.label, rightX, detailY)
      this.doc.text(detail.value, rightX + 25, detailY)
      detailY += 5
    })

    y += 30

    // Attn and contact
    this.doc.rect(this.margin, y, 40, 8)
    this.doc.rect(this.margin + 40, y, 40, 8)
    this.doc.text('Attn :', this.margin + 2, y + 5)
    this.doc.text('TEL :', this.margin + 42, y + 5)
    
    this.doc.rect(this.margin + 80, y, 35, 8)
    this.doc.text('FAX :', this.margin + 82, y + 5)

    y += 15

    // Items table
    const headers = ['No', 'Description', 'Qty', 'Price/Unit', 'Discount', 'Sub Total', 'Total Excl.\nGST (RM)', 'GST Amt @\n6% (RM)', 'Total Incl.\nGST (RM)', 'Tax']
    
    const tableData = orderData.order_items.map((item, index) => {
      const qty = item.qty || 0
      const unitPrice = item.unit_price || 0
      const subTotal = item.line_total || (qty * unitPrice)
      const gstAmount = 0 // Assuming 0% GST for now
      const totalIncl = subTotal + gstAmount
      
      return [
        (index + 1).toString(),
        `${item.product?.product_name || 'Product'}${item.variant?.variant_name ? `\n(${item.variant.variant_name})` : ''}`,
        `${qty.toFixed(2)} UNIT`,
        this.formatCurrency(unitPrice),
        '',
        this.formatCurrency(subTotal),
        this.formatCurrency(subTotal),
        this.formatCurrency(gstAmount),
        this.formatCurrency(totalIncl),
        ''
      ]
    })

    autoTable(this.doc, {
      startY: y,
      head: [headers],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        textColor: [0, 0, 0]
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle'
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 45 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 15, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 20, halign: 'right' },
        7: { cellWidth: 18, halign: 'right' },
        8: { cellWidth: 18, halign: 'right' },
        9: { cellWidth: 10, halign: 'center' }
      },
      margin: { left: this.margin, right: this.margin }
    })

    y = (this.doc as any).lastAutoTable.finalY + 10

    // Total amount in words
    const totalAmount = orderData.order_items.reduce((sum, item) => sum + (item.line_total || 0), 0)
    
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text(`RINGGIT MALAYSIA : ${this.numberToWords(totalAmount)} ONLY`, this.margin, y)

    y += 10

    // Notes section
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Notes :', this.margin, y)
    y += 4
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(7)
    this.doc.text('1. All cheques should be crossed and made payable to', this.margin, y)
    y += 4
    this.doc.text(`   ${orderData.seller_org.org_name}`, this.margin, y)
    y += 4
    this.doc.text('2. Goods sold are neither returnable nor refundable.', this.margin, y)

    // Total summary on right
    const summaryX = 130
    const summaryY = y - 15
    
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Total Amount Due', summaryX, summaryY)
    this.doc.text(this.formatCurrency(totalAmount), summaryX + 25, summaryY)
    this.doc.text(this.formatCurrency(totalAmount), summaryX + 45, summaryY)
    this.doc.text('0.00', summaryX + 60, summaryY)
    this.doc.text(this.formatCurrency(totalAmount), summaryX + 75, summaryY)

    // GST summary box
    y += 10
    this.doc.rect(summaryX, y, 35, 8)
    this.doc.rect(summaryX + 35, y, 35, 8)
    
    this.doc.setFontSize(7)
    this.doc.text('GST Amount (MYR)', summaryX + 2, y + 5)
    this.doc.text('Total Payable (MYR)', summaryX + 37, y + 5)
    
    y += 8
    this.doc.rect(summaryX, y, 35, 8)
    this.doc.rect(summaryX + 35, y, 35, 8)
    this.doc.text('0.00', summaryX + 17, y + 5, { align: 'center' })
    this.doc.setFont('helvetica', 'bold')
    this.doc.text(this.formatCurrency(totalAmount), summaryX + 52, y + 5, { align: 'center' })

    // Authorized Signature line
    y = 260
    this.doc.setLineWidth(0.5)
    this.doc.line(this.margin, y, this.margin + 50, y)
    y += 4
    this.doc.setFontSize(8)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Authorised Signature', this.margin, y)

    return this.doc.output('blob')
  }

  private numberToWords(num: number): string {
    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
    const teens = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']

    if (num === 0) return 'ZERO'
    if (num < 0) return 'MINUS ' + this.numberToWords(-num)

    let words = ''

    if (Math.floor(num / 1000000) > 0) {
      words += this.numberToWords(Math.floor(num / 1000000)) + ' MILLION '
      num %= 1000000
    }

    if (Math.floor(num / 1000) > 0) {
      words += this.numberToWords(Math.floor(num / 1000)) + ' THOUSAND '
      num %= 1000
    }

    if (Math.floor(num / 100) > 0) {
      words += ones[Math.floor(num / 100)] + ' HUNDRED '
      num %= 100
    }

    if (num > 0) {
      if (words !== '') words += 'AND '

      if (num < 10) {
        words += ones[num]
      } else if (num < 20) {
        words += teens[num - 10]
      } else {
        words += tens[Math.floor(num / 10)]
        if (num % 10 > 0) {
          words += ' ' + ones[num % 10]
        }
      }
    }

    return words.trim()
  }
}


/**
 * Get the appropriate template class based on template type
 */
export function getTemplateGenerator(
  templateType: DocumentTemplateType,
  signatures: TemplateSignatureData[] = []
): MinimalTemplate | TaxInvoiceTemplate | null {
  switch (templateType) {
    case 'minimal':
      return new MinimalTemplate(signatures)
    case 'tax_invoice':
      return new TaxInvoiceTemplate(signatures)
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
