import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const INBOX_TABLE = 'messaging_warehouse_inbox'

/**
 * The messaging fulfilment migrations are optional per environment: an
 * environment that has not received them has no messaging_warehouse_inbox at
 * all, and PostgREST answers the read with Postgres 42P01 (undefined_table).
 * That is a "feature not installed here" signal, not a fault, so the route
 * reports an empty inbox instead of a 500. PostgREST reports the same absence
 * two ways: Postgres 42P01 when it runs the query, PGRST205 when the table is
 * simply not in its schema cache. Both are only ever treated as "not installed"
 * when the message names this table - every other database error still
 * propagates, and this must not become a blanket catch.
 */
function isInboxTableMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof message !== 'string' || !message.includes(INBOX_TABLE)) return false
  return code === '42P01' || code === 'PGRST205'
}

/**
 * Warehouse incoming queue for messaging D2H orders (after HQ approve).
 * Additive — does not replace Serapp hold accept or classic Current Orders.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select('id, organization_id, organizations:organization_id ( id, org_type_code, parent_org_id )')
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const organization = Array.isArray(requester.organizations)
      ? requester.organizations[0]
      : requester.organizations
    const orgType = String(organization?.org_type_code || '').toUpperCase()

    if (!['HQ', 'WH'].includes(orgType)) {
      return NextResponse.json({ error: 'Warehouse inbox is available to HQ and warehouse users only.' }, { status: 403 })
    }

    const admin = createAdminClient()
    let query = admin
      .from(INBOX_TABLE)
      .select(`
        id,
        order_id,
        company_id,
        buyer_org_id,
        seller_hq_id,
        fulfillment_warehouse_id,
        source_channel,
        status,
        order_no,
        receipt_status,
        created_at,
        updated_at,
        delivery_method,
        delivery_reference,
        prepared_started_at,
        ready_at,
        shipped_at
      `)
      .or('status.in.(pending_preparation,preparing,awaiting_partial_confirmation,ready_to_ship),and(status.eq.shipped,receipt_status.in.(pending_receipt,discrepancy_pending))')
      .order('created_at', { ascending: false })
      .limit(50)

    if (orgType === 'WH') {
      query = query.eq('fulfillment_warehouse_id', requester.organization_id)
    } else {
      query = query.eq('seller_hq_id', requester.organization_id)
    }

    const { data: rows, error } = await query

    if (error) {
      if (isInboxTableMissing(error)) {
        return NextResponse.json({
          items: [],
          actor: { orgType, organizationId: requester.organization_id },
          messagingAvailable: false,
        })
      }
      throw error
    }

    return NextResponse.json({
      items: rows || [],
      actor: { orgType, organizationId: requester.organization_id },
      messagingAvailable: true,
    })
  } catch (error) {
    console.error('[messaging/warehouse-inbox]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load warehouse inbox.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
