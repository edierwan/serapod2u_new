import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Helpers ─────────────────────────────────────────────────────────

async function getAuthenticatedAdmin(supabase: any) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('id, organization_id, role_code, organizations(id, org_type_code), roles(role_level)')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  const orgType = (profile.organizations as any)?.org_type_code
  const roleLevel = (profile.roles as any)?.role_level
  if (orgType !== 'HQ' || roleLevel > 30) return null

  return { userId: user.id, orgId: profile.organization_id }
}

// ── GET /api/admin/store/banners ────────────────────────────────────
// List ALL banners for the admin's org (including inactive)

export async function GET() {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('store_hero_banners' as any)
      .select('*')
      .eq('org_id', admin.orgId)
      .order('sort_order', { ascending: true })

    if (error) throw error
    return NextResponse.json({ banners: data ?? [] })
  } catch (err) {
    console.error('[admin/store/banners] GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch banners' }, { status: 500 })
  }
}

// ── POST /api/admin/store/banners ───────────────────────────────────
// Create a new banner

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, subtitle, badge_text, image_url, link_url, link_text, sort_order, is_active, starts_at, ends_at, layout_slot } = body

    if (!image_url) {
      return NextResponse.json({ error: 'image_url is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('store_hero_banners' as any)
      .insert({
        org_id: admin.orgId,
        title: title || '',
        subtitle: subtitle || '',
        badge_text: badge_text || '',
        image_url,
        link_url: link_url || '/store/products',
        link_text: link_text || 'Shop Now',
        sort_order: sort_order ?? 0,
        is_active: is_active ?? true,
        starts_at: starts_at ? new Date(starts_at).toISOString() : new Date().toISOString(),
        ends_at: ends_at ? new Date(ends_at).toISOString() : null,
        layout_slot: layout_slot || 'carousel',
        created_by: admin.userId,
        updated_by: admin.userId,
      })
      .select()
      .single()

    if (error) {
      console.error('[admin/store/banners] POST DB error:', error)
      return NextResponse.json({ error: error.message || 'Database error creating banner' }, { status: 500 })
    }
    return NextResponse.json({ banner: data }, { status: 201 })
  } catch (err: any) {
    console.error('[admin/store/banners] POST error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to create banner' }, { status: 500 })
  }
}

// ── PUT /api/admin/store/banners ────────────────────────────────────
// Update an existing banner (expects { id, ...fields })

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Banner id is required' }, { status: 400 })
    }

    // Clean up date fields if present
    if (updates.starts_at) updates.starts_at = new Date(updates.starts_at).toISOString()
    if (updates.ends_at) updates.ends_at = new Date(updates.ends_at).toISOString()

    // Ensure updated_by is set
    updates.updated_by = admin.userId

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('store_hero_banners' as any)
      .update(updates)
      .eq('id', id)
      .eq('org_id', admin.orgId)
      .select()
      .single()

    if (error) {
      console.error('[admin/store/banners] PUT DB error:', error)
      return NextResponse.json({ error: error.message || 'Failed to update banner' }, { status: 500 })
    }
    return NextResponse.json({ banner: data })
  } catch (err) {
    console.error('[admin/store/banners] PUT error:', err)
    return NextResponse.json({ error: 'Failed to update banner' }, { status: 500 })
  }
}

// ── DELETE /api/admin/store/banners ─────────────────────────────────
// Delete a banner (expects ?id=xxx or body { id })

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await getAuthenticatedAdmin(supabase)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    let id = url.searchParams.get('id')
    if (!id) {
      const body = await request.json().catch(() => ({}))
      id = body.id
    }

    if (!id) {
      return NextResponse.json({ error: 'Banner id is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('store_hero_banners' as any)
      .delete()
      .eq('id', id)
      .eq('org_id', admin.orgId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/store/banners] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete banner' }, { status: 500 })
  }
}
