import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePdfForOrderDocument } from '@/lib/documents/pdf-generation'
import { PDFDocument } from 'pdf-lib'
import { Buffer } from 'buffer'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{
    orderId: string
  }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { orderId } = await context.params

  if (!orderId) {
    return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, order_no')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const { data: docs, error: docsError } = await supabase
      .from('documents')
      .select('id, doc_type, status, payment_percentage, payload, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    if (docsError || !docs || docs.length === 0) {
      return NextResponse.json({ error: 'No documents found for this order' }, { status: 404 })
    }

    const invoices: any[] = []
    const payments: any[] = []
    const receipts: any[] = []
    const paymentRequests: any[] = []
    let purchaseOrder: any = null

    for (const doc of docs) {
      switch ((doc as any).doc_type) {
        case 'PO':
          purchaseOrder = doc
          break
        case 'INVOICE':
          invoices.push(doc)
          break
        case 'PAYMENT':
          payments.push(doc)
          break
        case 'RECEIPT':
          receipts.push(doc)
          break
        case 'PAYMENT_REQUEST':
          paymentRequests.push(doc)
          break
        default:
          break
      }
    }

    const depositInvoice = invoices[0] ?? null
    const balancePaymentRequest = paymentRequests[paymentRequests.length - 1] ?? null

    const balancePayments = payments.filter((payment) => {
      const payload = (payment?.payload ?? {}) as Record<string, any>
      const sourceRequestId = payload?.source_request_id ?? payload?.source_request ?? null
      return Boolean(sourceRequestId)
    })
    const depositPayments = payments.filter((payment) => !balancePayments.includes(payment))

    const depositPayment = depositPayments[0] ?? null
    const balancePayment = balancePayments[balancePayments.length - 1] ?? null

    const isFinalReceipt = (receipt: any) => {
      if (typeof receipt.payment_percentage === 'number') {
        return receipt.payment_percentage >= 99
      }
      const payload = (receipt?.payload ?? {}) as Record<string, any>
      if (typeof payload.payment_percentage === 'number') {
        return payload.payment_percentage >= 99
      }
      return payload.is_final_receipt === true || payload.stage === 'final' || payload.payment_stage === 'final'
    }

    const finalReceipt = receipts.find(isFinalReceipt)

    if (!finalReceipt) {
      return NextResponse.json({
        error: 'Final receipt not ready',
        details: 'Please acknowledge the final balance payment first.'
      }, { status: 409 })
    }

    const depositReceipt = receipts.find((receipt) => {
      if (receipt === finalReceipt) return false
      if (typeof receipt.payment_percentage === 'number') {
        return receipt.payment_percentage < 99
      }
      const payload = (receipt?.payload ?? {}) as Record<string, any>
      if (typeof payload.payment_percentage === 'number') {
        return payload.payment_percentage < 99
      }
      return payload.is_deposit_receipt === true || payload.stage === 'deposit' || payload.payment_stage === 'deposit'
    })

    const sequence: Array<{ type: 'purchase_order' | 'invoice' | 'payment_request' | 'payment' | 'receipt'; documentId: string; label: string }> = []

    if (purchaseOrder) {
      sequence.push({ type: 'purchase_order', documentId: purchaseOrder.id, label: 'Purchase Order' })
    }

    if (depositInvoice) {
      sequence.push({ type: 'invoice', documentId: depositInvoice.id, label: 'Deposit Invoice' })
    }

    if (depositPayment) {
      sequence.push({ type: 'payment', documentId: depositPayment.id, label: 'Deposit Payment' })
    }

    if (balancePaymentRequest) {
      sequence.push({ type: 'payment_request', documentId: balancePaymentRequest.id, label: 'Balance Payment Request' })
    }

    if (balancePayment) {
      sequence.push({ type: 'payment', documentId: balancePayment.id, label: 'Balance Payment' })
    }

    if (depositReceipt) {
      sequence.push({ type: 'receipt', documentId: depositReceipt.id, label: 'Deposit Receipt' })
    }

    sequence.push({ type: 'receipt', documentId: finalReceipt.id, label: 'Final Receipt' })

    const mergedPdf = await PDFDocument.create()

    for (const entry of sequence) {
      try {
        const { buffer } = await generatePdfForOrderDocument(orderId, entry.type, {
          documentId: entry.documentId,
          supabaseClient: supabase,
          skipUpload: true
        })

        const sourcePdf = await PDFDocument.load(buffer)
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
        for (const page of copiedPages) {
          mergedPdf.addPage(page)
        }
      } catch (error) {
        console.error(`Failed to append ${entry.label}:`, error)
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      return NextResponse.json({ error: 'Unable to build combined PDF' }, { status: 500 })
    }

    mergedPdf.setTitle(`${(order as any).order_no} - Complete Document Package`)
    mergedPdf.setSubject('Combined Purchase Order, Invoices, Payments and Receipts')
    mergedPdf.setAuthor('Serapod Platform')

    const mergedBytes = await mergedPdf.save()
    const filename = `${(order as any).order_no}-complete-package.pdf`

    return new NextResponse(Buffer.from(mergedBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (error: any) {
    console.error('Failed to generate combined document package:', error)
    return NextResponse.json({ error: error?.message || 'Failed to generate document package' }, { status: 500 })
  }
}
