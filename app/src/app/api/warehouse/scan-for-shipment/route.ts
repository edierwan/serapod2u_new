import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type CodeType = 'master' | 'unique'

type ScanOutcome =
  | 'shipped'
  | 'already_shipped'
  | 'not_found'
  | 'invalid_status'
  | 'invalid_format'
  | 'wrong_warehouse'
  | 'session_closed'
  | 'duplicate'
  | 'error'

type InventoryAdjustment = {
  variant_id: string
  units_removed: number
  cases_removed: number
  inventory_before?: number | null
  inventory_after?: number | null
  shortfall?: number
}

type ShipmentScanResult = {
  code: string
  normalized_code: string
  code_type: CodeType
  outcome: ScanOutcome
  message: string
  master_case?: {
    id: string
    master_code: string
    case_number: number | null
    status: string
    shipped_at?: string
  }
  variant_adjustments?: InventoryAdjustment[]
  warnings?: string[]
  discrepancies?: Array<{
    variant_id: string
    expected_units: number
    removed_units: number
    shortfall: number
  }>
  session_update?: {
    master_codes_scanned?: string[]
    unique_codes_scanned?: string[]
    scanned_quantities?: ScannedQuantities
    discrepancy_details?: DiscrepancyDetails
    validation_status?: string
  }
}

type ScannedQuantities = {
  total_units: number
  total_cases: number
  per_variant: Record<string, { units: number; cases: number }>
}

type DiscrepancyDetails = {
  inventory_shortfalls?: Array<{
    code: string
    variant_id: string
    expected_units: number
    removed_units: number
    shortfall: number
  }>
  warnings?: string[]
}

type ValidationSession = {
  id: string
  warehouse_org_id: string
  distributor_org_id: string
  validation_status: string
  master_codes_scanned: string[] | null
  unique_codes_scanned: string[] | null
  scanned_quantities: ScannedQuantities | null
  discrepancy_details: DiscrepancyDetails | null
}

const normalizeCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  let token = value.trim()
  if (!token) return null
  if (token.includes('/track/')) {
    const parts = token.split('/')
    token = parts[parts.length - 1] || token
  }
  return token.trim() || null
}

const getDefaultScannedQuantities = (): ScannedQuantities => ({
  total_units: 0,
  total_cases: 0,
  per_variant: {}
})

const mergeWarnings = (existing: string[] | undefined, additions: string[]): string[] => {
  const merged = new Set<string>((existing || []).concat(additions))
  return Array.from(merged)
}

const loadSession = async (supabase: Awaited<ReturnType<typeof createClient>>, id: string) => {
  const { data, error } = await supabase
    .from('qr_validation_reports')
    .select(
      `id,
       warehouse_org_id,
       distributor_org_id,
       validation_status,
       master_codes_scanned,
       unique_codes_scanned,
       scanned_quantities,
       discrepancy_details`
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('❌ Failed to load shipment validation session:', error)
    throw new Error('Failed to load shipment session')
  }

  if (!data) {
    const notFound = new Error('Shipment session not found')
    ;(notFound as any).status = 404
    throw notFound
  }

  const session: ValidationSession = {
    id: data.id,
    warehouse_org_id: data.warehouse_org_id,
    distributor_org_id: data.distributor_org_id,
    validation_status: data.validation_status,
    master_codes_scanned: Array.isArray(data.master_codes_scanned) ? data.master_codes_scanned : [],
    unique_codes_scanned: Array.isArray(data.unique_codes_scanned) ? data.unique_codes_scanned : [],
    scanned_quantities: (data.scanned_quantities as ScannedQuantities) || null,
    discrepancy_details: (data.discrepancy_details as DiscrepancyDetails) || null
  }

  return session
}

