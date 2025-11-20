import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { session_id, user_id } = await request.json()

    if (!session_id || !user_id) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    console.log('🔄 Starting shipment cancellation for session:', session_id)

    // Get the session
    const { data: session, error: sessionError } = await supabase
      .from('qr_validation_reports')
      .select('*')
      .eq('id', session_id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Shipment session not found' },
        { status: 404 }
      )
    }

    // Only allow canceling pending sessions
    if (session.validation_status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel shipment with status: ${session.validation_status}` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const masterCodes = session.master_codes_scanned || []
    const uniqueCodes = session.unique_codes_scanned || []

    console.log('📦 Reverting codes:', {
      master_codes: masterCodes.length,
      unique_codes: uniqueCodes.length
    })

    // Revert all master codes back to received_warehouse
    if (masterCodes.length > 0) {
      const { data: masterRecords, error: getMasterError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, case_number, company_id')
        .in('master_code', masterCodes)
        .eq('status', 'warehouse_packed')

      if (!getMasterError && masterRecords) {
        console.log(`🔄 Reverting ${masterRecords.length} master codes`)

        // Update master codes status
        const { error: updateMasterError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'received_warehouse',
            shipped_to_distributor_id: null,
            updated_at: now
          })
          .in('master_code', masterCodes)
          .eq('status', 'warehouse_packed')

        if (updateMasterError) {
          console.error('❌ Error reverting master codes:', updateMasterError)
          throw new Error('Failed to revert master codes')
        }

        // Get all master code IDs for reverting their unique codes
        const masterIds = masterRecords.map(m => m.id)

        if (masterIds.length > 0) {
          // Revert all unique codes in these master cases
          const { error: updateUniqueError } = await supabase
            .from('qr_codes')
            .update({
              status: 'received_warehouse',
              current_location_org_id: session.warehouse_org_id,
              updated_at: now
            })
            .in('master_code_id', masterIds)
            .eq('status', 'warehouse_packed')

          if (updateUniqueError) {
            console.warn('⚠️ Warning reverting unique codes from masters:', updateUniqueError)
          }
        }

        // Log movements for master codes
        const movements = masterRecords.map(master => ({
          company_id: master.company_id,
          qr_master_code_id: master.id,
          movement_type: 'warehouse_cancel',
          from_org_id: session.warehouse_org_id,
          to_org_id: session.warehouse_org_id,
          current_status: 'received_warehouse',
          scanned_at: now,
          scanned_by: user_id,
          notes: `Shipment cancelled - reverted master ${master.master_code} to warehouse`
        }))

        await supabase.from('qr_movements').insert(movements)
      }
    }

    // Revert individual unique codes that were scanned separately
    if (uniqueCodes.length > 0) {
      const { data: uniqueRecords, error: getUniqueError } = await supabase
        .from('qr_codes')
        .select('id, code, company_id')
        .in('code', uniqueCodes)
        .eq('status', 'warehouse_packed')

      if (!getUniqueError && uniqueRecords) {
        console.log(`🔄 Reverting ${uniqueRecords.length} unique codes`)

        // Update unique codes status
        const { error: updateError } = await supabase
          .from('qr_codes')
          .update({
            status: 'received_warehouse',
            current_location_org_id: session.warehouse_org_id,
            updated_at: now
          })
          .in('code', uniqueCodes)
          .eq('status', 'warehouse_packed')

        if (updateError) {
          console.error('❌ Error reverting unique codes:', updateError)
          throw new Error('Failed to revert unique codes')
        }

        // Log movements for unique codes
        const movements = uniqueRecords.map(qr => ({
          company_id: qr.company_id,
          qr_code_id: qr.id,
          movement_type: 'warehouse_cancel',
          from_org_id: session.warehouse_org_id,
          to_org_id: session.warehouse_org_id,
          current_status: 'received_warehouse',
          scanned_at: now,
          scanned_by: user_id,
          notes: `Shipment cancelled - reverted unique code ${qr.code} to warehouse`
        }))

        await supabase.from('qr_movements').insert(movements)
      }
    }

    // Delete the session (it's pending and never approved, so safe to remove)
    const { error: deleteSessionError } = await supabase
      .from('qr_validation_reports')
      .delete()
      .eq('id', session_id)

    if (deleteSessionError) {
      console.error('❌ Failed to delete session:', deleteSessionError)
      throw new Error('Failed to cancel session')
    }

    console.log('✅ Shipment cancelled successfully - session deleted')

    return NextResponse.json({
      success: true,
      message: `Shipment cancelled. ${masterCodes.length} master cases and ${uniqueCodes.length} unique codes reverted to warehouse.`,
      reverted: {
        master_codes: masterCodes.length,
        unique_codes: uniqueCodes.length
      }
    })

  } catch (error: any) {
    console.error('❌ Error cancelling shipment:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
