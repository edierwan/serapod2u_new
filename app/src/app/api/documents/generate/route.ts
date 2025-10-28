import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PDFGenerator } from '@/lib/pdf-generator'

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn('Unable to fetch signature image:', url, response.status)
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    console.error('Error fetching signature image:', url, error)
    return null
  }
}

function formatRoleName(roleName?: string | null, roleCode?: string | null): string {
  if (roleName && roleName.trim().length > 0) {
    return roleName
  }

  if (roleCode && roleCode.trim().length > 0) {
    return roleCode.replace(/_/g, ' ').toUpperCase()
  }

  return ''
}

export const dynamic = 'force-dynamic'

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

    // Fetch approver data if order is approved
    let enrichedOrderData = orderData
    if (orderData.approved_by) {
      const { data: approver } = await supabase
        .from('users')
        .select('full_name, signature_url, role_code, roles:role_code(role_name)')
        .eq('id', orderData.approved_by)
        .single()
      
      if (approver) {
        const approverSignatureImage = approver.signature_url
          ? await fetchImageAsDataUrl(approver.signature_url)
          : null

        // Generate approval integrity hash
        const approvalData = `${orderData.order_no}|${orderData.approved_by}|${orderData.approved_at}`
        const encoder = new TextEncoder()
        const dataBuffer = encoder.encode(approvalData)
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const approvalHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
        
        enrichedOrderData = {
          ...orderData,
          approver: {
            full_name: approver.full_name,
            signature_url: approver.signature_url,
            role_name: formatRoleName((approver.roles as any)?.role_name, approver.role_code) || 'HQ POWER USER'
          },
          approval_hash: approvalHash,
          approver_signature_image: approverSignatureImage
        }
      }
    }

    // Fetch signatures (will be empty for unsigned documents)
    let signatures: any[] = []

    const generator = new PDFGenerator(signatures)
    let pdfBlob: Blob
    let filename: string

    if (type === 'order') {
      // Generate basic order document
      pdfBlob = await generator.generateOrderPDF(enrichedOrderData as any)
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

      let paymentDocument: any = null
      if (docType === 'RECEIPT') {
        const { data: paymentData } = await supabase
          .from('documents')
          .select('*')
          .eq('order_id', orderId)
          .eq('doc_type', 'PAYMENT')
          .single()

        if (paymentData) {
          paymentDocument = paymentData
        }
      }

      // For Invoice PDF: Fetch PO acknowledgment to show manufacturer who acknowledged PO
      let poDocument: any = null
      if (docType === 'INVOICE') {
        const { data: poData } = await supabase
          .from('documents')
          .select('*')
          .eq('order_id', orderId)
          .eq('doc_type', 'PO')
          .single()

        if (poData) {
          poDocument = poData
        }
      }

      const acknowledgementSource =
        docType === 'RECEIPT' && paymentDocument ? paymentDocument : 
        docType === 'INVOICE' && poDocument ? poDocument :
        documentData

      // Fetch acknowledger data if acknowledgement exists 
      // (use payment doc for receipts, PO for invoices)
      let enrichedDocumentData = {
        ...documentData,
        acknowledged_at: acknowledgementSource?.acknowledged_at ?? documentData.acknowledged_at,
        acknowledged_by: acknowledgementSource?.acknowledged_by ?? documentData.acknowledged_by
      }

      if (acknowledgementSource?.acknowledged_by) {
        const { data: acknowledger } = await supabase
          .from('users')
          .select('full_name, signature_url, role_code, roles:role_code(role_name)')
          .eq('id', acknowledgementSource.acknowledged_by)
          .single()
        
        if (acknowledger) {
          const acknowledgerSignatureImage = acknowledger.signature_url
            ? await fetchImageAsDataUrl(acknowledger.signature_url)
            : null

          // Generate acknowledgement integrity hash
          const ackData = `${acknowledgementSource.doc_no}|${acknowledgementSource.acknowledged_by}|${acknowledgementSource.acknowledged_at}`
          const encoder = new TextEncoder()
          const dataBuffer = encoder.encode(ackData)
          const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          const ackHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
          
          enrichedDocumentData = {
            ...enrichedDocumentData,
            acknowledger: {
              full_name: acknowledger.full_name,
              signature_url: acknowledger.signature_url,
              role_name: formatRoleName((acknowledger.roles as any)?.role_name, acknowledger.role_code) || 'MANUFACTURER'
            },
            acknowledgement_hash: ackHash,
            acknowledger_signature_image: acknowledgerSignatureImage
          }
        }
      }

      // Fetch signatures for this document
      const signaturesDocumentId =
        docType === 'RECEIPT' && paymentDocument ? paymentDocument.id : documentData.id

      const { data: signaturesData } = await supabase
        .rpc('get_document_signatures', { p_document_id: signaturesDocumentId })

      if (signaturesData && signaturesData.length > 0) {
        signatures = await Promise.all(
          signaturesData.map(async (sig: any) => ({
            ...sig,
            integrity_hash: sig.signature_hash,
            signature_image_data: sig.signature_image_url
              ? await fetchImageAsDataUrl(sig.signature_image_url)
              : null
          }))
        )

        const manufacturerSignature = [...signatures]
          .reverse()
          .find((sig) => (sig.signer_role || '').toUpperCase().includes('MANUFACTUR'))

        if (manufacturerSignature) {
          enrichedDocumentData = {
            ...enrichedDocumentData,
            acknowledged_at: manufacturerSignature.signed_at || enrichedDocumentData.acknowledged_at,
            acknowledgement_hash:
              manufacturerSignature.integrity_hash || manufacturerSignature.signature_hash || enrichedDocumentData.acknowledgement_hash,
            acknowledger: {
              full_name: manufacturerSignature.signer_name,
              role_name: formatRoleName(undefined, manufacturerSignature.signer_role) || manufacturerSignature.signer_role || 'MANUFACTURER',
              signature_url: manufacturerSignature.signature_image_url
            },
            acknowledger_signature_image:
              manufacturerSignature.signature_image_data || enrichedDocumentData.acknowledger_signature_image || null
          }
        }
      }

      // Update generator with signatures
      const generatorWithSigs = new PDFGenerator(signatures)

      // Generate specific document PDF
      switch (type) {
        case 'purchase_order':
          pdfBlob = await generatorWithSigs.generatePurchaseOrderPDF(enrichedOrderData as any, enrichedDocumentData as any)
          filename = `${orderData.order_no}-PO.pdf`
          break
        case 'invoice':
          pdfBlob = await generatorWithSigs.generateInvoicePDF(enrichedOrderData as any, enrichedDocumentData as any)
          filename = `${orderData.order_no}-invoice.pdf`
          break
        case 'receipt':
          pdfBlob = await generatorWithSigs.generateReceiptPDF(enrichedOrderData as any, enrichedDocumentData as any)
          filename = `${orderData.order_no}-receipt.pdf`
          break
        default:
          pdfBlob = await generatorWithSigs.generateOrderPDF(enrichedOrderData as any)
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
