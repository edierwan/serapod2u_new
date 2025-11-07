import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { session_id, user_id } = await request.json()

    if (!session_id || !user_id) {
      return NextResponse.json(
        { error: 'Missing session_id or user_id' },
        { status: 400 }
      )
    }

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

    // Allow both pending and matched status (matched = warehouse_packed, ready to ship)
    // If already approved, check if this is a duplicate request (same codes already shipped)
    if (session.validation_status === 'approved') {
      // Session was already approved - this might be a duplicate click or session wasn't reset
      const alreadyShipped = {
        master_codes: session.master_codes_scanned || [],
        unique_codes: session.unique_codes_scanned || []
      }
      
      return NextResponse.json(
        { 
          error: `This shipment session was already confirmed at ${new Date(session.approved_at || session.updated_at).toLocaleString()}. Please refresh the page or select the distributor again to start a new shipment.`,
          details: {
            already_shipped: alreadyShipped,
            approved_at: session.approved_at || session.updated_at
          }
        },
        { status: 400 }
      )
    }
    
    if (!['pending', 'matched'].includes(session.validation_status)) {
      return NextResponse.json(
        { error: `Invalid session status: ${session.validation_status}. Expected pending or matched.` },
        { status: 400 }
      )
    }

    const shippedAt = new Date().toISOString()
    
    // Get codes from the session itself
    const masterCodesScanned = session.master_codes_scanned || []
    const uniqueCodesScanned = session.unique_codes_scanned || []
    
    console.log('📦 Confirming shipment:', { 
      session_id, 
      master_codes: masterCodesScanned.length, 
      unique_codes: uniqueCodesScanned.length 
    })

    let masterCasesShipped = 0
    let uniqueCodesShipped = 0
    let qrCodeIds: string[] = []
  let wmsSummary: any = null

    // Update QR codes from warehouse_packed to shipped_distributor
    // IMPORTANT: We temporarily disable trigger by updating without transitioning through shipped_distributor
    // Then call WMS function manually with ALL codes to create ONE consolidated movement
    if (uniqueCodesScanned.length > 0) {
      // First, get the QR code IDs and metadata
      const { data: qrCodesData, error: fetchError } = await supabase
        .from('qr_codes')
        .select(`
          id, 
          code, 
          master_code_id,
          qr_master_codes (
            warehouse_org_id,
            shipped_to_distributor_id,
            shipment_order_id,
            batch_id,
            qr_batches (
              order_id,
              orders (
                buyer_org_id
              )
            )
          )
        `)
        .in('code', uniqueCodesScanned)
        .eq('status', 'warehouse_packed')

      if (fetchError) {
        console.error('Error fetching QR codes:', fetchError)
        return NextResponse.json(
          { error: 'Failed to fetch QR codes' },
          { status: 500 }
        )
      }

      if (!qrCodesData || qrCodesData.length === 0) {
        return NextResponse.json(
          { error: 'No QR codes found with warehouse_packed status' },
          { status: 400 }
        )
      }

      qrCodeIds = qrCodesData.map(qr => qr.id)
      
      // Get organization and order context from first QR
      const firstQR = qrCodesData[0]
      const masterData = firstQR.qr_master_codes 
        ? (Array.isArray(firstQR.qr_master_codes) ? firstQR.qr_master_codes[0] : firstQR.qr_master_codes)
        : null
      const batchData = masterData?.qr_batches
        ? (Array.isArray(masterData.qr_batches) ? masterData.qr_batches[0] : masterData.qr_batches)
        : null
      const orderData: any = batchData?.orders
        ? (Array.isArray(batchData.orders) ? batchData.orders[0] : batchData.orders)
        : null

      const fromOrg = session.warehouse_org_id || masterData?.warehouse_org_id
      const toOrg = session.distributor_org_id || masterData?.shipped_to_distributor_id || null
      const orderId = masterData?.shipment_order_id || batchData?.order_id

      if (!fromOrg) {
        return NextResponse.json(
          { error: 'Missing warehouse organization for shipment' },
          { status: 400 }
        )
      }

      if (!toOrg) {
        return NextResponse.json(
          { error: 'Distributor not specified for this shipment. Please select a distributor before confirming.' },
          { status: 400 }
        )
      }

      if (toOrg === fromOrg) {
        return NextResponse.json(
          { error: 'Distributor organization must be different from the shipping warehouse.' },
          { status: 400 }
        )
      }

      // ✅ FIXED APPROACH: 
      // 1. Call WMS function FIRST with ALL codes → creates ONE consolidated movement
      // 2. Set session variable to skip trigger
      // 3. Update QR status → trigger sees skip flag and doesn't create duplicate movements
      
      console.log('📦 Step 1: Creating consolidated movement via WMS function')
      const { data: wmsResult, error: wmsError } = await supabase.rpc('wms_ship_unique_auto', {
        p_qr_code_ids: qrCodeIds,
        p_from_org_id: fromOrg,
        p_to_org_id: toOrg,
        p_order_id: orderId,
        p_shipped_at: shippedAt
      })

      if (wmsError) {
        console.error('❌ WMS function failed:', wmsError)
        return NextResponse.json(
          { error: `WMS inventory update failed: ${wmsError.message}` },
          { status: 500 }
        )
      }

      console.log('✅ WMS function created consolidated movement:', wmsResult)
      wmsSummary = wmsResult

      // Step 2: Set session variable to tell trigger to skip
      console.log('📝 Step 2: Setting session variable to skip trigger')
      const { error: sessionError } = await supabase.rpc('set_skip_ship_trigger', {
        p_skip: true
      })

      if (sessionError) {
        console.log('⚠️  Warning: Could not set session variable, trigger may create duplicates:', sessionError.message)
      }

      // Step 3: Update QR codes status (trigger will be skipped due to session variable)
      console.log('📝 Step 3: Updating', qrCodeIds.length, 'QR codes to shipped_distributor')
      
      const { data: updatedCodes, error: updateError } = await supabase
        .from('qr_codes')
        .update({
          status: 'shipped_distributor',
          current_location_org_id: toOrg,
          updated_at: shippedAt
        })
        .in('id', qrCodeIds)
        .eq('status', 'warehouse_packed')
        .select('id, code')

      if (updateError) {
        console.error('Error updating QR codes:', updateError)
        return NextResponse.json(
          { error: 'Failed to update QR codes to shipped status' },
          { status: 500 }
        )
      }

      uniqueCodesShipped = updatedCodes?.length || 0
      console.log('✅ Updated', uniqueCodesShipped, 'QR codes to shipped_distributor')
    }

    // Update master codes if any (same pattern: call WMS first, then update status)
    if (masterCodesScanned.length > 0) {
      // Fetch master code IDs
      const { data: masterData, error: masterFetchError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code')
        .in('master_code', masterCodesScanned)
        .eq('status', 'warehouse_packed')

      if (masterFetchError) {
        console.error('Error fetching master codes:', masterFetchError)
      } else if (masterData && masterData.length > 0) {
        // Call WMS function for each master (masters are processed individually)
        for (const master of masterData) {
          const { error: masterWmsError } = await supabase.rpc('wms_ship_master_auto', {
            p_master_code_id: master.id
          })
          
          if (masterWmsError) {
            console.error(`❌ WMS function failed for master ${master.master_code}:`, masterWmsError)
          } else {
            console.log(`✅ WMS function processed master ${master.master_code}`)
          }
        }

        // Now update status - triggers will fire but dedup prevents duplicates
        const { data: updatedMasters, error: masterError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'shipped_distributor',
            shipped_at: shippedAt,
            shipped_by: user_id,
            updated_at: shippedAt
          })
          .in('master_code', masterCodesScanned)
          .eq('status', 'warehouse_packed')
          .select('id, master_code')

        if (masterError) {
          console.error('Error updating master codes:', masterError)
        } else {
          masterCasesShipped = updatedMasters?.length || 0
          console.log('✅ Updated', masterCasesShipped, 'master codes to shipped_distributor')
        }
      }
    }

    // Update session status to 'approved' (shipment confirmed and sent)
    const { error: updateSessionError } = await supabase
      .from('qr_validation_reports')
      .update({
        validation_status: 'approved',
        approved_by: user_id,
        approved_at: shippedAt,
        updated_at: shippedAt
      })
      .eq('id', session_id)

    if (updateSessionError) {
      console.error('Error updating session:', updateSessionError)
      return NextResponse.json(
        { error: 'Failed to update session status' },
        { status: 500 }
      )
    }

    console.log('✅ Session updated to approved status')

    // ===== INVENTORY FLOW =====
    // 1. WMS function called FIRST with ALL QR codes → creates ONE consolidated movement
    // 2. QR status updated AFTER → triggers fire but dedup prevents duplicate movements
    // 3. Result: Single movement row showing total quantity (e.g., -10, not 10x -1)

    const totalCases = masterCasesShipped
    const totalUnique = uniqueCodesShipped

    return NextResponse.json({
      success: true,
      message: `Shipment recorded. Inventory updated and movement logged.`,
      details: {
        master_cases_shipped: totalCases,
        unique_codes_shipped: totalUnique,
        shipped_at: shippedAt,
        wms_summary: wmsSummary
      }
    })

  } catch (error: any) {
    console.error('Error confirming shipment:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
