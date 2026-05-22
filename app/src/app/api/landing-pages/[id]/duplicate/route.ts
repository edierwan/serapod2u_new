import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { ensureUniqueLandingPageSlug, fetchLandingPageDetail, replaceLandingPageProducts } from '@/lib/landing-pages/admin-data'
import { normalizeLandingPageSlug } from '@/lib/landing-pages/slug'

async function nextCopySlug(adminClient: any, slug: string) {
  for (let index = 1; index < 50; index += 1) {
    const candidate = normalizeLandingPageSlug(`${slug}-copy${index === 1 ? '' : `-${index}`}`)
    try {
      await ensureUniqueLandingPageSlug(adminClient, candidate)
      return candidate
    } catch {
      continue
    }
  }
  return normalizeLandingPageSlug(`${slug}-copy-${Date.now()}`)
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { adminClient, organizationId, user } = await requireLandingPageAdmin()
    const existing = await fetchLandingPageDetail(adminClient, id, organizationId)
    if (!existing) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })

    const slug = await nextCopySlug(adminClient, existing.slug)
    const { data: page, error } = await adminClient
      .from('landing_pages')
      .insert({
        organization_id: organizationId,
        internal_name: `${existing.internal_name} Copy`,
        public_title: `${existing.public_title} Copy`,
        slug,
        description: existing.description,
        status: 'draft',
        source_mode: existing.source_mode,
        category_id: existing.category_id,
        max_products: existing.max_products,
        hero: existing.hero,
        display_settings: existing.display_settings,
        tracking_defaults: existing.tracking_defaults,
        publish_start_at: null,
        publish_end_at: null,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('id')
      .single()

    if (error || !page) throw error || new Error('Landing page was not duplicated.')
    await replaceLandingPageProducts(adminClient, page.id, existing.selected_product_ids)
    return NextResponse.json({ success: true, data: await fetchLandingPageDetail(adminClient, page.id, organizationId) }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
  }
}