const fetchVariantMetadata = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  variantIds: string[]
) => {
  if (!variantIds.length) return new Map<string, { unitsPerCase: number | null }>()

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, products ( units_per_case )')
    .in('id', variantIds)

  if (error) {
    console.warn('⚠️ Failed to load product variant metadata for shipping:', error)
    return new Map<string, { unitsPerCase: number | null }>()
  }

  const metaMap = new Map<string, { unitsPerCase: number | null }>()
  for (const row of data || []) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products
    const unitsPerCase = product?.units_per_case ?? null
    metaMap.set(row.id, { unitsPerCase })
  }
  return metaMap
}

const updateValidationSession = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: ValidationSession,
  result: ShipmentScanResult
) => {
  if (result.outcome !== 'shipped' || !result.session_update) {
    return
  }

  const updates: Record<string, any> = {
    master_codes_scanned: result.session_update.master_codes_scanned,
    unique_codes_scanned: result.session_update.unique_codes_scanned,
    scanned_quantities: result.session_update.scanned_quantities,
    discrepancy_details: result.session_update.discrepancy_details,
    updated_at: new Date().toISOString()
  }

  if (result.session_update.validation_status) {
    updates.validation_status = result.session_update.validation_status
  }

  const { error } = await supabase
    .from('qr_validation_reports')
    .update(updates)
    .eq('id', session.id)

  if (error) {
    console.error('⚠️ Failed to update shipment validation session:', error)
  }
}

const buildScannedQuantities = (
  session: ValidationSession,
  adjustments: InventoryAdjustment[]
): ScannedQuantities => {
  const starting = session.scanned_quantities || getDefaultScannedQuantities()
  const updated: ScannedQuantities = {
    total_units: starting.total_units,
    total_cases: starting.total_cases,
    per_variant: { ...starting.per_variant }
  }

  for (const adjustment of adjustments) {
    updated.total_units += adjustment.units_removed
    updated.total_cases += adjustment.cases_removed

    if (!updated.per_variant[adjustment.variant_id]) {
      updated.per_variant[adjustment.variant_id] = {
        units: 0,
        cases: 0
      }
    }

    updated.per_variant[adjustment.variant_id].units += adjustment.units_removed
    updated.per_variant[adjustment.variant_id].cases += adjustment.cases_removed
  }

  return updated
}

const buildDiscrepancyDetails = (
  session: ValidationSession,
  adjustments: InventoryAdjustment[],
  code: string,
  warnings: string[]
): DiscrepancyDetails => {
  const baseline: DiscrepancyDetails = session.discrepancy_details || {}
  const shortfalls = baseline.inventory_shortfalls ? [...baseline.inventory_shortfalls] : []

  adjustments.forEach(adj => {
    if ((adj.shortfall ?? 0) > 0) {
      shortfalls.push({
        code,
        variant_id: adj.variant_id,
        expected_units: adj.units_removed + (adj.shortfall || 0),
        removed_units: adj.units_removed,
        shortfall: adj.shortfall || 0
      })
    }
  })

  const combinedWarnings = mergeWarnings(baseline.warnings, warnings)

  const next: DiscrepancyDetails = {
    inventory_shortfalls: shortfalls,
    warnings: combinedWarnings.length ? combinedWarnings : undefined
  }

  if (!next.inventory_shortfalls?.length) {
    delete next.inventory_shortfalls
  }

  if (!next.warnings?.length) {
    delete next.warnings
  }

  return next
}

const getVariantAdjustmentsFromMap = (
  entries: Array<[string, number]>,
  variantMeta: Map<string, { unitsPerCase: number | null }>,
  inventorySnapshots: Map<string, { before: number; after: number }>,
  shortfalls: Map<string, number>,
  isSingleVariantMaster: boolean
) => {
  const adjustments: InventoryAdjustment[] = []

  for (const [variantId, units] of entries) {
    const meta = variantMeta.get(variantId)
    const unitsPerCase = meta?.unitsPerCase && meta.unitsPerCase > 0 ? meta.unitsPerCase : null
    const shortfall = shortfalls.get(variantId) ?? 0
    const actualUnitsRemoved = Math.max(units - shortfall, 0)
    let casesRemoved = unitsPerCase ? parseFloat((actualUnitsRemoved / unitsPerCase).toFixed(2)) : 0
    if (!casesRemoved && isSingleVariantMaster && actualUnitsRemoved > 0) {
      casesRemoved = 1
    }
    const snapshot = inventorySnapshots.get(variantId)
    adjustments.push({
      variant_id: variantId,
      units_removed: actualUnitsRemoved,
      cases_removed: casesRemoved,
      inventory_before: snapshot?.before ?? null,
      inventory_after: snapshot?.after ?? null,
      shortfall
    })
  }

  return adjustments
}

