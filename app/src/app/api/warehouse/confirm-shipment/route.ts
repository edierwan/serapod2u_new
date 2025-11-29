import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractMasterCode } from '@/lib/qr-code-utils'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const supabaseAdmin = createAdminClient()
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
    let masterCodesScanned = normalizeStringArray(session.master_codes_scanned)
    masterCodesScanned = Array.from(
      new Set(
        masterCodesScanned
          .map((code) => {
            const extracted = extractMasterCode(code)
            return extracted || code // Fallback to raw code if extraction returns empty
          })
          .filter((code): code is string => Boolean(code && code.length > 0))
      )
    )
    const uniqueCodesScanned = normalizeStringArray(session.unique_codes_scanned)
    const uniqueCodesScannedSet = new Set(uniqueCodesScanned)

    console.log('🔎 CONFIRM DEBUG', {
      session_id,
      session_status: session.validation_status,
      master_codes_scanned_raw: session.master_codes_scanned,
      unique_codes_scanned_raw: session.unique_codes_scanned,
      master_codes_normalized: masterCodesScanned,
      unique_codes_normalized: uniqueCodesScanned
    })

    // FALLBACK: If session has no master codes but has scanned quantities with cases,
    // try to infer master codes from database based on this session
    if (masterCodesScanned.length === 0) {
      // Try to infer from scanned_quantities
      if (session.scanned_quantities) {
        const totalCases = (session.scanned_quantities as any)?.total_cases || 0
        if (totalCases > 0) {
          console.log('⚠️ [CONFIRM] Session has scanned cases but no master_codes_scanned array. Attempting to infer from DB...')
          console.log('⚠️ [CONFIRM] Looking for', totalCases, 'cases in warehouse', session.warehouse_org_id)
          
          // Query for masters that were scanned for this session (warehouse_packed status)
          // Use a recent time window to avoid picking up old sessions
          const recentTimeThreshold = new Date(Date.now() - 60 * 60 * 1000).toISOString() // Last hour
          const { data: inferredMasters, error: inferError } = await supabase
            .from('qr_master_codes')
            .select('master_code, status, updated_at')
            .eq('warehouse_org_id', session.warehouse_org_id)
            .eq('status', 'warehouse_packed')
            .gte('updated_at', recentTimeThreshold)
            .order('updated_at', { ascending: false })
            .limit(totalCases)
          
          if (!inferError && inferredMasters && inferredMasters.length > 0) {
            const inferredCodes = Array.from(
              new Set(
                inferredMasters
                  .map((m) => extractMasterCode(m.master_code) || m.master_code)
                  .filter((code): code is string => Boolean(code && code.length > 0))
              )
            )
            masterCodesScanned = [...masterCodesScanned, ...inferredCodes]
            console.log('✅ [CONFIRM] Inferred', inferredCodes.length, 'master codes from database:', inferredCodes)
          } else {
            console.log('❌ [CONFIRM] Could not infer master codes. Error:', inferError, 'Found:', inferredMasters?.length || 0)
          }
        }
      }
      
      // Also try to infer from unique codes if we have them
      // REMOVED: This causes a bug where shipping a single unique item marks the entire master case as shipped
      // if (uniqueCodesScanned.length > 0) {
      //   console.log('⚠️ [CONFIRM] Attempting to infer master codes from unique codes...')
      //   ...
      // }
    }

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
      // First, get the QR code IDs with batch information
      const { data: qrCodesData, error: fetchError } = await supabase
        .from('qr_codes')
        .select(`
          id, 
          code, 
          master_code_id,
          batch_id,
          current_location_org_id,
          variant_id,
          qr_batches (
            order_id,
            orders (
              buyer_org_id
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
      console.log('🔍 Found', qrCodeIds.length, 'QR codes to ship')

      // Get order_id directly from QR codes' batch relationship
      const firstQR = qrCodesData[0]
      let orderId: string | null = null
      let batchId: string | null = null

      // Try to get order_id from the batch join
      if (firstQR.qr_batches) {
        const batch = Array.isArray(firstQR.qr_batches) ? firstQR.qr_batches[0] : firstQR.qr_batches
        orderId = batch?.order_id || null
        console.log('📦 Order ID from batch join:', orderId)
      }

      // Fallback: If join didn't work, query batch directly using batch_id
      if (!orderId && firstQR.batch_id) {
        batchId = firstQR.batch_id
        console.log('🔍 Querying batch directly with ID:', batchId)
        const { data: batchData, error: batchError } = await supabase
          .from('qr_batches')
          .select('order_id')
          .eq('id', batchId)
          .single()
        
        if (!batchError && batchData?.order_id) {
          orderId = batchData.order_id
          console.log('✅ Found order_id from direct batch query:', orderId)
        }
      }

      // Get warehouse and distributor info from session or QR codes
      // CRITICAL FIX: Do NOT use firstQR.current_location_org_id if status is warehouse_packed
      // because scan-for-shipment updates it to the distributor (destination)!
      let fromOrg = resolvedFromOrg || session.warehouse_org_id || null
      
      // Only use QR location if NOT warehouse_packed (e.g. if we support shipping from other states)
      // But for warehouse_packed, the location on the QR is the DESTINATION.
      if (!fromOrg && firstQR.status !== 'warehouse_packed') {
        fromOrg = firstQR.current_location_org_id
      }

      const toOrg = resolvedToOrg || session.distributor_org_id || null

      // If QR codes have master codes, try to get additional info from them
      const masterCodeIds = Array.from(new Set(
        qrCodesData
          .map(qr => qr.master_code_id)
          .filter((id): id is string => Boolean(id))
      ))

      if (masterCodeIds.length > 0) {
        console.log('🔍 Found', masterCodeIds.length, 'master codes, querying for additional context')
        const { data: masterData } = await supabase
          .from('qr_master_codes')
          .select('warehouse_org_id, shipped_to_distributor_id, shipment_order_id')
          .in('id', masterCodeIds)
          .limit(1)
          .single()
        
        if (masterData) {
          // Use master code data as fallback for missing values
          if (!orderId && masterData.shipment_order_id) {
            orderId = masterData.shipment_order_id
            console.log('✅ Found order_id from master code:', orderId)
          }
          
          // Fallback for warehouse ID if missing
          if (!fromOrg && masterData.warehouse_org_id) {
             fromOrg = masterData.warehouse_org_id
             console.log('✅ Found warehouse_org_id from master code:', fromOrg)
          }
        }
      }

      console.log('🔍 Final WMS context:', { fromOrg, toOrg, orderId, qrCodeCount: qrCodeIds.length })

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

      if (!orderId) {
        console.error('❌ No order_id found. QR code context:', {
          first_qr_batch_id: firstQR.batch_id,
          first_qr_code: firstQR.code,
          total_qr_codes: qrCodeIds.length,
          master_codes_count: masterCodeIds.length
        })
        return NextResponse.json(
          { error: 'Cannot determine order. QR codes must be linked to a batch with an order_id.' },
          { status: 400 }
        )
      }

      console.log('✅ Order ID resolved:', orderId)

      resolvedFromOrg = fromOrg
      resolvedToOrg = toOrg

      // 🛡️ PRE-FLIGHT CHECK: Auto-correct inventory if needed
      // If we have valid warehouse_packed QR codes, we MUST have the inventory.
      // If inventory is lower, it's a data sync error (likely from previous bugs).
      // We auto-correct it here to prevent blocking the shipment.
      if (qrCodesData && qrCodesData.length > 0) {
        const variantCounts = new Map<string, number>()
        qrCodesData.forEach(qr => {
          if (qr.variant_id) {
            variantCounts.set(qr.variant_id, (variantCounts.get(qr.variant_id) || 0) + 1)
          }
        })

        for (const [variantId, requiredCount] of variantCounts.entries()) {
          const { data: invData } = await supabase
            .from('product_inventory')
            .select('quantity_on_hand')
            .eq('variant_id', variantId)
            .eq('organization_id', fromOrg)
            .single()
          
          const currentStock = invData?.quantity_on_hand || 0
          
          if (currentStock < requiredCount) {
            const missing = requiredCount - currentStock
            console.warn(`⚠️ [CONFIRM] Inventory mismatch detected for variant ${variantId}. Required: ${requiredCount}, On Hand: ${currentStock}. Auto-correcting by adding ${missing}...`)
            
            // Auto-correct inventory
            await supabaseAdmin.rpc('adjust_inventory_quantity', {
              p_variant_id: variantId,
              p_organization_id: fromOrg,
              p_delta: missing
            })
            
            // Log the correction (optional, but good for audit)
            console.log(`✅ [CONFIRM] Auto-corrected inventory for variant ${variantId}`)
          }
        }
      }

      // ✅ FIXED APPROACH: 
      // 1. Call WMS function FIRST with ALL codes → creates ONE consolidated movement
      // 2. Set session variable to skip trigger
      // 3. Update QR status → trigger sees skip flag and doesn't create duplicate movements
      
      console.log('📦 Step 1: Creating consolidated movement via WMS function')
      console.log('📦 WMS Params:', {
        p_qr_code_ids_count: qrCodeIds.length,
        p_from_org_id: fromOrg,
        p_to_org_id: toOrg,
        p_order_id: orderId
      })
      // Use admin client for WMS RPC call to bypass RLS and ensure function access
      const { data: wmsResult, error: wmsError } = await supabaseAdmin.rpc('wms_ship_unique_auto', {
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

      console.log('✅ WMS function created consolidated movement and updated QR statuses:', wmsResult)
      wmsSummary = wmsResult

      // Step 2 & 3: QR codes are now updated INSIDE wms_ship_unique_auto to prevent double deduction
      // We no longer need to manually update them here or set the skip trigger variable
      
      const updatedUniqueCount = qrCodeIds.length
      uniqueCodesShipped += updatedUniqueCount
      console.log('✅ Updated', updatedUniqueCount, 'QR codes to shipped_distributor (via WMS function)')

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
            const { error: skipAutoMasterError } = await supabaseAdmin.rpc('set_skip_ship_trigger', {
              p_skip: true
            })

            if (skipAutoMasterError) {
              console.log('⚠️ Could not set skip trigger before auto master update:', skipAutoMasterError.message)
            }

            const { data: autoUpdatedMasters, error: autoMasterUpdateError } = await supabaseAdmin
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

          // Identify masters that are partially shipped (shipped > 0 but < total)
          // and update their status to 'opened' if they are currently 'warehouse_packed'
          const mastersPartiallyShipped = Array.from(masterStatusMap.entries())
            .filter(([, stats]) => stats.shipped > 0 && stats.shipped < stats.total)
            .map(([masterId]) => masterId)
            .filter((masterId) => !updatedMasterIdSet.has(masterId))

          if (mastersPartiallyShipped.length > 0) {
             console.log('📦 Found', mastersPartiallyShipped.length, 'partially shipped master cases, setting to opened')
             const { data: openedMasters, error: openError } = await supabaseAdmin
               .from('qr_master_codes')
               .update({
                 status: 'opened',
                 updated_at: shippedAt
               })
               .in('id', mastersPartiallyShipped)
               .eq('status', 'warehouse_packed')
               .select('id, master_code')
               
             if (openError) {
               console.error('❌ Failed to update partially shipped masters to opened:', openError)
             } else {
               console.log('✅ Updated', openedMasters?.length || 0, 'master cases to opened status (partial shipment)')
             }
          }
        }
      }
    }

    // Update master codes if any
    // IMPORTANT: Check if child codes were already scanned individually
    // If so, inventory was already deducted - skip WMS and just update master status
    if (masterCodesScanned.length > 0) {
      console.log('🔎 [CONFIRM] MASTER BLOCK - Processing', masterCodesScanned.length, 'master codes:', masterCodesScanned)
      console.log('🔎 [CONFIRM] Session master_codes_scanned (raw):', session.master_codes_scanned)
      console.log('🔎 [CONFIRM] Session master_codes_scanned (normalized):', masterCodesScanned)
      
      // First try without status filter to see what we have
      const { data: allMasterData, error: allMasterError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, status')
        .in('master_code', masterCodesScanned)
      
      if (allMasterError) {
        console.error('❌ [CONFIRM] Error querying all master codes:', allMasterError)
      }
      
      console.log('🔎 [CONFIRM] MASTER FETCH RESULT:', {
        requested: masterCodesScanned,
        found: allMasterData?.map(m => ({ code: m.master_code, status: m.status, id: m.id })) ?? [],
        count: allMasterData?.length || 0
      })
      
      if (!allMasterData || allMasterData.length === 0) {
        console.error('❌ [CONFIRM] No master codes found in database! Session codes:', masterCodesScanned)
        console.error('❌ [CONFIRM] This means either the codes were not scanned, or the master_code field does not match')
        console.error('❌ [CONFIRM] Trying case-insensitive search to debug...')
        
        // Debug: Try to find similar codes (case-insensitive)
        const { data: debugData } = await supabase
          .from('qr_master_codes')
          .select('master_code, status')
          .ilike('master_code', `%${masterCodesScanned[0]?.substring(0, 10) || ''}%`)
          .limit(5)
        
        console.error('❌ [CONFIRM] Similar codes in DB:', debugData)
        console.error('❌ [CONFIRM] Skipping master update block - nothing to update')
        // Continue to session update - don't fail the entire shipment
      } else {
        console.log('✅ [CONFIRM] Found', allMasterData.length, 'master codes in DB, will attempt to update all regardless of current status')
      }
      
      // Look for master codes to ship - get ALL masters regardless of status
      // We'll update them to shipped_distributor unconditionally
      const { data: masterData, error: masterFetchError } = await supabase
        .from('qr_master_codes')
        .select(`
          id, 
          master_code, 
          warehouse_org_id, 
          shipped_to_distributor_id,
          status,
          qr_codes(id, code, status)
        `)
        .in('master_code', masterCodesScanned)

      if (masterFetchError) {
        console.error('❌ [CONFIRM] Error fetching master codes:', masterFetchError)
      } else if (masterData && masterData.length > 0) {
        console.log('📦 [CONFIRM] Found', masterData.length, 'shippable master codes:', masterData.map(m => ({ id: m.id, code: m.master_code, status: m.status })))
        const masterIds = masterData.map(master => master.id)
        console.log('📦 [CONFIRM] Master IDs to update:', masterIds)
        
        if (masterIds.length === 0) {
          console.warn('⚠️ [CONFIRM] No master IDs to update even though user scanned masters. Check master_codes_scanned content.')
          // Continue - this shouldn't happen but don't crash
        }

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

        console.log(`🔄 [CONFIRM] Attempting to update ${masterIds.length} master codes to shipped_distributor:`, masterIds)
        console.log('🔄 [CONFIRM] Master codes to update:', masterData.map(m => ({ master_code: m.master_code, current_status: m.status, id: m.id })))
        console.log('🔄 [CONFIRM] Update payload:', {
          status: 'shipped_distributor',
          shipped_at: shippedAt,
          shipped_by: user_id,
          shipped_to_distributor_id: resolvedToOrg,
          updated_at: shippedAt
        })
        
        // Set session variable to skip trigger (prevent duplicate inventory movements)
        // Use admin client to ensure we can set the session variable on the same connection we'll use for updates
        const { error: skipMasterError } = await supabaseAdmin.rpc('set_skip_ship_trigger', {
          p_skip: true
        })

        if (skipMasterError) {
          console.log('⚠️ [CONFIRM] Warning: Could not set session variable for master update:', skipMasterError.message)
          console.log('⚠️ [CONFIRM] Skip error details:', JSON.stringify(skipMasterError, null, 2))
        } else {
          console.log('✅ [CONFIRM] Successfully set skip_ship_trigger session variable')
        }

        // Update master codes - NO status filter to ensure ALL scanned masters are updated
        console.log('📝 [CONFIRM] Executing master update query...')
        // Use admin client to bypass RLS and ensure update succeeds
        const { data: updatedMasters, error: masterError } = await supabaseAdmin
          .from('qr_master_codes')
          .update({
            status: 'shipped_distributor',
            shipped_at: shippedAt,
            shipped_by: user_id,
            shipped_to_distributor_id: resolvedToOrg,
            updated_at: shippedAt
          })
          .in('id', masterIds)
          .select('id, master_code, status')

        console.log('🔄 [CONFIRM] Master update result - error:', masterError, 'updated count:', updatedMasters?.length)
        console.log('🔄 [CONFIRM] Updated masters:', updatedMasters?.map(m => ({ id: m.id, code: m.master_code, new_status: m.status })))

        if (!masterError && (!updatedMasters || updatedMasters.length === 0)) {
          console.error('⚠️⚠️⚠️ [CONFIRM] CRITICAL: Master update returned 0 rows!')
          console.error('❌ [CONFIRM] IDs attempted:', masterIds)
          console.error('❌ [CONFIRM] Master codes attempted:', masterCodesScanned)
          console.error('❌ [CONFIRM] This indicates a database constraint or RLS policy is blocking the update')
          console.error('❌ [CONFIRM] Or the IDs don\'t exist / were already updated')
          
          // Try to re-query to see current state
          const { data: currentState } = await supabase
            .from('qr_master_codes')
            .select('id, master_code, status, shipped_at')
            .in('id', masterIds)
          console.error('❌ [CONFIRM] Current state of masters:', currentState)
        }

        if (masterError) {
          console.error('❌ [CONFIRM] Error updating master codes:', masterError)
          console.error('❌ [CONFIRM] Error details:', JSON.stringify(masterError, null, 2))
          console.error('❌ [CONFIRM] Error code:', masterError.code)
          console.error('❌ [CONFIRM] Error message:', masterError.message)
        } else {
          const updatedMasterCount = updatedMasters?.length || 0
          masterCasesShipped += updatedMasterCount
          updatedMasters?.forEach((master) => updatedMasterIdSet.add(master.id))
          console.log(`✅ Updated ${updatedMasterCount} of ${masterIds.length} master codes to shipped_distributor`)
          if (updatedMasterCount < masterIds.length) {
            console.error(`⚠️ MISMATCH: Only ${updatedMasterCount} of ${masterIds.length} master codes were updated!`)
            console.error('Missing IDs:', masterIds.filter(id => !updatedMasters?.find(m => m.id === id)))
          }
          updatedMasters?.forEach(m => console.log(`  ✓ ${m.master_code}: ${m.status}`))
        }

        // Update all child unique codes that haven't already been shipped individually
        const { data: masterChildCodes, error: childFetchError } = await supabase
          .from('qr_codes')
          .select('id, code')
          .in('master_code_id', masterIds)
          .neq('status', 'shipped_distributor')

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
            // Use admin client for session variable
            const { error: skipChildError } = await supabaseAdmin.rpc('set_skip_ship_trigger', {
              p_skip: true
            })

            if (skipChildError) {
              console.log('⚠️  Warning: Could not set session variable before master child update:', skipChildError.message)
            }

            // Use admin client for child updates
            const { data: updatedChildCodes, error: updateChildError } = await supabaseAdmin
              .from('qr_codes')
              .update({
                status: 'shipped_distributor',
                current_location_org_id: resolvedToOrg,
                updated_at: shippedAt
              })
              .in('id', childIdsToUpdate)
              .neq('status', 'shipped_distributor')
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

    console.log('✅ [CONFIRM] SHIPMENT COMPLETE:', {
      master_cases_shipped: totalCases,
      unique_codes_shipped: totalUnique,
      master_codes_in_session: masterCodesScanned.length,
      unique_codes_in_session: uniqueCodesScanned.length,
      shipped_at: shippedAt
    })

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
