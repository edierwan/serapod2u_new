import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Distributor receipt acknowledgement (web portal). */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
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

    const { data, error } = await supabase.rpc('messaging_acknowledge_receipt' as any, {
      p_order_id: orderId,
      p_user_id: user.id,
      p_channel: 'web',
      p_channel_user_id: user.id,
    })

    if (error) {
      return NextResponse.json({ error: error.message || 'Receipt failed.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, result: data })
  } catch (error) {
    console.error('[messaging/receipt]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Receipt failed.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
