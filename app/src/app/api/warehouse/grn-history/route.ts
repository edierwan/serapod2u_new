import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 500 // safety cap; filtering/pagination applied client-side over this set

function buildGrn(receiptNo: string, displayDoc: string, fallbackSeq: number) {
  const legacyRef = (receiptNo || '').replace(/^WR-/i, '')
  const seqMatch = (receiptNo || '').match(/-(\d+)$/)
  const seq = seqMatch ? seqMatch[1] : String(fallbackSeq).padStart(2, '0')
  return { grn_no: `GRN-${displayDoc}-${seq}`, legacy_ref: legacyRef || receiptNo }
}

/**
 * GET /api/warehouse/grn-history
 *
 * GLOBAL Goods Received History for the caller's company — every GRN across all
 * orders (active AND fully received), so completed orders stay accessible after
 * they drop out of the Warehouse Receive dropdown.
 *
 * Returns enriched receipts (order/supplier/GRN/legacy/items/remarks). Filtering
 * and pagination are applied client-side over a capped, company-scoped set
 * (sufficient for current volumes; raise MAX_ROWS or push filters into SQL if
 * history grows large).
 */
export async function GET(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let companyId: string | null = null
  try {
    const { data } = await authClient.rpc('get_user_company_id')
    companyId = (data as string) || null
  } catch { /* fall through */ }

  const supabase = createAdminClient()

  let rQuery = supabase
    .from('warehouse_receipts')
    .select('id, order_id, batch_id, receipt_no, receipt_type, posting_status, total_received, cumulative_received, ordered_total, extra_received, notes, received_by, received_at')
    .order('received_at', { ascending: false })
    .limit(MAX_ROWS)
  if (companyId) rQuery = rQuery.eq('company_id', companyId)

  const { data: receipts, error } = await rQuery
  if (error) return NextResponse.json({ receipts: [], available: false })

  const orderIds = Array.from(new Set((receipts || []).map((r: any) => r.order_id)))
  const receiptIds = (receipts || []).map((r: any) => r.id)

  // Orders (for GRN display number + supplier + legacy order ref)
  const orderById = new Map<string, any>()
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_no, display_doc_no, created_at, buyer_org:organizations!orders_buyer_org_id_fkey(org_name)')
      .in('id', orderIds)
    for (const o of orders || []) orderById.set(o.id, o)
  }

  // Line items (as any to avoid deep type instantiation with nested joins)
  const itemsByReceipt = new Map<string, any[]>()
  if (receiptIds.length > 0) {
    const { data: items } = await (supabase as any)
      .from('warehouse_receipt_items')
      .select('receipt_id, variant_id, product_id, ordered_qty, received_now, cumulative_received, product_variants(variant_name, variant_code), products(product_name)')
      .in('receipt_id', receiptIds)
    for (const it of items || []) {
      const ordered = it.ordered_qty || 0
      const cumulative = it.cumulative_received || 0
      const arr = itemsByReceipt.get(it.receipt_id) || []
      arr.push({
        product_name: (it.products as any)?.product_name || 'Product',
        variant_name: (it.product_variants as any)?.variant_name || '',
        variant_code: (it.product_variants as any)?.variant_code || '',
        ordered_qty: ordered,
        received_now: it.received_now,
        cumulative_received: cumulative,
        balance: Math.max(0, ordered - cumulative),
      })
      itemsByReceipt.set(it.receipt_id, arr)
    }
  }

  // Receiver names
  const userNameById = new Map<string, string>()
  const userIds = Array.from(new Set((receipts || []).map((r: any) => r.received_by).filter(Boolean)))
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, email, full_name').in('id', userIds)
    for (const u of users || []) userNameById.set(u.id, (u as any).full_name || (u as any).email || u.id)
  }

  // Per-order chronological sequence fallback
  const seqCounter = new Map<string, number>()
  const enriched = (receipts || []).slice().reverse().map((r: any) => {
    const order = orderById.get(r.order_id)
    const displayDoc = order?.display_doc_no || order?.order_no || 'ORDER'
    const n = (seqCounter.get(r.order_id) || 0) + 1
    seqCounter.set(r.order_id, n)
    const { grn_no, legacy_ref } = buildGrn(r.receipt_no, displayDoc, n)
    return {
      ...r,
      grn_no,
      legacy_ref,
      order_display_no: displayDoc,
      legacy_order_ref: order?.order_no || '',
      supplier: order?.buyer_org?.org_name || '',
      order_date: order?.created_at || null,
      received_by_name: r.received_by ? (userNameById.get(r.received_by) || r.received_by) : null,
      items: itemsByReceipt.get(r.id) || [],
    }
  }).reverse() // back to newest-first

  return NextResponse.json({ receipts: enriched, available: true })
}
