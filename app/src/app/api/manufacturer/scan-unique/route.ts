import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { qr_code } = body

    if (!qr_code || typeof qr_code !== 'string') {
      return NextResponse.json(
        { error: 'QR code is required' },
        { status: 400 }
      )
    }

    // Extract QR code from URL if it's a full URL
    let codeToScan = qr_code.trim()
    if (codeToScan.includes('/track/product/')) {
      // Extract the code from URL: http://www.serapod2u.com/track/product/PROD-ZEREL6829-MAN-552896-ORD-HM-1025-03-00001
      const parts = codeToScan.split('/track/product/')
      if (parts.length > 1) {
        codeToScan = parts[1]
      }
    }

    // Find QR code in database
    const { data: qrCode, error: qrError } = await supabase
      .from('qr_codes')
      .select(`
        id,
        code,
        status,
        batch_id,
        order_id,
        product_id,
        variant_id,
        sequence_number,
        master_code_id,
        products (
          id,
          product_code,
          product_name
        ),
        product_variants (
          id,
          variant_code,
          variant_name
        ),
        orders (
          id,
          order_no,
          buyer_org_id,
          seller_org_id
        ),
        qr_batches (
          id,
          order_id,
          total_master_codes,
          total_unique_codes
        )
      `)
      .eq('code', codeToScan)
      .single()

    if (qrError || !qrCode) {
      return NextResponse.json(
        { error: 'QR code not found in system' },
        { status: 404 }
      )
    }

    // Check if already linked to master
    // Newly generated/printed codes will still have status of 'pending', 'generated', or 'printed'
    // Only treat codes as already scanned when they have progressed beyond manufacturing capture
    const allowableStatuses = ['pending', 'generated', 'printed']
    const alreadyScanned =
      qrCode.master_code_id !== null ||
      (qrCode.status ? !allowableStatuses.includes(qrCode.status) : false)

    // Extract single objects from arrays (Supabase returns arrays even for single relations)
    const product = Array.isArray(qrCode.products) ? qrCode.products[0] : qrCode.products
    const variant = Array.isArray(qrCode.product_variants) ? qrCode.product_variants[0] : qrCode.product_variants
    const order = Array.isArray(qrCode.orders) ? qrCode.orders[0] : qrCode.orders
    const batch = Array.isArray(qrCode.qr_batches) ? qrCode.qr_batches[0] : qrCode.qr_batches

    // Generate batch code from order number or batch ID
    const batchCode = order?.order_no 
      ? `BATCH-${order.order_no}` 
      : batch?.id 
        ? `BATCH-${batch.id.substring(0, 8).toUpperCase()}`
        : 'UNKNOWN'

    return NextResponse.json({
      success: true,
      already_scanned: alreadyScanned,
      product_info: {
        id: qrCode.id,
        code: qrCode.code,
        product_code: product?.product_code,
        product_name: product?.product_name,
        variant_code: variant?.variant_code,
        variant_name: variant?.variant_name,
        order_no: order?.order_no,
        batch_code: batchCode,
        batch_id: qrCode.batch_id,
        sequence_number: qrCode.sequence_number,
        status: qrCode.status
      }
    })
  } catch (error: any) {
    console.error('Error scanning QR code:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to scan QR code' },
      { status: 500 }
    )
  }
}
