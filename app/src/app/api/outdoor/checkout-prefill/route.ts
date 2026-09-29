import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { outdoorCheckoutPrefill } from '@/lib/outdoor/checkout-prefill'

/** GET /api/outdoor/checkout-prefill — delivery details we already know for the signed-in shopper. */
export async function GET() {
  try {
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
    }

    const admin: any = createAdminClient()
    const email = user.email.trim().toLowerCase()
    const [profile, orders] = await Promise.all([
      admin.from('users').select('full_name, phone, address').eq('id', user.id).maybeSingle(),
      admin
        .from('storefront_orders')
        .select('customer_name, customer_phone, shipping_address, sales_channel, created_at')
        .ilike('customer_email', email)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const orderRows = Array.isArray(orders.data) ? orders.data : []
    const lastOrder =
      orderRows.find((order: any) => order.sales_channel === 'outdoor') || orderRows[0] || null

    return NextResponse.json({
      prefill: outdoorCheckoutPrefill({
        metadata: user.user_metadata || {},
        authPhone: user.phone || '',
        profile: profile.data || null,
        lastOrder,
      }),
    })
  } catch (err) {
    console.error('[outdoor/checkout-prefill]', err)
    return NextResponse.json({ error: 'Could not load your details.' }, { status: 500 })
  }
}
