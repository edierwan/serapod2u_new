import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireAdmin(request: NextRequest) {
  const { createClient: createServerClient } = await import('@/lib/supabase/server')
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('id, role_code, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['SA', 'HQ', 'POWER_USER'].includes(profile.role_code)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, profile, admin }
}

/**
 * GET /api/admin/user-shop-migration
 * Fetch consumers with their shop match status
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth && auth.error instanceof NextResponse) return auth.error
  const { admin } = auth as { admin: ReturnType<typeof getAdminClient>; user: any; profile: any }

  try {
    const { data, error } = await admin
      .from('v_user_shop_migration')
      .select('*')
      .order('match_status', { ascending: true })
      .order('current_shop_name', { ascending: true })

    if (error) throw error

    // Get summary counts
    const summary = {
      total: data?.length ?? 0,
      linked: data?.filter(d => d.match_status === 'linked').length ?? 0,
      auto_matchable: data?.filter(d => d.match_status === 'auto_matchable').length ?? 0,
      unmatched: data?.filter(d => d.match_status === 'unmatched').length ?? 0,
      no_shop: data?.filter(d => d.match_status === 'no_shop').length ?? 0,
    }

    return NextResponse.json({ success: true, data, summary })
  } catch (err: any) {
    console.error('user-shop-migration GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/user-shop-migration
 * Body: { action: 'auto_match' | 'assign', assignments?: { user_id: string, org_id: string }[] }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth && auth.error instanceof NextResponse) return auth.error
  const { admin } = auth as { admin: ReturnType<typeof getAdminClient>; user: any; profile: any }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'auto_match') {
      // Auto-match consumers whose shop_name matches an org_name (case-insensitive)
      const { data: matchable, error: fetchErr } = await admin
        .from('v_user_shop_migration')
        .select('user_id, matched_org_id')
        .eq('match_status', 'auto_matchable')

      if (fetchErr) throw fetchErr

      if (!matchable || matchable.length === 0) {
        return NextResponse.json({ success: true, matched: 0, message: 'No auto-matchable consumers found' })
      }

      let matched = 0
      let errors: string[] = []

      for (const row of matchable) {
        const { error: updateErr } = await admin
          .from('users')
          .update({ organization_id: row.matched_org_id })
          .eq('id', row.user_id)

        if (updateErr) {
          errors.push(`${row.user_id}: ${updateErr.message}`)
        } else {
          matched++
        }
      }

      return NextResponse.json({
        success: true,
        matched,
        total: matchable.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Auto-matched ${matched} of ${matchable.length} consumers to shop organizations`
      })
    }

    if (action === 'assign') {
      const { assignments } = body as { assignments: { user_id: string; org_id: string }[] }

      if (!Array.isArray(assignments) || assignments.length === 0) {
        return NextResponse.json({ error: 'assignments array required' }, { status: 400 })
      }

      // Validate that all org_ids exist and are SHOP type
      const orgIds = [...new Set(assignments.map(a => a.org_id))]
      const { data: orgs, error: orgErr } = await admin
        .from('organizations')
        .select('id')
        .in('id', orgIds)
        .eq('org_type_code', 'SHOP')

      if (orgErr) throw orgErr

      const validOrgIds = new Set(orgs?.map(o => o.id) ?? [])
      const invalidOrgs = orgIds.filter(id => !validOrgIds.has(id))
      if (invalidOrgs.length > 0) {
        return NextResponse.json({
          error: `Invalid or non-SHOP organizations: ${invalidOrgs.join(', ')}`
        }, { status: 400 })
      }

      let assigned = 0
      let errors: string[] = []

      for (const { user_id, org_id } of assignments) {
        const { error: updateErr } = await admin
          .from('users')
          .update({ organization_id: org_id })
          .eq('id', user_id)

        if (updateErr) {
          errors.push(`${user_id}: ${updateErr.message}`)
        } else {
          assigned++
        }
      }

      return NextResponse.json({
        success: true,
        assigned,
        total: assignments.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Assigned ${assigned} of ${assignments.length} consumers`
      })
    }

    if (action === 'unlink') {
      const { user_ids } = body as { user_ids: string[] }
      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return NextResponse.json({ error: 'user_ids array required' }, { status: 400 })
      }

      let unlinked = 0
      for (const uid of user_ids) {
        const { error: updateErr } = await admin
          .from('users')
          .update({ organization_id: null })
          .eq('id', uid)

        if (updateErr) {
          console.error(`Unlink error for ${uid}:`, updateErr)
        } else {
          unlinked++
        }
      }

      return NextResponse.json({
        success: true,
        unlinked,
        total: user_ids.length,
        message: `Unlinked ${unlinked} consumers from their shops`
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use auto_match, assign, or unlink' }, { status: 400 })
  } catch (err: any) {
    console.error('user-shop-migration POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
