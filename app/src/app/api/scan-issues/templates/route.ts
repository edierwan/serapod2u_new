import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/scan-issues/templates — list templates (org + global)
 * POST /api/scan-issues/templates — create
 * PATCH /api/scan-issues/templates?id=... — update by id
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')

  let query = supabase
    .from('consumer_scan_issue_templates')
    .select('*')
    .order('recipient_type', { ascending: true })
    .order('template_key', { ascending: true })

  if (orgId) query = query.or(`org_id.eq.${orgId},org_id.is.null`)
  else query = query.is('org_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ templates: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  if (!body.template_key || !body.template_name || !body.body || !body.recipient_type) {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
  }
  const insert = {
    org_id: body.org_id || null,
    template_key: String(body.template_key),
    template_name: String(body.template_name),
    recipient_type: body.recipient_type,
    body: String(body.body),
    is_active: body.is_active !== false,
  }
  const { data, error } = await supabase
    .from('consumer_scan_issue_templates')
    .insert(insert)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ template: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const update: Record<string, any> = {}
  if (typeof body.template_name === 'string') update.template_name = body.template_name
  if (typeof body.body === 'string') update.body = body.body
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('consumer_scan_issue_templates')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ template: data })
}
