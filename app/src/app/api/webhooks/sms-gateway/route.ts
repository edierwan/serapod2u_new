/**
 * SMS gateway status webhooks.
 *
 * POST /api/webhooks/sms-gateway
 * Events: sms:sent, sms:delivered, sms:failed
 *
 * Matches the outbound notification_logs row by message_id / external_id.
 * delivered and failed are final statuses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applySmsGatewayWebhook } from '@/lib/notifications/sms-send'

export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const header = request.headers.get('authorization') || ''
  const username = String(process.env.SMS_GATEWAY_USERNAME || '').trim()
  const password = String(process.env.SMS_GATEWAY_PASSWORD || '').trim()
  if (!header) return true
  if (!header.startsWith('Basic ') || !username || !password) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString()
  const sep = decoded.indexOf(':')
  const user = sep >= 0 ? decoded.slice(0, sep) : decoded
  const pass = sep >= 0 ? decoded.slice(sep + 1) : ''
  return user === username && pass === password
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: any = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const result = await applySmsGatewayWebhook(admin, payload)
    console.log('[sms-gateway webhook]', {
      event: payload?.event || payload?.type || payload?.event_type,
      messageId: result.messageId,
      status: result.status,
      updated: result.updated,
    })
    return NextResponse.json({
      success: true,
      updated: result.updated,
      status: result.status,
      message_id: result.messageId,
    })
  } catch (error: any) {
    console.error('[sms-gateway webhook]', error)
    return NextResponse.json({ error: error.message || 'Webhook failed' }, { status: 500 })
  }
}
