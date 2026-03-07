import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const dynamic = 'force-dynamic'

function computeDateWindow(preset: string) {
  const now = new Date()
  let start: Date
  let end: Date = new Date()

  switch (preset) {
    case 'thisMonth': start = startOfMonth(now); break
    case 'lastMonth':
      start = startOfMonth(subMonths(now, 1))
      end = endOfMonth(subMonths(now, 1))
      break
    case 'last3Months': start = startOfMonth(subMonths(now, 2)); break
    case 'last6Months': start = startOfMonth(subMonths(now, 5)); break
    case 'last12Months': start = startOfMonth(subMonths(now, 11)); break
    default: start = startOfMonth(now)
  }

  return { start: start.toISOString(), end: end.toISOString() }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const dateRange = searchParams.get('dateRange') || 'thisMonth'
    const orderType = searchParams.get('orderType') || ''
    const seller = searchParams.get('seller') || ''
    const status = searchParams.get('status') || ''
    const search = searchParams.get('search') || ''

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const dates = computeDateWindow(dateRange)

    let q = supabase
      .from('orders')
      .select(`
        id, order_no, display_doc_no, order_type, status, created_at,
        buyer:organizations!orders_buyer_org_id_fkey(id, org_name, org_type_code),
        seller:organizations!orders_seller_org_id_fkey(id, org_name),
        order_items(qty, unit_price, line_total)
      `)
      .gte('created_at', dates.start)
      .lte('created_at', dates.end)
      .order('created_at', { ascending: false })

    if (orderType) q = q.eq('order_type', orderType as any)
    if (seller) q = q.eq('seller_org_id', seller)
    if (status) q = q.eq('status', status as any)

    const { data: allOrders } = await q
    let orders = (allOrders || []).filter((o: any) => o.buyer?.org_type_code === 'DIST')
    if (search) {
      const s = search.toLowerCase()
      orders = orders.filter((o: any) => (o.buyer?.org_name || '').toLowerCase().includes(s))
    }

    // Build CSV
    const rows = orders.map((o: any) => {
      const lineTotal = (o.order_items || []).reduce((s: number, i: any) => s + (Number(i.line_total) || 0), 0)
      const qty = (o.order_items || []).reduce((s: number, i: any) => s + (i.qty || 0), 0)
      return {
        'Order No': o.display_doc_no || o.order_no || '',
        'Date': o.created_at ? new Date(o.created_at).toISOString().split('T')[0] : '',
        'Distributor': o.buyer?.org_name || '',
        'Seller': o.seller?.org_name || '',
        'Type': o.order_type || '',
        'Status': o.status || '',
        'Qty': qty,
        'Amount (RM)': lineTotal.toFixed(2),
      }
    })

    if (rows.length === 0) {
      return new Response('No data found for the selected filters.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const headers = Object.keys(rows[0])
    const csvLines = [
      headers.join(','),
      ...rows.map((r: any) =>
        headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(',')
      ),
    ]

    return new Response(csvLines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=distributor-report-${dateRange}.csv`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
