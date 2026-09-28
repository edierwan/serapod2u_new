import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import { requireStoreOrderAdmin } from '@/lib/storefront/admin-access'
import { listOrderRequests, updateOrderRequest } from '@/lib/storefront/order-requests-server'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?open=1 → open requests with their full order; ?orderIds=a,b → requests for those orders.
export async function GET(request: NextRequest) {
  const admin = await requireStoreOrderAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const orderIdsParam = params.get('orderIds')
  const orderIds = orderIdsParam
    ? orderIdsParam.split(',').map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id))
    : undefined
  const open = params.get('open') === '1'

  const result = await listOrderRequests(createAdminClient(), {
    orgId: admin.orgId,
    orderIds,
    openOnly: open,
    withOrder: open,
    limit: orderIds ? 200 : 100,
  })
  if (!result.ok) {
    if (result.available === false) return NextResponse.json({ available: false, requests: [] })
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ available: true, requests: result.requests })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireStoreOrderAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })

  const result = await updateOrderRequest(createAdminClient(), {
    id,
    status: body?.status,
    staffReply: body?.staffReply,
    actorId: admin.userId,
    scope: { orgId: admin.orgId },
    origin: publicOriginFromRequest(request),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ request: result.request })
}
