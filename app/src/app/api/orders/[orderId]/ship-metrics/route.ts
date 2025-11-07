import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const parseUUID = (value: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Simple UUID v4 format check (8-4-4-4-12 hex)
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(trimmed) ? trimmed : null
}

type SupabaseMasterRecord = {
  id: string
  status: string | null
  warehouse_org_id: string | null
  shipment_order_id: string | null
  receive_order_id?: string | null
  actual_unit_count: number | null
  expected_unit_count: number | null
  qr_batches?: Array<{ order_id: string | null }> | { order_id: string | null } | null
}

type SupabaseCodeRecord = {
  master_code_id: string | null
}

const resolveOrderIdForMaster = (
  record: SupabaseMasterRecord,
  mode: 'shipment' | 'receive' = 'shipment'
): string | null => {
  const directOrderId = mode === 'receive' ? record.receive_order_id : record.shipment_order_id
  if (directOrderId) {
    return directOrderId
  }

  const batches = record.qr_batches
  if (!batches) {
    return null
  }

  const batchArray = Array.isArray(batches) ? batches : [batches]
  const first = batchArray.find((batch) => batch && batch.order_id)
  return first?.order_id ?? null
}

const resolveUnitsForMaster = (record: SupabaseMasterRecord): number => {
  const actual = typeof record.actual_unit_count === 'number' ? record.actual_unit_count : null
  const expected = typeof record.expected_unit_count === 'number' ? record.expected_unit_count : null
  const candidate = actual && actual > 0 ? actual : expected
  return candidate && candidate > 0 ? candidate : 0
}

export async function GET(request: NextRequest, context: { params: { orderId: string } }) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderIdParam = context.params?.orderId
    const orderId = parseUUID(orderIdParam)

    if (!orderId) {
      return NextResponse.json({ error: 'Valid orderId is required' }, { status: 400 })
    }

    const searchParams = request.nextUrl.searchParams
    const warehouseId = parseUUID(searchParams.get('warehouseId') || searchParams.get('warehouse_id'))

    if (!warehouseId) {
      return NextResponse.json({ error: 'warehouseId query parameter is required' }, { status: 400 })
    }

    // --- Units shipped (movement-based) ---
    const { data: movementRows, error: movementError } = await supabase
      .from('v_stock_movements_display')
      .select('quantity_change')
      .eq('movement_type', 'order_fulfillment')
      .eq('reference_type', 'order')
      .eq('reference_id', orderId)
      .eq('from_organization_id', warehouseId)

    if (movementError) {
      console.error('[ship-metrics] Failed to load stock movements', movementError)
      return NextResponse.json({ error: 'Unable to load shipment movements' }, { status: 500 })
    }

    let unitsShipped = 0
    if (Array.isArray(movementRows)) {
      for (const row of movementRows) {
        const change = typeof row.quantity_change === 'number' ? row.quantity_change : 0
        if (change < 0) {
          unitsShipped += -change
        }
      }
    }

    // --- Master case information ---
    const { data: masterRows, error: masterError } = await supabase
      .from('qr_master_codes')
      .select(
        `
          id,
          status,
          warehouse_org_id,
          shipment_order_id,
          receive_order_id,
          actual_unit_count,
          expected_unit_count,
          qr_batches ( order_id )
        `
      )
      .eq('warehouse_org_id', warehouseId)
      .or(`shipment_order_id.eq.${orderId},qr_batches.order_id.eq.${orderId}`)

    if (masterError) {
      console.error('[ship-metrics] Failed to load master cases', masterError)
      return NextResponse.json({ error: 'Unable to load master case data' }, { status: 500 })
    }

    const relevantMasters = (masterRows || []).filter((record) => resolveOrderIdForMaster(record) === orderId)
    const masterIds = relevantMasters.map((record) => record.id)

    // --- Shipped unique counts per master ---
    let shippedUniquelyByMaster = new Map<string, number>()
    if (masterIds.length > 0) {
      const { data: shippedUniqueRows, error: shippedUniqueError } = await supabase
        .from('qr_codes')
        .select('master_code_id')
        .eq('status', 'shipped_distributor')
        .in('master_code_id', masterIds)

      if (shippedUniqueError) {
        console.error('[ship-metrics] Failed to load shipped unique codes', shippedUniqueError)
        return NextResponse.json({ error: 'Unable to load shipped unit details' }, { status: 500 })
      }

      shippedUniquelyByMaster = (shippedUniqueRows || []).reduce((map, row: SupabaseCodeRecord) => {
        const masterId = row.master_code_id
        if (!masterId) {
          return map
        }
        const current = map.get(masterId) ?? 0
        map.set(masterId, current + 1)
        return map
      }, new Map<string, number>())
    }

    let casesShipped = 0
    for (const master of relevantMasters) {
      const caseUnits = resolveUnitsForMaster(master)
    const masterShipped = master.status === 'shipped_distributor'
      const shippedUniqueCount = shippedUniquelyByMaster.get(master.id) ?? 0

      const shippedViaUnits = caseUnits > 0 && shippedUniqueCount >= caseUnits
      if (masterShipped || shippedViaUnits) {
        casesShipped += 1
      }
    }

    // --- Received metrics ---
  const { data: receivedMasters, error: receivedError } = await supabase
      .from('qr_master_codes')
      .select(
        `
          id,
          status,
          warehouse_org_id,
          shipment_order_id,
          receive_order_id,
          actual_unit_count,
          expected_unit_count,
          qr_batches ( order_id )
        `
      )
      .eq('warehouse_org_id', warehouseId)
      .eq('status', 'received_warehouse')
      .or(`receive_order_id.eq.${orderId},qr_batches.order_id.eq.${orderId}`)

    if (receivedError) {
      console.error('[ship-metrics] Failed to load received metrics', receivedError)
      return NextResponse.json({ error: 'Unable to load received metrics' }, { status: 500 })
    }

    let casesReceived = 0
    let unitsReceived = 0
    if (Array.isArray(receivedMasters)) {
      for (const master of receivedMasters) {
  const targetOrderId = resolveOrderIdForMaster(master, 'receive')
        if (targetOrderId !== orderId) continue

        casesReceived += 1
        unitsReceived += resolveUnitsForMaster(master)
      }
    }

    return NextResponse.json({
      order_id: orderId,
      warehouse_id: warehouseId,
      cases_shipped: casesShipped,
      units_shipped: unitsShipped,
      cases_received: casesReceived,
      units_received: unitsReceived
    })
  } catch (error: any) {
    console.error('[ship-metrics] Unexpected error', error)
    const message = error?.message || 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
