import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { queryByIdChunks } from '@/lib/orders/chunked-id-query'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const orderIds = Array.isArray(body?.orderIds)
      ? Array.from(new Set(body.orderIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)))
      : []

    if (orderIds.length === 0) {
      return NextResponse.json({ users: [] })
    }

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select('organization_id, organizations!inner(org_type_code), roles:role_code(role_level)')
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const requesterOrgType = Array.isArray(requester.organizations)
      ? requester.organizations[0]?.org_type_code
      : requester.organizations?.org_type_code
    const requesterRole = Array.isArray((requester as any).roles) ? (requester as any).roles[0] : (requester as any).roles
    const requesterRoleLevel = Number(requesterRole?.role_level ?? 999)

    const { data: companyId, error: companyError } = await supabase
      .rpc('get_company_id', { p_org_id: requester.organization_id })

    const scopedCompanyId = companyId || requester.organization_id
    if (companyError || !scopedCompanyId) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const adminSupabase = createAdminClient()

    // Batched: the Orders list now hydrates a full order history rather than a
    // 50-row window, and every id would otherwise ride in the PostgREST URL.
    const { data: orders, error: ordersError } = await queryByIdChunks<{
      id: string
      created_by: string | null
      approved_by: string | null
    }>(orderIds as string[], chunk => {
      let ordersQuery = adminSupabase
        .from('orders')
        .select('id, created_by, approved_by, buyer_org_id, seller_org_id, warehouse_org_id, company_id')
        .in('id', chunk)

      if (requesterOrgType === 'MFG' || requesterOrgType === 'MANU') {
        ordersQuery = ordersQuery
          .eq('seller_org_id', requester.organization_id)
          .neq('status', 'submitted')
          .neq('status', 'draft')
      } else if (requesterOrgType === 'HQ' && requesterRoleLevel <= 20) {
        ordersQuery = ordersQuery.eq('company_id', scopedCompanyId)
      } else {
        ordersQuery = ordersQuery.or(`buyer_org_id.eq.${requester.organization_id},seller_org_id.eq.${requester.organization_id},warehouse_org_id.eq.${requester.organization_id}`)
      }

      return ordersQuery as unknown as PromiseLike<{ data: any[] | null; error: unknown }>
    })

    if (ordersError) {
      console.error('Order actor scope query failed:', ordersError)
      return NextResponse.json({ error: 'Failed to resolve order access' }, { status: 500 })
    }

    if ((orders || []).length !== orderIds.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const actorIds = Array.from(new Set(
      (orders || []).flatMap(order => [order.created_by, order.approved_by]).filter((value): value is string => Boolean(value))
    ))

    if (actorIds.length === 0) {
      return NextResponse.json({ users: [] })
    }

    const { data: users, error: usersError } = await queryByIdChunks<{
      id: string
      email: string
      full_name: string | null
      signature_url: string | null
      roles: unknown
    }>(actorIds, chunk => adminSupabase
      .from('users')
      .select('id, email, full_name, signature_url, roles:role_code(role_level)')
      .in('id', chunk) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>)

    if (usersError) {
      console.error('Order actor user query failed:', usersError)
      return NextResponse.json({ error: 'Failed to load order actors' }, { status: 500 })
    }

    return NextResponse.json({
      users: (users || []).map(user => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        signature_url: user.signature_url,
        roles: Array.isArray(user.roles) ? (user.roles[0] || null) : (user.roles || null),
      })),
    })
  } catch (error) {
    console.error('Order actor hydration failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
