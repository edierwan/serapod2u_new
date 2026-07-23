import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Build the GRN display number + legacy reference for a stored receipt.
 *
 * Stored `receipt_no` (e.g. "WR-ORD-HM-1225-13-02") is kept intact for
 * compatibility / stock-movement lookups and surfaced as the legacy reference.
 * The user-facing Goods Received Note number is derived from the order's public
 * document number: "GRN-<display_doc_no>-<NN>".
 */
function buildGrn(receiptNo: string, displayDoc: string, fallbackSeq: number) {
  const legacyRef = (receiptNo || '').replace(/^WR-/i, '')
  const seqMatch = (receiptNo || '').match(/-(\d+)$/)
  const seq = seqMatch ? seqMatch[1] : String(fallbackSeq).padStart(2, '0')
  return {
    grn_no: `GRN-${displayDoc}-${seq}`,
    legacy_ref: legacyRef || receiptNo,
  }
}

/**
 * GET /api/warehouse/receipt-history?order_id=...
 *
 * Returns every separate delivery (Goods Received Note) recorded for an order,
 * newest first, with order header info, line items, derived GRN numbers and the
 * user who received each one. Degrades to an empty list if the receipt tables
 * are not present yet.
 */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('order_id')
  if (!orderId) {
    return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Order header (for GRN derivation + modal header)
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_no, display_doc_no, created_at, buyer_org:organizations!orders_buyer_org_id_fkey(org_name)')
    .eq('id', orderId)
    .single()

  const displayDoc = (order as any)?.display_doc_no || (order as any)?.order_no || 'ORDER'
  const orderHeader = order
    ? {
      order_id: order.id,
      order_no: (order as any).order_no,
      display_doc_no: (order as any).display_doc_no,
      order_date: (order as any).created_at,
      buyer_org_name: (order as any).buyer_org?.org_name || null,
    }
    : null

  try {
    const { data: receipts, error } = await supabase
      .from('warehouse_receipts')
      .select('id, receipt_no, receipt_type, posting_status, total_received, cumulative_received, ordered_total, extra_received, notes, received_by, received_at')
      .eq('order_id', orderId)
      .order('received_at', { ascending: false })

    if (error) {
      // Tables likely not present yet.
      return NextResponse.json({ receipts: [], available: false, order: orderHeader })
    }

    const receiptIds = (receipts || []).map((r: any) => r.id)
    const itemsByReceipt = new Map<string, any[]>()
    const userNameById = new Map<string, string>()

    if (receiptIds.length > 0) {
      const { data: items } = await (supabase as any)
        .from('warehouse_receipt_items')
        .select('receipt_id, variant_id, product_id, stock_config_id, ordered_qty, previously_received, received_now, cumulative_received, extra_received, product_variants(variant_name, variant_code), products(product_name), inventory_stock_configurations!warehouse_receipt_items_stock_config_fk(config_label, stock_sku, volume_ml, packaging)')
        .in('receipt_id', receiptIds)

      for (const it of items || []) {
        const arr = itemsByReceipt.get(it.receipt_id) || []
        const ordered = it.ordered_qty || 0
        const cumulative = it.cumulative_received || 0
        arr.push({
          variant_id: it.variant_id,
          product_id: it.product_id,
          product_name: (it.products as any)?.product_name || 'Product',
          variant_name: (it.product_variants as any)?.variant_name || '',
          variant_code: (it.product_variants as any)?.variant_code || '',
          ordered_qty: ordered,
          previously_received: it.previously_received,
          received_now: it.received_now,
          cumulative_received: cumulative,
          balance: Math.max(0, ordered - cumulative),
          extra_received: it.extra_received,
          stock_config_id: it.stock_config_id,
          stock_config: Array.isArray(it.inventory_stock_configurations) ? it.inventory_stock_configurations[0] : it.inventory_stock_configurations,
        })
        itemsByReceipt.set(it.receipt_id, arr)
      }

      // Resolve receiver names
      const userIds = Array.from(new Set((receipts || []).map((r: any) => r.received_by).filter(Boolean)))
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, full_name')
          .in('id', userIds)
        for (const u of users || []) {
          userNameById.set(u.id, (u as any).full_name || (u as any).email || u.id)
        }
      }
    }

    // Chronological sequence fallback: oldest receipt → GRN-XX-01, newest → GRN-XX-NN.
    const seqCounter = new Map<string, number>()
    const sortedDesc = [...(receipts || [])].sort(
      (a: any, b: any) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime()
    )
    const enriched = sortedDesc.map((r: any) => {
      const n = (seqCounter.get(r.order_id) || 0) + 1
      seqCounter.set(r.order_id, n)
      const { grn_no, legacy_ref } = buildGrn(r.receipt_no, displayDoc, n)
      return {
        ...r,
        grn_no,
        legacy_ref,
        received_by_name: r.received_by ? (userNameById.get(r.received_by) || r.received_by) : null,
        items: itemsByReceipt.get(r.id) || [],
      }
    })

    return NextResponse.json({ receipts: enriched, available: true, order: orderHeader })
  } catch (e: any) {
    return NextResponse.json({ receipts: [], available: false, order: orderHeader, error: e?.message })
  }
}
