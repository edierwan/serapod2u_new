import { NextRequest, NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'

export async function GET(request: NextRequest) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })
  const search = String(request.nextUrl.searchParams.get('q') || '').trim().replace(/[%_,().]/g, ' ')

  let organizationsQuery = context.admin.from('organizations')
    .select('id, org_code, org_name')
    .eq('org_type_code', 'DIST')
    .eq('is_active', true)
    .order('org_name')
    .limit(100)
  if (search) organizationsQuery = organizationsQuery.or(`org_name.ilike.%${search}%,org_code.ilike.%${search}%`)

  const [{ data: organizations, error: organizationsError }, { data: mappings, error: mappingsError }] = await Promise.all([
    organizationsQuery,
    context.admin.from('distributor_stock_config_eligibility')
      .select('distributor_org_id, allow_50ml_new_box, notes, created_by, created_at, updated_at')
      .order('updated_at', { ascending: false }),
  ])
  if (organizationsError || mappingsError) {
    return NextResponse.json({ error: organizationsError?.message || mappingsError?.message }, { status: 500 })
  }

  const creatorIds = Array.from(new Set((mappings || []).map((row: any) => row.created_by).filter(Boolean)))
  const { data: creators } = creatorIds.length
    ? await context.admin.from('users').select('id, full_name, email').in('id', creatorIds)
    : { data: [] }
  const creatorMap = new Map((creators || []).map((user: any) => [user.id, user]))
  const mappingMap = new Map((mappings || []).map((mapping: any) => [mapping.distributor_org_id, mapping]))

  return NextResponse.json({
    distributors: (organizations || []).map((organization: any) => {
      const mapping: any = mappingMap.get(organization.id)
      const creator: any = mapping?.created_by ? creatorMap.get(mapping.created_by) : null
      return {
        ...organization,
        eligible: mapping?.allow_50ml_new_box === true,
        createdAt: mapping?.created_at || null,
        updatedAt: mapping?.updated_at || null,
        responsibleUser: creator?.full_name || creator?.email || null,
      }
    }),
  })
}

export async function POST(request: NextRequest) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })
  const { distributorOrgId } = await request.json()
  const { data: distributor } = await context.admin.from('organizations')
    .select('id').eq('id', distributorOrgId).eq('org_type_code', 'DIST').eq('is_active', true).maybeSingle()
  if (!distributor) return NextResponse.json({ error: 'Active distributor organization not found' }, { status: 400 })

  const { error } = await context.admin.from('distributor_stock_config_eligibility').upsert({
    distributor_org_id: distributorOrgId,
    allow_50ml_new_box: true,
    notes: 'Managed through Inventory Stock Configuration administration',
    created_by: context.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'distributor_org_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })
  const distributorOrgId = request.nextUrl.searchParams.get('distributorOrgId')
  if (!distributorOrgId) return NextResponse.json({ error: 'Distributor organization is required' }, { status: 400 })

  const { data: configs, error: configError } = await context.admin.from('inventory_stock_configurations')
    .select('id').eq('volume_ml', 50).eq('packaging', 'new_box')
  if (configError) return NextResponse.json({ error: configError.message }, { status: 500 })
  const configIds = (configs || []).map((config: any) => config.id)
  if (configIds.length > 0) {
    const { data: dependent, error: dependentError } = await context.admin.from('order_items')
      .select('id, order_id, orders!inner(order_no, status, buyer_org_id)')
      .in('stock_config_id', configIds)
      .eq('orders.buyer_org_id', distributorOrgId)
      .eq('orders.status', 'submitted')
      .limit(1)
    if (dependentError) return NextResponse.json({ error: dependentError.message }, { status: 500 })
    if (dependent && dependent.length > 0) {
      return NextResponse.json({ error: 'Eligibility cannot be removed while a submitted order has an open 50ml allocation.' }, { status: 409 })
    }
  }

  const { error } = await context.admin.from('distributor_stock_config_eligibility')
    .delete().eq('distributor_org_id', distributorOrgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
