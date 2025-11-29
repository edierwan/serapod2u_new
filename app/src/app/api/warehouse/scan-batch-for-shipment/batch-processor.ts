import { createClient } from '@/lib/supabase/server'
import { extractMasterCode, parseQRCode } from '@/lib/qr-code-utils'
import { 
  ValidationSession, 
  ShipmentScanResult, 
  fetchVariantMetadata, 
  normalizeCode, 
  mapOutcomeToStatus,
  CodeType,
  ScanOutcome
} from '../scan-for-shipment/route'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type BatchResult = {
  results: ShipmentScanResult[]
  summary: {
    total: number
    success: number
    duplicates: number
    errors: number
  }
  sessionUpdate?: {
    master_codes_scanned: string[]
    unique_codes_scanned: string[]
    scanned_quantities: {
      total_units: number
      total_cases: number
      per_variant: Record<string, { units: number, cases: number }>
    }
  }
}

export async function processBatchShipment(
  supabase: SupabaseClient,
  session: ValidationSession,
  codes: string[],
  requestingUserId: string
): Promise<BatchResult> {
  const results: ShipmentScanResult[] = []
  const summary = { total: codes.length, success: 0, duplicates: 0, errors: 0 }

  // 1. Normalize and Classify Codes
  const uniqueCodesToFetch = new Set<string>()
  const masterCodesToFetch = new Set<string>()
  const codeMap = new Map<string, { original: string, normalized: string, type: CodeType }>()

  for (const code of codes) {
    const normalized = normalizeCode(code)
    if (!normalized) {
      results.push({
        code,
        normalized_code: code,
        code_type: 'master',
        outcome: 'invalid_format',
        message: 'Invalid code format'
      })
      summary.errors++
      continue
    }

    let type: CodeType = 'master'
    const parsed = parseQRCode(normalized)
    if (parsed.isValid && parsed.type === 'PRODUCT') {
      type = 'unique'
    } else if (normalized.toUpperCase().startsWith('PROD-')) {
      type = 'unique'
    } else {
      // Default to master
      type = 'master'
    }

    const normalizedForLookup = type === 'master' ? (extractMasterCode(normalized) || normalized) : normalized
    
    codeMap.set(code, { original: code, normalized: normalizedForLookup, type })

    if (type === 'master') {
      masterCodesToFetch.add(normalizedForLookup)
    } else {
      uniqueCodesToFetch.add(normalizedForLookup)
    }
  }

  // 2. Bulk Fetch Data
  const [
    { data: masterRecords },
    { data: uniqueRecords },
    { data: existingMasters }, // For duplicate check
    { data: existingUniques }  // For duplicate check
  ] = await Promise.all([
    // Fetch Master Records
    masterCodesToFetch.size > 0 
      ? supabase.from('qr_master_codes')
          .select(`
            id, master_code, status, case_number, warehouse_org_id, 
            shipped_to_distributor_id, expected_unit_count, actual_unit_count, 
            batch_id, company_id,
            qr_batches ( id, order_id, orders ( id, company_id ) )
          `)
          .in('master_code', Array.from(masterCodesToFetch))
      : Promise.resolve({ data: [] }),

    // Fetch Unique Records
    uniqueCodesToFetch.size > 0
      ? supabase.from('qr_codes')
          .select('id, code, status, variant_id, current_location_org_id, master_code_id, company_id')
          .in('code', Array.from(uniqueCodesToFetch))
      : Promise.resolve({ data: [] }),
      
    // Fetch Existing Scanned Masters (Duplicate Check)
    // We check DB status, but also need to know if they are already shipped
    // The main query above gets status, so we can check there.
    // But we also need to check if they are in the current session? 
    // The session object has `master_codes_scanned`.
    Promise.resolve({ data: [] }), 
    Promise.resolve({ data: [] })
  ])

  // Fetch Child Codes for Masters
  const validMasterIds = (masterRecords || []).map(m => m.id)
  const { data: childCodes } = validMasterIds.length > 0
    ? await supabase.from('qr_codes')
        .select('id, code, variant_id, status, master_code_id')
        .in('master_code_id', validMasterIds)
        .in('status', ['received_warehouse', 'warehouse_packed'])
    : { data: [] }

  // Collect Variant IDs for Metadata & Inventory
  const variantIds = new Set<string>()
  
  // From Uniques
  uniqueRecords?.forEach(r => { if (r.variant_id) variantIds.add(r.variant_id) })
  
  // From Children of Masters
  childCodes?.forEach(r => { if (r.variant_id) variantIds.add(r.variant_id) })

  // Fetch Metadata & Inventory
  const [variantMeta, { data: inventoryRows }] = await Promise.all([
    fetchVariantMetadata(supabase, Array.from(variantIds)),
    variantIds.size > 0
      ? supabase.from('product_inventory')
          .select('variant_id, quantity_on_hand')
          .eq('organization_id', session.warehouse_org_id)
          .in('variant_id', Array.from(variantIds))
      : Promise.resolve({ data: [] })
  ])

  const inventoryMap = new Map<string, number>()
  inventoryRows?.forEach(r => {
    if (r.variant_id) inventoryMap.set(r.variant_id, r.quantity_on_hand ?? 0)
  })

  // 3. Process Logic & Prepare Updates
  const updates = {
    masterIds: [] as string[],
    uniqueIds: [] as string[], // Loose uniques
    childMasterIds: [] as string[], // Masters whose children need update
    movements: [] as any[],
    session: {
      masters: new Set(session.master_codes_scanned || []),
      uniques: new Set(session.unique_codes_scanned || []),
      quantities: session.scanned_quantities 
        ? { ...session.scanned_quantities, per_variant: { ...session.scanned_quantities.per_variant } } 
        : { total_units: 0, total_cases: 0, per_variant: {} }
    }
  }

  // Initialize per_variant if missing (safety check)
  if (!updates.session.quantities.per_variant) {
    updates.session.quantities.per_variant = {}
  }

  const scannedAt = new Date().toISOString()

  // Helper to process inventory impact
  const processInventory = (variantId: string, units: number, cases: number, isShortfall: boolean) => {
    updates.session.quantities.total_units += units
    updates.session.quantities.total_cases += cases
    
    if (!updates.session.quantities.per_variant[variantId]) {
      updates.session.quantities.per_variant[variantId] = { units: 0, cases: 0 }
    }
    updates.session.quantities.per_variant[variantId].units += units
    updates.session.quantities.per_variant[variantId].cases += cases
  }

  // Map for fast lookup
  const masterMap = new Map(masterRecords?.map(m => [m.master_code, m]))
  const uniqueMap = new Map(uniqueRecords?.map(u => [u.code, u]))
  const childrenMap = new Map<string, typeof childCodes>() // master_id -> children
  
  childCodes?.forEach(c => {
    if (c.master_code_id) {
      const list = childrenMap.get(c.master_code_id) || []
      list.push(c)
      childrenMap.set(c.master_code_id, list)
    }
  })

  for (const code of codes) {
    // Skip if already processed as invalid format
    if (!codeMap.has(code)) continue

    const { normalized, type } = codeMap.get(code)!
    
    if (type === 'master') {
      const record = masterMap.get(normalized)
      
      if (!record) {
        results.push({ code, normalized_code: normalized, code_type: 'master', outcome: 'not_found', message: 'Master case not found' })
        summary.errors++
        continue
      }

      if (record.status === 'shipped_distributor') {
        results.push({ code, normalized_code: normalized, code_type: 'master', outcome: 'already_shipped', message: 'Already shipped' })
        summary.duplicates++ // Treat as duplicate/already done
        continue
      }

      if (record.warehouse_org_id && record.warehouse_org_id !== session.warehouse_org_id) {
        results.push({ code, normalized_code: normalized, code_type: 'master', outcome: 'wrong_warehouse', message: 'Wrong warehouse' })
        summary.errors++
        continue
      }

      const validStatuses = ['received_warehouse', 'warehouse_packed', 'ready_to_ship']
      if (!record.status || !validStatuses.includes(record.status)) {
        results.push({ code, normalized_code: normalized, code_type: 'master', outcome: 'invalid_status', message: `Invalid status: ${record.status}` })
        summary.errors++
        continue
      }

      // Valid Master
      updates.masterIds.push(record.id)
      updates.childMasterIds.push(record.id)
      updates.session.masters.add(normalized)

      // Inventory & Children
      const children = childrenMap.get(record.id) || []
      const variantCounts = new Map<string, number>()
      children.forEach(c => {
        if (c.variant_id) variantCounts.set(c.variant_id, (variantCounts.get(c.variant_id) || 0) + 1)
      })

      // Fallback if no children (use order items or expected count - simplified for batch)
      if (variantCounts.size === 0) {
         // Simplified: if no children, we might skip inventory calc or assume unknown
         // For batch optimization, we'll stick to what we found.
      }

      const isSingleVariant = variantCounts.size === 1
      
      for (const [vid, count] of Array.from(variantCounts)) {
        const meta = variantMeta.get(vid)
        const unitsPerCase = meta?.unitsPerCase || 1
        const cases = isSingleVariant ? 1 : (count / unitsPerCase)
        
        const available = inventoryMap.get(vid) || 0
        const shortfall = available < count
        
        processInventory(vid, count, cases, shortfall)
      }

      updates.movements.push({
        company_id: record.company_id,
        qr_master_code_id: record.id,
        movement_type: 'warehouse_scan',
        from_org_id: session.warehouse_org_id,
        to_org_id: session.distributor_org_id,
        current_status: 'warehouse_packed',
        scanned_at: scannedAt,
        scanned_by: requestingUserId,
        notes: 'Batch warehouse scan'
      })

      results.push({
        code, normalized_code: normalized, code_type: 'master', outcome: 'shipped', 
        message: 'Shipped',
        master_case: {
          id: record.id,
          master_code: record.master_code,
          case_number: record.case_number,
          status: 'warehouse_packed'
        }
      })
      summary.success++

    } else {
      // Unique
      const record = uniqueMap.get(normalized)

      if (!record) {
        results.push({ code, normalized_code: normalized, code_type: 'unique', outcome: 'not_found', message: 'Code not found' })
        summary.errors++
        continue
      }

      if (record.status === 'shipped_distributor') {
        results.push({ code, normalized_code: normalized, code_type: 'unique', outcome: 'already_shipped', message: 'Already shipped' })
        summary.duplicates++
        continue
      }

      if (record.current_location_org_id && record.current_location_org_id !== session.warehouse_org_id && record.status !== 'warehouse_packed') {
        results.push({ code, normalized_code: normalized, code_type: 'unique', outcome: 'wrong_warehouse', message: 'Wrong warehouse' })
        summary.errors++
        continue
      }

      const validStatuses = ['received_warehouse', 'packed', 'warehouse_packed']
      if (!record.status || !validStatuses.includes(record.status)) {
        results.push({ code, normalized_code: normalized, code_type: 'unique', outcome: 'invalid_status', message: `Invalid status: ${record.status}` })
        summary.errors++
        continue
      }

      // Valid Unique
      updates.uniqueIds.push(record.id)
      updates.session.uniques.add(normalized)

      if (record.variant_id) {
        const available = inventoryMap.get(record.variant_id) || 0
        const shortfall = available < 1
        processInventory(record.variant_id, 1, 0, shortfall)
      }

      updates.movements.push({
        company_id: record.company_id,
        qr_code_id: record.id,
        movement_type: 'warehouse_scan',
        from_org_id: session.warehouse_org_id,
        to_org_id: session.distributor_org_id,
        current_status: 'warehouse_packed',
        scanned_at: scannedAt,
        scanned_by: requestingUserId,
        notes: 'Batch warehouse scan'
      })

      results.push({ code, normalized_code: normalized, code_type: 'unique', outcome: 'shipped', message: 'Shipped' })
      summary.success++
    }
  }

  // 4. Execute Bulk Updates
  if (updates.masterIds.length > 0) {
    await supabase.from('qr_master_codes')
      .update({ 
        status: 'warehouse_packed', 
        shipped_to_distributor_id: session.distributor_org_id,
        updated_at: scannedAt 
      })
      .in('id', updates.masterIds)
  }

  if (updates.childMasterIds.length > 0) {
    await supabase.from('qr_codes')
      .update({
        status: 'warehouse_packed',
        current_location_org_id: session.distributor_org_id,
        last_scanned_at: scannedAt,
        last_scanned_by: requestingUserId,
        updated_at: scannedAt
      })
      .in('master_code_id', updates.childMasterIds)
      .in('status', ['received_warehouse', 'warehouse_packed'])
  }

  if (updates.uniqueIds.length > 0) {
    // For loose uniques, we also need to clear master_code_id if present
    // But we can't do conditional update easily in bulk if some have it and some don't
    // We'll just set it to null for all loose items, which is correct behavior (unlinking)
    await supabase.from('qr_codes')
      .update({
        status: 'warehouse_packed',
        current_location_org_id: session.distributor_org_id,
        last_scanned_at: scannedAt,
        last_scanned_by: requestingUserId,
        updated_at: scannedAt
        // master_code_id: null // REMOVED: Do not unlink from master, we need it for tracking
      })
      .in('id', updates.uniqueIds)
  }

  if (updates.movements.length > 0) {
    await supabase.from('qr_movements').insert(updates.movements)
  }

  // Update Session
  if (summary.success > 0) {
    await supabase.from('qr_validation_reports')
      .update({
        master_codes_scanned: Array.from(updates.session.masters),
        unique_codes_scanned: Array.from(updates.session.uniques),
        scanned_quantities: updates.session.quantities,
        updated_at: scannedAt
      })
      .eq('id', session.id)
  }

  return { 
    results, 
    summary,
    sessionUpdate: {
      master_codes_scanned: Array.from(updates.session.masters),
      unique_codes_scanned: Array.from(updates.session.uniques),
      scanned_quantities: updates.session.quantities
    }
  }
}
