import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { acceptSerappOrderHold } from '@/lib/serapp/hold-service'

/**
 * Warehouse / HQ accepts a Serapp hold within the 1-hour window.
 * Converts temporary acceptance risk into a stable allocated order
 * (allocation already exists from confirm; this stops auto-expiry).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    if (!orderId) return NextResponse.json({ error: 'orderId is required.' }, { status: 400 })

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        account_scope,
        organizations:organization_id ( id, org_type_code, parent_org_id )
      `)
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const organization = Array.isArray(requester.organizations)
      ? requester.organizations[0]
      : requester.organizations

    const access = getSerappAccessDecision({
      accountScope: requester.account_scope,
      orgTypeCode: organization?.org_type_code,
      organizationId: requester.organization_id,
      roleLevel: null,
    })

    const orgType = (organization?.org_type_code || '').toUpperCase()
    const canAccept = access.isHqSupport || orgType === 'WH' || orgType === 'HQ'
    if (!canAccept) {
      return NextResponse.json({
        error: 'Only HQ or Warehouse users can accept Serapp holds.',
      }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: hold, error: holdLookupError } = await admin
      .from('serapp_order_holds')
      .select('id, order_id, status, expires_at, seller_hq_id, fulfillment_warehouse_id, buyer_org_id, created_by')
      .eq('order_id', orderId)
      .maybeSingle()

    if (holdLookupError) throw holdLookupError
    if (!hold) return NextResponse.json({ error: 'Serapp hold not found for this order.' }, { status: 404 })

    if (orgType === 'WH' && hold.fulfillment_warehouse_id !== requester.organization_id) {
      return NextResponse.json({ error: 'This hold belongs to another warehouse.' }, { status: 403 })
    }

    if ((orgType === 'HQ' || access.isHqSupport) && hold.seller_hq_id !== requester.organization_id) {
      return NextResponse.json({ error: 'This hold belongs to another HQ.' }, { status: 403 })
    }

    if (hold.status !== 'active') {
      return NextResponse.json({
        error: `Hold is already ${hold.status}.`,
        hold,
      }, { status: 409 })
    }

    if (new Date(hold.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({
        error: 'Hold has already expired. Run the expiry worker or ask the distributor to re-order.',
      }, { status: 409 })
    }

    const accepted = await acceptSerappOrderHold(admin, {
      orderId,
      acceptedBy: user.id,
    })

    const { data: order } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no')
      .eq('id', orderId)
      .maybeSingle()

    const orderLabel = order?.display_doc_no || order?.order_no || orderId

    const { data: doDoc } = await admin
      .from('documents')
      .select('id, doc_no, display_doc_no, status')
      .eq('order_id', orderId)
      .eq('doc_type', 'DO')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Push acceptance/DO progress into persisted chats so distributors get a WhatsApp-like
    // thread update even when acceptance happens from History/HQ side.
    if (hold.created_by) {
      const { data: targetConversations } = await admin
        .from('serapp_conversations')
        .select('id, kind')
        .eq('owner_user_id', hold.created_by)
        .in('kind', ['assistant', 'warehouse'])
        .eq('is_archived', false)

      const warehouseText = doDoc
        ? `✅ Warehouse accepted hold for *${orderLabel}*. Delivery Order *${doDoc.display_doc_no || doDoc.doc_no}* is ${String(doDoc.status || '').toLowerCase() || 'available'}.`
        : `✅ Warehouse accepted hold for *${orderLabel}*. DO will be issued in the current order workflow; you can track documents from Dashboard/History.`

      const assistantText = doDoc
        ? `Update: warehouse accepted *${orderLabel}*. DO *${doDoc.display_doc_no || doDoc.doc_no}* is now ${String(doDoc.status || '').toLowerCase() || 'available'}.`
        : `Update: warehouse accepted *${orderLabel}*. DO will follow in the current order workflow.`

      for (const conv of targetConversations || []) {
        const body = conv.kind === 'warehouse' ? warehouseText : assistantText
        const { data: msg } = await admin
          .from('serapp_messages')
          .insert({
            conversation_id: conv.id,
            role: 'system',
            body,
          })
          .select('created_at')
          .single()

        await admin
          .from('serapp_conversations')
          .update({
            last_message_preview: body.slice(0, 72),
            last_message_at: msg?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conv.id)
      }
    }

    return NextResponse.json({
      ok: true,
      hold: accepted,
      do: doDoc
        ? {
            id: doDoc.id,
            doc_no: doDoc.doc_no,
            display_doc_no: doDoc.display_doc_no,
            status: doDoc.status,
          }
        : null,
      note: 'Serapp hold accepted. Order remains in Current Order Module and will no longer auto-expire.',
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Accept failed.',
    }, { status })
  }
}

export const dynamic = 'force-dynamic'
