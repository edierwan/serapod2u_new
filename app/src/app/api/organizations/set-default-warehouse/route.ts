import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_DISTRIBUTOR_FULFILLMENT_WAREHOUSE_SETTING_KEY } from '@/lib/orders/hq-fulfillment-warehouses'

/**
 * POST /api/organizations/set-default-warehouse
 * Sets organizations.default_warehouse_org_id for an HQ.
 * Application setting key: default_distributor_fulfillment_warehouse_id
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { hq_org_id, warehouse_org_id } = body

    if (!hq_org_id || !warehouse_org_id) {
      return NextResponse.json(
        { error: 'hq_org_id and warehouse_org_id are required' },
        { status: 400 },
      )
    }

    const { data: isHqAdmin, error: adminError } = await supabase.rpc('is_hq_admin')
    if (adminError) {
      console.error('Failed to verify HQ admin:', adminError)
      return NextResponse.json({ error: 'Unable to verify admin permissions.' }, { status: 500 })
    }
    if (!isHqAdmin) {
      return NextResponse.json(
        { error: 'Only HQ Admin can update the default fulfillment warehouse.' },
        { status: 403 },
      )
    }

    const { data: hq, error: hqError } = await supabase
      .from('organizations')
      .select('id, org_type_code, is_active')
      .eq('id', hq_org_id)
      .maybeSingle()

    if (hqError || !hq) {
      return NextResponse.json({ error: 'HQ organization not found' }, { status: 404 })
    }
    if (hq.org_type_code !== 'HQ' || hq.is_active !== true) {
      return NextResponse.json({ error: 'Target organization must be an active HQ' }, { status: 400 })
    }

    const { data: warehouse, error: warehouseError } = await supabase
      .from('organizations')
      .select('id, org_name, org_type_code, parent_org_id, is_active')
      .eq('id', warehouse_org_id)
      .single()

    if (warehouseError || !warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
    }
    if (warehouse.org_type_code !== 'WH' || warehouse.is_active !== true) {
      return NextResponse.json(
        { error: 'Organization must be an active warehouse (WH type)' },
        { status: 400 },
      )
    }
    if (warehouse.parent_org_id !== hq_org_id) {
      return NextResponse.json(
        { error: 'Warehouse must be an active child of this HQ' },
        { status: 400 },
      )
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        default_warehouse_org_id: warehouse_org_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', hq_org_id)

    if (updateError) {
      console.error('Failed to set default warehouse:', updateError)
      throw updateError
    }

    return NextResponse.json({
      success: true,
      setting_key: DEFAULT_DISTRIBUTOR_FULFILLMENT_WAREHOUSE_SETTING_KEY,
      message: `${warehouse.org_name} is now the default fulfillment warehouse`,
      hq_org_id,
      warehouse_org_id,
      warehouse_name: warehouse.org_name,
    })
  } catch (error: any) {
    console.error('Set default warehouse error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to set default warehouse' },
      { status: 500 },
    )
  }
}
