import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/scan-issues
 *   List scan issues for the caller's org (admin/HQ/power user only via RLS).
 *
 * Query params:
 *   status, issue_type, priority, q (search), date_from, date_to, page, page_size
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || ''
  const issueType = searchParams.get('issue_type') || ''
  const priority = searchParams.get('priority') || ''
  const q = (searchParams.get('q') || '').trim()
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
  const pageSize = Math.min(Math.max(parseInt(searchParams.get('page_size') || '20', 10), 1), 100)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('consumer_scan_issues')
    .select('*', { count: 'exact' })
    .order('scan_attempted_at', { ascending: false })
    .range(from, to)

  if (status && status !== 'all') query = query.eq('status', status)
  if (issueType && issueType !== 'all') query = query.eq('issue_type', issueType)
  if (priority && priority !== 'all') query = query.eq('priority', priority)
  if (dateFrom) query = query.gte('scan_attempted_at', dateFrom)
  if (dateTo) query = query.lte('scan_attempted_at', dateTo)

  if (q) {
    const like = `%${q}%`
    // Match any of qr_code_text, issue_no, consumer phone snapshot, order_no snapshot
    query = query.or(
      [
        `qr_code_text.ilike.${like}`,
        `issue_no.ilike.${like}`,
        `consumer_phone_snapshot.ilike.${like}`,
        `consumer_whatsapp_number.ilike.${like}`,
        `order_no_snapshot.ilike.${like}`,
        `display_doc_no_snapshot.ilike.${like}`,
      ].join(','),
    )
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // KPI cards (separate cheap counts using HEAD requests)
  const todayKL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  const todayKey = todayKL.toISOString().slice(0, 10)

  const [{ count: total }, { count: pending }, { count: resolvedToday }, { count: highPriority }] = await Promise.all([
    supabase.from('consumer_scan_issues').select('id', { count: 'exact', head: true }),
    supabase.from('consumer_scan_issues').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('consumer_scan_issues').select('id', { count: 'exact', head: true }).eq('status', 'resolved').eq('scan_date', todayKey),
    supabase.from('consumer_scan_issues').select('id', { count: 'exact', head: true }).eq('priority', 'high').neq('status', 'resolved'),
  ])

  return NextResponse.json({
    rows: data || [],
    total_count: count || 0,
    kpis: {
      total_issues: total || 0,
      pending: pending || 0,
      resolved_today: resolvedToday || 0,
      high_priority: highPriority || 0,
    },
  })
}

/**
 * POST /api/scan-issues
 *   Manual "Report an Issue" — admin records an issue not auto-captured.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, any>
  if (!body.qr_code_text || !body.issue_type || !body.error_message) {
    return NextResponse.json({ error: 'qr_code_text, issue_type, and error_message are required' }, { status: 400 })
  }

  const insert: Record<string, any> = {
    qr_code_text: String(body.qr_code_text),
    issue_type: String(body.issue_type),
    error_message: String(body.error_message),
    error_code: body.error_code || null,
    user_facing_message: body.user_facing_message || null,
    priority: body.priority || 'medium',
    consumer_phone_snapshot: body.consumer_phone || null,
    consumer_name_snapshot: body.consumer_name || null,
    consumer_email_snapshot: body.consumer_email || null,
    order_no_snapshot: body.order_no || null,
    source_page: 'manual_report',
    metadata: { reported_by: user.id },
  }

  const { data, error } = await supabase
    .from('consumer_scan_issues')
    .insert(insert)
    .select('id, issue_no')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ id: data.id, issue_no: data.issue_no })
}
