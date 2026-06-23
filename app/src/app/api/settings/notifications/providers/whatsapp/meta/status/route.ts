/**
 * GET /api/settings/notifications/providers/whatsapp/meta/status?wamid=...
 *
 * Returns the current delivery state of a previously-sent Meta WhatsApp message,
 * read from the whatsapp_message_logs delivery log. The UI polls this after a test
 * send so it can show the real status (accepted → sent → delivered → read / failed)
 * as Meta status webhooks arrive — instead of claiming delivery on HTTP 200.
 *
 * Admin-only and scoped to the caller's organization. Never returns secrets.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const wamid = (request.nextUrl.searchParams.get('wamid') || '').trim()
    if (!wamid) {
      return NextResponse.json({ error: 'wamid query parameter is required.' }, { status: 400 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    const orgId = userProfile?.organization_id || null

    let query = supabase
      .from('whatsapp_message_logs')
      .select('external_message_id, phone_e164, status, error_message, metadata, created_at')
      .eq('external_message_id', wamid)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)

    // Scope to the caller's org so an admin cannot read another tenant's logs.
    if (orgId) query = query.eq('tenant_id', orgId)

    const { data } = await query
    const row = data?.[0] as any
    if (!row) {
      return NextResponse.json({ found: false }, { status: 200 })
    }

    const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {}
    const timestamps = metadata.timestamps || {}

    return NextResponse.json({
      found: true,
      wamid: row.external_message_id,
      recipient: metadata.recipient_display || row.phone_e164 || null,
      status: row.status || 'accepted',
      accepted_at: timestamps.accepted || metadata.accepted_at || row.created_at || null,
      sent_at: timestamps.sent || null,
      delivered_at: timestamps.delivered || null,
      read_at: timestamps.read || null,
      failed_at: timestamps.failed || null,
      // Safe error surface only — code + message, never tokens/credentials.
      error: row.status === 'failed'
        ? { code: metadata.meta_error?.code ?? null, message: metadata.meta_error?.message || row.error_message || null }
        : null,
    })
  } catch (error: any) {
    console.error('[meta-status] failed:', error?.message || error)
    return NextResponse.json({ error: error?.message || 'Failed to read delivery status' }, { status: 500 })
  }
}
