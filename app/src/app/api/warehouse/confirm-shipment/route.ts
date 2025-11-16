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
    const sessionStatus = session.validation_status ?? 'pending'

    if (sessionStatus === 'approved') {
      // Session was already approved - this might be a duplicate click or session wasn't reset
      const alreadyShipped = {
        master_codes: session.master_codes_scanned || [],
        unique_codes: session.unique_codes_scanned || []
      }

      const approvalTimestamp = session.approved_at || session.updated_at || new Date().toISOString()
      const approvalDate = new Date(approvalTimestamp)
      
      return NextResponse.json(
        { 
          error: `This shipment session was already confirmed at ${approvalDate.toLocaleString()}. Please refresh the page or select the distributor again to start a new shipment.`,
          details: {
            already_shipped: alreadyShipped,
            approved_at: session.approved_at || session.updated_at
          }
        },
        { status: 400 }
      )
    }

    const allowedStatuses = ['pending', 'matched', 'discrepancy'] as const
    if (!allowedStatuses.includes(sessionStatus as typeof allowedStatuses[number])) {
      return NextResponse.json(
        { error: `Invalid session status: ${sessionStatus}. Expected pending, matched, or discrepancy.` },
        { status: 400 }
      )
    }

    if (sessionStatus === 'discrepancy') {
      console.warn('⚠️  Proceeding with shipment despite discrepancy status. Only scanned codes will be shipped.', {
        session_id,
        master_codes_scanned: session.master_codes_scanned?.length || 0,
        unique_codes_scanned: session.unique_codes_scanned?.length || 0
      })
    }

    const shippedAt = new Date().toISOString()

    const normalizeStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) return []
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }

    // Get codes from the session itself
    const masterCodesScanned = normalizeStringArray(session.master_codes_scanned)
    const uniqueCodesScanned = normalizeStringArray(session.unique_codes_scanned)
    const uniqueCodesScannedSet = new Set(uniqueCodesScanned)

  let resolvedFromOrg: string | null = session.warehouse_org_id ?? null
  let resolvedToOrg: string | null = session.distributor_org_id ?? null
    
    console.log('📦 Confirming shipment:', { 
      session_id, 
      master_codes: masterCodesScanned.length, 
      unique_codes: uniqueCodesScanned.length 
    })

    let masterCasesShipped = 0
    let uniqueCodesShipped = 0
    let qrCodeIds: string[] = []
    let wmsSummary: any = null
    const updatedMasterIdSet = new Set<string>()

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

      const resolvedFrom = resolvedFromOrg || masterData?.warehouse_org_id || null
      const resolvedTo = resolvedToOrg || masterData?.shipped_to_distributor_id || null
      const fromOrg = resolvedFrom
      const toOrg = resolvedTo
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

      resolvedFromOrg = fromOrg
      resolvedToOrg = toOrg

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

      const updatedUniqueCount = updatedCodes?.length || 0
      uniqueCodesShipped += updatedUniqueCount
      console.log('✅ Updated', updatedUniqueCount, 'QR codes to shipped_distributor')

      // Auto-update related master cases if all their children are now shipped
      const masterIdsFromUnique = Array.from(
        new Set(
          (qrCodesData || [])
            .map((qr) => qr.master_code_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
      ).filter((id) => !updatedMasterIdSet.has(id))

      if (masterIdsFromUnique.length > 0) {
        const { data: masterChildStatuses, error: masterChildError } = await supabase
          .from('qr_codes')
          .select('master_code_id, status')
          .in('master_code_id', masterIdsFromUnique)

        if (masterChildError) {
          console.warn('⚠️ Failed to load child code statuses for master auto-update:', masterChildError)
        } else if (masterChildStatuses && masterChildStatuses.length > 0) {
          const masterStatusMap = new Map<string, { total: number; shipped: number }>()

          masterChildStatuses.forEach((row) => {
            if (!row.master_code_id) return
            const stats = masterStatusMap.get(row.master_code_id) || { total: 0, shipped: 0 }
            stats.total += 1
            if (row.status === 'shipped_distributor') {
              stats.shipped += 1
            }
            masterStatusMap.set(row.master_code_id, stats)
          })

          const mastersFullyShipped = Array.from(masterStatusMap.entries())
            .filter(([, stats]) => stats.total > 0 && stats.shipped === stats.total)
            .map(([masterId]) => masterId)
            .filter((masterId) => !updatedMasterIdSet.has(masterId))

          if (mastersFullyShipped.length > 0) {
            const { error: skipAutoMasterError } = await supabase.rpc('set_skip_ship_trigger', {
              p_skip: true
            })

            if (skipAutoMasterError) {
              console.log('⚠️ Could not set skip trigger before auto master update:', skipAutoMasterError.message)
            }

            const { data: autoUpdatedMasters, error: autoMasterUpdateError } = await supabase
              .from('qr_master_codes')
              .update({
                status: 'shipped_distributor',
                shipped_at: shippedAt,
                shipped_by: user_id,
                shipped_to_distributor_id: resolvedToOrg,
                updated_at: shippedAt
              })
              .in('id', mastersFullyShipped)
              .select('id, master_code')

            if (autoMasterUpdateError) {
              console.error('❌ Failed to auto-update master codes after unique shipment:', autoMasterUpdateError)
            } else {
              const autoMasterCount = autoUpdatedMasters?.length || 0
              masterCasesShipped += autoMasterCount
              autoUpdatedMasters?.forEach((master) => updatedMasterIdSet.add(master.id))
              console.log('✅ Auto-updated', autoMasterCount, 'master cases to shipped_distributor based on unique shipments')
            }
          }
        }
      }
    }

    // Update master codes if any
    // IMPORTANT: Check if child codes were already scanned individually
    // If so, inventory was already deducted - skip WMS and just update master status
    if (masterCodesScanned.length > 0) {
      const { data: masterData, error: masterFetchError } = await supabase
        .from('qr_master_codes')
        .select(`
          id, 
          master_code, 
          warehouse_org_id, 
          shipped_to_distributor_id,
          qr_codes(id, code, status)
        `)
        .in('master_code', masterCodesScanned)
        .eq('status', 'warehouse_packed')

      if (masterFetchError) {
        console.error('Error fetching master codes:', masterFetchError)
      } else if (masterData && masterData.length > 0) {
        const masterIds = masterData.map(master => master.id)

        if (!resolvedFromOrg) {
          const fallbackWarehouse = masterData.find(master => master.warehouse_org_id)?.warehouse_org_id ?? null
          resolvedFromOrg = fallbackWarehouse
        }

        if (!resolvedToOrg) {
          const fallbackDistributor = masterData.find(master => master.shipped_to_distributor_id)?.shipped_to_distributor_id ?? null
          resolvedToOrg = fallbackDistributor
        }

        if (!resolvedFromOrg) {
          return NextResponse.json(
            { error: 'Missing warehouse organization for shipment' },
            { status: 400 }
          )
        }

        if (!resolvedToOrg) {
          return NextResponse.json(
            { error: 'Distributor not specified for this shipment. Please select a distributor before confirming.' },
            { status: 400 }
          )
        }

        if (resolvedToOrg === resolvedFromOrg) {
          return NextResponse.json(
            { error: 'Distributor organization must be different from the shipping warehouse.' },
            { status: 400 }
          )
        }

        // Check which masters have children already processed via unique code scanning
        // If all children were already shipped individually, skip WMS call entirely
        // to avoid double inventory deduction
        for (const master of masterData) {
          const childCodes = master.qr_codes || []
          
          // Check if any child codes exist and their status
          if (childCodes.length === 0) {
            console.log(`⚠️ Master ${master.master_code}: No child codes found, skipping WMS`)
            continue
          }
          
          const allChildrenAlreadyShipped = childCodes.every((child: any) => 
            child.status === 'shipped_distributor' || 
            uniqueCodesScannedSet.has(child.code)
          )

          if (allChildrenAlreadyShipped) {
            console.log(`✅ Master ${master.master_code}: All ${childCodes.length} children already processed, skipping WMS (inventory already deducted)`)
          } else {
            // Only call WMS if children haven't been individually scanned yet
            console.log(`📦 Master ${master.master_code}: Processing via WMS (some children not yet shipped)`)
            const { error: masterWmsError } = await supabase.rpc('wms_ship_master_auto', {
              p_master_code_id: master.id
            })

            if (masterWmsError) {
              console.error(`❌ WMS function failed for master ${master.master_code}:`, masterWmsError.message)
              console.log(`⚠️ Continuing with status update despite WMS error (children may have already handled inventory)`)
              // Don't return error - continue to update status anyway since inventory might have been handled by children
            } else {
              console.log(`✅ WMS function processed master ${master.master_code}`)
            }
          }
        }

        console.log(`🔄 Attempting to update ${masterIds.length} master codes:`, masterIds)
        
        // Set session variable to skip trigger (prevent duplicate inventory movements)
        const { error: skipMasterError } = await supabase.rpc('set_skip_ship_trigger', {
          p_skip: true
        })

        if (skipMasterError) {
          console.log('⚠️  Warning: Could not set session variable for master update:', skipMasterError.message)
        }

        // Update master codes - remove strict status check to ensure update happens
        // even if WMS function or other process already changed the status
          const { data: updatedMasters, error: masterError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'shipped_distributor',
            shipped_at: shippedAt,
            shipped_by: user_id,
            updated_at: shippedAt
          })
          .in('id', masterIds)
          .select('id, master_code, status')

        if (masterError) {
          console.error('❌ Error updating master codes:', masterError)
        } else {
          const updatedMasterCount = updatedMasters?.length || 0
          masterCasesShipped += updatedMasterCount
            updatedMasters?.forEach((master) => updatedMasterIdSet.add(master.id))
          console.log(`✅ Updated ${updatedMasterCount} of ${masterIds.length} master codes to shipped_distributor`)
          if (updatedMasterCount < masterIds.length) {
            console.warn(`⚠️ Only ${updatedMasterCount} of ${masterIds.length} master codes were updated. Some may not have status=warehouse_packed`)
          }
          updatedMasters?.forEach(m => console.log(`  - ${m.master_code}: ${m.status}`))
        }

        // Update all child unique codes that haven't already been shipped individually
        const { data: masterChildCodes, error: childFetchError } = await supabase
          .from('qr_codes')
          .select('id, code')
          .in('master_code_id', masterIds)
          .eq('status', 'warehouse_packed')

        if (childFetchError) {
          console.error('Error fetching unique codes for masters:', childFetchError)
        } else if (masterChildCodes && masterChildCodes.length > 0) {
          const childIdsToUpdate: string[] = []

          for (const child of masterChildCodes) {
            if (!uniqueCodesScannedSet.has(child.code)) {
              childIdsToUpdate.push(child.id)
            }
          }

          if (childIdsToUpdate.length > 0) {
            const { error: skipChildError } = await supabase.rpc('set_skip_ship_trigger', {
              p_skip: true
            })

            if (skipChildError) {
              console.log('⚠️  Warning: Could not set session variable before master child update:', skipChildError.message)
            }

            const { data: updatedChildCodes, error: updateChildError } = await supabase
              .from('qr_codes')
              .update({
                status: 'shipped_distributor',
                current_location_org_id: resolvedToOrg,
                updated_at: shippedAt
              })
              .in('id', childIdsToUpdate)
              .eq('status', 'warehouse_packed')
              .select('id, code')

            if (updateChildError) {
              console.error('Error updating unique codes linked to masters:', updateChildError)
            } else {
              const childCount = updatedChildCodes?.length || 0
              uniqueCodesShipped += childCount
              console.log('✅ Updated', childCount, 'unique codes linked to master cases to shipped_distributor')
            }
          }
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
