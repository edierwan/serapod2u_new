import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import PDFGenerator from '@/lib/pdf-generator'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('orderId')
    const type = searchParams.get('type') as 'order' | 'purchase_order' | 'invoice' | 'receipt'

    if (!orderId || !type) {
      return NextResponse.json(
        { error: 'Missing orderId or type parameter' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Fetch order data with all relationships
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        buyer_org:organizations!orders_buyer_org_id_fkey(org_name, address, contact_phone, contact_email),
        seller_org:organizations!orders_seller_org_id_fkey(org_name, address, contact_phone, contact_email),
        order_items(
          *,
          product:products(product_name, product_code),
          variant:product_variants(variant_name)
        )
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !orderData) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const generator = new PDFGenerator()
    let pdfBlob: Blob
    let filename: string

    if (type === 'order') {
      // Generate basic order document
      pdfBlob = generator.generateOrderPDF(orderData as any)
      filename = `${orderData.order_no}-order.pdf`
    } else {
      // Fetch specific document
      let docType: string
      switch (type) {
        case 'purchase_order':
          docType = 'PO'
          break
        case 'invoice':
          docType = 'INVOICE'
          break
        case 'receipt':
          docType = 'RECEIPT'
          break
        default:
          return NextResponse.json(
            { error: 'Invalid document type' },
            { status: 400 }
          )
      }

      const { data: documentData, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('order_id', orderId)
        .eq('doc_type', docType)
        .single()

      if (docError || !documentData) {
        return NextResponse.json(
          { error: `${type} not found for this order` },
          { status: 404 }
        )
      }

      // Generate specific document PDF
      switch (type) {
        case 'purchase_order':
          pdfBlob = generator.generatePurchaseOrderPDF(orderData as any, documentData as any)
          filename = `${orderData.order_no}-PO.pdf`
          break
        case 'invoice':
          pdfBlob = generator.generateInvoicePDF(orderData as any, documentData as any)
          filename = `${orderData.order_no}-invoice.pdf`
          break
        case 'receipt':
          pdfBlob = generator.generateReceiptPDF(orderData as any, documentData as any)
          filename = `${orderData.order_no}-receipt.pdf`
          break
        default:
          pdfBlob = generator.generateOrderPDF(orderData as any)
          filename = `${orderData.order_no}-order.pdf`
      }

      // Optional: Upload to Supabase Storage
      try {
        const arrayBuffer = await pdfBlob.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('order-documents')
          .upload(`${orderId}/${filename}`, buffer, {
            contentType: 'application/pdf',
            upsert: true
          })

        if (!uploadError) {
          console.log('PDF uploaded to storage:', uploadData.path)
        }
      } catch (uploadErr) {
        console.error('Error uploading to storage:', uploadErr)
        // Continue even if upload fails
      }
    }

    // Convert blob to buffer for response
    const arrayBuffer = await pdfBlob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error('Error generating PDF:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}
