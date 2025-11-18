import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateQRBatch } from '@/lib/qr-generator'
import { generateQRExcel, generateQRExcelFilename } from '@/lib/excel-generator'

/**
 * POST /api/qr-batches/generate
 * Generate QR batch and Excel file for an approved H2M order
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large batches (Vercel Pro limit)

export async function POST(request: NextRequest) {
  const startTime = Date.now()

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
    const orderItems = order.order_items.map((item: any) => {
      // Determine units_per_case: use item value, or infer from product type
      let itemUnitsPerCase = item.units_per_case
      
      // If not set, infer from product name/code
      if (itemUnitsPerCase == null) {
        const productCode = item.product.product_code?.toUpperCase() || ''
        const productName = item.product.product_name?.toLowerCase() || ''
        
        if (productCode.includes('SLINE') || productName.includes('s.line')) {
          itemUnitsPerCase = 200
        } else if (productCode.includes('SBOX') || productName.includes('s.box')) {
          itemUnitsPerCase = 50
        } else {
          itemUnitsPerCase = 100 // Default
        }
        
        console.log(`📦 Inferred units_per_case for ${item.product.product_name}: ${itemUnitsPerCase}`)
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
    
    console.log('📋 Order items with case sizes:', orderItems.map(i => `${i.product_name}: ${i.qty} units @ ${i.units_per_case}/case`))

    // 3. Generate QR codes
    console.log('⏳ Generating QR batch...')
    
    // Check if order uses individual case sizes per product
    const hasIndividualCaseSizes = orderItems.some(item => item.units_per_case != null)
    
    console.log('📦 Case configuration:', hasIndividualCaseSizes ? 'Individual case sizes per product' : `Standard ${order.units_per_case || 100} units/case`)
    
    const qrBatch = generateQRBatch({
      orderNo: order.order_no,
      manufacturerCode: order.seller_org.org_code,  // Pass manufacturer code for variant_key
      orderItems,
      bufferPercent: order.qr_buffer_percent || 10,
      unitsPerCase: order.units_per_case || 100, // Default/fallback for non-individual mode
      useIndividualCaseSizes: hasIndividualCaseSizes
    })

    console.log('✅ Generated QR Batch:', {
      order_no: order.order_no,
      master_codes: qrBatch.totalMasterCodes,
      unique_codes: qrBatch.totalUniqueCodes
    })

    // 4. Generate Excel file (streaming for large batches)
    console.log('⏳ Generating Excel file (this may take a while for large batches)...')
    const excelFilePath = await generateQRExcel({
      orderNo: order.order_no,
      orderDate: new Date(order.created_at || new Date().toISOString()).toLocaleDateString(),
      companyName: order.buyer_org.org_name,
      manufacturerName: order.seller_org.org_name,
      masterCodes: qrBatch.masterCodes,
      individualCodes: qrBatch.individualCodes,
      totalMasterCodes: qrBatch.totalMasterCodes,
      totalUniqueCodes: qrBatch.totalUniqueCodes,
      bufferPercent: qrBatch.bufferPercent
    })

    const excelFilename = generateQRExcelFilename(order.order_no)
    console.log('✅ Generated Excel file:', excelFilename)

    // 5. Upload Excel to Supabase Storage
    const storagePath = `${order.seller_org.id}/${order_id}/${excelFilename}`

    // Read file as buffer for storage upload
    const fs = await import('fs/promises')
    const excelBuffer = await fs.readFile(excelFilePath)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('qr-codes')
      .upload(storagePath, excelBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false
      })

    // Cleanup temp Excel file after upload
    await fs.unlink(excelFilePath).catch(() => { })

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
    console.log('📝 Creating batch for order:', {
      order_id: order.id,
      company_id: order.company_id || order.seller_org.id,
      order_no: order.order_no
    })

    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .insert({
        order_id: order.id,
        company_id: order.company_id || order.seller_org.id,
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

    // 7. Insert master codes and individual codes
    console.log('📝 Inserting master codes with org IDs:', {
      manufacturer_org_id: order.seller_org_id,
      warehouse_org_id: order.warehouse_org_id,
      company_id: order.company_id
    })

    const masterCodesData = qrBatch.masterCodes.map(master => ({
      batch_id: batch.id,
      master_code: master.code,
      case_number: master.case_number,
      status: 'generated',
      expected_unit_count: master.expected_unit_count,
      actual_unit_count: 0,
      manufacturer_org_id: order.seller_org_id,
      warehouse_org_id: order.warehouse_org_id,
      company_id: order.company_id,
      manufacturer_scanned_at: null,
      warehouse_received_at: null
    }))

    console.log('📋 Sample master codes to insert (first 3):', masterCodesData.slice(0, 3).map(m => ({
      master_code: m.master_code,
      case_number: m.case_number,
      expected_unit_count: m.expected_unit_count
    })))

    const { data: insertedMasters, error: masterError } = await supabase
      .from('qr_master_codes')
      .insert(masterCodesData)
      .select('id, case_number, master_code, expected_unit_count')

    if (masterError) {
      console.error('❌ Master codes insert error:', {
        error_code: masterError.code,
        error_message: masterError.message,
        error_details: masterError.details,
        error_hint: masterError.hint,
        sample_data: masterCodesData.slice(0, 2)
      })
      // CRITICAL: Throw error instead of continuing - without master codes, the batch is useless
      throw new Error(`Failed to insert master codes: ${masterError.message}`)
    } else {
      console.log(`✅ Inserted ${masterCodesData.length} master codes`)
      console.log('📋 Sample inserted masters:', insertedMasters?.slice(0, 3).map(m => ({
        id: m.id,
        master_code: m.master_code,
        case_number: m.case_number
      })))
    }

    // Create a map of case_number to master_code_id for linking
    const caseToMasterIdMap = new Map<number, string>()
    if (insertedMasters) {
      insertedMasters.forEach(master => {
        caseToMasterIdMap.set(master.case_number, master.id)
      })
      console.log(`✅ Created case to master ID mapping for ${caseToMasterIdMap.size} cases`)
    }

    // 8. Insert Individual QR codes (in batches to avoid timeout)
    // Increased batch size for better performance with large datasets
    const BATCH_SIZE = 1000
    console.log(`⏳ Inserting ${qrBatch.individualCodes.length} QR codes in batches of ${BATCH_SIZE}...`)

    // Add master_code_id to individual codes for non-buffer codes
    const codesWithMasterIds = qrBatch.individualCodes.map(code => ({
      ...code,
      master_code_id: !code.is_buffer && code.case_number ? caseToMasterIdMap.get(code.case_number) : null
    }))

    const totalInserted = await insertQRCodesInBatches(
      supabase,
      batch.id,
      order.id,
      order.company_id || order.seller_org.id,
      order.seller_org_id,
      order.warehouse_org_id || order.seller_org_id, // Fallback to seller if warehouse not set
      codesWithMasterIds,
      BATCH_SIZE
    )

    console.log(`✅ Inserted ${totalInserted} individual QR codes`)

    // 9. Verify master codes were actually inserted
    const { data: verifyMasters, error: verifyError } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, case_number')
      .eq('batch_id', batch.id)
      .limit(5)

    if (verifyError || !verifyMasters || verifyMasters.length === 0) {
      console.error('⚠️ CRITICAL: Master codes verification failed!', {
        error: verifyError,
        found_count: verifyMasters?.length || 0,
        batch_id: batch.id
      })
      throw new Error('Master codes were not saved to database. Batch generation incomplete.')
    }

    console.log(`✅ Verified ${verifyMasters.length} master codes exist in database`)

    // 10. Return success response
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`✅ QR Batch generation complete in ${totalTime}s`)

    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      order_no: order.order_no,
      total_master_codes: qrBatch.totalMasterCodes,
      total_unique_codes: qrBatch.totalUniqueCodes,
      excel_file_url: publicUrl,
      generation_time_seconds: parseFloat(totalTime),
      message: `Generated ${qrBatch.totalUniqueCodes} QR codes in ${qrBatch.totalMasterCodes} cases`
    })

  } catch (error: any) {
    console.error('❌ QR Batch Generation Error:', error)

    // More detailed error logging
    if (error.message?.includes('out of memory')) {
      console.error('💥 OUT OF MEMORY - Dataset too large for current configuration')
    }

    return NextResponse.json(
      {
        error: 'Failed to generate QR batch',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * Helper function to insert QR codes in batches to avoid timeout
 * Optimized for large datasets with progress logging
 */
