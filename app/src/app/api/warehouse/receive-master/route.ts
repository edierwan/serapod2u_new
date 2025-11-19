import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type ReceiveOutcome =
  | 'received'
  | 'already_received'
  | 'wrong_order'
  | 'not_found'
  | 'invalid_status'
  | 'error'
  | 'duplicate_request'
  | 'invalid_format'

type ReceiveResult = {
  master_code: string
  normalized_code: string
  outcome: ReceiveOutcome
  message: string
  order_id?: string | null
  warehouse_org_id?: string | null
  case_info?: {
    id: string
    master_code: string
    case_number: number | null
    status: string
    product_count: number
    warehouse_received_at: string | null
    variants?: Array<{
      variant_id: string
      quantity: number
      movement_id: string | null
      cases_increment?: number | null
    }>
  }
  received_at?: string
  details?: unknown
  inventory_updates?: InventorySnapshot[]
  inventory_warning?: string | null
}

type ReceiveContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  providedOrderId?: string
  providedWarehouseOrgId?: string
  requestingUserId: string
}

type InventorySnapshot = {
  variant_id: string
  quantity_on_hand: number
  quantity_available: number | null
  units_on_hand?: number | null
  cases_on_hand?: number | null
  variant_name?: string | null
  variant_code?: string | null
  product_name?: string | null
  product_code?: string | null
}

const normalizeMasterCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  let token = value.trim()
  if (!token) return null
  if (token.includes('/track/')) {
    const parts = token.split('/')
    token = parts[parts.length - 1] || token
  }
  return token.trim() || null
}

const resolveSingleVariantForOrder = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string | null | undefined
): Promise<string | null> => {
  if (!orderId) return null

  const { data, error } = await supabase
    .from('order_items')
    .select('variant_id')
    .eq('order_id', orderId)

  if (error) {
    console.warn('⚠️ Failed to load order items for inventory fallback:', error)
    return null
  }

  const uniqueVariants = new Set<string>()
  ;(data || []).forEach((item: any) => {
    if (item?.variant_id) {
      uniqueVariants.add(item.variant_id as string)
    }
  })

  if (uniqueVariants.size === 1) {
    return Array.from(uniqueVariants)[0]
  }

  return null
}

const summarizeResults = (results: ReceiveResult[]) => {
  const base = {
    total: results.length,
    received: 0,
    alreadyReceived: 0,
    wrongOrder: 0,
    notFound: 0,
    invalidStatus: 0,
    duplicateRequest: 0,
    invalidFormat: 0,
    errors: 0
  }

  for (const result of results) {
    switch (result.outcome) {
      case 'received':
        base.received += 1
        break
      case 'already_received':
        base.alreadyReceived += 1
        break
      case 'wrong_order':
        base.wrongOrder += 1
        break
      case 'not_found':
        base.notFound += 1
        break
      case 'invalid_status':
        base.invalidStatus += 1
        break
      case 'duplicate_request':
        base.duplicateRequest += 1
        break
      case 'invalid_format':
        base.invalidFormat += 1
        break
      case 'error':
        base.errors += 1
        break
      default:
        break
    }
  }

  return base
}

const mapSingleResultToStatus = (result: ReceiveResult): number => {
  switch (result.outcome) {
    case 'received':
      return 200
    case 'already_received':
      return 409
    case 'wrong_order':
    case 'invalid_status':
    case 'invalid_format':
      return 400
    case 'not_found':
      return 404
    case 'duplicate_request':
      return 200
    default:
      return 500
  }
}

