import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** HQ resolves messaging discrepancy and issues invoice. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    const resolution = typeof body?.resolution === 'string' ? body.resolution : null
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase.rpc('messaging_resolve_discrepancy_invoice' as any, {
      p_order_id: orderId,
      p_resolution: resolution,
    })

    if (error) {
      return NextResponse.json({ error: error.message || 'Resolve failed.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, result: data })
  } catch (error) {
    console.error('[messaging/receipt/resolve]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Resolve failed.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
