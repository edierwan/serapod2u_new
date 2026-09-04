import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Order lines + prepared quantities for messaging warehouse UI. */
export async function GET(request: Request) {
  try {
    const orderId = new URL(request.url).searchParams.get('orderId')
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

    const admin = createAdminClient()
    await admin.rpc('messaging_ensure_preparation_items' as any, { p_order_id: orderId })

    const { data: items, error } = await admin
      .from('messaging_preparation_items')
      .select(`
        id,
        order_id,
        order_item_id,
        ordered_quantity,
        prepared_quantity,
        short_quantity,
        remark,
        order_items!inner (
          id,
          qty,
          variant_id,
          variant:product_variants (
            variant_name
          )
        )
      `)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    if (error) throw error

    const lines = (items || []).map((row: any) => ({
      id: row.id,
      orderItemId: row.order_item_id,
      orderedQuantity: row.ordered_quantity,
      preparedQuantity: row.prepared_quantity,
      shortQuantity: row.short_quantity,
      remark: row.remark,
      variantName: row.order_items?.variant?.variant_name || 'Item',
    }))

    return NextResponse.json({ lines })
  } catch (error) {
    console.error('[messaging/preparation-items]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load preparation lines.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
