import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const parseUUID = (value: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(trimmed) ? trimmed : null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = parseUUID(request.nextUrl.searchParams.get('orderId'))

    let query = supabase
      .from('v_stock_movements_display')
      .select(
        `
          created_at,
          movement_type,
          variant_id,
          from_organization_id,
          to_organization_id,
          quantity_before,
          quantity_change,
          quantity_after,
          reference_type,
          reference_id
        `
      )
      .order('created_at', { ascending: false })
      .limit(500)

    if (orderId) {
      query = query.eq('reference_type', 'order').eq('reference_id', orderId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[movements] Failed to load movements', error)
      return NextResponse.json({ error: 'Unable to load stock movements' }, { status: 500 })
    }

    const rows = (data || []).map((row) => ({
      created_at: row.created_at,
      movement_type: row.movement_type,
      type: row.movement_type === 'order_fulfillment' ? 'Shipment' : row.movement_type,
      variant_id: row.variant_id,
      from_organization_id: row.from_organization_id,
      to_organization_id: row.to_organization_id,
      before: row.quantity_before,
      change: row.quantity_change,
      after: row.quantity_after,
      reference_type: row.reference_type,
      reference_id: row.reference_id
    }))

    return NextResponse.json({
      data: rows,
      filters: {
        order_id: orderId
      }
    })
  } catch (error: any) {
    console.error('[movements] Unexpected error', error)
    return NextResponse.json({ error: error?.message || 'Unexpected error' }, { status: 500 })
  }
}
