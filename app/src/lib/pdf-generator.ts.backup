import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface OrderData {
  order_no: string
  order_type: string
  status: string
  created_at: string
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
}

export class PDFGenerator {
  private doc: jsPDF

  constructor() {
    this.doc = new jsPDF()
  }

  private formatCurrency(amount: number | string): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return 'RM 0.00'
    return `RM ${numAmount.toFixed(2)}`
  }

  private formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-MY', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  private addHeader(title: string, subtitle?: string) {
    this.doc.setFontSize(24)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text(title, 105, 20, { align: 'center' })

    if (subtitle) {
      this.doc.setFontSize(12)
      this.doc.setFont('helvetica', 'normal')
      this.doc.text(subtitle, 105, 28, { align: 'center' })
    }
  }

  private addOrderInfo(orderData: OrderData, yPosition: number): number {
    let y = yPosition

    // Order Number and Status
    this.doc.setFontSize(12)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Order Number:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(orderData.order_no, 60, y)

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Status:', 130, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(orderData.status.toUpperCase(), 150, y)

    y += 10

    // Order Date
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Order Date:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(this.formatDate(orderData.created_at), 60, y)

    y += 15

    return y
  }

  private addOrganizationInfo(orderData: OrderData, yPosition: number): number {
    let y = yPosition

    // Buyer Information (Left Column)
    this.doc.setFillColor(240, 240, 240)
    this.doc.rect(20, y, 80, 40, 'F')
    
    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('FROM (BUYER)', 25, y + 7)
    
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(9)
    let buyerY = y + 14
    this.doc.text(orderData.buyer_org.org_name, 25, buyerY)
    if (orderData.buyer_org.address) {
      buyerY += 5
      this.doc.text(orderData.buyer_org.address.substring(0, 40), 25, buyerY)
    }
    if (orderData.buyer_org.contact_phone) {
      buyerY += 5
      this.doc.text(`Tel: ${orderData.buyer_org.contact_phone}`, 25, buyerY)
    }
    if (orderData.buyer_org.contact_email) {
      buyerY += 5
      this.doc.text(`Email: ${orderData.buyer_org.contact_email}`, 25, buyerY)
    }

    // Seller Information (Right Column)
    this.doc.setFillColor(240, 240, 240)
    this.doc.rect(110, y, 80, 40, 'F')
    
    this.doc.setFontSize(10)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('TO (SELLER)', 115, y + 7)
    
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(9)
    let sellerY = y + 14
    this.doc.text(orderData.seller_org.org_name, 115, sellerY)
    if (orderData.seller_org.address) {
      sellerY += 5
      this.doc.text(orderData.seller_org.address.substring(0, 40), 115, sellerY)
    }
    if (orderData.seller_org.contact_phone) {
      sellerY += 5
      this.doc.text(`Tel: ${orderData.seller_org.contact_phone}`, 115, sellerY)
    }
    if (orderData.seller_org.contact_email) {
      sellerY += 5
      this.doc.text(`Email: ${orderData.seller_org.contact_email}`, 115, sellerY)
    }

    return y + 50
  }

  private addOrderItems(orderData: OrderData, yPosition: number): number {
    const items = orderData.order_items.map((item, index) => {
      // Ensure proper number conversion
      const qty = parseFloat(item.qty.toString())
      const unitPrice = parseFloat(item.unit_price.toString())
      const lineTotal = parseFloat(item.line_total.toString())
      
      return [
        (index + 1).toString(),
        item.product?.product_name || 'Product1',
        `${qty.toFixed(2)} units`,
        this.formatCurrency(unitPrice),
        this.formatCurrency(lineTotal)
      ]
    })

    // Calculate totals with proper number parsing
    const subtotal = orderData.order_items.reduce((sum, item) => {
      const lineTotal = parseFloat(item.line_total.toString())
      return sum + lineTotal
    }, 0)
    const tax = subtotal * 0.06
    const grandTotal = subtotal + tax

    autoTable(this.doc, {
      startY: yPosition,
      head: [['#', 'Item', 'Quantity', 'Unit Price', 'Total']],
      body: items,
      foot: [
        ['', '', '', 'Subtotal:', this.formatCurrency(subtotal)],
        ['', '', '', 'Tax (6% SST):', this.formatCurrency(tax)],
        ['', '', '', 'Grand Total:', this.formatCurrency(grandTotal)]
      ],
      theme: 'grid',
      headStyles: {
        fillColor: [66, 139, 202],
        textColor: 255,
        fontStyle: 'bold'
      },
      footStyles: {
        fillColor: [240, 240, 240],
        textColor: 0,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 70 },
        2: { cellWidth: 30 },
        3: { cellWidth: 35 },
        4: { cellWidth: 35, halign: 'right' }
      }
    })

    return (this.doc as any).lastAutoTable.finalY + 10
  }

  generateOrderPDF(orderData: OrderData): Blob {
    this.addHeader('ORDER DOCUMENT', 'Official Order Record')
    
    let y = 40
    y = this.addOrderInfo(orderData, y)
    y = this.addOrganizationInfo(orderData, y)
    y = this.addOrderItems(orderData, y)

    // Footer
    this.doc.setFontSize(8)
    this.doc.setTextColor(128, 128, 128)
    this.doc.text(
      `Generated on ${new Date().toLocaleDateString('en-MY')} - Serapod2U Supply Chain Management`,
      105,
      280,
      { align: 'center' }
    )

    return this.doc.output('blob')
  }

  generatePurchaseOrderPDF(orderData: OrderData, documentData: DocumentData): Blob {
    this.addHeader('PURCHASE ORDER', documentData.doc_no)
    
    let y = 40

    // PO Specific Info
    this.doc.setFontSize(12)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('PO Number:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.doc_no, 60, y)

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Status:', 130, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.status.toUpperCase(), 150, y)

    y += 10

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('PO Date:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(this.formatDate(documentData.created_at), 60, y)

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Payment Terms:', 130, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text('Net 30 Days', 170, y)

    y += 15

    y = this.addOrganizationInfo(orderData, y)
    y = this.addOrderItems(orderData, y)

    // Footer
    this.doc.setFontSize(8)
    this.doc.setTextColor(128, 128, 128)
    this.doc.text(
      `Generated on ${new Date().toLocaleDateString('en-MY')} - Serapod2U Supply Chain Management`,
      105,
      280,
      { align: 'center' }
    )

    return this.doc.output('blob')
  }

  generateInvoicePDF(orderData: OrderData, documentData: DocumentData): Blob {
    this.addHeader('INVOICE', documentData.doc_no)
    
    let y = 40

    // Invoice Specific Info
    this.doc.setFontSize(12)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Invoice Number:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.doc_no, 60, y)

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Status:', 130, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.status.toUpperCase(), 150, y)

    y += 10

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Invoice Date:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(this.formatDate(documentData.created_at), 60, y)

    if (documentData.acknowledged_at) {
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Acknowledged:', 130, y)
      this.doc.setFont('helvetica', 'normal')
      this.doc.text(this.formatDate(documentData.acknowledged_at), 170, y)
    }

    y += 15

    y = this.addOrganizationInfo(orderData, y)
    y = this.addOrderItems(orderData, y)

    // Footer
    this.doc.setFontSize(8)
    this.doc.setTextColor(128, 128, 128)
    this.doc.text(
      `Generated on ${new Date().toLocaleDateString('en-MY')} - Serapod2U Supply Chain Management`,
      105,
      280,
      { align: 'center' }
    )

    return this.doc.output('blob')
  }

  generateReceiptPDF(orderData: OrderData, documentData: DocumentData): Blob {
    this.addHeader('RECEIPT', documentData.doc_no)
    
    let y = 40

    // Receipt Specific Info
    this.doc.setFontSize(12)
    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Receipt Number:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.doc_no, 60, y)

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Status:', 130, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(documentData.status.toUpperCase(), 150, y)

    y += 10

    this.doc.setFont('helvetica', 'bold')
    this.doc.text('Receipt Date:', 20, y)
    this.doc.setFont('helvetica', 'normal')
    this.doc.text(this.formatDate(documentData.created_at), 60, y)

    y += 15

    y = this.addOrganizationInfo(orderData, y)
    y = this.addOrderItems(orderData, y)

    // Acknowledgment
    if (y < 250) {
      this.doc.setFontSize(10)
      this.doc.setFont('helvetica', 'bold')
      this.doc.text('Received in good condition:', 20, y + 10)
      
      this.doc.setLineWidth(0.5)
      this.doc.line(20, y + 30, 90, y + 30)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(9)
      this.doc.text('Signature', 45, y + 35)
    }

    // Footer
    this.doc.setFontSize(8)
    this.doc.setTextColor(128, 128, 128)
    this.doc.text(
      `Generated on ${new Date().toLocaleDateString('en-MY')} - Serapod2U Supply Chain Management`,
      105,
      280,
      { align: 'center' }
    )

    return this.doc.output('blob')
  }
}

export default PDFGenerator
