import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { listOrderRequests, updateOrderRequest } from '@/lib/storefront/order-requests-server'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const staff = await requireOutdoorStaff()
  if (!staff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await listOrderRequests(createAdminClient(), {
    salesChannel: 'outdoor',
    openOnly: request.nextUrl.searchParams.get('view') !== 'all',
    limit: 100,
  })
  if (!result.ok) {
    if (result.available === false) return NextResponse.json({ available: false, requests: [] })
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ available: true, requests: result.requests })
}

export async function PATCH(request: NextRequest) {
  const staff = await requireOutdoorStaff()
  if (!staff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })

  const result = await updateOrderRequest(createAdminClient(), {
    id,
    status: body?.status,
    staffReply: body?.staffReply,
    actorId: staff.userId,
    scope: { salesChannel: 'outdoor' },
    origin: publicOriginFromRequest(request),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ request: result.request })
}