const receiveSingleMaster = async (
  normalizedMasterCode: string,
  context: ReceiveContext
): Promise<ReceiveResult> => {
  const { supabase, providedOrderId, providedWarehouseOrgId, requestingUserId } = context

  try {
    const { data: masterRecord, error: masterError } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        status,
        case_number,
        expected_unit_count,
        actual_unit_count,
        warehouse_org_id,
        manufacturer_org_id,
        batch_id,
        company_id,
        warehouse_received_at,
        qr_batches (
          id,
          order_id,
          orders (
            id,
            order_no,
            buyer_org_id,
            seller_org_id,
            company_id
          )
        )
      `)
      .eq('master_code', normalizedMasterCode)
      .maybeSingle()

    if (masterError) {
      console.error('❌ Failed to load master code for warehouse receive:', masterError)
      return {
        master_code: normalizedMasterCode,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: 'Failed to load master code metadata',
        details: masterError
      }
    }

    if (!masterRecord) {
      return {
        master_code: normalizedMasterCode,
        normalized_code: normalizedMasterCode,
        outcome: 'not_found',
        message: 'Master code not found'
      }
    }

    const batchRecord = masterRecord.qr_batches
      ? (Array.isArray(masterRecord.qr_batches) ? masterRecord.qr_batches[0] : masterRecord.qr_batches)
      : null
    const orderRecord = batchRecord?.orders
      ? (Array.isArray(batchRecord.orders) ? batchRecord.orders[0] : batchRecord.orders)
      : null

    const resolvedOrderId = orderRecord?.id || batchRecord?.order_id || null
    const resolvedOrderNo = orderRecord?.order_no || null
    const resolvedCompanyId = orderRecord?.company_id || masterRecord.company_id || null
    const manufacturerOrgId = masterRecord.manufacturer_org_id || orderRecord?.seller_org_id || null

    if (providedOrderId && resolvedOrderId && providedOrderId !== resolvedOrderId) {
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'wrong_order',
        message: 'Master code does not belong to selected order',
        order_id: resolvedOrderId,
        warehouse_org_id: masterRecord.warehouse_org_id
      }
    }

    let resolvedWarehouseOrgId =
      providedWarehouseOrgId || masterRecord.warehouse_org_id || orderRecord?.buyer_org_id || null

    if (!resolvedWarehouseOrgId) {
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: 'Unable to determine warehouse for this master case'
      }
    }

    if (orderRecord?.buyer_org_id && resolvedWarehouseOrgId !== orderRecord.buyer_org_id) {
      console.warn('⚠️ Warehouse mismatch detected. Proceeding with provided warehouse.', {
        provided: providedWarehouseOrgId,
        assigned: resolvedWarehouseOrgId,
        buyer: orderRecord.buyer_org_id,
        master_code: normalizedMasterCode
      })
    }

    if (masterRecord.status === 'received_warehouse') {
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'already_received',
        message: 'Master case already received at warehouse',
        order_id: resolvedOrderId,
        warehouse_org_id: resolvedWarehouseOrgId,
        case_info: {
          id: masterRecord.id,
          master_code: masterRecord.master_code,
          case_number: masterRecord.case_number,
          status: masterRecord.status,
          product_count:
            masterRecord.actual_unit_count || masterRecord.expected_unit_count || 0,
          warehouse_received_at: masterRecord.warehouse_received_at,
          variants: []
        },
        received_at: masterRecord.warehouse_received_at || undefined
      }
    }

    if (!['packed', 'ready_to_ship'].includes(masterRecord.status)) {
      console.warn('⚠️ [Warehouse Receive] Invalid status attempt:', {
        master_code: masterRecord.master_code,
        current_status: masterRecord.status,
        required_status: ['packed', 'ready_to_ship'],
        order_id: resolvedOrderId
      })
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'invalid_status',
        message: `Master case must be packed or ready_to_ship before receiving (current status: ${masterRecord.status})`,
        order_id: resolvedOrderId,
        warehouse_org_id: resolvedWarehouseOrgId
      }
    }

    // ============================================================================
    // CORRECT STRATEGY: Fetch codes by case_number (same as manufacturer logic)
    // ============================================================================
    // Get ALL non-buffer codes for this specific case_number
    // This automatically handles:
    // - Normal cases: 1 product per case
    // - Mixed cases: Multiple products in same case_number
    // - Variable sizes: Different expected_unit_count per case
    // ============================================================================
    
    console.log('🎯 [Warehouse Receive] Fetching codes by case_number (supports normal & mixed cases)')
    
    const { data: uniqueCodes, error: uniqueCodesError } = await supabase
      .from('qr_codes')
      .select('id, code, variant_id, case_number, is_buffer, master_code_id')
      .eq('batch_id', masterRecord.batch_id)
      .eq('case_number', masterRecord.case_number) // ✅ Link by case_number
      .eq('is_buffer', false)                       // ✅ Exclude buffer codes
      .limit(100000)                                // Handle large cases

    if (uniqueCodesError) {
      console.error('❌ Failed to load child codes for master receive:', uniqueCodesError)
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: 'Failed to load unique codes for master case',
        details: uniqueCodesError
      }
    }

    // Detect if this is a mixed case
    const uniqueVariants = new Set((uniqueCodes || []).map(c => c.variant_id).filter(Boolean))
    const isMixedCase = uniqueVariants.size > 1
    
    console.log('📊 [Warehouse Receive] Found codes for case #' + masterRecord.case_number + ':', {
      total_found: uniqueCodes?.length || 0,
      expected: masterRecord.expected_unit_count,
      match: uniqueCodes?.length === masterRecord.expected_unit_count,
      is_mixed_case: isMixedCase,
      unique_products: uniqueVariants.size
    })

    // Validation: Check if we found codes
    if (!uniqueCodes || uniqueCodes.length === 0) {
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: `No QR codes found for case #${masterRecord.case_number}. Case may not have been generated yet.`,
        order_id: resolvedOrderId,
        warehouse_org_id: resolvedWarehouseOrgId
      }
    }

    // ============================================================================
    // STRICT VALIDATION: Ensure data integrity before receiving
    // ============================================================================

    // Validation 2: Strict count validation against expected_unit_count
    if (masterRecord.expected_unit_count !== null && uniqueCodes.length !== masterRecord.expected_unit_count) {
      const message = `Expected ${masterRecord.expected_unit_count} codes but found ${uniqueCodes.length} for case #${masterRecord.case_number}. Case is incomplete or over-filled.`
      console.error(`❌ [Warehouse Receive] ${message}${isMixedCase ? ' (mixed case)' : ''}`)
      
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message,
        order_id: resolvedOrderId,
        warehouse_org_id: resolvedWarehouseOrgId,
        details: {
          case_number: masterRecord.case_number,
          expected_count: masterRecord.expected_unit_count,
          found_count: uniqueCodes.length,
          is_mixed_case: isMixedCase,
          unique_products: uniqueVariants.size
        }
      }
    }

    // Validation 3: Check actual_unit_count consistency (if set by manufacturer)
    if (masterRecord.actual_unit_count !== null && 
        masterRecord.actual_unit_count > 0 && 
        uniqueCodes.length !== masterRecord.actual_unit_count) {
      console.warn(`⚠️ [Warehouse Receive] actual_unit_count mismatch for case #${masterRecord.case_number}:`, {
        actual_unit_count: masterRecord.actual_unit_count,
        found_codes: uniqueCodes.length,
        master_code: masterRecord.master_code
      })
    }

    // Validation 4: Ensure all codes in this case are linked to THIS master (or unlinked)
    const codesLinkedToOtherMasters = (uniqueCodes || []).filter(
      c => c.master_code_id !== null && c.master_code_id !== masterRecord.id
    )
    
    if (codesLinkedToOtherMasters.length > 0) {
      console.error('❌ [Warehouse Receive] Codes in this case are linked to different masters:', {
        case_number: masterRecord.case_number,
        this_master: masterRecord.id,
        conflicting_codes: codesLinkedToOtherMasters.length
      })
      
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: `${codesLinkedToOtherMasters.length} code(s) in case #${masterRecord.case_number} are linked to different master cases. Data integrity issue - cannot receive.`,
        order_id: resolvedOrderId,
        warehouse_org_id: resolvedWarehouseOrgId,
        details: {
          case_number: masterRecord.case_number,
          conflicting_codes: codesLinkedToOtherMasters.length,
          expected_master: masterRecord.id
        }
      }
    }

    // Validation 5: Warn if codes don't have master_code_id set (manufacturer didn't pack properly)
    const codesWithoutMaster = (uniqueCodes || []).filter(c => c.master_code_id === null)
    if (codesWithoutMaster.length > 0) {
      console.warn(`⚠️ [Warehouse Receive] ${codesWithoutMaster.length} codes in case #${masterRecord.case_number} have no master_code_id. Case may not have been properly packed by manufacturer.`)
    }

    const receivedAt = new Date().toISOString()

    console.log('✅ [Warehouse Receive] Setting warehouse_received_at:', {
      master_code: masterRecord.master_code,
      master_id: masterRecord.id,
      warehouse_org_id: resolvedWarehouseOrgId,
      warehouse_received_at: receivedAt,
      order_id: resolvedOrderId
    })

    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update({
        status: 'received_warehouse',
        warehouse_org_id: resolvedWarehouseOrgId,
        warehouse_received_at: receivedAt,
        warehouse_received_by: requestingUserId,
        updated_at: receivedAt
      })
      .eq('id', masterRecord.id)
      .in('status', ['packed', 'ready_to_ship'])

    if (masterUpdateError) {
      console.error('❌ Failed to update master case during warehouse receive:', masterUpdateError)
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: 'Failed to update master case status',
        details: masterUpdateError
      }
    }

    console.log('✅ [Warehouse Receive] Successfully updated master case:', {
      master_code: masterRecord.master_code,
      master_id: masterRecord.id,
      new_status: 'received_warehouse',
      is_mixed_case: isMixedCase,
      unique_products: uniqueVariants.size
    })

    // ============================================================================
    // CONSISTENCY: Use the SAME set of codes (uniqueCodes) for status update
    // ============================================================================
    // Update ONLY the validated codes from case_number query
    // This ensures inventory and status updates use identical code sets
    const codeIds = (uniqueCodes || []).map(c => c.id)
    
    console.log('📝 [Warehouse Receive] Updating codes (using validated IDs):', {
      codes_to_update: codeIds.length,
      case_number: masterRecord.case_number,
      codes_with_master_link: uniqueCodes.filter(c => c.master_code_id === masterRecord.id).length,
      codes_without_master_link: codesWithoutMaster.length,
      sample_code_ids: codeIds.slice(0, 3)
    })

    const { error: codesUpdateError } = await supabase
      .from('qr_codes')
      .update({
        status: 'received_warehouse',
        current_location_org_id: resolvedWarehouseOrgId,
        last_scanned_at: receivedAt,
        last_scanned_by: requestingUserId,
        updated_at: receivedAt
      })
      .in('id', codeIds) // ✅ Update only validated codes from case_number query

    if (codesUpdateError) {
      console.error('❌ Failed to update child codes during warehouse receive:', codesUpdateError)
      return {
        master_code: masterRecord.master_code,
        normalized_code: normalizedMasterCode,
        outcome: 'error',
        message: 'Failed to update child codes for master',
        details: codesUpdateError
      }
    }

    const variantCounts = new Map<string, number>()
    ;(uniqueCodes || []).forEach(code => {
      if (!code.variant_id) return
      const variantId = code.variant_id as string
      variantCounts.set(variantId, (variantCounts.get(variantId) || 0) + 1)
    })

    let variantEntries = Array.from(variantCounts.entries())
    let inventoryWarning: string | null = null

    // ============================================================================
    // REFINED FALLBACK: Only use for simple single-variant orders with valid data
    // ============================================================================
    if (variantEntries.length === 0) {
      // Only attempt fallback if:
      // 1. We have codes (uniqueCodes.length > 0)
      // 2. Count matches expected
      // 3. Order has exactly one variant
      if (uniqueCodes.length > 0 && 
          uniqueCodes.length === masterRecord.expected_unit_count) {
        const fallbackVariantId = await resolveSingleVariantForOrder(supabase, resolvedOrderId)
        
        if (fallbackVariantId) {
          // Use actual counted codes, not expected_unit_count
          variantEntries = [[fallbackVariantId, uniqueCodes.length]]
          inventoryWarning = 'Variant IDs missing in QR codes. Used order-level fallback for single-variant order.'
          console.warn(`⚠️ [Warehouse Receive] Using fallback variant for case #${masterRecord.case_number}:`, {
            fallback_variant_id: fallbackVariantId,
            quantity: uniqueCodes.length
          })
        } else {
          // Multiple variants in order or no variants found - cannot fallback
          return {
            master_code: masterRecord.master_code,
            normalized_code: normalizedMasterCode,
            outcome: 'error',
            message: `Cannot determine product variants for case #${masterRecord.case_number}. QR codes have no variant_id and order has multiple or no variants.`,
            order_id: resolvedOrderId,
            warehouse_org_id: resolvedWarehouseOrgId,
            details: {
              case_number: masterRecord.case_number,
              codes_count: uniqueCodes.length,
              variant_ids_in_codes: 0
            }
          }
        }
      } else {
        // No codes or count mismatch - this is a data integrity error
        return {
          master_code: masterRecord.master_code,
          normalized_code: normalizedMasterCode,
          outcome: 'error',
          message: `No product variants found in QR codes for case #${masterRecord.case_number}. Cannot process inventory.`,
          order_id: resolvedOrderId,
          warehouse_org_id: resolvedWarehouseOrgId,
          details: {
            case_number: masterRecord.case_number,
            codes_count: uniqueCodes.length,
            expected_count: masterRecord.expected_unit_count,
            variant_ids_in_codes: 0
          }
        }
      }
    }

    const variantMetaMap = new Map<string, { unitsPerCase: number | null }>()
    if (variantEntries.length > 0) {
      const variantIds = Array.from(new Set(variantEntries.map(([variantId]) => variantId)))
      const { data: variantMeta, error: variantMetaError } = await supabase
        .from('product_variants')
        .select('id, products!inner ( units_per_case )')
        .in('id', variantIds)

      if (variantMetaError) {
        console.error('⚠️ Failed to load variant metadata for warehouse receive:', variantMetaError)
        if (!inventoryWarning) {
          inventoryWarning = 'Inventory updated without product unit-per-case metadata.'
        }
      } else {
        for (const row of variantMeta || []) {
          const product = Array.isArray(row.products) ? row.products[0] : row.products
          const unitsPerCase = product?.units_per_case ?? null
          variantMetaMap.set(row.id, { unitsPerCase })
        }
      }
    }

    if (variantEntries.length > 1 && !inventoryWarning) {
      inventoryWarning = 'Master case contains multiple product variants. Units recorded; case totals left unchanged.'
    }

    const inventoryMovements: Array<{ variant_id: string; quantity: number; movement_id: string | null; cases_increment?: number | null }> = []
    const inventorySnapshots: InventorySnapshot[] = []

    for (const [variantId, quantity] of variantEntries) {
      const { data: movementId, error: movementError } = await supabase.rpc('record_stock_movement', {
        p_movement_type: 'addition',
        p_variant_id: variantId,
        p_organization_id: resolvedWarehouseOrgId,
        p_quantity_change: quantity,
        p_unit_cost: null,
        p_manufacturer_id: manufacturerOrgId,
        p_warehouse_location: null,
        p_reason: 'warehouse_receive',
        p_notes: `Master ${masterRecord.master_code} received`,
        p_reference_type: 'order',
        p_reference_id: resolvedOrderId,
        p_reference_no: resolvedOrderNo,
        p_company_id: resolvedCompanyId,
        p_created_by: requestingUserId
      })

      if (movementError) {
        console.error('❌ Failed to record inventory movement during warehouse receive:', movementError)
        return {
          master_code: masterRecord.master_code,
          normalized_code: normalizedMasterCode,
          outcome: 'error',
          message: 'Failed to record inventory movement',
          details: movementError
        }
      }

      const meta = variantMetaMap.get(variantId)
      const unitsPerCase = meta?.unitsPerCase && meta.unitsPerCase > 0 ? meta.unitsPerCase : null
      const isSingleVariantMaster = variantEntries.length === 1
      let casesIncrement = 0

      if (isSingleVariantMaster) {
        if (unitsPerCase && unitsPerCase > 0) {
          casesIncrement = Math.max(1, Math.round(quantity / unitsPerCase))
        } else {
          casesIncrement = 1
          if (!inventoryWarning) {
            inventoryWarning = 'Case totals estimated because product unit-per-case metadata is missing.'
          }
        }
      }

      inventoryMovements.push({
        variant_id: variantId,
        quantity,
        movement_id: movementId || null,
        cases_increment: isSingleVariantMaster ? casesIncrement : null
      })

      const { data: inventoryRow, error: inventoryError } = await supabase
        .from('product_inventory')
        .select(`
          quantity_on_hand,
          quantity_available,
          units_on_hand,
          cases_on_hand,
          variant_id,
          product_variants (
            variant_name,
            variant_code,
            products (
              product_name,
              product_code
            )
          )
        `)
        .eq('organization_id', resolvedWarehouseOrgId)
        .eq('variant_id', variantId)
        .maybeSingle()

      if (inventoryError) {
        console.warn('⚠️ Failed to load inventory snapshot:', inventoryError)
        continue
      }

      if (inventoryRow) {
        const variantData = Array.isArray(inventoryRow.product_variants)
          ? inventoryRow.product_variants[0]
          : inventoryRow.product_variants
        const productData = variantData?.products
          ? Array.isArray(variantData.products)
            ? variantData.products[0]
            : variantData.products
          : null

        inventorySnapshots.push({
          variant_id: variantId,
          quantity_on_hand: inventoryRow.quantity_on_hand ?? 0,
          quantity_available: inventoryRow.quantity_available ?? null,
          units_on_hand: inventoryRow.units_on_hand ?? null,
          cases_on_hand: inventoryRow.cases_on_hand ?? null,
          variant_name: variantData?.variant_name ?? null,
          variant_code: variantData?.variant_code ?? null,
          product_name: productData?.product_name ?? null,
          product_code: productData?.product_code ?? null
        })
      }
    }

    const { error: movementLogError } = await supabase
      .from('qr_movements')
      .insert({
        company_id: resolvedCompanyId,
        qr_master_code_id: masterRecord.id,
        movement_type: 'warehouse_receive',
        from_org_id: manufacturerOrgId,
        to_org_id: resolvedWarehouseOrgId,
        current_status: 'received_warehouse',
        scanned_at: receivedAt,
        scanned_by: requestingUserId,
        related_order_id: resolvedOrderId,
        notes: `Warehouse receive: ${masterRecord.master_code}`
      })

    if (movementLogError) {
      console.warn('⚠️ Failed to insert warehouse movement log:', movementLogError)
    }

    // ============================================================================
    // CONSISTENCY: Use actual counted codes, no fallbacks
    // ============================================================================
    // totalProducts should always equal uniqueCodes.length (validated earlier)
    const totalProducts = uniqueCodes.length

    return {
      master_code: masterRecord.master_code,
      normalized_code: normalizedMasterCode,
      outcome: 'received',
      message: `Received case ${masterRecord.case_number}`,
      order_id: resolvedOrderId,
      warehouse_org_id: resolvedWarehouseOrgId,
      case_info: {
        id: masterRecord.id,
        master_code: masterRecord.master_code,
        case_number: masterRecord.case_number,
        status: 'received_warehouse',
        product_count: totalProducts,
        warehouse_received_at: receivedAt,
        variants: inventoryMovements
      },
      received_at: receivedAt,
      inventory_updates: inventorySnapshots,
      inventory_warning: inventoryWarning
    }
  } catch (error: any) {
    console.error('❌ Warehouse receive error (single):', error)
    return {
      master_code: normalizedMasterCode,
      normalized_code: normalizedMasterCode,
      outcome: 'error',
      message: error?.message || 'Unexpected error processing master code',
      details: error
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { master_code, master_codes, order_id, warehouse_org_id, user_id } = body || {}

    const rawInput = Array.isArray(master_codes)
      ? master_codes
      : master_code !== undefined
        ? [master_code]
        : []

    if (rawInput.length === 0) {
      return NextResponse.json({ message: 'master_code is required' }, { status: 400 })
    }

    const requestingUserId = user_id || user.id

    const results: ReceiveResult[] = []
    const seenCodes = new Set<string>()

    for (const rawCode of rawInput) {
      const normalized = normalizeMasterCode(rawCode)

      if (!normalized) {
        results.push({
          master_code: typeof rawCode === 'string' ? rawCode : String(rawCode),
          normalized_code: typeof rawCode === 'string' ? rawCode.trim() : String(rawCode),
          outcome: 'invalid_format',
          message: 'Invalid master code format'
        })
        continue
      }

      if (seenCodes.has(normalized)) {
        results.push({
          master_code: normalized,
          normalized_code: normalized,
          outcome: 'duplicate_request',
          message: 'Duplicate master code in request'
        })
        continue
      }

      seenCodes.add(normalized)

      const result = await receiveSingleMaster(normalized, {
        supabase,
        providedOrderId: order_id,
        providedWarehouseOrgId: warehouse_org_id,
        requestingUserId
      })

      results.push(result)
    }

    const summary = summarizeResults(results)
    const success = summary.received > 0
    const responsePayload: Record<string, any> = {
      success,
      results,
      summary
    }

    if (results.length === 1) {
      const single = results[0]
      if (single.case_info) {
        responsePayload.case_info = single.case_info
        responsePayload.master_code = single.case_info.master_code
        responsePayload.master_status = single.case_info.status
        responsePayload.order_id = single.order_id ?? null
        responsePayload.warehouse_org_id = single.warehouse_org_id ?? null
        responsePayload.received_at = single.received_at ?? null
      }
      responsePayload.message = single.message
    }

    const status = results.length === 1 ? mapSingleResultToStatus(results[0]) : 200

    return NextResponse.json(responsePayload, { status })
  } catch (error: any) {
    console.error('❌ Warehouse receive error:', error)
    return NextResponse.json(
      {
        message: error?.message || 'Failed to receive master case',
        details: error
      },
      { status: 500 }
    )
  }
}
