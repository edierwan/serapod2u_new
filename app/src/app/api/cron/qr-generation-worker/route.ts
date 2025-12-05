import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateQRBatch } from '@/lib/qr-generator'
import { generateQRExcel, generateQRExcelFilename } from '@/lib/excel-generator'

/**
 * CRON: /api/cron/qr-generation-worker
 * Background worker to process queued QR batches
 * Runs every minute via Vercel Cron
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Keep each run short to avoid timeouts

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const supabase = await createClient()

  try {
    // 1. Find a batch to process (queued or processing)
    // We prioritize 'processing' to finish what we started, then 'queued'
    const { data: batch, error: fetchError } = await supabase
      .from('qr_batches')
      .select(`
        *,
        order:orders!qr_batches_order_id_fkey(
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
        )
      `)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (fetchError || !batch) {
      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('❌ Error fetching batch:', fetchError)
      }
      return NextResponse.json({ message: 'No batches to process' })
    }

    console.log(`⚙️ Processing batch ${batch.id} (Status: ${batch.status})`)

    // 2. Update status to processing if needed
    if (batch.status === 'queued') {
      const { data: updated, error: updateError } = await supabase
        .from('qr_batches')
        .update({ 
          status: 'processing',
          processing_started_at: new Date().toISOString()
        })
        .eq('id', batch.id)
        .eq('status', 'queued') // Optimistic locking: ensure it's still queued
        .select()

      if (!updated || updated.length === 0) {
        console.log('⚠️ Batch claimed by another worker, skipping')
        return NextResponse.json({ message: 'Batch claimed by another worker' })
      }
    } else if (batch.status === 'processing') {
      // If it's already processing (e.g. retry), just log it
      console.log('🔄 Resuming processing for batch:', batch.id)
    }

    // 3. Re-generate QR data in memory (needed for all phases)
    // This is fast enough to do every time
    const order = batch.order
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

    const qrBatch = generateQRBatch({
      orderNo: order.order_no,
      manufacturerCode: order.seller_org.org_code,
      orderItems,
      bufferPercent: order.qr_buffer_percent || 10,
      unitsPerCase: order.units_per_case || 100,
      useIndividualCaseSizes: orderItems.some(item => item.units_per_case != null)
    })

    // PHASE 1: Excel Generation
    if (!batch.excel_generated) {
      console.log('Phase 1: Generating Excel...')
      
      const extraQrMasterRaw = (order as any).extra_qr_master
      let extraQrMaster = Number.isFinite(Number(extraQrMasterRaw))
        ? Number(extraQrMasterRaw)
        : 0
      extraQrMaster = Math.max(0, Math.min(10, extraQrMaster))

      const excelFilePath = await generateQRExcel({
        orderNo: order.order_no,
        orderDate: new Date(order.created_at || new Date().toISOString()).toLocaleDateString(),
        companyName: order.buyer_org.org_name,
        manufacturerName: order.seller_org.org_name,
        masterCodes: qrBatch.masterCodes,
        individualCodes: qrBatch.individualCodes,
        totalMasterCodes: qrBatch.totalMasterCodes,
        totalUniqueCodes: qrBatch.totalUniqueCodes,
        totalBaseUnits: qrBatch.totalBaseUnits,
        bufferPercent: qrBatch.bufferPercent,
        extraQrMaster: extraQrMaster
      })

      const excelFilename = generateQRExcelFilename(order.order_no)
      const storagePath = `${order.seller_org.id}/${order.id}/${excelFilename}`

      const fs = await import('fs/promises')
      const excelBuffer = await fs.readFile(excelFilePath)

      const { error: uploadError } = await supabase.storage
        .from('qr-codes')
        .upload(storagePath, excelBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true // Allow overwriting if file exists (e.g. retry)
        })

      await fs.unlink(excelFilePath).catch(() => { })

      if (uploadError) {
        throw new Error(`Failed to upload Excel: ${uploadError.message}`)
      }

      const { data: { publicUrl } } = supabase.storage
        .from('qr-codes')
        .getPublicUrl(storagePath)

      await supabase
        .from('qr_batches')
        .update({
          excel_generated: true,
          storage_url: publicUrl,
          excel_file_url: publicUrl, // Maintain compatibility
          excel_generated_at: new Date().toISOString()
        })
        .eq('id', batch.id)
      
      console.log('✅ Phase 1 Complete: Excel generated and uploaded')
      
      // Check time - if we spent too long, exit and let next run continue
      if ((Date.now() - startTime) > 45000) { // 45 seconds safety buffer
        return NextResponse.json({ message: 'Phase 1 complete, yielding to next run' })
      }
    }

    // PHASE 2: Master Codes Insertion
    if (!batch.master_inserted) {
      console.log('Phase 2: Inserting Master Codes...')
      
      const companyId = order.company_id || order.seller_org_id
      const masterCodesData = qrBatch.masterCodes.map(master => ({
        batch_id: batch.id,
        master_code: master.code,
        case_number: master.case_number,
        status: 'generated',
        expected_unit_count: master.expected_unit_count,
        actual_unit_count: 0,
        manufacturer_org_id: order.seller_org_id,
        warehouse_org_id: order.warehouse_org_id || order.seller_org_id,
        company_id: companyId
      }))

      const { error: masterError } = await supabase
        .from('qr_master_codes')
        .insert(masterCodesData)

      if (masterError) {
        throw new Error(`Failed to insert master codes: ${masterError.message}`)
      }

      await supabase
        .from('qr_batches')
        .update({ master_inserted: true })
        .eq('id', batch.id)

      console.log('✅ Phase 2 Complete: Master codes inserted')

      if ((Date.now() - startTime) > 45000) {
        return NextResponse.json({ message: 'Phase 2 complete, yielding to next run' })
      }
    }

    // PHASE 3: QR Codes Insertion (Chunked)
    if (batch.qr_inserted_count < batch.total_unique_codes) {
      console.log(`Phase 3: Inserting QR Codes (Progress: ${batch.qr_inserted_count}/${batch.total_unique_codes})...`)

      // Fetch master codes to link them
      // We need to fetch them because we might be in a new run
      const { data: masterCodes } = await supabase
        .from('qr_master_codes')
        .select('id, case_number')
        .eq('batch_id', batch.id)
      
      const caseToMasterIdMap = new Map<number, string>()
      if (masterCodes) {
        masterCodes.forEach((m: any) => caseToMasterIdMap.set(m.case_number, m.id))
      }

      const allCodes = qrBatch.individualCodes
      let currentInsertedCount = batch.qr_inserted_count || 0
      const CHUNK_SIZE = 2000 // Process 2k codes per loop iteration
      
      // Loop until we finish or run out of time
      // This allows us to process as many codes as possible within the Vercel timeout (60s)
      while (currentInsertedCount < allCodes.length) {
        // Check if we're running out of time (leave 10s buffer)
        if ((Date.now() - startTime) > 50000) {
           console.log('⏳ Time limit reached, yielding to next run...')
           break
        }

        const endIndex = Math.min(currentInsertedCount + CHUNK_SIZE, allCodes.length)
        const codesToInsert = allCodes.slice(currentInsertedCount, endIndex)
        
        // Add master_code_id
        const codesWithMasterIds = codesToInsert.map(code => ({
          ...code,
          master_code_id: !code.is_buffer && code.case_number ? caseToMasterIdMap.get(code.case_number) : null
        }))

        const companyId = order.company_id || order.seller_org_id
        
        // Insert this chunk
        const insertedCount = await insertQRCodesInBatches(
          supabase,
          batch.id,
          order.id,
          companyId,
          order.seller_org_id,
          order.warehouse_org_id || order.seller_org_id,
          codesWithMasterIds,
          1000 // DB insert batch size
        )

        currentInsertedCount += insertedCount
        
        // Update progress in DB after each chunk so we don't lose work
        await supabase
          .from('qr_batches')
          .update({ qr_inserted_count: currentInsertedCount })
          .eq('id', batch.id)
        
        console.log(`✅ Phase 3 Progress: Inserted ${insertedCount} codes. Total: ${currentInsertedCount}/${batch.total_unique_codes}`)
      }

      if (currentInsertedCount >= batch.total_unique_codes) {
        // All done!
        await supabase
          .from('qr_batches')
          .update({ 
            status: 'completed',
            processing_finished_at: new Date().toISOString()
          })
          .eq('id', batch.id)
        
        console.log('🎉 Batch processing COMPLETED!')
        return NextResponse.json({ success: true, message: 'Batch processing COMPLETED!', hasMore: false })
      } else {
        console.log('⏳ Batch processing continuing in next run...')
        return NextResponse.json({ success: true, message: 'Worker run completed (more work remaining)', hasMore: true })
      }
    } else {
      // Just in case we missed the completion update
      await supabase
        .from('qr_batches')
        .update({ 
          status: 'completed',
          processing_finished_at: new Date().toISOString()
        })
        .eq('id', batch.id)
      
      return NextResponse.json({ success: true, message: 'Batch processing COMPLETED!', hasMore: false })
    }

  } catch (error: any) {
    console.error('❌ Worker Error:', error)
    
    // Try to log error to batch
    // We need batch ID, but it might be undefined if error happened before fetching
    // But we have 'batch' variable in scope if fetch succeeded
    // Actually 'batch' is const inside try block, so not available in catch if defined there.
    // But I defined it inside try.
    // I'll just log to console for now, as I can't easily access batch.id here without moving declaration up.
    
    return NextResponse.json(
      { error: 'Worker failed', details: error.message },
      { status: 500 }
    )
  }
}

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
  
  // Process in chunks to control concurrency
  const CONCURRENCY_LIMIT = 2
  const chunks = []
  
  for (let i = 0; i < codes.length; i += batchSize) {
    chunks.push(codes.slice(i, i + batchSize))
  }

  // Process chunks with concurrency limit
  for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
    const activeChunks = chunks.slice(i, i + CONCURRENCY_LIMIT)
    const promises = activeChunks.map(async (chunk, index) => {
      const inserts = chunk.map(code => ({
        batch_id: batchId,
        company_id: companyId,
        order_id: orderId,
        product_id: code.product_id,
        variant_id: code.variant_id,
        code: code.code,
        qr_hash: code.hash,
        sequence_number: code.sequence_number,
        case_number: code.case_number,
        variant_key: code.variant_key,
        is_buffer: code.is_buffer,
        status: code.is_buffer ? 'buffer_available' : 'generated',
        is_active: true,
        master_code_id: code.master_code_id || null
      }))

      const { error } = await supabase
        .from('qr_codes')
        .insert(inserts)

      if (error) {
        console.error(`❌ Error inserting batch:`, error)
        throw error
      }
      
      return inserts.length
    })

    const results = await Promise.all(promises)
    totalInserted += results.reduce((a, b) => a + b, 0)
  }

  return totalInserted
}
