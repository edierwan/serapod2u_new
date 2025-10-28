import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type StartShipmentRequest = {
  warehouse_org_id?: string
  distributor_org_id?: string
  user_id?: string
  destination_order_id?: string | null
  source_order_id?: string | null
}

type ScannedQuantities = {
  total_units: number
  total_cases: number
  per_variant: Record<string, { units: number; cases: number }>
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

    const body = (await request.json()) as StartShipmentRequest
    const {
      warehouse_org_id: warehouseOrgId,
      distributor_org_id: distributorOrgId,
      user_id: userId,
      destination_order_id: destinationOrderId,
      source_order_id: sourceOrderId
    } = body || {}

    if (!warehouseOrgId || !distributorOrgId) {
      return NextResponse.json(
        { message: 'warehouse_org_id and distributor_org_id are required' },
        { status: 400 }
      )
    }

    const requestingUserId = userId || user.id

    const { data: companyId, error: companyError } = await supabase.rpc('get_company_id', {
      p_org_id: warehouseOrgId
    })

    if (companyError) {
      console.error('❌ Failed to resolve company_id for warehouse shipping session:', companyError)
      return NextResponse.json(
        { message: 'Unable to resolve company for warehouse organization', details: companyError },
        { status: 500 }
      )
    }

    if (!companyId) {
      return NextResponse.json(
        { message: 'Warehouse organization is not linked to a company. Cannot start shipment.' },
        { status: 400 }
      )
    }

    const { data: expectedMasters, error: expectedError } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, expected_unit_count, actual_unit_count')
      .eq('warehouse_org_id', warehouseOrgId)
      .eq('status', 'received_warehouse')

    if (expectedError) {
      console.warn('⚠️ Unable to load expected master cases for shipping session:', expectedError)
    }

    const expectedSummary = {
      master_cases_available: expectedMasters?.length ?? 0,
      units_available: (expectedMasters || []).reduce((total, item) => {
        const units = item.actual_unit_count || item.expected_unit_count || 0
        return total + units
      }, 0),
      generated_at: new Date().toISOString()
    }

    const initialScannedQuantities: ScannedQuantities = {
      total_units: 0,
      total_cases: 0,
      per_variant: {}
    }

    const { data: insertResult, error: insertError } = await supabase
      .from('qr_validation_reports')
      .insert({
        company_id: companyId,
        warehouse_org_id: warehouseOrgId,
        distributor_org_id: distributorOrgId,
        destination_order_id: destinationOrderId || null,
        source_order_id: sourceOrderId || null,
        expected_quantities: expectedSummary,
        scanned_quantities: initialScannedQuantities,
        master_codes_scanned: [],
        unique_codes_scanned: [],
        discrepancy_details: {},
        created_by: requestingUserId,
        validation_status: 'pending',
        is_matched: false
      })
      .select('id, expected_quantities, scanned_quantities, master_codes_scanned, unique_codes_scanned')
      .single()

    if (insertError || !insertResult) {
      console.error('❌ Failed to create warehouse shipping session:', insertError)
      return NextResponse.json(
        { message: 'Failed to start shipment session', details: insertError },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      shipment_session_id: insertResult.id,
      expected_summary: insertResult.expected_quantities,
      scanned_summary: insertResult.scanned_quantities,
      master_codes_scanned: insertResult.master_codes_scanned || [],
      unique_codes_scanned: insertResult.unique_codes_scanned || []
    })
  } catch (error: any) {
    console.error('❌ Unexpected error starting warehouse shipment session:', error)
    return NextResponse.json(
      { message: error?.message || 'Failed to start shipment session', details: error },
      { status: 500 }
    )
  }
}
