import { createAdminClient } from '@/lib/supabase/admin'
import { SERAPP_ORDER_SOURCE_MARKER } from '@/lib/serapp/constants'
import { bumpUnreadIfOwnerAway } from '@/lib/serapp/conversation-service'

type Admin = ReturnType<typeof createAdminClient>

function formatApprovedBotMessage(orderLabel: string): string {
  return [
    `✅ **Admin approved your order** · **${orderLabel}**`,
    '',
    'What happened: HQ accepted this order. Documents are ready and stock is set aside for you.',
    '',
    '👉 **Next step:** Wait for the warehouse to prepare and ship. You can track status anytime in [History](/serapp/history).',
  ].join('\n')
}

/**
 * Push a clear bot update into SerApp assistant chat(s) after HQ approves a SerApp D2H order.
 * Best-effort: never throws to the approve UI path.
 */
export async function notifySerappOrderApproved(
  admin: Admin,
  orderId: string,
): Promise<{ notified: number; skipped?: string }> {
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, order_no, display_doc_no, status, notes, buyer_org_id, created_by')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw orderError
  if (!order) return { notified: 0, skipped: 'order_not_found' }
  if (order.status !== 'approved') return { notified: 0, skipped: 'not_approved' }

  const { data: hold } = await admin
    .from('serapp_order_holds')
    .select('id, buyer_org_id, created_by')
    .eq('order_id', orderId)
    .maybeSingle()

  const fromNotes = String(order.notes || '').includes(SERAPP_ORDER_SOURCE_MARKER)
  if (!hold && !fromNotes) {
    return { notified: 0, skipped: 'not_serapp_order' }
  }

  const buyerOrgId = hold?.buyer_org_id || order.buyer_org_id
  const createdBy = hold?.created_by || order.created_by
  const orderLabel = order.display_doc_no || order.order_no || orderId
  const body = formatApprovedBotMessage(orderLabel)

  const byId = new Map<string, { id: string; kind: string }>()

  if (buyerOrgId) {
    const { data: orgChats } = await admin
      .from('serapp_conversations')
      .select('id, kind')
      .eq('kind', 'assistant')
      .eq('is_archived', false)
      .or(`owner_org_id.eq.${buyerOrgId},distributor_org_id.eq.${buyerOrgId}`)
    for (const row of orgChats || []) byId.set(row.id, row)
  }

  if (createdBy) {
    const { data: ownerChats } = await admin
      .from('serapp_conversations')
      .select('id, kind')
      .eq('kind', 'assistant')
      .eq('is_archived', false)
      .eq('owner_user_id', createdBy)
    for (const row of ownerChats || []) byId.set(row.id, row)
  }

  const targets = Array.from(byId.values())
  if (targets.length === 0) return { notified: 0, skipped: 'no_conversation' }

  const quickReplies = [
    { id: 'new', label: 'New order', sendText: 'new order' },
    { id: 'help', label: 'Help', sendText: 'help' },
  ]

  let notified = 0
  for (const conv of targets) {
    const { data: msg, error: msgError } = await admin
      .from('serapp_messages')
      .insert({
        conversation_id: conv.id,
        role: 'bot',
        body,
        quick_replies_json: quickReplies,
      })
      .select('created_at')
      .single()

    if (msgError) {
      console.warn('[serapp] approve notify insert failed', conv.id, msgError.message)
      continue
    }

    const patch: Record<string, unknown> = {
      last_message_preview: body.replace(/\n/g, ' ').slice(0, 72),
      last_message_at: msg?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    await bumpUnreadIfOwnerAway(admin, conv.id, patch)
    await admin.from('serapp_conversations').update(patch).eq('id', conv.id)
    notified += 1
  }

  return { notified }
}