async function insertQRCodesInBatches(
  supabase: any,
  batchId: string,
  orderId: string,
  companyId: string,
  manufacturerOrgId: string,
  warehouseOrgId: string,
  codes: any[],
  batchSize: number
): Promise<number> {
  let totalInserted = 0
  const totalBatches = Math.ceil(codes.length / batchSize)

  for (let i = 0; i < codes.length; i += batchSize) {
    const chunk = codes.slice(i, i + batchSize)
    const currentBatch = Math.floor(i / batchSize) + 1

    const inserts = chunk.map(code => ({
      batch_id: batchId,
      company_id: companyId,
      order_id: orderId,
      product_id: code.product_id,
      variant_id: code.variant_id,
      code: code.code,
      qr_hash: code.hash, // Store security hash
      sequence_number: code.sequence_number,
      case_number: code.case_number,  // NEW: Case assignment
      variant_key: code.variant_key,  // NEW: Variant grouping key
      is_buffer: code.is_buffer,  // NEW: Buffer flag
      status: code.is_buffer ? 'buffer_available' : 'generated',  // Start as 'generated', change to 'printed' after Excel download
      is_active: true,
      master_code_id: code.master_code_id || null  // Link to master during generation
    }))

    const { error } = await supabase
      .from('qr_codes')
      .insert(inserts)

    if (error) {
      console.error(`❌ Error inserting batch ${currentBatch}/${totalBatches}:`, error)
      throw error
    }

    totalInserted += inserts.length

    // Log progress every 10 batches or 10,000 codes
    if (currentBatch % 10 === 0 || totalInserted >= codes.length) {
      const progress = ((totalInserted / codes.length) * 100).toFixed(1)
      console.log(`  ⏳ Progress: ${totalInserted}/${codes.length} codes (${progress}%) - Batch ${currentBatch}/${totalBatches}`)
    }
  }

  return totalInserted
}
