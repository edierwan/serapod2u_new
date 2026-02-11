import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/ar/receipts
 * List D2H customer receipts with GL posting status.
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
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')

    let query = supabase
      .from('documents')
      .select(`
        id,
        doc_type,
        doc_no,
        display_doc_no,
        status,
        created_at,
        acknowledged_at,
        order_id,
        payment_percentage,
        orders!inner (
          id,
          order_no,
          display_doc_no,
          order_type,
          buyer_org_id
        )
      `, { count: 'exact' })
      .eq('company_id', orgId)
      .eq('doc_type', 'RECEIPT')
      .eq('orders.order_type', 'D2H')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (fromDate) query = query.gte('created_at', fromDate)
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59')

    const { data: receipts, error, count } = await query

    if (error) {
      console.error('Error fetching AR receipts:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate amounts from order_items
    const orderIds = [...new Set((receipts || []).map((d: any) => d.order_id).filter(Boolean))]
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

    // GL posting status
    const docIds = (receipts || []).map((d: any) => d.id)
    const postingMap: Record<string, any> = {}
    if (docIds.length > 0) {
      const { data: postings } = await supabase
        .from('gl_document_postings')
        .select('document_id, journal_id, document_number, posted_amount, created_at')
        .in('document_id', docIds)
      if (postings) for (const p of postings) postingMap[p.document_id] = p
    }

    // Buyer names
    const buyerIds = [...new Set((receipts || []).map((d: any) => (d.orders as any)?.buyer_org_id).filter(Boolean))]
    const buyerMap: Record<string, string> = {}
    if (buyerIds.length > 0) {
      const { data: orgs } = await supabase.from('organizations').select('id, org_name').in('id', buyerIds)
      if (orgs) for (const o of orgs) buyerMap[o.id] = o.org_name
    }

    const result = (receipts || []).map((doc: any) => {
      const orderTotal = orderAmounts[doc.order_id] || 0
      // Receipt amount: if payment_percentage is set, use that fraction of total
      const amount = doc.payment_percentage
        ? Math.round(orderTotal * (doc.payment_percentage / 100) * 100) / 100
        : orderTotal
      return {
        id: doc.id,
        document_no: doc.display_doc_no || doc.doc_no,
        order_no: doc.orders?.display_doc_no || doc.orders?.order_no,
        order_id: doc.order_id,
        status: doc.status,
        amount,
        date: doc.created_at,
        customer_name: buyerMap[doc.orders?.buyer_org_id] || '-',
        gl_posted: !!postingMap[doc.id],
        gl_posting: postingMap[doc.id] || null,
      }
    })

    return NextResponse.json({ receipts: result, total: count || 0, limit, offset })
  } catch (error) {
    console.error('Error in AR receipts API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
