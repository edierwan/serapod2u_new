import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

const relation = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] || null : value || null

export async function GET(_request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  if (!orderId) return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })

  const { data: requester, error: requesterError } = await supabase
    .from('users')
    .select('organization_id, organizations:organization_id(org_type_code), roles:role_code(role_level)')
    .eq('id', user.id)
    .single()

  if (requesterError || !requester?.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Authenticated client deliberately invokes orders_select RLS first.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, company_id, buyer_org_id, seller_org_id, warehouse_org_id')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const org = relation(requester.organizations as any) as { org_type_code?: string } | null
  const role = relation(requester.roles as any) as { role_level?: number } | null
  const orgType = String(org?.org_type_code || '').toUpperCase()

  if (orgType === 'MFG' || orgType === 'MANU') {
    if (order.seller_org_id !== requester.organization_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (orgType === 'HQ' && Number(role?.role_level) === 10) {
    // RLS already confirmed authorized company access for HQ Admin.
  }

  return NextResponse.json({ success: true, order_id: order.id })
}
