import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/ap/aging
 * AP aging analysis: outstanding supplier balances bucketed by days.
 *
 * Issue 2 fix: Also includes orders that are status='unpaid' but have no
 * PAYMENT_REQUEST yet — these still represent AP obligations.
 *
 * Schema: documents has NO total_amount. Orders uses seller_org_id.
 * source_request_id is in payload JSONB, not a direct column.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    const orgId = userData.organization_id
    const { searchParams } = new URL(request.url)
    const asAtDate = searchParams.get('asAt') || new Date().toISOString().split('T')[0]

    // Get ALL purchase orders (non-D2H) up to asAt date
    // These represent AP obligations. order_type H2M and S2D are purchase flows.
    const { data: purchaseOrders } = await supabase
      .from('orders')
      .select('id, order_no, display_doc_no, order_type, seller_org_id, status, created_at, paid_amount, payment_terms')
      .eq('company_id', orgId)
      .in('order_type', ['H2M', 'S2D'])
      .in('status', ['submitted', 'approved', 'unpaid', 'processing', 'partially_paid'])
      .lte('created_at', asAtDate + 'T23:59:59')

    // Get order amounts from order_items
    const orderIds = (purchaseOrders || []).map((o: any) => o.id)
    const orderAmounts: Record<string, number> = {}
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, line_total')
        .in('order_id', orderIds)
      for (const item of items || []) {
        orderAmounts[item.order_id] = (orderAmounts[item.order_id] || 0) + (Number(item.line_total) || 0)
      }
    }

    // Get all PAYMENT documents for these orders (actual cash paid)
    const { data: payments } = await supabase
      .from('documents')
      .select('id, order_id, payment_percentage, doc_no, payload')
      .eq('company_id', orgId)
      .eq('doc_type', 'PAYMENT')
      .in('order_id', orderIds.length > 0 ? orderIds : ['00000000-0000-0000-0000-000000000000'])
      .lte('created_at', asAtDate + 'T23:59:59')

    // Calculate paid per order from payment documents
    const paidByOrder: Record<string, number> = {}
    for (const p of payments || []) {
      const orderTotal = orderAmounts[p.order_id] || 0
      const docNo = p.doc_no || ''
      const payload = (p.payload as any) || {}
      const isBalance = docNo.includes('-BAL') || !!payload.source_request_id

      // Use order payment_terms to determine amount
      const order = (purchaseOrders || []).find((o: any) => o.id === p.order_id)
      const paymentTerms = order?.payment_terms || {}
      let paidAmount: number
      if (isBalance) {
        paidAmount = Math.round(orderTotal * (Number(paymentTerms.balance_pct) || 0.7) * 100) / 100
      } else {
        paidAmount = Math.round(orderTotal * (Number(paymentTerms.deposit_pct) || 0.3) * 100) / 100
      }
      paidByOrder[p.order_id] = (paidByOrder[p.order_id] || 0) + paidAmount
    }

    // Supplier names
    const supplierIds = [...new Set((purchaseOrders || []).map((o: any) => o.seller_org_id).filter(Boolean))]
    const supplierMap: Record<string, string> = {}
    if (supplierIds.length > 0) {
      const { data: orgs } = await supabase.from('organizations').select('id, org_name').in('id', supplierIds)
      if (orgs) for (const o of orgs) supplierMap[o.id] = o.org_name
    }

    // Calculate aging per supplier
    const now = new Date(asAtDate)
    const agingBySupplier: Record<string, {
      supplier_id: string; supplier_name: string
      current: number; days_31_60: number; days_61_90: number
      days_91_120: number; days_120_plus: number
      total: number; bill_count: number
    }> = {}

    for (const order of purchaseOrders || []) {
      const supplierId = order.seller_org_id || 'unknown'
      const supplierName = supplierMap[supplierId] || 'Unknown'
      const orderTotal = orderAmounts[order.id] || 0
      const paid = paidByOrder[order.id] || 0
      const outstanding = Math.max(0, orderTotal - paid)

      if (outstanding <= 0) continue

      const orderDate = new Date(order.created_at!)
      const daysOld = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))

      if (!agingBySupplier[supplierId]) {
        agingBySupplier[supplierId] = {
          supplier_id: supplierId, supplier_name: supplierName,
          current: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, days_120_plus: 0,
          total: 0, bill_count: 0,
        }
      }

      const e = agingBySupplier[supplierId]
      e.bill_count++
      e.total += outstanding
      if (daysOld <= 30) e.current += outstanding
      else if (daysOld <= 60) e.days_31_60 += outstanding
      else if (daysOld <= 90) e.days_61_90 += outstanding
      else if (daysOld <= 120) e.days_91_120 += outstanding
      else e.days_120_plus += outstanding
    }

    const agingData = Object.values(agingBySupplier).sort((a, b) => b.total - a.total)
    const totals = agingData.reduce(
      (acc, r) => ({
        current: acc.current + r.current, days_31_60: acc.days_31_60 + r.days_31_60,
        days_61_90: acc.days_61_90 + r.days_61_90, days_91_120: acc.days_91_120 + r.days_91_120,
        days_120_plus: acc.days_120_plus + r.days_120_plus, total: acc.total + r.total,
        bill_count: acc.bill_count + r.bill_count,
      }),
      { current: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, days_120_plus: 0, total: 0, bill_count: 0 }
    )

    return NextResponse.json({ aging: agingData, totals, asAtDate, supplierCount: agingData.length })
  } catch (error) {
    console.error('Error in AP aging API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
