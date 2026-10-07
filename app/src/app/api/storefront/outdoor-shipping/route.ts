import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOutdoorShipping } from '@/lib/outdoor/shipping-server'
import { pickOutdoorShipping } from '@/lib/outdoor/shipping'

/** POST /api/storefront/outdoor-shipping — the delivery line the Outdoor checkout will charge for this bag and address. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const items: Array<{ variantId?: string; quantity?: number }> = Array.isArray(body?.items) ? body.items.slice(0, 50) : []
    const variantIds = [...new Set(items.map((item) => String(item?.variantId || '')).filter(Boolean))]
    if (variantIds.length === 0) {
      return NextResponse.json({ shipping: pickOutdoorShipping([], 0) })
    }

    const supabase: any = createAdminClient()
    const { data: variants, error } = await supabase
      .from('product_variants')
      .select('id, product_id, suggested_retail_price')
      .in('id', variantIds)
      .eq('is_active', true)
    if (error) {
      console.error('[outdoor-shipping] variants', error)
      return NextResponse.json({ error: 'Could not load delivery' }, { status: 500 })
    }

    const byId = new Map((variants || []).map((variant: any) => [variant.id, variant]))
    let subtotal = 0
    const lines: Array<{ productId: string; quantity: number }> = []
    for (const item of items) {
      const variant: any = byId.get(String(item?.variantId || ''))
      const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0))
      if (!variant) continue
      subtotal += Number(variant.suggested_retail_price || 0) * quantity
      lines.push({ productId: String(variant.product_id || ''), quantity })
    }

    const shipping = await resolveOutdoorShipping(supabase, lines, subtotal, {
      postcode: typeof body?.postcode === 'string' ? body.postcode.slice(0, 10) : '',
      state: typeof body?.state === 'string' ? body.state.slice(0, 60) : '',
    })
    return NextResponse.json({ shipping })
  } catch (err) {
    console.error('[outdoor-shipping]', err)
    return NextResponse.json({ error: 'Could not load delivery' }, { status: 500 })
  }
}
