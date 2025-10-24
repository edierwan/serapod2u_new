import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateQRBatch } from '@/lib/qr-generator'
import { generateQRExcel, generateQRExcelFilename } from '@/lib/excel-generator'

/**
 * POST /api/qr-batches/generate
 * Generate QR batch and Excel file for an approved H2M order
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
      .select('id, excel_file_url')
      .eq('order_id', order_id)
      .single()

    if (existingBatch) {
      return NextResponse.json(
        { error: 'QR batch already exists for this order', batch: existingBatch },
        { status: 409 }
      )
    }

    // 2. Prepare data for QR generation
    const orderItems = order.order_items.map((item: any) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_code: item.product.product_code,
      variant_code: item.variant.variant_code,
      product_name: item.product.product_name,
      variant_name: item.variant.variant_name,
      qty: item.qty
    }))

    // 3. Generate QR codes
    const qrBatch = generateQRBatch({
      orderNo: order.order_no,
      orderItems,
      bufferPercent: order.qr_buffer_percent || 10,
      unitsPerCase: order.units_per_case || 100
    })

    console.log('✅ Generated QR Batch:', {
      order_no: order.order_no,
      master_codes: qrBatch.totalMasterCodes,
      unique_codes: qrBatch.totalUniqueCodes
    })

    // 4. Generate Excel file
    const excelBuffer = generateQRExcel({
      orderNo: order.order_no,
      orderDate: new Date(order.created_at).toLocaleDateString(),
      companyName: order.buyer_org.org_name,
      manufacturerName: order.seller_org.org_name,
      masterCodes: qrBatch.masterCodes,
      individualCodes: qrBatch.individualCodes,
      totalMasterCodes: qrBatch.totalMasterCodes,
      totalUniqueCodes: qrBatch.totalUniqueCodes,
      bufferPercent: qrBatch.bufferPercent
    })

    const filename = generateQRExcelFilename(order.order_no)
    console.log('✅ Generated Excel file:', filename)

    // 5. Upload Excel to Supabase Storage
    const storagePath = `${order.seller_org.id}/${order_id}/${filename}`
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('qr-codes')
      .upload(storagePath, excelBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false
      })

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload Excel file', details: uploadError.message },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('qr-codes')
      .getPublicUrl(storagePath)

    console.log('✅ Uploaded to storage:', publicUrl)

    // 6. Create QR batch record
    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .insert({
        order_id: order.id,
        company_id: order.seller_org.id,
        total_master_codes: qrBatch.totalMasterCodes,
        total_unique_codes: qrBatch.totalUniqueCodes,
        buffer_percent: qrBatch.bufferPercent,
        excel_file_url: publicUrl,
        excel_generated_at: new Date().toISOString(),
        excel_generated_by: user.id,
        status: 'generated',
        created_by: user.id
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

    console.log('✅ Created batch record:', batch.id)

    // 7. Insert Master QR codes
    const masterCodeInserts = qrBatch.masterCodes.map(master => ({
      batch_id: batch.id,
      company_id: order.seller_org.id,
      master_code: master.code,
      case_number: master.case_number,
      expected_unit_count: master.expected_unit_count,
      status: 'pending'
    }))

    const { error: masterError } = await supabase
      .from('qr_master_codes')
      .insert(masterCodeInserts)

    if (masterError) {
      console.error('❌ Master codes insert error:', masterError)
      // Continue despite error - batch is already created
    } else {
      console.log(`✅ Inserted ${masterCodeInserts.length} master codes`)
    }

    // 8. Insert Individual QR codes (in batches to avoid timeout)
    const BATCH_SIZE = 500
    const totalInserted = await insertQRCodesInBatches(
      supabase,
      batch.id,
      order.id,
      order.seller_org.id,
      qrBatch.individualCodes,
      BATCH_SIZE
    )

    console.log(`✅ Inserted ${totalInserted} individual QR codes`)

    // 9. Return success response
    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      order_no: order.order_no,
      total_master_codes: qrBatch.totalMasterCodes,
      total_unique_codes: qrBatch.totalUniqueCodes,
      excel_file_url: publicUrl,
      message: `Generated ${qrBatch.totalUniqueCodes} QR codes in ${qrBatch.totalMasterCodes} cases`
    })

  } catch (error: any) {
    console.error('❌ QR Batch Generation Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate QR batch', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * Helper function to insert QR codes in batches to avoid timeout
 */
async function insertQRCodesInBatches(
  supabase: any,
  batchId: string,
  orderId: string,
  companyId: string,
  codes: any[],
  batchSize: number
): Promise<number> {
  let totalInserted = 0

  for (let i = 0; i < codes.length; i += batchSize) {
    const chunk = codes.slice(i, i + batchSize)
    
    const inserts = chunk.map(code => ({
      batch_id: batchId,
      company_id: companyId,
      order_id: orderId,
      product_id: code.product_id,
      variant_id: code.variant_id,
      code: code.code,
      sequence_number: code.sequence_number,
      status: 'pending',
      is_active: true
    }))

    const { error } = await supabase
      .from('qr_codes')
      .insert(inserts)

    if (error) {
      console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, error)
      throw error
    }

    totalInserted += inserts.length
    console.log(`✅ Inserted ${totalInserted}/${codes.length} QR codes...`)
  }

  return totalInserted
}