const handleMasterShipment = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: ValidationSession,
  code: string,
  normalizedCode: string,
  requestingUserId: string
): Promise<ShipmentScanResult> => {
  const { data: masterRecord, error: masterError } = await supabase
    .from('qr_master_codes')
    .select(
      `id,
       master_code,
       status,
       case_number,
       warehouse_org_id,
       shipped_to_distributor_id,
       expected_unit_count,
       actual_unit_count,
       batch_id,
       company_id,
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
      `
    )
    .eq('master_code', normalizedCode)
    .maybeSingle()

  if (masterError) {
    console.error('❌ Failed to load master code for shipment scan:', masterError)
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'error',
      message: 'Failed to load master code metadata'
    }
  }

  if (!masterRecord) {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'not_found',
      message: 'This master case was not found in the system. Please verify the QR code.'
    }
  }

  if (masterRecord.warehouse_org_id && masterRecord.warehouse_org_id !== session.warehouse_org_id) {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'wrong_warehouse',
      message: 'This master case belongs to a different warehouse. Please check the code.'
    }
  }

  if (masterRecord.status === 'shipped_distributor') {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'already_shipped',
      message: 'This master case has already been shipped to a distributor.'
    }
  }

  if (masterRecord.status !== 'received_warehouse') {
    const statusMessages: Record<string, string> = {
      'pending': 'This master case is still pending. Please receive it at the warehouse first.',
      'printed': 'This master case has not been received at the warehouse yet. Please receive it first.',
      'packed': 'This master case is at the manufacturer. Please receive it at the warehouse first.',
      'shipped_distributor': 'This master case has already been shipped to a distributor.',
      'received_distributor': 'This master case is at a distributor and cannot be shipped from warehouse.',
      'opened': 'This master case has already been opened.',
    }
    
    const friendlyMessage = statusMessages[masterRecord.status] || 
      `This master case cannot be shipped right now. Please check its status.`
    
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'invalid_status',
      message: friendlyMessage
    }
  }

  const { data: uniqueCodes, error: uniqueError } = await supabase
    .from('qr_codes')
    .select('id, code, variant_id, status')
    .eq('master_code_id', masterRecord.id)

  if (uniqueError) {
    console.error('❌ Failed to load child codes for master shipment:', uniqueError)
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'error',
      message: 'Failed to load child codes for master case'
    }
  }

  const variantCounts = new Map<string, number>()
  ;(uniqueCodes || []).forEach(row => {
    if (!row.variant_id) return
    const variantId = row.variant_id as string
    variantCounts.set(variantId, (variantCounts.get(variantId) || 0) + 1)
  })

  const batchRecord = masterRecord.qr_batches
    ? Array.isArray(masterRecord.qr_batches)
      ? masterRecord.qr_batches[0]
      : masterRecord.qr_batches
    : null
  const orderRecord = batchRecord?.orders
    ? Array.isArray(batchRecord.orders)
      ? batchRecord.orders[0]
      : batchRecord.orders
    : null

  if (variantCounts.size === 0) {
    if (orderRecord?.id) {
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('order_items')
        .select('variant_id, quantity')
        .eq('order_id', orderRecord.id)

      if (!orderItemsError) {
        for (const item of orderItems || []) {
          if (item.variant_id) {
            variantCounts.set(item.variant_id, (variantCounts.get(item.variant_id) || 0) + (item.quantity || 0))
          }
        }
      } else {
        console.warn('⚠️ Unable to load order items for variant fallback in shipping:', orderItemsError)
      }
    }
  }

  if (variantCounts.size === 0) {
    variantCounts.set('unknown', masterRecord.actual_unit_count || masterRecord.expected_unit_count || 0)
  }

  const variantIds = Array.from(variantCounts.keys()).filter(id => id !== 'unknown')
  const variantMeta = await fetchVariantMetadata(supabase, variantIds)

  const inventorySnapshots = new Map<string, { before: number; after: number }>()
  const shortfalls = new Map<string, number>()
  const warnings: string[] = []

  const isSingleVariantMaster = variantCounts.size === 1 && !variantCounts.has('unknown')

  for (const [variantId, unitsToRemove] of Array.from(variantCounts.entries())) {
    if (variantId === 'unknown') continue

    const { data: inventoryRow, error: inventoryError } = await supabase
      .from('product_inventory')
      .select('quantity_on_hand')
      .eq('organization_id', session.warehouse_org_id)
      .eq('variant_id', variantId)
      .maybeSingle()

    if (inventoryError) {
      console.warn('⚠️ Failed to load inventory snapshot for shipping:', inventoryError)
    }

    const before = inventoryRow?.quantity_on_hand ?? 0
    let removableUnits = unitsToRemove

    if (before < unitsToRemove) {
      shortfalls.set(variantId, unitsToRemove - before)
      removableUnits = before
      warnings.push(
        `Inventory shortfall for variant ${variantId}. Requested ${unitsToRemove}, available ${before}.`
      )
    }

    if (removableUnits > 0) {
      const { error: movementError } = await supabase.rpc('record_stock_movement', {
        p_movement_type: 'removal',
        p_variant_id: variantId,
        p_organization_id: session.warehouse_org_id,
        p_quantity_change: -removableUnits,
        p_unit_cost: null,
        p_manufacturer_id: null,
        p_warehouse_location: null,
        p_reason: 'warehouse_ship',
        p_notes: `Master ${masterRecord.master_code} shipped`,
        p_reference_type: 'order',
        p_reference_id: orderRecord?.id || masterRecord.batch_id,
        p_reference_no: orderRecord?.order_no || null,
        p_company_id: orderRecord?.company_id || masterRecord.company_id,
        p_created_by: requestingUserId
      })

      if (movementError) {
        console.warn('⚠️ Failed to record stock movement during shipping:', movementError)
        warnings.push('Inventory movement could not be recorded for this shipment.')
      }
    }

    const { error: aggregateError } = await supabase.rpc('apply_inventory_ship_adjustment', {
      p_variant_id: variantId,
      p_organization_id: session.warehouse_org_id,
      p_units: removableUnits,
      p_cases: 0,
      p_shipped_at: new Date().toISOString()
    })

    if (aggregateError) {
      console.warn('⚠️ Failed to update inventory aggregates for shipping:', aggregateError)
      warnings.push('Inventory aggregate metrics may be out of sync for this variant.')
    }

    const after = Math.max(0, before - removableUnits)
    inventorySnapshots.set(variantId, { before, after })
  }

  const shippedAt = new Date().toISOString()

  const { error: masterUpdateError } = await supabase
    .from('qr_master_codes')
    .update({
      status: 'shipped_distributor',
      shipped_to_distributor_id: session.distributor_org_id,
      shipped_at: shippedAt,
      shipped_by: requestingUserId,
      updated_at: shippedAt
    })
    .eq('id', masterRecord.id)
    .eq('status', 'received_warehouse')

  if (masterUpdateError) {
    console.error('❌ Failed to update master case for shipping:', masterUpdateError)
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'master',
      outcome: 'error',
      message: 'Failed to update master case status for shipping'
    }
  }

  const { error: codesUpdateError } = await supabase
    .from('qr_codes')
    .update({
      status: 'shipped_distributor',
      current_location_org_id: session.distributor_org_id,
      last_scanned_at: shippedAt,
      last_scanned_by: requestingUserId,
      updated_at: shippedAt
    })
    .eq('master_code_id', masterRecord.id)

  if (codesUpdateError) {
    console.warn('⚠️ Failed to update child codes during shipping:', codesUpdateError)
    warnings.push('Child codes were not fully updated to shipped status.')
  }

  const { error: movementLogError } = await supabase
    .from('qr_movements')
    .insert({
      company_id: orderRecord?.company_id || masterRecord.company_id,
      qr_master_code_id: masterRecord.id,
      movement_type: 'warehouse_ship',
      from_org_id: session.warehouse_org_id,
      to_org_id: session.distributor_org_id,
      current_status: 'shipped_distributor',
      scanned_at: shippedAt,
      scanned_by: requestingUserId,
      related_order_id: orderRecord?.id || null,
      notes: `Warehouse shipped master ${masterRecord.master_code}`
    })

  if (movementLogError) {
    console.warn('⚠️ Failed to insert warehouse shipment movement log:', movementLogError)
    warnings.push('Shipment history entry could not be recorded.')
  }

  const variantEntries = Array.from(variantCounts.entries()).filter(([variantId]) => variantId !== 'unknown')
  const adjustments = getVariantAdjustmentsFromMap(
    variantEntries,
    variantMeta,
    inventorySnapshots,
    shortfalls,
    isSingleVariantMaster
  )

  const discrepancies = adjustments
    .filter(adj => (adj.shortfall ?? 0) > 0)
    .map(adj => ({
      variant_id: adj.variant_id,
      expected_units: adj.units_removed + (adj.shortfall || 0),
      removed_units: adj.units_removed,
      shortfall: adj.shortfall || 0
    }))

  const nextQuantities = buildScannedQuantities(session, adjustments)
  const nextDiscrepancy = buildDiscrepancyDetails(session, adjustments, normalizedCode, warnings)
  const nextMasterList = session.master_codes_scanned || []
  const nextStatus = discrepancies.length ? 'discrepancy' : session.validation_status

  if (!nextMasterList.includes(normalizedCode)) {
    nextMasterList.push(normalizedCode)
  }

  return {
    code,
    normalized_code: normalizedCode,
    code_type: 'master',
    outcome: 'shipped',
    message: `Master case ${masterRecord.case_number || ''} shipped to distributor`,
    master_case: {
      id: masterRecord.id,
      master_code: masterRecord.master_code,
      case_number: masterRecord.case_number,
      status: 'shipped_distributor',
      shipped_at: shippedAt
    },
    variant_adjustments: adjustments,
    warnings,
    discrepancies,
    session_update: {
      master_codes_scanned: nextMasterList,
      unique_codes_scanned: session.unique_codes_scanned || [],
      scanned_quantities: nextQuantities,
      discrepancy_details: nextDiscrepancy,
      validation_status: nextStatus
    }
  }
}

