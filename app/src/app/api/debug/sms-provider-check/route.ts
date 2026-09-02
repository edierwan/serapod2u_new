import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { loadActiveSmsProviderConfig } from '@/lib/notifications/sms-send'

export const dynamic = 'force-dynamic'

// TEMPORARY DIAGNOSTIC ROUTE.
// Purpose: figure out exactly why sendSmsWithActiveProvider() returns
// "SMS provider not configured" for real order notifications even
// though the SMS provider shows as Active in Settings -> Providers.
//
// Usage: GET /api/debug/sms-provider-check?orderNo=ORD26000081
// (must be logged in as an admin user)
//
// Safe to delete once the mismatch is found and fixed.

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient()
    const orderNo = request.nextUrl.searchParams.get('orderNo')
    if (!orderNo) {
      return NextResponse.json({ error: 'Pass ?orderNo=ORD26000081' }, { status: 400 })
    }

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no, company_id, buyer_org_id, seller_org_id, status')
      .or(`order_no.eq.${orderNo},display_doc_no.eq.${orderNo}`)
      .maybeSingle()

    if (orderError || !order) {
      return NextResponse.json({
        error: orderError?.message || 'Order not found',
        orderNo,
      }, { status: 404 })
    }

    const resolvedOrgId = order.company_id || order.seller_org_id || order.buyer_org_id

    const { data: resolvedOrg } = resolvedOrgId
      ? await admin
          .from('organizations')
          .select('id, org_name, org_type_code, is_active')
          .eq('id', resolvedOrgId)
          .maybeSingle()
      : { data: null }

    const { data: hqOrgs } = await admin
      .from('organizations')
      .select('id, org_name, org_type_code, is_active, created_at')
      .eq('org_type_code', 'HQ')
      .order('created_at', { ascending: true })

    const { data: ownConfigs } = resolvedOrgId
      ? await admin
          .from('notification_provider_configs')
          .select('id, org_id, channel, provider_name, is_active, created_at')
          .eq('org_id', resolvedOrgId)
      : { data: null }

    const hqId = hqOrgs?.[0]?.id
    const { data: hqConfigs } = hqId
      ? await admin
          .from('notification_provider_configs')
          .select('id, org_id, channel, provider_name, is_active, created_at')
          .eq('org_id', hqId)
      : { data: null }

    // Call the EXACT same function the real send path calls, with the
    // EXACT same orgId we just resolved -- if this returns a config but
    // the real send still fails, the bug is not in the lookup at all.
    let liveLookupResult: any = null
    let liveLookupError: string | null = null
    try {
      liveLookupResult = await loadActiveSmsProviderConfig(admin, resolvedOrgId)
    } catch (e: any) {
      liveLookupError = e?.message || String(e)
    }

    // What org_id actually got stored on the outbox rows for this order?
    // (queue_notification is a Postgres RPC -- worth checking it didn't
    // silently store something different from what we computed above.)
    const { data: outboxRows } = await admin
      .from('notifications_outbox')
      .select('id, org_id, event_code, channel, status, provider_name, error, created_at')
      .contains('payload_json', { order_no: order.display_doc_no || order.order_no })
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      order: {
        id: order.id,
        order_no: order.order_no,
        display_doc_no: order.display_doc_no,
        status: order.status,
        company_id: order.company_id,
        buyer_org_id: order.buyer_org_id,
        seller_org_id: order.seller_org_id,
      },
      resolvedOrgId,
      resolvedOrg,
      hqOrgs,
      ownConfigs,
      hqConfigs,
      // Credentials live on the same row, so only echo the identifying fields.
      liveLookupResult: liveLookupResult
        ? {
            id: liveLookupResult.id,
            org_id: liveLookupResult.org_id,
            channel: liveLookupResult.channel,
            provider_name: liveLookupResult.provider_name,
            is_active: liveLookupResult.is_active,
            created_at: liveLookupResult.created_at,
          }
        : null,
      liveLookupError,
      outboxRows,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Debug check failed' }, { status: 500 })
  }
}
