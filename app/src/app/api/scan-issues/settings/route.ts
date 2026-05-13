import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizePhoneE164 } from '@/utils/phone'

/**
 * GET /api/scan-issues/settings?org_id=...
 * PUT /api/scan-issues/settings
 *
 * If org_id is omitted, defaults to user's organization_id from profile.
 */
async function resolveOrgId(supabase: any, userId: string, override?: string | null) {
  if (override) return override
  const { data } = await supabase
    .from('users')
    .select('organization_id, organizations!fk_users_organization(parent_org_id, org_type_code)')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null
  const org = (data as any).organizations
  // For HQ users, return their org id; for SHOP/INDEP users, use parent (HQ)
  if (!org) return data.organization_id || null
  if (org.org_type_code === 'HQ') return data.organization_id
  return org.parent_org_id || data.organization_id
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const orgId = await resolveOrgId(supabase, user.id, searchParams.get('org_id'))
  if (!orgId) return NextResponse.json({ error: 'no org context' }, { status: 400 })

  const { data } = await supabase
    .from('consumer_scan_issue_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()

  return NextResponse.json({
    org_id: orgId,
    settings: data || {
      org_id: orgId,
      admin_whatsapp_numbers: [],
      notify_on_new_issue: true,
      notify_on_high_priority: true,
      notify_on_status_change: false,
      notify_on_resolved: false,
      consumer_dedup_window_minutes: 60,
    },
  })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const orgId = await resolveOrgId(supabase, user.id, body.org_id)
  if (!orgId) return NextResponse.json({ error: 'no org context' }, { status: 400 })

  // Normalize each WhatsApp number to digits-only E.164 (no '+')
  const rawNumbers: any[] = Array.isArray(body.admin_whatsapp_numbers) ? body.admin_whatsapp_numbers : []
  const normalized: string[] = []
  const invalid: string[] = []
  for (const raw of rawNumbers) {
    const e164 = normalizePhoneE164(String(raw))
    if (e164) normalized.push(e164.replace(/^\+/, ''))
    else if (String(raw).trim()) invalid.push(String(raw))
  }

  const upsertRow: Record<string, any> = {
    org_id: orgId,
    admin_whatsapp_numbers: normalized,
  }
  if (typeof body.notify_on_new_issue === 'boolean') upsertRow.notify_on_new_issue = body.notify_on_new_issue
  if (typeof body.notify_on_high_priority === 'boolean') upsertRow.notify_on_high_priority = body.notify_on_high_priority
  if (typeof body.notify_on_status_change === 'boolean') upsertRow.notify_on_status_change = body.notify_on_status_change
  if (typeof body.notify_on_resolved === 'boolean') upsertRow.notify_on_resolved = body.notify_on_resolved
  if (typeof body.consumer_dedup_window_minutes === 'number') upsertRow.consumer_dedup_window_minutes = body.consumer_dedup_window_minutes

  const { data, error } = await supabase
    .from('consumer_scan_issue_settings')
    .upsert(upsertRow, { onConflict: 'org_id' })
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ settings: data, invalid_numbers: invalid })
}
