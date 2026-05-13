import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/scan-issues/[id]/notify
 *
 * Body:
 *   template_key: 'issue_acknowledgement' | 'issue_resolved_rescan' | 'general_reminder'
 *   recipient_type: 'consumer' | 'admin'
 *   support_note?: string
 *   rescan_link?: string
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'server config error' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const templateKey = String(body.template_key || 'issue_acknowledgement')
  const recipientType = body.recipient_type === 'admin' ? 'admin' : 'consumer'
  const supportNote = body.support_note || ''
  const rescanLink = body.rescan_link || ''

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: issue } = await supabaseAdmin
    .from('consumer_scan_issues')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (!issue) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const orgId: string | null = issue.org_id || null
  let tpl: any = null
  if (orgId) {
    const { data } = await supabaseAdmin
      .from('consumer_scan_issue_templates')
      .select('body')
      .eq('org_id', orgId)
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .maybeSingle()
    tpl = data
  }
  if (!tpl) {
    const { data } = await supabaseAdmin
      .from('consumer_scan_issue_templates')
      .select('body')
      .is('org_id', null)
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .maybeSingle()
    tpl = data
  }
  if (!tpl?.body) return NextResponse.json({ error: 'template not found' }, { status: 404 })

  const scanTimeKL = new Date(issue.scan_attempted_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })
  const vars: Record<string, string | number> = {
    name: issue.consumer_name_snapshot || 'there',
    consumer_phone: issue.consumer_phone_snapshot || '',
    qr_code: issue.qr_code_text,
    order_no: issue.display_doc_no_snapshot || issue.order_no_snapshot || '',
    product_name: issue.product_name_snapshot || '',
    issue_type: issue.issue_type,
    error_message: issue.error_message,
    scan_time: scanTimeKL,
    issue_no: issue.issue_no,
    priority: issue.priority,
    support_note: supportNote,
    rescan_link: rescanLink,
  }
  const text = String(tpl.body)
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => String(vars[k] ?? ''))
    .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_m, k) => String(vars[k] ?? ''))

  // Resolve recipients
  let recipients: string[] = []
  if (recipientType === 'consumer') {
    if (issue.consumer_whatsapp_number) recipients = [issue.consumer_whatsapp_number]
  } else {
    if (orgId) {
      const { data: settings } = await supabaseAdmin
        .from('consumer_scan_issue_settings')
        .select('admin_whatsapp_numbers')
        .eq('org_id', orgId)
        .maybeSingle()
      const nums = Array.isArray(settings?.admin_whatsapp_numbers)
        ? settings!.admin_whatsapp_numbers
        : []
      recipients = nums.map((n: any) => String(n))
    }
  }
  if (recipients.length === 0) return NextResponse.json({ error: 'no recipients' }, { status: 400 })

  const { getWhatsAppConfig, callGateway } = await import('@/app/api/settings/whatsapp/_utils')
  const cfg = orgId ? await getWhatsAppConfig(supabaseAdmin as any, orgId) : null
  if (!cfg?.baseUrl || !cfg?.apiKey) {
    return NextResponse.json({ error: 'No active WhatsApp gateway config for this org' }, { status: 400 })
  }

  const { toProviderPhone } = await import('@/utils/phone')
  const results: Array<{ to: string; ok: boolean; error?: string; messageId?: string }> = []
  for (const raw of recipients) {
    const provider = toProviderPhone('+' + String(raw).replace(/^\+/, ''))
    if (!provider) { results.push({ to: raw, ok: false, error: 'phone_normalize_failed' }); continue }
    try {
      const r = await callGateway(cfg.baseUrl, cfg.apiKey, 'POST', '/messages/send', { to: provider, text }, cfg.tenantId)
      const ok = !(r?.success === false || r?.ok === false)
      results.push({ to: provider, ok, messageId: r?.messageId || r?.message_id, error: ok ? undefined : (r?.error || 'gateway_rejected') })
    } catch (err: any) {
      results.push({ to: provider, ok: false, error: err?.message || 'send_failed' })
    }
  }

  const anyOk = results.some((r) => r.ok)
  const updateCol: Record<string, any> = {}
  if (templateKey === 'issue_resolved_rescan') {
    updateCol.rescan_notification_status = anyOk ? 'sent' : 'failed'
    if (anyOk) updateCol.rescan_notification_sent_at = new Date().toISOString()
  } else if (recipientType === 'consumer') {
    updateCol.consumer_notification_status = anyOk ? 'sent' : 'failed'
    updateCol.consumer_notification_template_key = templateKey
    if (anyOk) updateCol.consumer_notification_sent_at = new Date().toISOString()
    if (!anyOk) updateCol.consumer_notification_error = results.find((r) => !r.ok)?.error || 'unknown'
  } else {
    updateCol.admin_notification_status = anyOk ? 'sent' : 'failed'
    if (anyOk) updateCol.admin_notification_sent_at = new Date().toISOString()
    if (!anyOk) updateCol.admin_notification_error = results.find((r) => !r.ok)?.error || 'unknown'
  }
  await supabaseAdmin.from('consumer_scan_issues').update(updateCol).eq('id', params.id)

  return NextResponse.json({ ok: anyOk, results })
}
