/**
 * Signed-in customer: list or raise return / problem requests on their own orders.
 * /api/storefront is a public middleware path, so the session is checked here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import { ORDER_REQUEST_MAX_PHOTOS } from '@/lib/storefront/order-requests'
import { createOrderRequest, listOrderRequests } from '@/lib/storefront/order-requests-server'

export const dynamic = 'force-dynamic'

async function sessionEmail() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ? user.email.trim().toLowerCase() : null
}

export async function GET(request: NextRequest) {
  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Sign in to see your requests.' }, { status: 401 })

  const channel = request.nextUrl.searchParams.get('channel')
  const result = await listOrderRequests(createAdminClient(), {
    email,
    salesChannel: channel === 'outdoor' || channel === 'store' ? channel : undefined,
    limit: 100,
  })
  if (!result.ok) {
    if (result.available === false) return NextResponse.json({ available: false, requests: [] })
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ available: true, requests: result.requests })
}

export async function POST(request: NextRequest) {
  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Sign in to send a request.' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const files = form.getAll('photos').filter((item): item is File => item instanceof File && item.size > 0)
  if (files.length > ORDER_REQUEST_MAX_PHOTOS) {
    return NextResponse.json({ error: `Add up to ${ORDER_REQUEST_MAX_PHOTOS} photos.` }, { status: 400 })
  }

  const result = await createOrderRequest(createAdminClient(), {
    email,
    orderRef: String(form.get('orderRef') || ''),
    type: form.get('type'),
    message: form.get('message'),
    files,
    origin: publicOriginFromRequest(request),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ request: result.request }, { status: 201 })
}
