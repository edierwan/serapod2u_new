import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifySerappOrderApproved } from '@/lib/serapp/order-status-notify'

/**
 * After HQ approves a SerApp order in Current Orders, push a clear bot message
 * into the distributor SerApp chat so they do not need to open History first.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const result = await notifySerappOrderApproved(admin, orderId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[serapp/notify-order-approved]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Notify failed.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
