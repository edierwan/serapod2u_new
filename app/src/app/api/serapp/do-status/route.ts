import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        account_scope,
        organizations:organization_id ( id, org_type_code )
      `)
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const org = Array.isArray(requester.organizations) ? requester.organizations[0] : requester.organizations
    const access = getSerappAccessDecision({
      accountScope: requester.account_scope,
      orgTypeCode: org?.org_type_code,
      organizationId: requester.organization_id,
      roleLevel: null,
    })
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 })
    }

    const url = new URL(request.url)
    const limit = Math.max(1, Math.min(10, Number(url.searchParams.get('limit') || 5)))
    const admin = createAdminClient()

    let holdsQuery = admin
      .from('serapp_order_holds')
      .select('order_id, status, accepted_at, created_at, buyer_org_id, seller_hq_id')
      .order('created_at', { ascending: false })
      .limit(limit * 3)

    if (access.isHqSupport) {
      holdsQuery = holdsQuery.eq('seller_hq_id', requester.organization_id)
    } else {
      holdsQuery = holdsQuery.eq('buyer_org_id', requester.organization_id)
    }

    const { data: holds, error: holdsError } = await holdsQuery
    if (holdsError) throw holdsError

    const orderIds = [...new Set((holds || []).map((h) => h.order_id))].slice(0, limit * 2)
    if (orderIds.length === 0) {
      return NextResponse.json({ stories: [] })
    }

    const { data: orders } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no, status, created_at')
      .in('id', orderIds)

    const { data: docs } = await admin
      .from('documents')
      .select('id, order_id, doc_no, display_doc_no, status, created_at')
      .eq('doc_type', 'DO')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })

    const orderById = new Map((orders || []).map((o) => [o.id, o]))
    const docByOrder = new Map<string, any>()
    for (const d of docs || []) {
      if (!docByOrder.has(d.order_id)) docByOrder.set(d.order_id, d)
    }

    const stories = (holds || [])
      .map((hold) => {
        const order = orderById.get(hold.order_id)
        if (!order) return null
        const doc = docByOrder.get(hold.order_id) || null
        const orderLabel = order.display_doc_no || order.order_no
        const holdStatus = hold.status
        const doLabel = doc ? (doc.display_doc_no || doc.doc_no) : null

        return {
          orderId: order.id,
          orderNo: order.order_no,
          orderLabel,
          orderStatus: order.status,
          holdStatus,
          acceptedAt: hold.accepted_at,
          do: doc
            ? {
                docNo: doc.doc_no,
                displayDocNo: doc.display_doc_no,
                status: doc.status,
                createdAt: doc.created_at,
                downloadUrl: `/api/documents/generate?orderId=${encodeURIComponent(order.id)}&type=delivery_order&documentId=${encodeURIComponent(doc.id)}`,
              }
            : null,
          story: doc
            ? `Order ${orderLabel}: DO ${doLabel} is ${String(doc.status || '').toLowerCase() || 'ready'}.`
            : holdStatus === 'accepted'
              ? `Order ${orderLabel}: accepted by warehouse. DO not found yet — ask HQ to re-check documents.`
              : `Order ${orderLabel}: waiting for warehouse acceptance before DO.`,
          updatedAt: doc?.created_at || hold.accepted_at || hold.created_at || order.created_at,
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit)

    return NextResponse.json({ stories })
  } catch (error) {
    console.error('[serapp/do-status]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load DO stories.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
