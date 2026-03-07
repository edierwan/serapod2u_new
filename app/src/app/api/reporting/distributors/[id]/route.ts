import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { format, parseISO, subMonths, startOfMonth } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: distId } = await params
    if (!distId) {
      return NextResponse.json({ error: 'Missing distributor id' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Org info
    const { data: org } = await supabase
      .from('organizations')
      .select('id, org_name, org_type_code')
      .eq('id', distId)
      .single()

    if (!org) {
      return NextResponse.json({ error: 'Distributor not found' }, { status: 404 })
    }

    // Last 12 months of orders
    const since = startOfMonth(subMonths(new Date(), 11)).toISOString()
    const prevSince = startOfMonth(subMonths(new Date(), 23)).toISOString()

    const { data: orders } = await supabase
      .from('orders')
      .select(`
        id, order_no, display_doc_no, order_type, status, created_at,
        seller:organizations!orders_seller_org_id_fkey(org_name),
        order_items(id, variant_id, qty, unit_price, line_total)
      `)
      .eq('buyer_org_id', distId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    // Previous 12 months (for growth calc)
    const { data: prevOrders } = await supabase
      .from('orders')
      .select(`id, order_items(line_total)`)
      .eq('buyer_org_id', distId)
      .gte('created_at', prevSince)
      .lt('created_at', since)

    // Aggregate current
    let totalRM = 0
    let totalOrders = (orders || []).length
    const monthMap: Record<string, { amount: number; orders: number }> = {}
    const productMap: Record<string, { name: string; qty: number; amount: number }> = {}
    let lastOrderDate: string | null = null

    const recentOrders: any[] = []

    // Fetch variant names for top products
    const variantIds = new Set<string>()
      ; (orders || []).forEach((o: any) => {
        o.order_items?.forEach((i: any) => {
          if (i.variant_id) variantIds.add(i.variant_id)
        })
      })

    let variantNames: Record<string, string> = {}
    if (variantIds.size > 0) {
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, variant_name, products(product_name)')
        .in('id', Array.from(variantIds))

        ; (variants || []).forEach((v: any) => {
          const pn = v.products?.product_name || ''
          const vn = v.variant_name || ''
          const full = pn && vn && pn !== vn ? `${pn} - ${vn}` : vn || pn || 'Unknown'
          const match = full.match(/\[(.*?)\]/)
          variantNames[v.id] = match ? match[1].trim() : full
        })
    }

    ; (orders || []).forEach((o: any) => {
      const lineTotal = (o.order_items || []).reduce(
        (s: number, i: any) => s + (Number(i.line_total) || 0),
        0
      )
      totalRM += lineTotal

      if (!lastOrderDate || o.created_at > lastOrderDate) {
        lastOrderDate = o.created_at
      }

      const mKey = (o.created_at || '').slice(0, 7)
      if (!monthMap[mKey]) monthMap[mKey] = { amount: 0, orders: 0 }
      monthMap[mKey].amount += lineTotal
      monthMap[mKey].orders += 1

        // Product aggregation
        ; (o.order_items || []).forEach((i: any) => {
          const vid = i.variant_id || 'unknown'
          if (!productMap[vid])
            productMap[vid] = { name: variantNames[vid] || 'Unknown', qty: 0, amount: 0 }
          productMap[vid].qty += i.qty || 0
          productMap[vid].amount += Number(i.line_total) || 0
        })

      if (recentOrders.length < 20) {
        recentOrders.push({
          orderNo: o.display_doc_no || o.order_no || '',
          date: o.created_at,
          status: o.status,
          amount: lineTotal,
          balance: lineTotal, // TODO: integrate actual balance/payment data
        })
      }
    })

    // Previous period total
    const prevRM = (prevOrders || []).reduce((s: number, o: any) => {
      return s + (o.order_items || []).reduce(
        (ss: number, i: any) => ss + (Number(i.line_total) || 0), 0
      )
    }, 0)

    const aov = totalOrders > 0 ? totalRM / totalOrders : 0
    const growthPct = prevRM > 0 ? ((totalRM - prevRM) / prevRM) * 100 : null

    const trend = Object.entries(monthMap)
      .map(([month, d]) => ({
        month,
        label: format(parseISO(month + '-01'), 'MMM yy'),
        amount: d.amount,
        orders: d.orders,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)

    return NextResponse.json({
      id: org.id,
      name: org.org_name,
      totalRM,
      totalOrders,
      aov,
      growthPct,
      lastOrderDate,
      trend,
      topProducts,
      recentOrders,
      agingBuckets: null, // TODO: populate when payment aging data is available
    })
  } catch (error: any) {
    console.error('[Distributor Detail API] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
