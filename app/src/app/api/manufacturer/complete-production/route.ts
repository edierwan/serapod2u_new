import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/manufacturer/complete-production
 * Marks a batch as production complete (ready for warehouse shipment)
 * Changes batch status from 'in_production' to 'completed'
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { batch_id } = body

    if (!batch_id) {
      return NextResponse.json(
        { error: 'batch_id is required' },
        { status: 400 }
      )
    }

    console.log('🏭 Completing production for batch:', batch_id)

    // Get batch details
    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .select(`
        id,
        status,
        total_master_codes,
        order_id,
        orders (
          id,
          order_no,
          buyer_org_id,
          warehouse_org_id
        )
      `)
      .eq('id', batch_id)
      .single()

    if (batchError || !batch) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      )
    }

    const orderInfo = Array.isArray(batch.orders) ? batch.orders[0] : batch.orders

    // CRITICAL: Verify order has a destination warehouse assigned
    if (!orderInfo?.warehouse_org_id) {
      return NextResponse.json(
        { 
          error: 'Order has no destination warehouse assigned. Cannot complete production.',
          order_id: orderInfo?.id,
          order_no: orderInfo?.order_no
        },
        { status: 400 }
      )
    }

    // Verify batch is in production
    if (batch.status !== 'in_production') {
      return NextResponse.json(
        { 
          error: `Batch must be in production status. Current status: ${batch.status}`,
          current_status: batch.status
        },
        { status: 400 }
      )
    }

    // Check if all master codes are packed
    const { data: masterCodes, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('id, status, actual_unit_count, expected_unit_count')
      .eq('batch_id', batch_id)

    if (masterError) {
      throw masterError
    }

    const totalMasters = masterCodes?.length || 0
    const packedMasters = masterCodes?.filter(m => m.status === 'packed').length || 0
    const progressPercentage = totalMasters > 0 ? Math.round((packedMasters / totalMasters) * 100) : 0

    console.log('📊 Production progress:', {
      batch_id,
      total_master_codes: totalMasters,
      packed_master_codes: packedMasters,
      progress: `${progressPercentage}%`
    })

    // ============================================================================
    // PART 3: CRITICAL PROPAGATION STEP
    // Before marking batch as completed, we MUST copy the order's warehouse
    // assignment into EVERY master case for this batch.
    // This is what makes warehouse receive work!
    // 
    // CHAIN OF CUSTODY:
    // orders.warehouse_org_id → qr_master_codes.warehouse_org_id
    // This happens HERE, at production completion time.
    // ============================================================================
    
    console.log('🔄 CRITICAL: Propagating warehouse assignment to all master cases...')
    console.log(`   Source: orders.warehouse_org_id = ${orderInfo.warehouse_org_id}`)
    console.log(`   Target: qr_master_codes.warehouse_org_id for batch ${batch_id}`)
    console.log(`   Expected cases to update: ${totalMasters}`)

    // Execute the critical UPDATE using database function to bypass RLS
    // This MUST succeed or warehouse receive will show empty forever
    const { data: propagateResult, error: propagateError } = await supabase
      .rpc('propagate_warehouse_to_master_codes', { 
        p_batch_id: batch_id 
      })

    if (propagateError) {
      console.error('❌ CRITICAL ERROR: Failed to propagate warehouse assignment to master cases:', propagateError)
      throw new Error(`Failed to assign warehouse to master cases: ${propagateError.message}`)
    }

    const result = Array.isArray(propagateResult) ? propagateResult[0] : propagateResult
    const casesUpdated = result?.cases_updated || 0
    const propagatedWarehouseId = result?.warehouse_org_id

    console.log(`✅ SUCCESS: Warehouse assignment propagated to ${casesUpdated} master cases`)
    console.log(`   All cases now have warehouse_org_id = ${propagatedWarehouseId}`)

    if (casesUpdated !== totalMasters) {
      console.error(`❌ CRITICAL WARNING: Updated ${casesUpdated} cases but expected ${totalMasters}`)
      console.error(`   This means some master codes were NOT assigned to the warehouse!`)
      throw new Error(`Warehouse propagation incomplete: ${casesUpdated}/${totalMasters} cases updated`)
    }

    // Verify the propagated warehouse matches the order's warehouse
    if (propagatedWarehouseId !== orderInfo.warehouse_org_id) {
      console.error('❌ CRITICAL: Verification failed - warehouse_org_id mismatch!')
      console.error(`   Expected: ${orderInfo.warehouse_org_id}`)
      console.error(`   Got: ${propagatedWarehouseId}`)
      throw new Error('Warehouse propagation verification failed')
    }

    console.log('✅ Verification passed: warehouse_org_id correctly set in qr_master_codes')

    // ============================================================================
    // Update all master codes from 'packed' to 'ready_to_ship'
    // ============================================================================

    console.log('📝 Updating master codes status: packed → ready_to_ship')
    
    const { error: masterUpdateError, count: masterUpdatedCount } = await supabase
      .from('qr_master_codes')
      .update({
        status: 'ready_to_ship',
        updated_at: new Date().toISOString()
      })
      .eq('batch_id', batch_id)
      .eq('status', 'packed')

    if (masterUpdateError) {
      console.error('❌ Failed to update master codes status:', masterUpdateError)
      throw masterUpdateError
    }

    console.log(`✅ ${masterUpdatedCount || 0} master codes updated to 'ready_to_ship' status`)

    // ============================================================================
    // Update all unique codes from 'packed' to 'ready_to_ship'
    // ============================================================================

    console.log('📝 Updating unique codes status: packed → ready_to_ship')
    
    // Get all master code IDs for this batch to find their unique codes
    const { data: masterCodeIds, error: masterIdsError } = await supabase
      .from('qr_master_codes')
      .select('id')
      .eq('batch_id', batch_id)

    if (masterIdsError) {
      console.error('❌ Failed to get master code IDs:', masterIdsError)
      throw masterIdsError
    }

    const masterIds = masterCodeIds?.map(m => m.id) || []
    
    if (masterIds.length > 0) {
      const { error: uniqueUpdateError, count: uniqueUpdatedCount } = await supabase
        .from('qr_codes')
        .update({
          status: 'ready_to_ship',
          updated_at: new Date().toISOString()
        })
        .in('master_code_id', masterIds)
        .eq('status', 'packed')

      if (uniqueUpdateError) {
        console.error('❌ Failed to update unique codes status:', uniqueUpdateError)
        throw uniqueUpdateError
      }

      console.log(`✅ ${uniqueUpdatedCount || 0} unique codes updated to 'ready_to_ship' status`)
    } else {
      console.log('⚠️  No master codes found for this batch, skipping unique code update')
    }

    // ============================================================================
    // NOW mark batch as completed (only after successful propagation)
    // ============================================================================

    // Update batch status to completed
    const { error: updateError } = await supabase
      .from('qr_batches')
      .update({
        status: 'completed',
        production_completed_at: new Date().toISOString(),
        production_completed_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', batch_id)

    if (updateError) {
      console.error('❌ Failed to update batch status:', updateError)
      throw updateError
    }

    console.log('✅ Batch marked as completed and ready for warehouse shipment')

    return NextResponse.json({
      success: true,
      message: 'Production completed successfully. Batch is now ready for warehouse shipment.',
      batchId: batch.id,
      order_no: orderInfo?.order_no,
      warehouseOrgId: orderInfo.warehouse_org_id,
      casesUpdated: casesUpdated,
      total_master_codes: totalMasters,
      packed_master_codes: packedMasters,
      progress_percentage: progressPercentage,
      production_completed_at: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('❌ Complete production error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to complete production' },
      { status: 500 }
    )
  }
}
