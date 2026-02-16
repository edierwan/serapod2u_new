import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/storefront/banners
 * Public endpoint — returns active hero banners for the storefront.
 * No auth required.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('store_hero_banners' as any)
      .select('id, title, subtitle, badge_text, image_url, link_url, link_text, sort_order')
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('sort_order', { ascending: true })
      .limit(10)

    if (error) {
      console.error('[storefront/banners] GET error:', error)
      return NextResponse.json({ error: 'Failed to fetch banners' }, { status: 500 })
    }

    return NextResponse.json({ banners: data ?? [] })
  } catch (err) {
    console.error('[storefront/banners] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
