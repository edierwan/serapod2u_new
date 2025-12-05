import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateQRBatch } from '@/lib/qr-generator'

/**
 * POST /api/qr-batches/generate
 * Queue QR batch generation for an approved H2M order
 * This endpoint now only creates the batch record and queues it for the background worker.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { order_id } = await request.json()

    if (!order_id) {
      return NextResponse.json(
        { error: 'Missing order_id parameter' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 1. Fetch order with all details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        buyer_org:organizations!orders_buyer_org_id_fkey(
          id, org_name, org_code
        ),
        seller_org:organizations!orders_seller_org_id_fkey(
          id, org_name, org_code
        ),
        order_items(
          id,
          qty,
          product_id,
          variant_id,
          units_per_case,
          product:products(
            id,
            product_code,
            product_name
          ),
          variant:product_variants(
            id,
            variant_code,
            variant_name
          )
        )
      `)
      .eq('id', order_id)
      .eq('order_type', 'H2M')
      .in('status', ['approved', 'closed'])
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found or not eligible for QR generation' },
        { status: 404 }
      )
    }

    // Check if batch already exists
    const { data: existingBatch } = await supabase
      .from('qr_batches')
      .select('id, status, total_unique_codes, total_master_codes')
      .eq('order_id', order_id)
      .single()

    if (existingBatch) {
      return NextResponse.json(
        { 
          message: 'QR batch already exists for this order', 
          batch: existingBatch,
          status: existingBatch.status
        },
        { status: 200 }
      )
    }

    // 2. Prepare data for QR generation (to calculate totals)
    const orderItems = order.order_items.map((item: any) => {
      let itemUnitsPerCase = item.units_per_case
      if (itemUnitsPerCase == null) {
        itemUnitsPerCase = order.units_per_case || 100
      }
      return {
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_code: item.product.product_code,
        variant_code: item.variant.variant_code,
        product_name: item.product.product_name,
        variant_name: item.variant.variant_name,
        qty: item.qty,
        units_per_case: itemUnitsPerCase
      }
    })
    
    // Calculate totals using the generator logic
    const qrBatch = generateQRBatch({
      orderNo: order.order_no,
      manufacturerCode: order.seller_org.org_code,
      orderItems,
      bufferPercent: order.qr_buffer_percent || 10,
      unitsPerCase: order.units_per_case || 100,
      useIndividualCaseSizes: orderItems.some(item => item.units_per_case != null)
    })

    console.log('📝 Queuing batch for order:', {
      order_id: order.id,
      company_id: order.company_id || order.seller_org.id,
      order_no: order.order_no,
      total_unique: qrBatch.totalUniqueCodes
    })

    // 3. Create QR batch record with 'queued' status
    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .insert({
        order_id: order.id,
        company_id: order.company_id || order.seller_org.id,
        total_master_codes: qrBatch.totalMasterCodes,
        total_unique_codes: qrBatch.totalUniqueCodes,
        buffer_percent: qrBatch.bufferPercent,
        status: 'queued',
        created_by: user.id,
        excel_generated: false,
        master_inserted: false,
        qr_inserted_count: 0
      })
      .select()
      .single()

    if (batchError) {
      console.error('❌ Batch creation error:', batchError)
      return NextResponse.json(
        { error: 'Failed to create batch record', details: batchError.message },
        { status: 500 }
      )
    }

    console.log('✅ Batch queued successfully:', batch.id)

    return NextResponse.json({
      success: true,
      message: 'Batch queued for generation. This may take a few minutes.',
      batch_id: batch.id,
      status: 'queued',
      total_unique_codes: qrBatch.totalUniqueCodes
    })

  } catch (error: any) {
    console.error('❌ QR Batch Queue Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to queue QR batch',
        details: error.message
      },
      { status: 500 }
    )
  }
}
