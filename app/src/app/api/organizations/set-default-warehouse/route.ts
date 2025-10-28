import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/organizations/set-default-warehouse
 * Sets the default warehouse for an HQ organization
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { hq_org_id, warehouse_org_id } = body

    if (!hq_org_id || !warehouse_org_id) {
      return NextResponse.json(
        { error: 'hq_org_id and warehouse_org_id are required' },
        { status: 400 }
      )
    }

    console.log('🏭 Setting default warehouse:', { hq_org_id, warehouse_org_id })

    // Verify the warehouse belongs to this HQ
    const { data: warehouse, error: warehouseError } = await supabase
      .from('organizations')
      .select('id, org_name, org_type_code, parent_org_id')
      .eq('id', warehouse_org_id)
      .single()

    if (warehouseError || !warehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      )
    }

    if (warehouse.org_type_code !== 'WH') {
      return NextResponse.json(
        { error: 'Organization must be a warehouse (WH type)' },
        { status: 400 }
      )
    }

    if (warehouse.parent_org_id !== hq_org_id) {
      return NextResponse.json(
        { error: 'Warehouse must belong to this HQ' },
        { status: 400 }
      )
    }

    // Update HQ to set default warehouse
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        default_warehouse_org_id: warehouse_org_id,
        updated_at: new Date().toISOString()
      })
      .eq('id', hq_org_id)

    if (updateError) {
      console.error('❌ Failed to set default warehouse:', updateError)
      throw updateError
    }

    console.log('✅ Default warehouse set successfully')

    return NextResponse.json({
      success: true,
      message: `${warehouse.org_name} is now the default warehouse`,
      hq_org_id,
      warehouse_org_id,
      warehouse_name: warehouse.org_name
    })
  } catch (error: any) {
    console.error('❌ Set default warehouse error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to set default warehouse' },
      { status: 500 }
    )
  }
}
