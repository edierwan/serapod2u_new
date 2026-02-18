import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Admin role codes that are allowed to manage hero config
const ADMIN_ROLES = ['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin']

// ── Helpers ─────────────────────────────────────────────────────────

async function getAuthenticatedAdmin(supabase: any) {
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const adminClient = createAdminClient()

    // Query user profile (avoid roles join — FK may not exist)
    const { data: profile, error: profileErr } = await adminClient
      .from('users')
      .select('id, organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile) return null

    // Check role via allowlist
    if (!ADMIN_ROLES.includes(profile.role_code)) return null

    // Verify org is HQ type
    const orgId = profile.organization_id
    if (!orgId) return null

    const { data: org } = await adminClient
      .from('organizations')
      .select('org_type_code')
      .eq('id', orgId)
      .single()

    if (!org || org.org_type_code !== 'HQ') return null

    return { userId: user.id, orgId }
  } catch (err) {
    console.error('[getAuthenticatedAdmin] Error:', err)
    return null
  }
}

// ── GET /api/admin/store/hero-config ────────────────────────────────

export async function GET() {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('store_hero_config' as any)
      .select('*')
      .eq('org_id', admin.orgId)
      .maybeSingle()

    if (error) {
      console.error('[hero-config] GET error:', error)
      // Table might not exist yet — return defaults
      return NextResponse.json({
        config: {
          layout_type: 'carousel',
          auto_rotate_interval: 6000,
          max_slides: 5,
        },
      })
    }

    return NextResponse.json({
      config: data || {
        layout_type: 'carousel',
        auto_rotate_interval: 6000,
        max_slides: 5,
      },
    })
  } catch (err) {
    console.error('[hero-config] GET unexpected error:', err)
    return NextResponse.json({
      config: {
        layout_type: 'carousel',
        auto_rotate_interval: 6000,
        max_slides: 5,
      },
    })
  }
}

// ── PUT /api/admin/store/hero-config ────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { layout_type, auto_rotate_interval, max_slides } = body

    const adminClient = createAdminClient()

    // Upsert hero config — one row per org
    const { data, error } = await adminClient
      .from('store_hero_config' as any)
      .upsert(
        {
          org_id: admin.orgId,
          layout_type: layout_type || 'carousel',
          auto_rotate_interval: auto_rotate_interval ?? 6000,
          max_slides: max_slides ?? 5,
          updated_at: new Date().toISOString(),
          updated_by: admin.userId,
        },
        { onConflict: 'org_id' }
      )
      .select()
      .single()

    if (error) {
      console.error('[hero-config] PUT DB error:', error)
      return NextResponse.json({ error: error.message || 'Failed to save hero config' }, { status: 500 })
    }

    return NextResponse.json({ config: data })
  } catch (err: any) {
    console.error('[hero-config] PUT error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to save hero config' }, { status: 500 })
  }
}