const handleUniqueShipment = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: ValidationSession,
  code: string,
  normalizedCode: string,
  requestingUserId: string
): Promise<ShipmentScanResult> => {
  const { data: qrCode, error: qrError } = await supabase
    .from('qr_codes')
    .select('id, code, status, variant_id, current_location_org_id, master_code_id, company_id')
    .eq('code', normalizedCode)
    .maybeSingle()

  if (qrError) {
    console.error('❌ Failed to load unique code for shipping:', qrError)
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'error',
      message: 'Failed to load unique code metadata'
    }
  }

  if (!qrCode) {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'not_found',
      message: 'This product code was not found in the system. Please verify the QR code.'
    }
  }

  if (qrCode.status === 'shipped_distributor') {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'already_shipped',
      message: 'This product has already been shipped to a distributor.'
    }
  }

  if (qrCode.current_location_org_id && qrCode.current_location_org_id !== session.warehouse_org_id) {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'wrong_warehouse',
      message: 'This product code is currently assigned to a different warehouse location.'
    }
  }

  if (qrCode.status !== 'received_warehouse' && qrCode.status !== 'packed') {
    const statusMessages: Record<string, string> = {
      'pending': 'This product is still pending. Please receive it at the warehouse first.',
      'printed': 'This product has not been received at the warehouse yet. Please receive it first.',
      'shipped_distributor': 'This product has already been shipped to a distributor.',
      'received_distributor': 'This product is at a distributor and cannot be shipped from warehouse.',
      'opened': 'This product has already been opened.',
    }
    
    const friendlyMessage = statusMessages[qrCode.status] || 
      `This product cannot be shipped right now. Please check its status.`
    
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'invalid_status',
      message: friendlyMessage
    }
  }

  if (!qrCode.variant_id) {
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'error',
      message: 'This product code is missing product information. Please contact support.'
    }
  }

  const variantId = qrCode.variant_id as string
  const warnings: string[] = []

  const { data: inventoryRow, error: inventoryError } = await supabase
    .from('product_inventory')
    .select('quantity_on_hand')
    .eq('organization_id', session.warehouse_org_id)
    .eq('variant_id', variantId)
    .maybeSingle()

  if (inventoryError) {
    console.warn('⚠️ Failed to load inventory for unique code shipping:', inventoryError)
  }

  const before = inventoryRow?.quantity_on_hand ?? 0
  const removableUnits = before > 0 ? 1 : 0
  let shortfall = 0

  if (removableUnits === 0) {
    warnings.push('Inventory shortfall: unique code not available in warehouse inventory.')
    shortfall = 1
  }

  if (removableUnits > 0) {
    const { error: movementError } = await supabase.rpc('record_stock_movement', {
      p_movement_type: 'removal',
      p_variant_id: variantId,
      p_organization_id: session.warehouse_org_id,
      p_quantity_change: -removableUnits,
      p_unit_cost: null,
      p_manufacturer_id: null,
      p_warehouse_location: null,
      p_reason: 'warehouse_ship',
      p_notes: `Unique code ${normalizedCode} shipped`,
      p_reference_type: 'tracking',
      p_reference_id: qrCode.id,
      p_reference_no: null,
      p_company_id: qrCode.company_id,
      p_created_by: requestingUserId
    })

    if (movementError) {
      console.warn('⚠️ Failed to record stock movement for unique ship:', movementError)
      warnings.push('Inventory movement recording failed for this unique code.')
    }
  }

  const { error: aggregateError } = await supabase.rpc('apply_inventory_ship_adjustment', {
    p_variant_id: variantId,
    p_organization_id: session.warehouse_org_id,
    p_units: removableUnits,
    p_cases: 0,
    p_shipped_at: new Date().toISOString()
  })

  if (aggregateError) {
    console.warn('⚠️ Failed to update inventory aggregates for unique shipping:', aggregateError)
    warnings.push('Inventory aggregate metrics may be out of sync for this unique code.')
  }

  const shippedAt = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('qr_codes')
    .update({
      status: 'shipped_distributor',
      current_location_org_id: session.distributor_org_id,
      last_scanned_at: shippedAt,
      last_scanned_by: requestingUserId,
      updated_at: shippedAt
    })
    .eq('id', qrCode.id)

  if (updateError) {
    console.error('❌ Failed to update unique code status for shipping:', updateError)
    return {
      code,
      normalized_code: normalizedCode,
      code_type: 'unique',
      outcome: 'error',
      message: 'Failed to update unique code status for shipping'
    }
  }

  const { error: movementLogError } = await supabase
    .from('qr_movements')
    .insert({
      company_id: qrCode.company_id,
      qr_code_id: qrCode.id,
      movement_type: 'warehouse_ship',
      from_org_id: session.warehouse_org_id,
      to_org_id: session.distributor_org_id,
      current_status: 'shipped_distributor',
      scanned_at: shippedAt,
      scanned_by: requestingUserId,
      notes: `Warehouse shipped unique code ${normalizedCode}`
    })

  if (movementLogError) {
    console.warn('⚠️ Failed to record movement log for unique shipment:', movementLogError)
    warnings.push('Shipment history entry could not be recorded for this unique code.')
  }

  const after = Math.max(0, before - removableUnits)
  const adjustments: InventoryAdjustment[] = [
    {
      variant_id: variantId,
      units_removed: removableUnits,
      cases_removed: 0,
      inventory_before: before,
      inventory_after: after,
      shortfall
    }
  ]

  const discrepancies = shortfall
    ? [
        {
          variant_id: variantId,
          expected_units: 1,
          removed_units: removableUnits,
          shortfall
        }
      ]
    : []

  const nextQuantities = buildScannedQuantities(session, adjustments)
  const nextDiscrepancy = buildDiscrepancyDetails(session, adjustments, normalizedCode, warnings)
  const nextUniqueList = session.unique_codes_scanned || []
  const nextStatus = discrepancies.length ? 'discrepancy' : session.validation_status

  if (!nextUniqueList.includes(normalizedCode)) {
    nextUniqueList.push(normalizedCode)
  }

  return {
    code,
    normalized_code: normalizedCode,
    code_type: 'unique',
    outcome: 'shipped',
    message: 'Unique code shipped to distributor',
    variant_adjustments: adjustments,
    warnings,
    discrepancies,
    session_update: {
      master_codes_scanned: session.master_codes_scanned || [],
      unique_codes_scanned: nextUniqueList,
      scanned_quantities: nextQuantities,
      discrepancy_details: nextDiscrepancy,
      validation_status: nextStatus
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
    const {
      shipment_session_id: sessionId,
      code,
      code_type: rawCodeType,
      user_id: overrideUserId
    } = body || {}

    if (!sessionId) {
      return NextResponse.json({ message: 'shipment_session_id is required' }, { status: 400 })
    }

    if (!code) {
      return NextResponse.json({ message: 'code is required' }, { status: 400 })
    }

    const normalizedCode = normalizeCode(code)
    if (!normalizedCode) {
      return NextResponse.json(
        {
          code,
          normalized_code: code,
          outcome: 'invalid_format',
          message: 'Invalid code format'
        },
        { status: 400 }
      )
    }

    const session = await loadSession(supabase, sessionId)

    if (session.validation_status === 'approved') {
      return NextResponse.json(
        {
          code,
          normalized_code: normalizedCode,
          outcome: 'session_closed',
          message: 'Shipment session already completed'
        },
        { status: 409 }
      )
    }

    const codeType: CodeType = rawCodeType === 'unique' ? 'unique' : 'master'
    const requestingUserId = overrideUserId || user.id

    const scannedLists = {
      master: session.master_codes_scanned || [],
      unique: session.unique_codes_scanned || []
    }

    if (codeType === 'master' && scannedLists.master.includes(normalizedCode)) {
      return NextResponse.json(
        {
          code,
          normalized_code: normalizedCode,
          code_type: 'master',
          outcome: 'duplicate',
          message: 'Master code already scanned in this session'
        },
        { status: 200 }
      )
    }

    if (codeType === 'unique' && scannedLists.unique.includes(normalizedCode)) {
      return NextResponse.json(
        {
          code,
          normalized_code: normalizedCode,
          code_type: 'unique',
          outcome: 'duplicate',
          message: 'Unique code already scanned in this session'
        },
        { status: 200 }
      )
    }

    let result: ShipmentScanResult

    if (codeType === 'master') {
      result = await handleMasterShipment(supabase, session, code, normalizedCode, requestingUserId)
    } else {
      result = await handleUniqueShipment(supabase, session, code, normalizedCode, requestingUserId)
    }

    await updateValidationSession(supabase, session, result)

    const status =
      result.outcome === 'shipped'
        ? 200
        : result.outcome === 'already_shipped'
          ? 409
          : result.outcome === 'not_found'
            ? 404
            : result.outcome === 'invalid_status' || result.outcome === 'invalid_format'
              ? 400
              : result.outcome === 'duplicate'
                ? 200
                : result.outcome === 'wrong_warehouse'
                  ? 403
                  : 500

    return NextResponse.json(result, { status })
  } catch (error: any) {
    const status = error?.status || 500
    console.error('❌ Warehouse shipment scan error:', error)
    return NextResponse.json(
      { message: error?.message || 'Failed to process shipment scan', details: error },
      { status }
    )
  }
}
