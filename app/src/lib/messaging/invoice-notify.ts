import { createAdminClient } from '@/lib/supabase/admin'
import { notifyMessagingInvoiceIssued } from '@/lib/messaging/notifications'

/** Best-effort invoice notifications after messaging receipt/resolve RPCs. */
export async function notifyAfterMessagingInvoice(orderId: string, rpcResult: unknown): Promise<void> {
  try {
    const payload = rpcResult as {
      order_no?: string
      invoice_no?: string
      invoice_total?: number
    } | null
    if (!payload?.invoice_no) return

    const admin = createAdminClient()
    const { data: order } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no, buyer_org_id, seller_org_id, created_by, source_channel')
      .eq('id', orderId)
      .maybeSingle()

    if (!order || (order.source_channel !== 'telegram' && order.source_channel !== 'whatsapp')) {
      return
    }

    const { data: hqId } = await admin.rpc('resolve_seller_hq_organization', {
      p_org_id: order.seller_org_id,
    } as any)

    await notifyMessagingInvoiceIssued({
      hqOrgId: String(hqId || order.seller_org_id),
      buyerOrgId: order.buyer_org_id,
      createdByUserId: order.created_by,
      orderId: order.id,
      orderNo: payload.order_no || order.display_doc_no || order.order_no || order.id.slice(0, 8),
      invoiceNo: payload.invoice_no,
      invoiceTotal: Number(payload.invoice_total || 0),
    })
  } catch (error) {
    console.warn('[messaging/notifyAfterMessagingInvoice]', error)
  }
}
