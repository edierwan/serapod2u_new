import { guardUserOperation } from '@/lib/security-access/operation'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateQRBatch, type QRCodeGenerationParams } from '@/lib/qr-generator'
import { PROCESSING_ORG_TYPES, canProcessBatchForOrder } from '@/lib/qr-batch-access'

/**
 * POST /api/qr-batches/generate
 * Queue QR batch generation for an approved H2M order
 * This endpoint now only creates the batch record and queues it for the background worker.
 *
 * qr_batches is read-only to supply partners under RLS, so the order is read
 * and the batch row written with the service role, after the caller is shown
 * to be an active HQ/MFG user whose organization owns the order. Orders
 * outside the caller's organization respond 404 like unknown ones.
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
    const saDenied = await guardUserOperation(user.id, 'qr.batch.manage')
    if (saDenied) return saDenied

    const { data: profile, error: profileError } = await (supabase as any)
      .from('users')
      .select('is_active, organization_id, organizations:organization_id(org_type_code)')
      .eq('id', user.id)
      .single()

    const orgType = String(profile?.organizations?.org_type_code || '').toUpperCase()
    const orgId = String(profile?.organization_id || '')
    if (profileError || !profile || profile.is_active === false || !orgId || !PROCESSING_ORG_TYPES.includes(orgType)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient() as any

    // 1. Fetch order with all details
    const { data: order, error: orderError } = await admin
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
      .maybeSingle()

    if (orderError) {
      console.error('❌ Order lookup error:', orderError)
      return NextResponse.json(
        { error: 'Failed to load order', details: orderError.message },
        { status: 500 }
      )
    }
    if (!order || !canProcessBatchForOrder(orgType, orgId, order)) {
      return NextResponse.json(
        { error: 'Order not found or not eligible for QR generation' },
        { status: 404 }
      )
    }

    // Check if batch already exists
    const { data: existingBatch, error: existingBatchError } = await admin
      .from('qr_batches')
      .select('id, status, total_unique_codes, total_master_codes')
      .eq('order_id', order_id)
      .limit(1)
      .maybeSingle()

    if (existingBatchError) {
      console.error('❌ Existing batch lookup error:', existingBatchError)
      return NextResponse.json(
        { error: 'Failed to check existing batch', details: existingBatchError.message },
        { status: 500 }
      )
    }

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
    const orderItems: QRCodeGenerationParams['orderItems'] = order.order_items.map((item: any) => {
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
    const { data: batch, error: batchError } = await admin
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
